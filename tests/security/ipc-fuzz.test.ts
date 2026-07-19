import { createResultEnvelopeSchema } from '@obscurpilot/contracts/ipc';
import { PublicErrorSchema } from '@obscurpilot/contracts/errors';
import { registerSecureHandler } from '../../apps/desktop/electron/ipc-router';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

type CapturedHandler = (event: never, request: unknown) => Promise<unknown>;

const NOW = Date.parse('2026-07-19T06:30:00.000Z');
const REQUEST_ID = '10000000-0000-4000-8000-000000000001';
const CANARY = 'stage13-secret-canary-123456789';

function validRequest() {
  return {
    protocolVersion: 1,
    requestId: REQUEST_ID,
    sentAt: new Date(NOW).toISOString(),
    payload: { command: 'inspect', target: 'obs' },
  };
}

function malformed(index: number): unknown {
  const base = validRequest();
  switch (index % 14) {
    case 0:
      return null;
    case 1:
      return { ...base, protocolVersion: index + 2 };
    case 2:
      return { ...base, requestId: '__proto__' };
    case 3:
      return { ...base, sentAt: 'not-a-date' };
    case 4:
      return { ...base, sentAt: new Date(0).toISOString() };
    case 5:
      return { ...base, sentAt: new Date(NOW + 10 * 60_000).toISOString() };
    case 6:
      return { ...base, extra: CANARY };
    case 7:
      return { ...base, payload: { ...base.payload, extra: CANARY } };
    case 8:
      return { ...base, payload: { command: 'execute', target: CANARY } };
    case 9:
      return { ...base, payload: { command: 'inspect', target: 'x'.repeat(70_000) } };
    case 10: {
      const circular: Record<string, unknown> = { ...base };
      circular.self = circular;
      return circular;
    }
    case 11:
      return { ...base, payload: BigInt(index) };
    case 12:
      return JSON.parse(
        '{"protocolVersion":1,"requestId":"' +
          REQUEST_ID +
          '","sentAt":"2026-07-19T06:30:00.000Z","payload":{"command":"inspect","target":"obs"},"__proto__":{"polluted":true}}',
      ) as unknown;
    default:
      return ['unexpected', index, CANARY];
  }
}

describe('secure IPC hostile-input gate', () => {
  it('rejects 10,000 deterministic malformed envelopes without side effects or secret reflection', async () => {
    let captured: CapturedHandler | undefined;
    const sideEffect = vi.fn(() => ({ accepted: true }));
    registerSecureHandler({
      ipcMain: {
        handle: (_channel: string, listener: CapturedHandler) => {
          captured = listener;
        },
        removeHandler: () => undefined,
      } as never,
      channel: 'stage13:fuzz:v1',
      payloadSchema: z
        .object({ command: z.literal('inspect'), target: z.enum(['obs', 'twitch']) })
        .strict(),
      resultSchema: z.object({ accepted: z.literal(true) }).strict(),
      isTrustedSender: () => true,
      handler: sideEffect,
      now: () => NOW,
    });
    expect(captured).toBeDefined();

    for (let index = 0; index < 10_000; index += 1) {
      const result = await captured?.({} as never, malformed(index));
      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
      expect(JSON.stringify(result)).not.toContain(CANARY);
    }
    expect(sideEffect).not.toHaveBeenCalled();
  });

  it('returns only the bounded public result contract for untrusted senders', async () => {
    let captured: CapturedHandler | undefined;
    registerSecureHandler({
      ipcMain: {
        handle: (_channel: string, listener: CapturedHandler) => {
          captured = listener;
        },
        removeHandler: () => undefined,
      } as never,
      channel: 'stage13:sender-fuzz:v1',
      payloadSchema: z.object({ command: z.literal('inspect'), target: z.literal('obs') }).strict(),
      resultSchema: z.object({ accepted: z.literal(true) }).strict(),
      isTrustedSender: () => false,
      handler: () => ({ accepted: true as const }),
      now: () => NOW,
    });
    const result = await captured?.({} as never, validRequest());
    const resultSchema = createResultEnvelopeSchema(
      z.object({ accepted: z.literal(true) }).strict(),
    );
    expect(resultSchema.parse(result)).toMatchObject({
      ok: false,
      error: PublicErrorSchema.parse((result as { error: unknown }).error),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
  });
});
