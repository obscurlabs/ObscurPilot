import {
  GroqReasoningAdapter,
  type ReasoningMessage,
  type ReasoningToolSpec,
  type ReasoningTransport,
} from '@obscurpilot/adapters-groq/boundary';
import { APIError } from 'groq-sdk';
import { describe, expect, it, vi } from 'vitest';

const correlationId = '10000000-0000-4000-8000-000000000001';
const messages: ReasoningMessage[] = [{ role: 'user', content: 'switch scene' }];
const tools: ReasoningToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'obs_set_program_scene_v1',
      description: 'Change the current OBS program scene.',
      parameters: { type: 'object' },
    },
  },
];

function response(input?: {
  name?: string;
  argumentsJson?: string;
  finishReason?: string;
  omitContent?: boolean;
}) {
  const hasCall = input !== undefined;
  return {
    choices: [
      {
        finish_reason: input?.finishReason ?? (hasCall ? 'tool_calls' : 'stop'),
        message: {
          role: 'assistant',
          ...(input?.omitContent ? {} : { content: hasCall ? null : 'Done.' }),
          ...(hasCall
            ? {
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: input.name ?? 'obs_set_program_scene_v1',
                      arguments: input.argumentsJson ?? '{"sceneName":"Main"}',
                    },
                  },
                ],
              }
            : {}),
        },
      },
    ],
  };
}

describe('Groq reasoning response boundary', () => {
  it('validates deterministic local tool calls for both configured models', async () => {
    for (const model of ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b'] as const) {
      const adapter = new GroqReasoningAdapter({
        primaryModel: model,
        maxAttempts: 1,
        transport: { complete: async () => response({}) },
      });
      await expect(
        adapter.complete(messages, tools, correlationId, new AbortController().signal),
      ).resolves.toMatchObject({
        model,
        finishReason: 'tool_calls',
        toolCalls: [{ name: 'obs_set_program_scene_v1' }],
      });
    }
  });

  it('normalizes an omitted assistant content field on a valid Groq tool call', async () => {
    const adapter = new GroqReasoningAdapter({
      primaryModel: 'openai/gpt-oss-120b',
      maxAttempts: 1,
      transport: { complete: async () => response({ omitContent: true }) },
    });
    await expect(
      adapter.complete(messages, tools, correlationId, new AbortController().signal),
    ).resolves.toMatchObject({ content: null, finishReason: 'tool_calls' });
  });

  it('falls back only after a retryable primary-model failure', async () => {
    const complete = vi.fn<ReasoningTransport['complete']>(async ({ model }) => {
      if (model === 'openai/gpt-oss-120b') {
        throw new APIError(503, {}, 'unavailable', new Headers());
      }
      return response();
    });
    const adapter = new GroqReasoningAdapter({
      primaryModel: 'openai/gpt-oss-120b',
      fallbackModel: 'qwen/qwen3.6-27b',
      maxAttempts: 1,
      transport: { complete },
    });
    await expect(
      adapter.complete(messages, tools, correlationId, new AbortController().signal),
    ).resolves.toMatchObject({ model: 'qwen/qwen3.6-27b', content: 'Done.' });
    expect(complete.mock.calls.map(([input]) => input.model)).toEqual([
      'openai/gpt-oss-120b',
      'qwen/qwen3.6-27b',
    ]);
  });

  it('fails closed on malformed, deprecated, or inconsistent tool-call responses', async () => {
    for (const malformed of [
      { choices: [] },
      response({ finishReason: 'stop' }),
      response({ finishReason: 'function_call' }),
      {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: { role: 'assistant', content: null, tool_calls: [] },
          },
        ],
      },
    ]) {
      const adapter = new GroqReasoningAdapter({
        primaryModel: 'openai/gpt-oss-120b',
        maxAttempts: 1,
        transport: { complete: async () => malformed },
      });
      await expect(
        adapter.complete(messages, tools, correlationId, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
    }
  });

  it('does not put prompts, arguments, or completion content into diagnostics', async () => {
    const events: unknown[] = [];
    const adapter = new GroqReasoningAdapter({
      primaryModel: 'openai/gpt-oss-120b',
      maxAttempts: 1,
      transport: { complete: async () => response({ argumentsJson: '{"secret":"never"}' }) },
      onEvent: (event) => events.push(event),
    });
    await adapter.complete(
      [{ role: 'user', content: 'private transcript' }],
      tools,
      correlationId,
      new AbortController().signal,
    );
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('private transcript');
    expect(serialized).not.toContain('never');
  });
});
