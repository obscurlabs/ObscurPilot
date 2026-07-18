import type { GroqReasoningModel } from '@obscurpilot/contracts/agent';
import type { OperationalEvent } from '@obscurpilot/contracts/observability';
import type Groq from 'groq-sdk';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'groq-sdk/resources/chat/completions';
import { z } from 'zod';
import { GroqAdapterError, translateGroqError } from './errors.js';
import { GroqResiliencePolicy, type GroqResilienceOptions } from './resilience.js';

const ModelToolCallSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.literal('function'),
    function: z
      .object({
        name: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/u),
        arguments: z.string().max(32 * 1024),
      })
      .strict(),
  })
  .strict();

const CompletionSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            finish_reason: z.enum(['stop', 'length', 'tool_calls', 'function_call']),
            message: z
              .object({
                role: z.literal('assistant'),
                content: z.string().max(16_000).nullable().optional(),
                tool_calls: z.array(ModelToolCallSchema).max(6).optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .length(1),
  })
  .passthrough();

export interface ReasoningToolSpec {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
}

export type ReasoningMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string | null;
      readonly toolCalls: readonly ModelToolCall[];
    }
  | {
      readonly role: 'tool';
      readonly toolCallId: string;
      readonly content: string;
    };

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
}

export interface ReasoningTurn {
  readonly model: GroqReasoningModel;
  readonly finishReason: 'stop' | 'length' | 'tool_calls';
  readonly content: string | null;
  readonly toolCalls: readonly ModelToolCall[];
  readonly durationMs: number;
  readonly attempts: number;
}

export interface ReasoningTransport {
  complete(input: {
    readonly model: GroqReasoningModel;
    readonly messages: readonly ReasoningMessage[];
    readonly tools: readonly ReasoningToolSpec[];
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
  }): Promise<unknown>;
}

export interface GroqReasoningAdapterOptions extends GroqResilienceOptions {
  readonly primaryModel: GroqReasoningModel;
  readonly fallbackModel?: GroqReasoningModel;
  readonly timeoutMs?: number;
  readonly transport: ReasoningTransport;
  readonly onEvent?: (event: OperationalEvent) => void;
  readonly now?: () => number;
}

export class GroqReasoningAdapter {
  private readonly timeoutMs: number;
  private readonly resilience: GroqResiliencePolicy;
  private readonly now: () => number;

  public constructor(private readonly options: GroqReasoningAdapterOptions) {
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.now = options.now ?? Date.now;
    this.resilience = new GroqResiliencePolicy({
      ...options,
      maxAttempts: options.maxAttempts ?? 2,
    });
  }

  public async complete(
    messages: readonly ReasoningMessage[],
    tools: readonly ReasoningToolSpec[],
    correlationId: string,
    signal: AbortSignal,
  ): Promise<ReasoningTurn> {
    try {
      return await this.completeWithModel(
        this.options.primaryModel,
        messages,
        tools,
        correlationId,
        signal,
      );
    } catch (error: unknown) {
      const fault = translateGroqError(error, signal);
      const fallback = this.options.fallbackModel;
      if (!fault.retryable || fallback === undefined || fallback === this.options.primaryModel) {
        throw fault;
      }
      return this.completeWithModel(fallback, messages, tools, correlationId, signal);
    }
  }

  private async completeWithModel(
    model: GroqReasoningModel,
    messages: readonly ReasoningMessage[],
    tools: readonly ReasoningToolSpec[],
    correlationId: string,
    signal: AbortSignal,
  ): Promise<ReasoningTurn> {
    const startedAt = this.now();
    this.emit(correlationId, 'groq.reasoning.started', undefined, undefined, model);
    try {
      const result = await this.resilience.execute(
        () =>
          this.options.transport.complete({
            model,
            messages,
            tools,
            signal,
            timeoutMs: this.timeoutMs,
          }),
        signal,
      );
      const parsed = CompletionSchema.safeParse(result.value);
      if (!parsed.success) {
        throw new GroqAdapterError('MALFORMED_RESPONSE', 'Groq reasoning response was malformed');
      }
      const choice = parsed.data.choices[0];
      if (choice === undefined || choice.finish_reason === 'function_call') {
        throw new GroqAdapterError('MALFORMED_RESPONSE', 'Deprecated function call was rejected');
      }
      const calls = (choice.message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        argumentsJson: call.function.arguments,
      }));
      if (
        (choice.finish_reason === 'tool_calls' && calls.length === 0) ||
        (choice.finish_reason !== 'tool_calls' && calls.length > 0)
      ) {
        throw new GroqAdapterError('MALFORMED_RESPONSE', 'Groq tool-call finish state was invalid');
      }
      const durationMs = Math.max(0, this.now() - startedAt);
      this.emit(correlationId, 'groq.reasoning.completed', durationMs, 'success', model);
      return {
        model,
        finishReason: choice.finish_reason,
        content: choice.message.content ?? null,
        toolCalls: calls,
        durationMs,
        attempts: result.attempts,
      };
    } catch (error: unknown) {
      const fault = translateGroqError(error, signal);
      this.emit(
        correlationId,
        'groq.reasoning.completed',
        Math.max(0, this.now() - startedAt),
        fault.code === 'CANCELLED' ? 'cancelled' : 'failure',
        model,
      );
      throw fault;
    }
  }

  private emit(
    correlationId: string,
    event: string,
    durationMs?: number,
    outcome?: OperationalEvent['outcome'],
    model?: GroqReasoningModel,
  ): void {
    this.options.onEvent?.({
      timestamp: new Date(this.now()).toISOString(),
      level: outcome === 'failure' ? 'warn' : 'info',
      service: 'groq-reasoning',
      event,
      correlationId,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(outcome === undefined ? {} : { outcome }),
      ...(model === undefined ? {} : { metadata: { model } }),
    });
  }
}

export function createSdkReasoningTransport(client: Groq): ReasoningTransport {
  return {
    complete: ({ model, messages, tools, signal, timeoutMs }) => {
      const body: ChatCompletionCreateParamsNonStreaming = {
        model,
        messages: messages.map(toSdkMessage),
        tools: tools as ChatCompletionTool[],
        tool_choice: tools.length === 0 ? 'none' : 'auto',
        parallel_tool_calls: false,
        disable_tool_validation: false,
        temperature: 0,
        max_completion_tokens: 1_024,
        reasoning_format: 'hidden',
      };
      return client.chat.completions.create(body, {
        signal,
        timeout: timeoutMs,
        maxRetries: 0,
      });
    },
  };
}

function toSdkMessage(message: ReasoningMessage): ChatCompletionMessageParam {
  if (message.role === 'system' || message.role === 'user') return message;
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
  return {
    role: 'assistant',
    content: message.content,
    tool_calls: message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.argumentsJson },
    })),
  };
}
