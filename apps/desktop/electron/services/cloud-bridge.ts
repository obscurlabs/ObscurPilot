import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  CloudAuthProjectionSchema,
  type CloudAuthProjection,
  type CloudConfirmationPayload,
  type CloudCredentialPayload,
} from '@obscurpilot/contracts/cloud';
import type { ConnectionProjection } from '@obscurpilot/contracts/state';
import {
  CloudConflictError,
  CloudRepository,
  RealtimeSyncCoordinator,
  createStagePilotSupabaseClient,
  type AsyncAuthStorage,
  type StagePilotSupabaseClient,
} from '@obscurpilot/adapters/supabase';
import { z } from 'zod';
import type { ZodType } from 'zod';
import {
  EncryptedJsonStore,
  requireSecureEncryptionProvider,
  type EncryptionProvider,
} from '../storage/encrypted-json-store.js';
import { safeStorage } from 'electron';
import { createCloudOutbox } from './cloud-outbox.js';
import type { BoundedDurableOutbox } from '@obscurpilot/domain/durable-outbox';
import type { Json } from '@obscurpilot/adapters/supabase';
import type { ToolGrant } from '@obscurpilot/domain/policy';

const AuthValuesSchema = z.record(z.string().min(1).max(256), z.string().max(2 * 1024 * 1024));
const CLOUD_AUTH_CALLBACK = 'obscurpilot://auth/callback';
const DeviceIdentitySchema = z
  .object({
    publicId: z.string().uuid(),
  })
  .strict();
const FunctionFaultSchema = z
  .object({ reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u) })
  .passthrough();

export interface CloudBridgeConfig {
  readonly url: string;
  readonly publishableKey: string;
  readonly appVersion: string;
  readonly userDataPath: string;
  readonly platform: 'win32' | 'darwin' | 'linux';
  readonly onConnection: (projection: ConnectionProjection) => void;
}

class EncryptedAuthStorage implements AsyncAuthStorage {
  private values: Record<string, string> | undefined;
  private pending: Promise<void> = Promise.resolve();

  public constructor(private readonly store: EncryptedJsonStore<Record<string, string>>) {}

  public async getItem(key: string): Promise<string | null> {
    validateAuthStorageKey(key);
    await this.pending;
    const values = await this.load();
    return values[key] ?? null;
  }

  public setItem(key: string, value: string): Promise<void> {
    validateAuthStorageKey(key);
    return this.serialize(async () => {
      const values = await this.load();
      const next = AuthValuesSchema.parse({ ...values, [key]: value });
      await this.store.save(next);
      this.values = next;
    });
  }

  public removeItem(key: string): Promise<void> {
    validateAuthStorageKey(key);
    return this.serialize(async () => {
      const values = await this.load();
      const next = { ...values };
      delete next[key];
      await this.store.save(next);
      this.values = next;
    });
  }

  private async load(): Promise<Record<string, string>> {
    this.values ??= await this.store.load();
    return this.values;
  }

  private serialize(task: () => Promise<void>): Promise<void> {
    const run = this.pending.then(task, task);
    this.pending = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export class CloudBridge {
  private readonly client: StagePilotSupabaseClient;
  private readonly repository: CloudRepository;
  private readonly sync: RealtimeSyncCoordinator;
  private readonly outbox: BoundedDurableOutbox;
  private readonly encryption: EncryptionProvider;
  private readonly outboxAbort = new AbortController();
  private outboxRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private projection: CloudAuthProjection = {
    configured: true,
    phase: 'restoring',
    reasonCode: 'RESTORING',
  };
  private authSubscription: { unsubscribe(): void } | undefined;
  private synchronization: { key: string; promise: Promise<void> } | undefined;
  private toolGrants: readonly ToolGrant[] = [];
  private identityGeneration = 0;
  private disposed = false;

  public constructor(private readonly config: CloudBridgeConfig) {
    this.encryption = requireSecureEncryptionProvider(safeStorage, config.platform);
    const storage = new EncryptedAuthStorage(
      new EncryptedJsonStore(
        resolve(config.userDataPath, 'supabase-auth.enc'),
        AuthValuesSchema,
        () => ({}),
        this.encryption,
      ),
    );
    this.client = createStagePilotSupabaseClient({
      url: config.url,
      publishableKey: config.publishableKey,
      storage,
      appVersion: config.appVersion,
    });
    this.repository = new CloudRepository(this.client);
    this.outbox = createCloudOutbox(
      config.userDataPath,
      this.repository,
      () => this.projection.userId,
      this.encryption,
    );
    this.sync = new RealtimeSyncCoordinator(this.client, this.repository, {
      onState: (state, reasonCode, attempt) => {
        const phase =
          state === 'subscribed'
            ? 'ready'
            : state === 'backoff'
              ? 'backoff'
              : state === 'degraded'
                ? 'degraded'
                : state === 'stopped'
                  ? 'stopped'
                  : 'synchronizing';
        this.emitConnection(phase, reasonCode, attempt);
        if (state === 'subscribed') {
          this.restoreAuthenticatedProjection('SYNCHRONIZED');
          void this.flushOutbox();
        }
      },
      onCatchUp: () => undefined,
      onInvalidated: () => {
        void this.refreshProfile();
      },
    });
  }

  public snapshot(): CloudAuthProjection {
    return CloudAuthProjectionSchema.parse(this.projection);
  }

  public toolGrantSnapshot(): readonly ToolGrant[] {
    return this.toolGrants;
  }

  public async start(): Promise<void> {
    this.emitConnection('authenticating', 'RESTORING_SESSION', 0);
    const listener = this.client.auth.onAuthStateChange((event, session) => {
      if (this.disposed) return;
      const generation = this.acceptSession(session);
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (session !== null) {
          setTimeout(() => void this.synchronizeIdentity(session.user.id, generation), 0);
        }
      }
      if (event === 'SIGNED_OUT') {
        this.sync.stop();
        this.clearOutboxRetry();
        this.emitConnection('auth_required', 'SIGNED_OUT', 0);
      }
    });
    this.authSubscription = listener.data.subscription;
    this.client.auth.startAutoRefresh();

    const result = await this.client.auth.getSession();
    if (result.error !== null) {
      this.markDegraded('SESSION_RESTORE_FAILED');
      return;
    }
    const generation = this.acceptSession(result.data.session);
    if (result.data.session === null) {
      this.emitConnection('auth_required', 'SIGNED_OUT', 0);
      return;
    }
    await this.synchronizeIdentity(result.data.session.user.id, generation);
  }

  public async signIn(credentials: CloudCredentialPayload): Promise<CloudAuthProjection> {
    this.emitConnection('authenticating', 'SIGNING_IN', 0);
    const result = await this.client.auth.signInWithPassword(credentials);
    if (result.error !== null) {
      this.projection = { configured: true, phase: 'signed_out', reasonCode: 'SIGN_IN_REJECTED' };
      this.emitConnection('auth_required', 'SIGN_IN_REJECTED', 0);
      return this.snapshot();
    }
    const generation = this.acceptSession(result.data.session);
    await this.synchronizeIdentity(result.data.session.user.id, generation);
    return this.snapshot();
  }

  public async signUp(credentials: CloudCredentialPayload): Promise<CloudAuthProjection> {
    this.emitConnection('authenticating', 'SIGNING_UP', 0);
    const result = await this.client.auth.signUp({
      ...credentials,
      options: { emailRedirectTo: CLOUD_AUTH_CALLBACK },
    });
    if (result.error !== null) {
      this.projection = { configured: true, phase: 'signed_out', reasonCode: 'SIGN_UP_REJECTED' };
      this.emitConnection('auth_required', 'SIGN_UP_REJECTED', 0);
      return this.snapshot();
    }
    const generation = this.acceptSession(result.data.session);
    if (result.data.session !== null) {
      await this.synchronizeIdentity(result.data.session.user.id, generation);
    }
    return this.snapshot();
  }

  public async resendConfirmation(payload: CloudConfirmationPayload): Promise<void> {
    const result = await this.client.auth.resend({
      type: 'signup',
      email: payload.email,
      options: { emailRedirectTo: CLOUD_AUTH_CALLBACK },
    });
    if (result.error !== null) throw new Error('Confirmation email request was rejected');
  }

  public async handleAuthCallback(value: string): Promise<boolean> {
    const callback = parseCloudAuthCallback(value);
    if (callback === undefined) return false;
    if ('error' in callback) {
      this.projection = {
        configured: true,
        phase: 'signed_out',
        reasonCode: 'EMAIL_CONFIRMATION_REJECTED',
      };
      this.emitConnection('auth_required', 'EMAIL_CONFIRMATION_REJECTED', 0);
      return true;
    }
    const result = await this.client.auth.exchangeCodeForSession(callback.code);
    if (result.error !== null || result.data.session === null) {
      this.projection = {
        configured: true,
        phase: 'signed_out',
        reasonCode: 'EMAIL_CONFIRMATION_REJECTED',
      };
      this.emitConnection('auth_required', 'EMAIL_CONFIRMATION_REJECTED', 0);
      return true;
    }
    const generation = this.acceptSession(result.data.session);
    await this.synchronizeIdentity(result.data.session.user.id, generation);
    return true;
  }

  public async signOut(): Promise<CloudAuthProjection> {
    this.identityGeneration += 1;
    this.clearOutboxRetry();
    this.sync.stop();
    await this.client.removeAllChannels();
    const result = await this.client.auth.signOut({ scope: 'local' });
    if (result.error !== null) {
      this.markDegraded('SIGN_OUT_FAILED');
      return this.snapshot();
    }
    this.projection = { configured: true, phase: 'signed_out', reasonCode: 'SIGNED_OUT' };
    this.toolGrants = [];
    this.emitConnection('auth_required', 'SIGNED_OUT', 0);
    return this.snapshot();
  }

  public async requestAccountDeletion(): Promise<{ accepted: true }> {
    await this.repository.requestAccountDeletion();
    return { accepted: true };
  }

  public async recordCommandAudit(input: {
    correlationId: string;
    toolName: string;
    outcome: 'allowed' | 'denied' | 'failed' | 'cancelled';
    reasonCode: string;
    durationMs: number;
    metadata: Json;
  }): Promise<void> {
    const userId = this.projection.userId;
    if (userId === undefined) return;
    await this.repository.recordCommandAudit({ userId, ...input });
  }

  public async invokeFunction<T>(
    name: string,
    body: Readonly<Record<string, unknown>>,
    schema: ZodType<T>,
  ): Promise<T> {
    if (!/^[a-z][a-z0-9-]{1,62}$/u.test(name)) throw new Error('Invalid function name');
    const session = await this.client.auth.getSession();
    if (session.error !== null || session.data.session === null) {
      throw new Error('Cloud authorization is required');
    }
    const result = await this.client.functions.invoke(name, { body });
    if (result.error !== null) {
      throw new Error(await extractFunctionFaultReason(result.error));
    }
    return schema.parse(result.data);
  }

  public async queueProfileUpdate(input: {
    expectedRevision: number;
    displayName: string;
    locale: string;
    timeZone: string;
  }): Promise<{ mutationId: string; status: 'delivered' | 'queued' }> {
    const tenantId = this.projection.userId;
    if (tenantId === undefined) throw new Error('Cloud authorization is required');
    const mutationId = randomUUID();
    await this.outbox.enqueue({
      id: mutationId,
      idempotencyKey: mutationId,
      tenantId,
      aggregateId: tenantId + ':creator-profile',
      schemaVersion: 1,
      eventType: 'profile.update',
      occurredAt: new Date().toISOString(),
      payload: input,
    });
    const result = await this.outbox.flush(this.outboxAbort.signal);
    this.scheduleOutboxRetry(result.nextAttemptAt);
    if (result.rejectedIds.includes(mutationId)) throw new CloudConflictError();
    return {
      mutationId,
      status: result.deliveredIds.includes(mutationId) ? 'delivered' : 'queued',
    };
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    this.identityGeneration += 1;
    this.clearOutboxRetry();
    this.outboxAbort.abort();
    this.authSubscription?.unsubscribe();
    this.authSubscription = undefined;
    this.sync.stop();
    await this.client.removeAllChannels();
    this.client.auth.stopAutoRefresh();
  }

  private projectSession(session: { user: { id: string }; expires_at?: number } | null): void {
    this.projection =
      session === null
        ? { configured: true, phase: 'signed_out', reasonCode: 'SIGNED_OUT' }
        : {
            configured: true,
            phase: 'authenticated',
            userId: session.user.id,
            ...(session.expires_at === undefined
              ? {}
              : { expiresAt: new Date(session.expires_at * 1000).toISOString() }),
            reasonCode: 'SESSION_PRESENT',
          };
  }

  private acceptSession(session: { user: { id: string }; expires_at?: number } | null): number {
    const generation = ++this.identityGeneration;
    this.projectSession(session);
    if (session === null) {
      this.clearOutboxRetry();
      this.toolGrants = [];
    }
    return generation;
  }

  private async synchronizeIdentity(userId: string, generation: number): Promise<void> {
    if (!this.isCurrentIdentity(userId, generation)) return;
    const key = generation.toString(10) + ':' + userId;
    const active = this.synchronization;
    if (active !== undefined) {
      if (active.key === key) return active.promise;
      try {
        await active.promise;
      } catch {
        // The newer identity still needs its own synchronization attempt.
      }
      if (!this.isCurrentIdentity(userId, generation)) return;
    }
    const promise = this.performIdentitySynchronization(userId, generation);
    this.synchronization = { key, promise };
    try {
      await promise;
    } finally {
      if (this.synchronization?.promise === promise) this.synchronization = undefined;
    }
  }

  private async performIdentitySynchronization(userId: string, generation: number): Promise<void> {
    try {
      const userResult = await this.client.auth.getUser();
      if (
        !this.isCurrentIdentity(userId, generation) ||
        userResult.error !== null ||
        userResult.data.user === null ||
        userResult.data.user.id !== userId
      ) {
        if (!this.isCurrentIdentity(userId, generation)) return;
        this.markDegraded('IDENTITY_VALIDATION_FAILED');
        return;
      }
      this.emitConnection('synchronizing', 'REGISTERING_DEVICE', 0);
      const publicId = await this.getDevicePublicId();
      await this.repository.registerDevice({
        publicId,
        name: 'Desktop device',
        platform: this.config.platform,
        appVersion: this.config.appVersion,
      });
      await this.refreshToolGrants();
      if (!this.isCurrentIdentity(userId, generation)) return;
      const sessionResult = await this.client.auth.getSession();
      if (
        sessionResult.error !== null ||
        sessionResult.data.session === null ||
        sessionResult.data.session.user.id !== userId
      ) {
        this.markDegraded('IDENTITY_VALIDATION_FAILED');
        return;
      }
      this.projectSession(sessionResult.data.session);
      if (this.isCurrentIdentity(userId, generation)) this.sync.start(userId);
    } catch {
      if (this.isCurrentIdentity(userId, generation)) {
        this.markDegraded('DEVICE_REGISTRATION_FAILED');
      }
    }
  }

  private async getDevicePublicId(): Promise<string> {
    const store = new EncryptedJsonStore(
      resolve(this.config.userDataPath, 'device-identity.enc'),
      DeviceIdentitySchema,
      () => ({ publicId: randomUUID() }),
      this.encryption,
    );
    const identity = await store.load();
    await store.save(identity);
    return identity.publicId;
  }

  private async refreshProfile(): Promise<void> {
    try {
      await this.repository.getProfile();
      await this.refreshToolGrants();
    } catch {
      this.markDegraded('CATCH_UP_FAILED');
    }
  }

  private async refreshToolGrants(): Promise<void> {
    const persisted = await this.repository.getActiveToolGrants();
    this.toolGrants = persisted.map((grant) => ({
      toolName: grant.toolName,
      scopes: new Set(grant.scopes),
      expiresAt: Number.MAX_SAFE_INTEGER,
    }));
  }

  private async flushOutbox(): Promise<void> {
    try {
      const result = await this.outbox.flush(this.outboxAbort.signal);
      this.scheduleOutboxRetry(result.nextAttemptAt);
    } catch {
      this.markDegraded('OUTBOX_FLUSH_FAILED');
    }
  }

  private markDegraded(reasonCode: string): void {
    const identity =
      this.projection.userId === undefined
        ? {}
        : {
            userId: this.projection.userId,
            ...(this.projection.expiresAt === undefined
              ? {}
              : { expiresAt: this.projection.expiresAt }),
          };
    this.projection = { configured: true, phase: 'degraded', ...identity, reasonCode };
    this.emitConnection('degraded', reasonCode, 0);
  }

  private restoreAuthenticatedProjection(reasonCode: string): void {
    if (this.projection.userId === undefined) return;
    this.projection = {
      ...this.projection,
      configured: true,
      phase: 'authenticated',
      reasonCode,
    };
  }

  private isCurrentIdentity(userId: string, generation: number): boolean {
    return (
      !this.disposed && this.identityGeneration === generation && this.projection.userId === userId
    );
  }

  private scheduleOutboxRetry(nextAttemptAt: string | undefined): void {
    this.clearOutboxRetry();
    if (nextAttemptAt === undefined || this.disposed || this.projection.userId === undefined)
      return;
    const delay = Math.max(0, Math.min(5 * 60_000, Date.parse(nextAttemptAt) - Date.now()));
    this.outboxRetryTimer = setTimeout(() => {
      this.outboxRetryTimer = undefined;
      void this.flushOutbox();
    }, delay);
  }

  private clearOutboxRetry(): void {
    if (this.outboxRetryTimer !== undefined) clearTimeout(this.outboxRetryTimer);
    this.outboxRetryTimer = undefined;
  }

  private emitConnection(
    phase: ConnectionProjection['phase'],
    reasonCode: string,
    attempt: number,
  ): void {
    this.config.onConnection({
      provider: 'supabase',
      phase,
      attempt,
      changedAt: new Date().toISOString(),
      reasonCode,
      correlationId: randomUUID(),
    });
  }
}

export async function extractFunctionFaultReason(error: unknown): Promise<string> {
  if (typeof error !== 'object' || error === null || !('context' in error)) {
    return 'CLOUD_FUNCTION_FAILED';
  }
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return 'CLOUD_FUNCTION_FAILED';
  try {
    const parsed = FunctionFaultSchema.safeParse(await context.clone().json());
    return parsed.success ? parsed.data.reasonCode : 'CLOUD_FUNCTION_FAILED';
  } catch {
    return 'CLOUD_FUNCTION_FAILED';
  }
}

export function parseCloudAuthCallback(
  value: string,
): { readonly code: string } | { readonly error: true } | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'obscurpilot:' ||
      url.hostname !== 'auth' ||
      url.pathname !== '/callback' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return undefined;
    }
    if (url.searchParams.has('error') || url.searchParams.has('error_code')) {
      return { error: true };
    }
    const code = url.searchParams.get('code');
    return code !== null && /^[A-Za-z0-9._~-]{8,2048}$/u.test(code) ? { code } : { error: true };
  } catch {
    return undefined;
  }
}

function validateAuthStorageKey(key: string): void {
  if (
    key.length < 1 ||
    key.length > 256 ||
    key === '__proto__' ||
    key === 'constructor' ||
    !/^[a-zA-Z0-9._:-]+$/u.test(key)
  ) {
    throw new Error('Invalid authentication storage key');
  }
}
