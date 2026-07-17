import { GetBootstrapRequestSchema } from '@obscurpilot/contracts/bootstrap';
import { createResultEnvelopeSchema, IPC_PROTOCOL_VERSION } from '@obscurpilot/contracts/ipc';
import { AppSnapshotSchema, StateChangedEventSchema } from '@obscurpilot/contracts/state';
import { PttCommandPayloadSchema } from '@obscurpilot/contracts/audio';
import { describe, expect, it } from 'vitest';

const requestId = '10000000-0000-4000-8000-000000000001';

describe('versioned IPC contracts', () => {
  it('accepts tap-to-talk and rejects unknown audio actions', () => {
    expect(PttCommandPayloadSchema.parse({ action: 'tap' })).toEqual({ action: 'tap' });
    expect(() => PttCommandPayloadSchema.parse({ action: 'listen_forever' })).toThrow();
  });

  it('rejects unknown request properties and protocol versions', () => {
    const valid = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      requestId,
      sentAt: new Date().toISOString(),
      payload: {},
    };
    expect(GetBootstrapRequestSchema.parse(valid)).toEqual(valid);
    expect(() => GetBootstrapRequestSchema.parse({ ...valid, extra: true })).toThrow();
    expect(() => GetBootstrapRequestSchema.parse({ ...valid, protocolVersion: 2 })).toThrow();
  });

  it('requires every provider in authoritative snapshots', () => {
    const connection = (provider: 'obs' | 'twitch' | 'groq' | 'supabase') => ({
      provider,
      phase: 'idle' as const,
      attempt: 0,
      changedAt: new Date(0).toISOString(),
      reasonCode: 'NOT_STARTED',
      correlationId: '00000000-0000-4000-8000-000000000000',
    });
    const snapshot = {
      protocolVersion: 1,
      snapshotVersion: 0,
      generatedAt: new Date().toISOString(),
      lifecycle: 'starting',
      connections: {
        obs: connection('obs'),
        twitch: connection('twitch'),
        groq: connection('groq'),
        supabase: connection('supabase'),
      },
    };
    expect(AppSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    const incomplete = { ...snapshot, connections: { obs: connection('obs') } };
    expect(() => AppSnapshotSchema.parse(incomplete)).toThrow();
  });

  it('strictly validates result and state-event envelopes', () => {
    const resultSchema = createResultEnvelopeSchema(AppSnapshotSchema);
    expect(() =>
      resultSchema.parse({ ok: false, requestId, error: { message: 'raw error' } }),
    ).toThrow();
    expect(() =>
      StateChangedEventSchema.parse({
        protocolVersion: 1,
        eventId: requestId,
        emittedAt: new Date().toISOString(),
        payload: { snapshotVersion: 2, patches: [], secret: 'never' },
      }),
    ).toThrow();
  });
});
