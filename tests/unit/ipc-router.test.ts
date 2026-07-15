import { registerSecureHandler } from '../../apps/desktop/electron/ipc-router';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

type CapturedHandler = (event: never, request: unknown) => Promise<unknown>;

function request(payload: unknown) {
  return {
    protocolVersion: 1,
    requestId: '10000000-0000-4000-8000-000000000001',
    sentAt: new Date().toISOString(),
    payload,
  };
}

describe('secure IPC router', () => {
  it('validates sender and strict payload before side effects', async () => {
    let captured: CapturedHandler | undefined;
    const handler = vi.fn(() => ({ accepted: true }));
    const registrar = {
      handle: vi.fn((_channel: string, listener: CapturedHandler) => {
        captured = listener;
      }),
      removeHandler: vi.fn(),
    };
    const dispose = registerSecureHandler({
      ipcMain: registrar as never,
      channel: 'test:secure:v1',
      payloadSchema: z.object({ value: z.string().max(16) }).strict(),
      resultSchema: z.object({ accepted: z.boolean() }).strict(),
      isTrustedSender: () => true,
      handler,
    });
    expect(captured).toBeDefined();

    const invalid = (await captured?.({} as never, request({ value: 'ok', extra: true }))) as {
      ok: boolean;
      error: { code: string };
    };
    expect(invalid.ok).toBe(false);
    expect(invalid.error.code).toBe('VALIDATION_FAILED');
    expect(handler).not.toHaveBeenCalled();

    const valid = (await captured?.({} as never, request({ value: 'ok' }))) as {
      ok: boolean;
      data: { accepted: boolean };
    };
    expect(valid).toMatchObject({ ok: true, data: { accepted: true } });
    expect(handler).toHaveBeenCalledOnce();

    dispose();
    expect(registrar.removeHandler).toHaveBeenCalledWith('test:secure:v1');
  });

  it('fails closed for untrusted, stale, and oversized requests', async () => {
    let captured: CapturedHandler | undefined;
    let trusted = false;
    registerSecureHandler({
      ipcMain: {
        handle: (_channel: string, listener: CapturedHandler) => {
          captured = listener;
        },
        removeHandler: () => undefined,
      } as never,
      channel: 'test:closed:v1',
      payloadSchema: z.object({ value: z.string() }).strict(),
      resultSchema: z.object({ accepted: z.boolean() }).strict(),
      isTrustedSender: () => trusted,
      handler: () => ({ accepted: true }),
      now: () => Date.now(),
    });
    const denied = (await captured?.({} as never, request({ value: 'ok' }))) as {
      error: { code: string };
    };
    expect(denied.error.code).toBe('PERMISSION_DENIED');

    trusted = true;
    const oversized = request({ value: 'x'.repeat(70_000) });
    const blocked = (await captured?.({} as never, oversized)) as {
      error: { code: string };
    };
    expect(blocked.error.code).toBe('VALIDATION_FAILED');

    const stale = {
      ...request({ value: 'ok' }),
      sentAt: new Date(0).toISOString(),
    };
    const expired = (await captured?.({} as never, stale)) as {
      error: { code: string };
    };
    expect(expired.error.code).toBe('VALIDATION_FAILED');
  });
});
