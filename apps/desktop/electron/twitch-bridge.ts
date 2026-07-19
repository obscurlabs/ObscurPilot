import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ConnectionProjection } from '@obscurpilot/contracts/state';
import type {
  ChatMessageProjection,
  LiveSessionProfileV1,
  ModerationIntentV1,
  TwitchMetadata,
} from '@obscurpilot/contracts/live-session';
import {
  TwitchProjectionSchema,
  type TwitchActivity,
  type TwitchProjection,
} from '@obscurpilot/contracts/twitch';
import {
  TwitchRuntime,
  type DelegatedAccessToken,
  type TwitchTokenBroker,
} from '@obscurpilot/adapters-twitch/boundary';
import { EncryptedJsonStore, type EncryptionProvider } from './encrypted-json-store.js';
import type { CloudBridge } from './cloud-bridge.js';

const OAUTH_FUNCTION = 'twitch-oauth';
const TwitchAccountResponseSchema = z
  .object({
    connected: z.boolean(),
    account: TwitchProjectionSchema.shape.account.optional(),
    reasonCode: z.string().min(1).max(96),
  })
  .strict();
const BeginResponseSchema = z
  .object({
    flowId: z.string().uuid(),
    authorizationUrl: z.string().url(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
const TokenResponseSchema = z
  .object({
    accessToken: z.string().min(16).max(256),
    userId: z.string().regex(/^\d{1,32}$/u),
    scopes: z.array(z.string().min(1).max(128)).max(64),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
const PendingFlowSchema = z
  .object({
    flowId: z.string().uuid(),
    verifier: z.string().min(43).max(128),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
type PendingFlow = z.infer<typeof PendingFlowSchema>;

export interface TwitchBridgeOptions {
  readonly clientId: string;
  readonly cloud: CloudBridge;
  readonly userDataPath: string;
  readonly encryption: EncryptionProvider;
  readonly openExternal: (url: string) => Promise<unknown>;
  readonly onConnection: (projection: ConnectionProjection) => void;
  readonly onProjection?: (projection: TwitchProjection) => void;
  readonly onActivity: (activity: TwitchActivity) => void;
  readonly onChatMessage?: (message: ChatMessageProjection) => void;
  readonly runtimeFactory?: typeof TwitchRuntime;
}

export class TwitchBridge {
  private readonly flowStore: EncryptedJsonStore<PendingFlow | null>;
  private projection: TwitchProjection = {
    configured: true,
    phase: 'signed_out',
    reasonCode: 'NOT_CONNECTED',
  };
  private runtime: TwitchRuntime | undefined;
  private disposed = false;

  public constructor(private readonly options: TwitchBridgeOptions) {
    this.flowStore = new EncryptedJsonStore(
      resolve(options.userDataPath, 'twitch-oauth-flow.enc'),
      PendingFlowSchema.nullable(),
      () => null,
      options.encryption,
    );
  }

  public snapshot(): TwitchProjection {
    return TwitchProjectionSchema.parse(this.projection);
  }

  public async start(): Promise<void> {
    await this.synchronizeFromCloud();
  }

  private async synchronizeFromCloud(): Promise<boolean> {
    let result: z.infer<typeof TwitchAccountResponseSchema>;
    try {
      result = await this.options.cloud.invokeFunction(
        OAUTH_FUNCTION,
        { action: 'status' },
        TwitchAccountResponseSchema,
      );
    } catch {
      this.setProjection({
        configured: true,
        phase: 'signed_out',
        reasonCode: 'CLOUD_AUTH_REQUIRED',
      });
      return false;
    }
    if (!result.connected || result.account === undefined) {
      this.setProjection({ configured: true, phase: 'signed_out', reasonCode: result.reasonCode });
      return false;
    }
    try {
      await this.startRuntime(result.account);
      return true;
    } catch {
      // TwitchRuntime publishes a bounded auth/degraded projection before rejecting.
      return false;
    }
  }

  public async connect(): Promise<{ accepted: true }> {
    if (this.disposed) throw new Error('Twitch bridge is stopped');
    const verifier = base64Url(randomBytes(48));
    const challenge = base64Url(createHash('sha256').update(verifier, 'ascii').digest());
    this.setProjection({ configured: true, phase: 'authorizing', reasonCode: 'OAUTH_PENDING' });
    const flow = await this.options.cloud.invokeFunction(
      OAUTH_FUNCTION,
      { action: 'begin', codeChallenge: challenge },
      BeginResponseSchema,
    );
    await this.flowStore.save({ flowId: flow.flowId, verifier, expiresAt: flow.expiresAt });
    const authorizationUrl = assertTwitchAuthorizationUrl(
      flow.authorizationUrl,
      this.options.clientId,
    );
    await this.options.openExternal(authorizationUrl);
    return { accepted: true };
  }

  public async handleCallback(value: string): Promise<boolean> {
    const callback = parseCompletionCallback(value);
    if (callback === undefined) return false;
    this.setProjection({
      configured: true,
      phase: 'authorizing',
      reasonCode: 'OAUTH_CALLBACK_RECEIVED',
    });
    const pending = await this.flowStore.load();
    if (
      pending === null ||
      pending.flowId !== callback.flowId ||
      Date.parse(pending.expiresAt) <= Date.now()
    ) {
      if (await this.synchronizeFromCloud()) {
        await this.flowStore.save(null);
        return true;
      }
      this.setProjection({
        configured: true,
        phase: 'degraded',
        reasonCode: 'OAUTH_CALLBACK_REJECTED',
      });
      return true;
    }
    try {
      const result = await this.options.cloud.invokeFunction(
        OAUTH_FUNCTION,
        { action: 'finalize', flowId: pending.flowId, codeVerifier: pending.verifier },
        TwitchAccountResponseSchema,
      );
      await this.flowStore.save(null);
      if (!result.connected || result.account === undefined) {
        if (await this.synchronizeFromCloud()) return true;
        this.setProjection({ configured: true, phase: 'degraded', reasonCode: result.reasonCode });
        return true;
      }
      try {
        await this.startRuntime(result.account);
      } catch {
        // Runtime has already published the actionable connection failure.
      }
      return true;
    } catch {
      // The hosted callback stores the account before redirecting to the desktop.
      // Recover from that authoritative record if finalization was interrupted locally.
      if (await this.synchronizeFromCloud()) {
        await this.flowStore.save(null);
        return true;
      }
      this.setProjection({
        configured: true,
        phase: 'degraded',
        reasonCode: 'OAUTH_FINALIZATION_FAILED',
      });
      return true;
    }
  }

  public async reconnect(): Promise<void> {
    if (this.runtime === undefined) return this.start();
    await this.runtime.reconnect();
  }

  public async sessionPreflight(profile: LiveSessionProfileV1) {
    const runtime = this.requireRuntime();
    return runtime.getSessionPreflight(profile.twitch.categoryId, profile.twitch.categoryName);
  }

  public searchCategories(
    query: string,
  ): Promise<readonly { readonly id: string; readonly name: string }[]> {
    return this.requireRuntime().searchCategories(query);
  }

  public updateMetadata(metadata: TwitchMetadata): Promise<void> {
    this.requireScope('channel:manage:broadcast');
    return this.requireRuntime().updateMetadata(metadata);
  }

  public restoreMetadata(metadata: TwitchMetadata): Promise<void> {
    this.requireScope('channel:manage:broadcast');
    return this.requireRuntime().updateMetadata(metadata);
  }

  public readMetadata(): Promise<TwitchMetadata> {
    return this.requireRuntime().readMetadata();
  }

  public isLive(): Promise<boolean> {
    return this.requireRuntime().isLive();
  }

  public sendMessage(message: string): Promise<string> {
    this.requireScope('user:write:chat');
    return this.requireRuntime().sendMessage(message);
  }

  public async executeModeration(intent: ModerationIntentV1): Promise<void> {
    const runtime = this.requireRuntime();
    const identity = await runtime.resolveUser(intent.targetLogin);
    if (identity === undefined || identity.id !== intent.targetUserId) {
      throw new Error('TWITCH_TARGET_MISMATCH');
    }
    if (intent.action === 'delete_message') {
      this.requireScope('moderator:manage:chat_messages');
      if (intent.messageId === undefined) throw new Error('MESSAGE_ID_REQUIRED');
      return runtime.deleteMessage(intent.messageId);
    }
    if (intent.action === 'timeout_user') {
      this.requireScope('moderator:manage:banned_users');
      if (intent.durationSeconds === undefined) throw new Error('TIMEOUT_DURATION_REQUIRED');
      return runtime.timeoutUser(intent.targetUserId, intent.durationSeconds, intent.reason);
    }
    if (intent.action === 'ban_user') {
      this.requireScope('moderator:manage:banned_users');
      return runtime.banUser(intent.targetUserId, intent.reason);
    }
    if (intent.action === 'unban_user') {
      this.requireScope('moderator:manage:banned_users');
      return runtime.unbanUser(intent.targetUserId);
    }
    if (intent.action === 'block_user') {
      this.requireScope('user:manage:blocked_users');
      return runtime.blockUser(intent.targetUserId);
    }
    this.requireScope('user:manage:blocked_users');
    return runtime.unblockUser(intent.targetUserId);
  }

  public async disconnect(): Promise<TwitchProjection> {
    await this.runtime?.stop();
    this.runtime = undefined;
    await this.options.cloud.invokeFunction(
      OAUTH_FUNCTION,
      { action: 'revoke' },
      TwitchAccountResponseSchema,
    );
    await this.flowStore.save(null);
    this.setProjection({ configured: true, phase: 'signed_out', reasonCode: 'DISCONNECTED' });
    return this.snapshot();
  }

  public async suspend(): Promise<void> {
    await this.runtime?.stop();
    this.runtime = undefined;
    this.setProjection({
      configured: true,
      phase: 'signed_out',
      reasonCode: 'CLOUD_AUTH_REQUIRED',
    });
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    await this.runtime?.stop();
    this.runtime = undefined;
  }

  private async startRuntime(account: NonNullable<TwitchProjection['account']>): Promise<void> {
    await this.runtime?.stop();
    this.setProjection({
      configured: true,
      phase: 'connecting',
      account,
      reasonCode: 'CONNECTING',
    });
    const broker: TwitchTokenBroker = {
      acquire: (_userId, forceRefresh) =>
        this.options.cloud.invokeFunction<DelegatedAccessToken>(
          OAUTH_FUNCTION,
          { action: 'token', forceRefresh },
          TokenResponseSchema,
        ),
    };
    const Runtime = this.options.runtimeFactory ?? TwitchRuntime;
    this.runtime = new Runtime({
      clientId: this.options.clientId,
      userId: account.providerUserId,
      tokenBroker: broker,
      onConnection: (connection) => {
        this.options.onConnection(connection);
        const phase =
          connection.phase === 'ready'
            ? 'connected'
            : connection.phase === 'backoff' || connection.phase === 'reconnecting'
              ? 'backoff'
              : connection.phase === 'auth_required'
                ? 'signed_out'
                : connection.phase === 'degraded'
                  ? 'degraded'
                  : 'connecting';
        this.setProjection({ configured: true, phase, account, reasonCode: connection.reasonCode });
      },
      onActivity: this.options.onActivity,
      ...(this.options.onChatMessage === undefined
        ? {}
        : { onChatMessage: this.options.onChatMessage }),
    });
    await this.runtime.start();
  }

  private setProjection(projection: TwitchProjection): void {
    this.projection = TwitchProjectionSchema.parse(projection);
    this.options.onProjection?.(this.snapshot());
  }

  private requireRuntime(): TwitchRuntime {
    if (this.runtime === undefined || this.projection.phase !== 'connected') {
      throw new Error('TWITCH_NOT_CONNECTED');
    }
    return this.runtime;
  }

  private requireScope(scope: string): void {
    if (!this.projection.account?.scopes.includes(scope)) throw new Error('TWITCH_SCOPE_REQUIRED');
  }
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function assertTwitchAuthorizationUrl(value: string, clientId: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'id.twitch.tv' ||
    url.pathname !== '/oauth2/authorize' ||
    url.username !== '' ||
    url.password !== '' ||
    url.searchParams.get('client_id') !== clientId ||
    url.searchParams.get('response_type') !== 'code'
  ) {
    throw new Error('OAuth authorization URL was rejected');
  }
  return url.href;
}

function parseCompletionCallback(value: string): { flowId: string } | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'obscurpilot:' ||
      url.hostname !== 'oauth' ||
      url.pathname !== '/twitch/callback'
    ) {
      return undefined;
    }
    const flowId = url.searchParams.get('flow_id');
    return z.string().uuid().safeParse(flowId).success && flowId !== null ? { flowId } : undefined;
  } catch {
    return undefined;
  }
}
