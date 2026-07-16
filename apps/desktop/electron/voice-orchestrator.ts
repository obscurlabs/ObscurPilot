import { randomUUID } from 'node:crypto';
import type { AgentInteractionProjection, GroqReasoningModel } from '@obscurpilot/contracts/agent';
import type { ConnectionProjection } from '@obscurpilot/contracts/state';
import type { EncodedAudioClip } from '@obscurpilot/domain/audio-pipeline';
import {
  GroqAdapterError,
  type ConfirmationRequest,
  type GroqTranscriptionAdapter,
  type TranscriptionResult,
} from '@obscurpilot/adapters-groq/boundary';
import type { AgentConfirmationDecisionPayload } from '@obscurpilot/contracts/agent';
import { LoopLimitError } from '@obscurpilot/domain/loop-controller';
import { PolicyDeniedError } from '@obscurpilot/domain/policy';
import { ObsBridgeError } from '@obscurpilot/adapters-obs/boundary';
import { ZodError } from 'zod';

export interface VoiceOrchestratorOptions {
  readonly transcription: GroqTranscriptionAdapter;
  readonly onProjection: (projection: AgentInteractionProjection) => void;
  readonly onConnection: (projection: ConnectionProjection) => void;
  readonly onTranscript?: (
    result: TranscriptionResult,
    context: { readonly correlationId: string; readonly signal: AbortSignal },
  ) => Promise<void>;
  readonly now?: () => number;
  readonly id?: () => string;
}

export class VoiceOrchestrator {
  private readonly now: () => number;
  private readonly id: () => string;
  private projectionValue: AgentInteractionProjection = {
    phase: 'idle',
    reasonCode: 'IDLE',
    elapsedMs: 0,
  };
  private active:
    | {
        readonly correlationId: string;
        readonly startedAt: number;
        readonly abort: AbortController;
      }
    | undefined;
  private transcriptHandler: VoiceOrchestratorOptions['onTranscript'];
  private pendingConfirmation:
    | {
        readonly confirmationId: string;
        readonly correlationId: string;
        readonly settle: (approved: boolean, reasonCode: string) => void;
      }
    | undefined;
  private disposed = false;

  public constructor(private readonly options: VoiceOrchestratorOptions) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? randomUUID;
    this.transcriptHandler = options.onTranscript;
  }

  public snapshot(): AgentInteractionProjection {
    return this.projectionValue;
  }

  public async processClip(clip: EncodedAudioClip): Promise<void> {
    if (this.disposed) return;
    this.cancel('SUPERSEDED');
    const correlationId = this.id();
    const active = {
      correlationId,
      startedAt: this.now(),
      abort: new AbortController(),
    };
    this.active = active;
    this.publish({
      phase: 'transcribing',
      reasonCode: 'STT_IN_FLIGHT',
      elapsedMs: 0,
      correlationId,
    });
    this.publishConnection('connecting', 'REQUEST_IN_FLIGHT', correlationId);
    try {
      const result = await this.options.transcription.transcribe(
        clip,
        correlationId,
        active.abort.signal,
      );
      if (this.active !== active || active.abort.signal.aborted) return;
      this.publishConnection('ready', 'STT_READY', correlationId);
      if (this.transcriptHandler !== undefined) {
        await this.transcriptHandler(result, {
          correlationId,
          signal: active.abort.signal,
        });
      } else if (this.active === active) {
        this.publish({
          phase: 'completed',
          reasonCode: 'TRANSCRIPTION_COMPLETE',
          elapsedMs: this.elapsed(active),
          correlationId,
        });
      }
    } catch (error: unknown) {
      if (this.active !== active) return;
      if (error instanceof GroqAdapterError && error.code === 'CANCELLED') {
        this.publish({ phase: 'idle', reasonCode: 'CANCELLED', elapsedMs: 0 });
      } else {
        const reasonCode = reasonCodeForError(error);
        this.publish({
          phase: 'error',
          reasonCode,
          elapsedMs: this.elapsed(active),
          correlationId,
        });
        if (error instanceof GroqAdapterError) {
          this.publishConnection(connectionPhaseFor(error), error.code, correlationId);
        } else {
          this.publishConnection('ready', reasonCode, correlationId);
        }
      }
    } finally {
      clip.bytes.fill(0);
      if (this.active === active) this.active = undefined;
    }
  }

  public setPhase(input: {
    readonly phase: AgentInteractionProjection['phase'];
    readonly reasonCode: string;
    readonly correlationId: string;
    readonly model?: GroqReasoningModel;
    readonly tool?: AgentInteractionProjection['tool'];
    readonly confirmation?: AgentInteractionProjection['confirmation'];
  }): void {
    const active = this.active;
    if (active?.correlationId !== input.correlationId) return;
    this.publish({
      phase: input.phase,
      reasonCode: input.reasonCode,
      elapsedMs: this.elapsed(active),
      correlationId: input.correlationId,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.tool === undefined ? {} : { tool: input.tool }),
      ...(input.confirmation === undefined ? {} : { confirmation: input.confirmation }),
    });
  }

  public setTranscriptHandler(
    handler: NonNullable<VoiceOrchestratorOptions['onTranscript']>,
  ): void {
    this.transcriptHandler = handler;
  }

  public requestConfirmation(request: ConfirmationRequest): Promise<boolean> {
    const active = this.active;
    if (active?.correlationId !== request.correlationId || request.signal.aborted) {
      return Promise.resolve(false);
    }
    this.pendingConfirmation?.settle(false, 'CONFIRMATION_SUPERSEDED');
    const confirmationId = this.id();
    const expiresAtMs = this.now() + 15_000;
    request.pauseDeadline();
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const onAbort = () => settle(false, 'CONFIRMATION_CANCELLED');
      const timer = setTimeout(() => settle(false, 'CONFIRMATION_EXPIRED'), 15_000);
      timer.unref?.();
      const settle = (approved: boolean, reasonCode: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal.removeEventListener('abort', onAbort);
        request.resumeDeadline();
        if (this.pendingConfirmation?.confirmationId === confirmationId) {
          this.pendingConfirmation = undefined;
        }
        if (approved && this.active === active) {
          this.setPhase({
            phase: 'tool_active',
            reasonCode,
            correlationId: request.correlationId,
            tool: request.tool,
          });
        } else if (this.active === active) {
          this.setPhase({
            phase: 'reasoning',
            reasonCode,
            correlationId: request.correlationId,
          });
        }
        resolve(approved);
      };
      this.pendingConfirmation = {
        confirmationId,
        correlationId: request.correlationId,
        settle,
      };
      request.signal.addEventListener('abort', onAbort, { once: true });
      this.setPhase({
        phase: 'awaiting_confirmation',
        reasonCode: 'CONFIRMATION_REQUIRED',
        correlationId: request.correlationId,
        tool: request.tool,
        confirmation: {
          confirmationId,
          tool: request.tool,
          expiresAt: new Date(expiresAtMs).toISOString(),
          summaryCode: `CONFIRM_${request.tool.name.replaceAll('.', '_').toUpperCase()}`,
        },
      });
    });
  }

  public decideConfirmation(payload: AgentConfirmationDecisionPayload): AgentInteractionProjection {
    const pending = this.pendingConfirmation;
    if (pending?.confirmationId !== payload.confirmationId) return this.snapshot();
    pending.settle(
      payload.decision === 'approve',
      `CONFIRMATION_${payload.decision.toUpperCase()}`,
    );
    return this.snapshot();
  }

  public cancel(reasonCode = 'CANCELLED'): void {
    const active = this.active;
    if (active === undefined) return;
    this.pendingConfirmation?.settle(false, reasonCode);
    this.pendingConfirmation = undefined;
    this.active = undefined;
    active.abort.abort(new DOMException(reasonCode, 'AbortError'));
    this.publish({ phase: 'idle', reasonCode, elapsedMs: 0 });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel('SHUTDOWN');
  }

  private elapsed(active: { readonly startedAt: number }): number {
    return Math.max(0, this.now() - active.startedAt);
  }

  private publish(projection: AgentInteractionProjection): void {
    this.projectionValue = projection;
    this.options.onProjection(projection);
  }

  private publishConnection(
    phase: ConnectionProjection['phase'],
    reasonCode: string,
    correlationId: string,
  ): void {
    this.options.onConnection({
      provider: 'groq',
      phase,
      attempt: 0,
      changedAt: new Date(this.now()).toISOString(),
      reasonCode,
      correlationId,
    });
  }
}

function connectionPhaseFor(error: GroqAdapterError): ConnectionProjection['phase'] {
  if (error.code === 'AUTH_REQUIRED' || error.code === 'NOT_CONFIGURED') return 'auth_required';
  if (error.code === 'RATE_LIMITED') return 'backoff';
  return 'degraded';
}

function reasonCodeForError(error: unknown): string {
  if (error instanceof GroqAdapterError) return error.code;
  if (error instanceof PolicyDeniedError) return 'POLICY_DENIED';
  if (error instanceof LoopLimitError) return 'LOOP_LIMIT_REACHED';
  if (error instanceof ObsBridgeError) return error.code;
  if (error instanceof ZodError) return 'TOOL_ARGUMENT_INVALID';
  return 'ORCHESTRATION_FAILED';
}
