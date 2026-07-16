import {
  GroqReasoningAdapter,
  GuardedReasoningOrchestrator,
  type ReasoningTransport,
} from '@obscurpilot/adapters-groq/boundary';
import { ToolRegistry } from '@obscurpilot/domain/tool-registry';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const toolTurn = {
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'fixture_action_v1', arguments: '{"value":"safe"}' },
          },
        ],
      },
    },
  ],
};

const finalTurn = {
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Complete.' } }],
};

describe('Stage 9 validated tool dispatch budget', () => {
  it('dispatches an authorized tool at p95 below 50 ms after a model tool call', async () => {
    const latencies: number[] = [];

    for (let index = 0; index < 100; index += 1) {
      let transportTurn = 0;
      let startedAt = 0;
      const transport: ReasoningTransport = {
        complete: async () => (transportTurn++ === 0 ? toolTurn : finalTurn),
      };
      const registry = new ToolRegistry();
      registry.register({
        name: 'fixture.action',
        version: 1,
        risk: 'reversible',
        modelName: 'fixture_action_v1',
        description: 'Dispatch the authorized performance fixture action.',
        parameters: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
        parse: (value) =>
          z
            .object({ value: z.literal('safe') })
            .strict()
            .parse(value),
        authorize: async () => undefined,
        execute: async () => {
          latencies.push(performance.now() - startedAt);
          return { accepted: true };
        },
      });
      const orchestrator = new GuardedReasoningOrchestrator({
        reasoning: new GroqReasoningAdapter({
          primaryModel: 'openai/gpt-oss-120b',
          maxAttempts: 1,
          transport,
        }),
        registry,
        getSnapshot: () => ({ redactedContext: '{"obs":{"ready":true}}' }),
        requestConfirmation: async () => false,
      });
      startedAt = performance.now();
      await orchestrator.run('run the fixture', crypto.randomUUID(), new AbortController().signal);
    }

    latencies.sort((left, right) => left - right);
    const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1];
    expect(p95).toBeDefined();
    expect(p95!).toBeLessThanOrEqual(50);
  });
});
