import { createHash, randomUUID } from 'node:crypto';
import { ApiClient } from '@twurple/api';
import type {
  AccessTokenMaybeWithUserId,
  AccessTokenWithUserId,
  AuthProvider,
} from '@twurple/auth';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import type { ConnectionProjection } from '@obscurpilot/contracts/state';
import { TwitchActivitySchema, type TwitchActivity } from '@obscurpilot/contracts/twitch';

export const TWITCH_ADAPTER_PACKAGE = '@obscurpilot/adapters-twitch' as const;

export interface DelegatedAccessToken {
  readonly accessToken: string;
  readonly userId: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
}

export interface TwitchTokenBroker {
  acquire(
    userId: string,
    forceRefresh: boolean,
    signal?: AbortSignal,
  ): Promise<DelegatedAccessToken>;
}

export class TwitchAuthenticationError extends Error {
  public constructor(message = 'Twitch authorization is required') {
    super(message);
    this.name = 'TwitchAuthenticationError';
  }
}

export class DelegatedTwitchAuthProvider implements AuthProvider {
  public readonly authorizationType = 'Bearer';
  private token: DelegatedAccessToken | undefined;
  private acquisition: Promise<DelegatedAccessToken> | undefined;

  public constructor(
    public readonly clientId: string,
    private readonly userId: string,
    private readonly broker: TwitchTokenBroker,
    private readonly now: () => number = Date.now,
  ) {
    if (!/^[a-z0-9]{8,64}$/u.test(clientId)) throw new Error('Invalid Twitch client ID');
    if (!/^\d{1,32}$/u.test(userId)) throw new Error('Invalid Twitch user ID');
  }

  public getCurrentScopesForUser: AuthProvider['getCurrentScopesForUser'] = (user) =>
    this.matchesUser(user) ? [...(this.token?.scopes ?? [])] : [];

  public getAccessTokenForUser: AuthProvider['getAccessTokenForUser'] = async (
    user,
    ...scopeSets
  ) => {
    if (!this.matchesUser(user)) return null;
    const token = await this.getToken(false);
    if (!hasOneScopeSet(token.scopes, scopeSets)) return null;
    return toTwurpleToken(token);
  };

  public getAnyAccessToken: AuthProvider['getAnyAccessToken'] = async (user) => {
    if (user !== undefined && !this.matchesUser(user)) throw new TwitchAuthenticationError();
    return toTwurpleToken(await this.getToken(false)) satisfies AccessTokenMaybeWithUserId;
  };

  public refreshAccessTokenForUser: NonNullable<AuthProvider['refreshAccessTokenForUser']> = async (
    user,
  ) => {
    if (!this.matchesUser(user)) throw new TwitchAuthenticationError();
    return toTwurpleToken(await this.getToken(true));
  };

  public invalidate(): void {
    this.token = undefined;
  }

  private async getToken(forceRefresh: boolean): Promise<DelegatedAccessToken> {
    if (
      !forceRefresh &&
      this.token !== undefined &&
      Date.parse(this.token.expiresAt) > this.now() + 60_000
    ) {
      return this.token;
    }
    if (this.acquisition !== undefined) return this.acquisition;
    const run = this.broker.acquire(this.userId, forceRefresh).then((token) => {
      validateDelegatedToken(token, this.userId, this.now());
      this.token = Object.freeze({ ...token, scopes: Object.freeze([...token.scopes]) });
      return this.token;
    });
    this.acquisition = run;
    try {
      return await run;
    } finally {
      if (this.acquisition === run) this.acquisition = undefined;
    }
  }

  private matchesUser(user: unknown): boolean {
    if (typeof user === 'string' || typeof user === 'number') return String(user) === this.userId;
    if (typeof user === 'object' && user !== null && 'id' in user)
      return String(user.id) === this.userId;
    return false;
  }
}

function hasOneScopeSet(
  available: readonly string[],
  requested: Array<string[] | undefined>,
): boolean {
  const sets = requested.filter((set): set is string[] => set !== undefined && set.length > 0);
  return sets.length === 0 || sets.some((set) => set.every((scope) => available.includes(scope)));
}

function toTwurpleToken(token: DelegatedAccessToken): AccessTokenWithUserId {
  return {
    accessToken: token.accessToken,
    refreshToken: null,
    scope: [...token.scopes],
    expiresIn: Math.max(1, Math.floor((Date.parse(token.expiresAt) - Date.now()) / 1000)),
    obtainmentTimestamp: Date.now(),
    userId: token.userId,
  };
}

function validateDelegatedToken(token: DelegatedAccessToken, userId: string, now: number): void {
  if (token.userId !== userId || !/^[a-z0-9]{16,256}$/u.test(token.accessToken)) {
    throw new TwitchAuthenticationError('Twitch returned an invalid delegated credential');
  }
  if (!Number.isFinite(Date.parse(token.expiresAt)) || Date.parse(token.expiresAt) <= now) {
    throw new TwitchAuthenticationError('Twitch delegated credential is expired');
  }
  if (
    token.scopes.length > 64 ||
    token.scopes.some((scope) => !/^[a-z0-9:_-]{1,128}$/u.test(scope))
  ) {
    throw new TwitchAuthenticationError('Twitch delegated credential scopes are invalid');
  }
}

export class SlidingWindowEventDedupe {
  private readonly entries = new Map<string, number>();

  public constructor(
    private readonly ttlMs = 10 * 60_000,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {
    if (ttlMs < 1_000 || maxEntries < 1) throw new RangeError('Invalid dedupe bounds');
  }

  public accept(id: string): boolean {
    const timestamp = this.now();
    this.prune(timestamp);
    const seenAt = this.entries.get(id);
    if (seenAt !== undefined && timestamp - seenAt < this.ttlMs) return false;
    this.entries.delete(id);
    this.entries.set(id, timestamp);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return true;
  }

  private prune(timestamp: number): void {
    for (const [id, seenAt] of this.entries) {
      if (timestamp - seenAt < this.ttlMs) break;
      this.entries.delete(id);
    }
  }
}

export class TwitchRateLimitScheduler {
  private tail: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;

  public constructor(
    private readonly minimumSpacingMs = 50,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  public schedule<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const waitMs = Math.max(0, this.nextAllowedAt - this.now());
      if (waitMs > 0) await this.sleep(waitMs);
      this.nextAllowedAt = this.now() + this.minimumSpacingMs;
      return operation();
    });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export interface TwitchRuntimeOptions {
  readonly clientId: string;
  readonly userId: string;
  readonly tokenBroker: TwitchTokenBroker;
  readonly onConnection: (projection: ConnectionProjection) => void;
  readonly onActivity: (activity: TwitchActivity) => void;
  readonly now?: () => number;
  readonly listenerFactory?: (apiClient: ApiClient) => EventSubWsListener;
}

export class TwitchRuntime {
  private readonly now: () => number;
  private readonly dedupe: SlidingWindowEventDedupe;
  private readonly auth: DelegatedTwitchAuthProvider;
  private readonly apiClient: ApiClient;
  private readonly listener: EventSubWsListener;
  private readonly scheduler: TwitchRateLimitScheduler;
  private started = false;

  public constructor(private readonly options: TwitchRuntimeOptions) {
    this.now = options.now ?? Date.now;
    this.dedupe = new SlidingWindowEventDedupe(10 * 60_000, 10_000, this.now);
    this.scheduler = new TwitchRateLimitScheduler(50, this.now);
    this.auth = new DelegatedTwitchAuthProvider(
      options.clientId,
      options.userId,
      options.tokenBroker,
      this.now,
    );
    this.apiClient = new ApiClient({ authProvider: this.auth });
    this.listener =
      options.listenerFactory?.(this.apiClient) ??
      new EventSubWsListener({ apiClient: this.apiClient });
    this.listener.onUserSocketConnect((userId) => {
      if (userId === options.userId) this.emitConnection('ready', 'EVENTSUB_READY', 0);
    });
    this.listener.onUserSocketDisconnect((userId, error) => {
      if (userId === options.userId && this.started) {
        this.emitConnection(
          'backoff',
          error === undefined ? 'EVENTSUB_CLOSED' : 'EVENTSUB_RECONNECTING',
          0,
        );
      }
    });
    this.listener.onSubscriptionCreateFailure((_subscription, error) => {
      this.emitConnection('degraded', classifyReason(error), 0);
    });
    this.listener.onRevoke(() => this.emitConnection('auth_required', 'SUBSCRIPTION_REVOKED', 0));
  }

  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.emitConnection('authenticating', 'ACQUIRING_DELEGATED_ACCESS', 0);
    try {
      await this.auth.getAccessTokenForUser(this.options.userId);
      const identity = await this.scheduler.schedule(() =>
        this.apiClient.users.getUserById(this.options.userId),
      );
      if (identity === null || identity.id !== this.options.userId) {
        throw new TwitchAuthenticationError('Twitch account identity could not be verified');
      }
      this.emitConnection('synchronizing', 'RECONCILING_SUBSCRIPTIONS', 0);
      this.listener.onStreamOnline(this.options.userId, (event) =>
        this.acceptActivity({
          id: 'stream.online:' + event.id,
          type: 'stream.online',
          occurredAt: event.startDate.toISOString(),
          summary: event.broadcasterDisplayName + ' is live',
          metadata: { broadcasterId: event.broadcasterId, streamType: event.type },
        }),
      );
      this.listener.onStreamOffline(this.options.userId, (event) =>
        this.acceptActivity({
          id: fingerprint('stream.offline', event.broadcasterId, this.now()),
          type: 'stream.offline',
          occurredAt: new Date(this.now()).toISOString(),
          summary: event.broadcasterDisplayName + ' is offline',
          metadata: { broadcasterId: event.broadcasterId },
        }),
      );
      this.listener.onChannelUpdate(this.options.userId, (event) =>
        this.acceptActivity({
          id: fingerprint(
            'channel.update',
            event.broadcasterId + ':' + event.streamTitle,
            this.now(),
          ),
          type: 'channel.update',
          occurredAt: new Date(this.now()).toISOString(),
          summary: 'Channel metadata updated',
          metadata: {
            broadcasterId: event.broadcasterId,
            title: event.streamTitle.slice(0, 140),
            categoryId: event.categoryId,
            language: event.streamLanguage,
          },
        }),
      );
      this.listener.start();
    } catch (error: unknown) {
      this.started = false;
      this.emitConnection(
        error instanceof TwitchAuthenticationError ? 'auth_required' : 'degraded',
        classifyReason(error),
        0,
      );
      throw error;
    }
  }

  public async reconnect(): Promise<void> {
    await this.stop();
    this.auth.invalidate();
    await this.start();
  }

  public async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.listener.stop();
    this.emitConnection('stopped', 'STOPPED', 0);
  }

  public acceptActivity(input: TwitchActivity): boolean {
    const activity = TwitchActivitySchema.parse(input);
    if (!this.dedupe.accept(activity.id)) return false;
    this.options.onActivity(activity);
    return true;
  }

  private emitConnection(
    phase: ConnectionProjection['phase'],
    reasonCode: string,
    attempt: number,
  ): void {
    this.options.onConnection({
      provider: 'twitch',
      phase,
      attempt,
      changedAt: new Date(this.now()).toISOString(),
      reasonCode,
      correlationId: randomUUID(),
    });
  }
}

function fingerprint(type: string, value: string, now: number): string {
  const bucket = Math.floor(now / 30_000);
  return (
    type +
    ':' +
    createHash('sha256')
      .update(value + ':' + bucket)
      .digest('hex')
  );
}

function classifyReason(error: unknown): string {
  const value = error instanceof Error ? error.message.toLowerCase() : '';
  if (value.includes('401') || value.includes('auth') || value.includes('token'))
    return 'AUTH_REQUIRED';
  if (value.includes('429') || value.includes('rate')) return 'RATE_LIMITED';
  return 'UPSTREAM_UNAVAILABLE';
}
