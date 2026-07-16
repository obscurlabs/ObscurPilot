import type { CreatorProfile, DeviceRegistration } from '@obscurpilot/contracts/cloud';
import type { Json } from './database.types.js';
import type { StagePilotSupabaseClient } from './client.js';

export class CloudRepositoryError extends Error {
  public constructor(
    public readonly code:
      'AUTH_REQUIRED' | 'NOT_FOUND' | 'CONFLICT' | 'REMOTE_UNAVAILABLE' | 'VALIDATION_FAILED',
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'CloudRepositoryError';
  }
}

export class CloudConflictError extends CloudRepositoryError {
  public constructor() {
    super('CONFLICT', 'The cloud record changed on another device', false);
    this.name = 'CloudConflictError';
  }
}

export interface CatchUpCursor {
  readonly occurredAt: string;
  readonly id: string;
}

export interface CatchUpResult {
  readonly events: readonly {
    id: string;
    eventType: string;
    summary: string;
    metadata: Json;
    occurredAt: string;
  }[];
  readonly cursor: CatchUpCursor | undefined;
  readonly hasMore: boolean;
}

export interface PersistedToolGrant {
  readonly toolName: string;
  readonly scopes: readonly string[];
  readonly riskTier: number;
  readonly confirmationMode: 'always' | 'session' | 'never';
}

export class CloudRepository {
  public constructor(private readonly client: StagePilotSupabaseClient) {}

  public async getProfile(): Promise<CreatorProfile | undefined> {
    const result = await this.client
      .from('profiles')
      .select('id,user_id,display_name,locale,time_zone,revision,updated_at')
      .maybeSingle();
    if (result.error !== null) throw mapError(result.error);
    return result.data === null ? undefined : mapProfile(result.data);
  }

  public async updateProfile(input: {
    mutationId: string;
    expectedRevision: number;
    displayName: string;
    locale: string;
    timeZone: string;
  }): Promise<CreatorProfile> {
    const result = await this.client.rpc('update_creator_profile', {
      p_idempotency_key: input.mutationId,
      p_expected_revision: input.expectedRevision,
      p_display_name: input.displayName,
      p_locale: input.locale,
      p_time_zone: input.timeZone,
    });
    if (result.error !== null) throw mapError(result.error);
    const row = result.data[0];
    if (row === undefined) throw new CloudConflictError();
    return mapProfile(row);
  }

  public async registerDevice(input: {
    publicId: string;
    name: string;
    platform: string;
    appVersion: string;
  }): Promise<DeviceRegistration> {
    const result = await this.client.rpc('register_device', {
      p_public_id: input.publicId,
      p_name: input.name,
      p_platform: input.platform,
      p_app_version: input.appVersion,
    });
    if (result.error !== null) throw mapError(result.error);
    const row = result.data[0];
    if (row === undefined) {
      throw new CloudRepositoryError('NOT_FOUND', 'Device registration was not returned', false);
    }
    return {
      id: row.id,
      publicId: row.public_id,
      revision: row.revision,
      lastSeenAt: row.last_seen_at,
    };
  }

  public async recordCommandAudit(input: {
    userId: string;
    correlationId: string;
    toolName: string;
    outcome: 'allowed' | 'denied' | 'failed' | 'cancelled';
    reasonCode: string;
    durationMs: number;
    metadata: Json;
  }): Promise<void> {
    const result = await this.client.from('command_audit').insert({
      user_id: input.userId,
      correlation_id: input.correlationId,
      tool_name: input.toolName,
      outcome: input.outcome,
      reason_code: input.reasonCode,
      duration_ms: input.durationMs,
      metadata: input.metadata,
    });
    if (result.error !== null) throw mapError(result.error);
  }

  public async getActiveToolGrants(): Promise<readonly PersistedToolGrant[]> {
    const profile = await this.client
      .from('control_profiles')
      .select('id')
      .eq('is_active', true)
      .maybeSingle();
    if (profile.error !== null) throw mapError(profile.error);
    if (profile.data === null) return [];
    const result = await this.client
      .from('tool_grants')
      .select('tool_name,risk_tier,confirmation_mode,constraints')
      .eq('control_profile_id', profile.data.id);
    if (result.error !== null) throw mapError(result.error);
    return result.data.map((row) => ({
      toolName: row.tool_name,
      scopes: readScopes(row.constraints),
      riskTier: row.risk_tier,
      confirmationMode:
        row.confirmation_mode === 'always' ||
        row.confirmation_mode === 'session' ||
        row.confirmation_mode === 'never'
          ? row.confirmation_mode
          : 'always',
    }));
  }

  public async requestAccountDeletion(): Promise<{
    requestId: string;
    requestedAt: string;
    executeAfter: string;
  }> {
    const result = await this.client.rpc('request_account_deletion');
    if (result.error !== null) throw mapError(result.error);
    const row = result.data[0];
    if (row === undefined) {
      throw new CloudRepositoryError('NOT_FOUND', 'Deletion request was not returned', false);
    }
    return {
      requestId: row.request_id,
      requestedAt: row.requested_at,
      executeAfter: row.execute_after,
    };
  }

  public async catchUp(cursor: CatchUpCursor | undefined, limit = 250): Promise<CatchUpResult> {
    const pageSize = Math.max(1, Math.min(limit, 500));
    let query = this.client
      .from('activity_events')
      .select('id,event_type,summary,metadata,occurred_at')
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(pageSize + 1);
    if (cursor !== undefined) {
      query = query.or(
        'occurred_at.gt.' +
          cursor.occurredAt +
          ',and(occurred_at.eq.' +
          cursor.occurredAt +
          ',id.gt.' +
          cursor.id +
          ')',
      );
    }
    const result = await query;
    if (result.error !== null) throw mapError(result.error);
    const page = result.data.slice(0, pageSize);
    const last = page.at(-1);
    return {
      events: page.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        summary: row.summary,
        metadata: row.metadata,
        occurredAt: row.occurred_at,
      })),
      cursor: last === undefined ? cursor : { occurredAt: last.occurred_at, id: last.id },
      hasMore: result.data.length > pageSize,
    };
  }
}

function mapProfile(row: {
  id: string;
  user_id: string;
  display_name: string;
  locale: string;
  time_zone: string;
  revision: number;
  updated_at: string;
}): CreatorProfile {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    locale: row.locale,
    timeZone: row.time_zone,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

function mapError(error: { code?: string; message: string }): CloudRepositoryError {
  if (error.code === 'PGRST301' || error.code === '42501') {
    return new CloudRepositoryError('AUTH_REQUIRED', 'Cloud authorization is required', false);
  }
  if (error.code === '23514' || error.code === '22001') {
    return new CloudRepositoryError('VALIDATION_FAILED', 'Cloud input was rejected', false);
  }
  return new CloudRepositoryError('REMOTE_UNAVAILABLE', 'Cloud operation failed', true);
}

function readScopes(value: Json): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const scopes = value.scopes;
  if (!Array.isArray(scopes)) return [];
  return scopes.filter(
    (scope): scope is string => typeof scope === 'string' && scope.length > 0 && scope.length <= 96,
  );
}
