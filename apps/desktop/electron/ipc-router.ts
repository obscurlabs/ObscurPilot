import { randomUUID } from 'node:crypto';
import {
  createRequestEnvelopeSchema,
  MAX_IPC_ENVELOPE_BYTES,
  type ResultEnvelope,
} from '@obscurpilot/contracts/ipc';
import type { PublicError, PublicErrorCode } from '@obscurpilot/contracts/errors';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { redactText } from './redaction.js';

export class PublicFault extends Error {
  public constructor(
    public readonly code: PublicErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'PublicFault';
  }
}

interface HandlerContext<Input> {
  readonly payload: Input;
  readonly requestId: string;
}

export interface SecureHandlerOptions<Input, Output> {
  readonly ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  readonly channel: string;
  readonly payloadSchema: z.ZodType<Input>;
  readonly resultSchema: z.ZodType<Output>;
  readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
  readonly handler: (context: HandlerContext<Input>) => Output | Promise<Output>;
  readonly now?: () => number;
}

const UUID_SCHEMA = z.string().uuid();
const REQUEST_MAX_SKEW_MS = 5 * 60 * 1000;

export function registerSecureHandler<Input, Output>(
  options: SecureHandlerOptions<Input, Output>,
): () => void {
  const requestSchema = createRequestEnvelopeSchema(options.payloadSchema);
  const now = options.now ?? Date.now;

  options.ipcMain.handle(
    options.channel,
    async (event, rawRequest): Promise<ResultEnvelope<Output>> => {
      const requestId = extractRequestId(rawRequest);
      try {
        if (!options.isTrustedSender(event)) {
          throw new PublicFault('PERMISSION_DENIED', 'Request sender is not trusted');
        }
        if (hasUnsafeObjectShape(rawRequest)) {
          throw new PublicFault('VALIDATION_FAILED', 'IPC request contains an unsafe object shape');
        }
        if (serializedSize(rawRequest) > MAX_IPC_ENVELOPE_BYTES) {
          throw new PublicFault('VALIDATION_FAILED', 'IPC request exceeds the size limit');
        }
        const request = requestSchema.parse(rawRequest);
        if (Math.abs(now() - Date.parse(request.sentAt)) > REQUEST_MAX_SKEW_MS) {
          throw new PublicFault(
            'VALIDATION_FAILED',
            'IPC request timestamp is outside the allowed window',
          );
        }
        const data = options.resultSchema.parse(
          await options.handler({ payload: request.payload, requestId: request.requestId }),
        );
        return { ok: true, requestId: request.requestId, data };
      } catch (error: unknown) {
        return { ok: false, requestId, error: mapPublicError(error) };
      }
    },
  );

  return () => {
    options.ipcMain.removeHandler(options.channel);
  };
}

export function mapPublicError(error: unknown): PublicError {
  const correlationId = randomUUID();
  if (error instanceof PublicFault) {
    return {
      code: error.code,
      message: redactText(error.message),
      retryable: error.retryable,
      correlationId,
    };
  }
  if (error instanceof z.ZodError) {
    return {
      code: 'VALIDATION_FAILED',
      message: 'The request or response did not match its contract',
      retryable: false,
      correlationId,
    };
  }
  return {
    code: 'INTERNAL',
    message: 'The desktop service could not complete the request',
    retryable: false,
    correlationId,
  };
}

function extractRequestId(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'requestId' in value) {
    const parsed = UUID_SCHEMA.safeParse(value.requestId);
    if (parsed.success) return parsed.data;
  }
  return randomUUID();
}

function serializedSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function hasUnsafeObjectShape(value: unknown): boolean {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === undefined || typeof item.value !== 'object' || item.value === null) continue;
    if (item.depth > 32 || seen.has(item.value)) return true;
    seen.add(item.value);
    if (!Array.isArray(item.value)) {
      const prototype = Object.getPrototypeOf(item.value) as unknown;
      if (prototype !== Object.prototype && prototype !== null) return true;
    }
    let descriptors: Record<string, PropertyDescriptor>;
    try {
      descriptors = Object.getOwnPropertyDescriptors(item.value);
    } catch {
      return true;
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') return true;
      if ('get' in descriptor || 'set' in descriptor) return true;
      pending.push({ value: descriptor.value, depth: item.depth + 1 });
    }
  }
  return false;
}
