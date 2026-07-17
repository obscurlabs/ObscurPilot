import type { AgentInteractionProjection } from '@obscurpilot/contracts/agent';
import { GroqTranscriptionAdapter } from '@obscurpilot/adapters-groq/boundary';
import { encodeMonoPcm16Wav, type EncodedAudioClip } from '@obscurpilot/domain/audio-pipeline';
import { VoiceOrchestrator } from '../../apps/desktop/electron/voice-orchestrator';
import { describe, expect, it, vi } from 'vitest';

const id = '10000000-0000-4000-8000-000000000001';

describe('voice orchestration privacy boundary', () => {
  it('publishes typed state without transcript content and zeroizes the source clip', async () => {
    const projections: AgentInteractionProjection[] = [];
    const bytes = encodeMonoPcm16Wav(new Int16Array(4_000).fill(1_000), 16_000);
    const clip: EncodedAudioClip = {
      clipId: id,
      sessionId: '10000000-0000-4000-8000-000000000002',
      durationMs: 250,
      bytes,
      mimeType: 'audio/wav',
      truncated: false,
    };
    const orchestrator = new VoiceOrchestrator({
      transcription: new GroqTranscriptionAdapter({
        transport: { transcribe: async () => ({ text: 'private transcript' }) },
        maxAttempts: 1,
      }),
      onProjection: (projection) => projections.push(projection),
      onConnection: () => undefined,
      id: () => id,
    });
    await orchestrator.processClip(clip);
    expect(projections.map((projection) => projection.phase)).toEqual([
      'transcribing',
      'completed',
    ]);
    expect(JSON.stringify(projections)).not.toContain('private transcript');
    expect(bytes.every((value) => value === 0)).toBe(true);
  });

  it('expires confirmation after 45 seconds and resumes the paused loop deadline', async () => {
    vi.useFakeTimers();
    const projections: AgentInteractionProjection[] = [];
    const pauseDeadline = vi.fn();
    const resumeDeadline = vi.fn();
    let approved: boolean | undefined;
    const orchestrator = new VoiceOrchestrator({
      transcription: new GroqTranscriptionAdapter({
        transport: { transcribe: async () => ({ text: 'start streaming' }) },
        maxAttempts: 1,
      }),
      onProjection: (projection) => projections.push(projection),
      onConnection: () => undefined,
      id: (() => {
        let next = 0;
        return () => `10000000-0000-4000-8000-${(++next).toString().padStart(12, '0')}`;
      })(),
      onTranscript: async (_result, context) => {
        approved = await orchestrator.requestConfirmation({
          correlationId: context.correlationId,
          tool: { name: 'obs.start_stream', version: 1 },
          signal: context.signal,
          pauseDeadline,
          resumeDeadline,
        });
        orchestrator.setPhase({
          phase: 'completed',
          reasonCode: 'TEST_COMPLETE',
          correlationId: context.correlationId,
        });
      },
    });
    const process = orchestrator.processClip({
      clipId: id,
      sessionId: '10000000-0000-4000-8000-000000000002',
      durationMs: 250,
      bytes: encodeMonoPcm16Wav(new Int16Array(4_000).fill(1_000), 16_000),
      mimeType: 'audio/wav',
      truncated: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(projections.at(-1)).toMatchObject({
      phase: 'awaiting_confirmation',
      confirmation: { tool: { name: 'obs.start_stream', version: 1 } },
    });
    await vi.advanceTimersByTimeAsync(45_000);
    await process;
    expect(approved).toBe(false);
    expect(pauseDeadline).toHaveBeenCalledOnce();
    expect(resumeDeadline).toHaveBeenCalledOnce();
    expect(projections.some((projection) => projection.reasonCode === 'CONFIRMATION_EXPIRED')).toBe(
      true,
    );
    vi.useRealTimers();
  });

  it('accepts a spoken hands-free confirmation without cancelling the protected tool', async () => {
    const projections: AgentInteractionProjection[] = [];
    let approved: boolean | undefined;
    const transcription = new GroqTranscriptionAdapter({
      transport: {
        transcribe: async (request) => ({
          text: (await request.file.bytes()).byteLength > 100 ? 'start streaming' : 'yes',
        }),
      },
      maxAttempts: 1,
    });
    const orchestrator = new VoiceOrchestrator({
      transcription,
      onProjection: (projection) => projections.push(projection),
      onConnection: () => undefined,
      onTranscript: async (_result, context) => {
        approved = await orchestrator.requestConfirmation({
          correlationId: context.correlationId,
          tool: { name: 'obs.start_stream', version: 1 },
          signal: context.signal,
          pauseDeadline: () => undefined,
          resumeDeadline: () => undefined,
        });
      },
    });
    const initial = orchestrator.processClip({
      clipId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      durationMs: 250,
      bytes: new Uint8Array(128),
      mimeType: 'audio/wav',
      truncated: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await orchestrator.processClip(
      {
        clipId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        durationMs: 250,
        bytes: new Uint8Array(64),
        mimeType: 'audio/wav',
        truncated: false,
      },
      'hands_free',
    );
    await initial;
    expect(approved).toBe(true);
    expect(
      projections.some((projection) => projection.reasonCode === 'VOICE_CONFIRMATION_APPROVED'),
    ).toBe(true);
  });
});
