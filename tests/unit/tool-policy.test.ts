import { BoundedLoopController } from '@obscurpilot/domain/loop-controller';
import { authorizeTool, PolicyDeniedError, type ToolGrant } from '@obscurpilot/domain/policy';
import { ToolRegistry } from '@obscurpilot/domain/tool-registry';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

describe('guarded tool foundation', () => {
  const grant: ToolGrant = {
    toolName: 'system.observe',
    scopes: new Set(['runtime:read']),
    expiresAt: 2_000,
  };

  it('requires a current grant, exact scope, and confirmation for confirm-risk tools', () => {
    expect(() =>
      authorizeTool([grant], {
        now: 1_000,
        toolName: 'system.observe',
        requiredScope: 'runtime:read',
        risk: 'observe',
        confirmed: false,
      }),
    ).not.toThrow();
    expect(() =>
      authorizeTool([grant], {
        now: 2_000,
        toolName: 'system.observe',
        requiredScope: 'runtime:read',
        risk: 'observe',
        confirmed: false,
      }),
    ).toThrow(PolicyDeniedError);
    expect(() =>
      authorizeTool([grant], {
        now: 1_000,
        toolName: 'system.observe',
        requiredScope: 'runtime:read',
        risk: 'confirm',
        confirmed: false,
      }),
    ).toThrow('confirmation');
  });

  it('resolves only exact versioned tools and parses before authorization or execution', async () => {
    const execute = vi.fn(async (input: { value: string }) => input.value.toUpperCase());
    const registry = new ToolRegistry();
    registry.register({
      name: 'system.observe',
      version: 1,
      risk: 'observe',
      modelName: 'system_observe_v1',
      description: 'Read the bounded system observation fixture.',
      parameters: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
      parse: (input) => z.object({ value: z.string() }).strict().parse(input),
      authorize: async () => undefined,
      execute: async (_context, input) => execute(input),
    });
    const context = {
      correlationId: '10000000-0000-4000-8000-000000000001',
      signal: new AbortController().signal,
    };
    await expect(registry.invoke('system.observe', 1, { value: 'ready' }, context)).resolves.toBe(
      'READY',
    );
    await expect(
      registry.invoke('system.observe', 1, { value: 'ready', extra: true }, context),
    ).rejects.toThrow();
    await expect(registry.invoke('system.observe', 2, {}, context)).rejects.toThrow('Unknown tool');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('enforces turn, call, byte, and wall-clock ceilings', () => {
    let now = 0;
    const controller = new BoundedLoopController(() => now, {
      maxTurns: 1,
      maxToolCalls: 1,
      maxWallClockMs: 10,
      maxArgumentBytes: 10,
    });
    controller.beginTurn();
    expect(() => controller.beginTurn()).toThrow('turn ceiling');

    const callController = new BoundedLoopController(() => now, {
      maxTurns: 2,
      maxToolCalls: 1,
      maxWallClockMs: 10,
      maxArgumentBytes: 10,
    });
    callController.registerToolCall({ x: 1 });
    expect(() => callController.registerToolCall({ x: 1 })).toThrow('call ceiling');

    const byteController = new BoundedLoopController(() => now, {
      maxTurns: 2,
      maxToolCalls: 2,
      maxWallClockMs: 10,
      maxArgumentBytes: 4,
    });
    expect(() => byteController.registerToolCall({ value: 'large' })).toThrow('byte ceiling');

    const timeController = new BoundedLoopController(() => now, {
      maxTurns: 2,
      maxToolCalls: 2,
      maxWallClockMs: 10,
      maxArgumentBytes: 100,
    });
    now = 11;
    expect(() => timeController.assertWithinDeadline()).toThrow('deadline');
  });
});
