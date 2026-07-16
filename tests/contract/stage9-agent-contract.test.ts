import {
  AgentConfirmationDecisionPayloadSchema,
  AgentInteractionProjectionSchema,
} from '@obscurpilot/contracts/agent';
import { describe, expect, it } from 'vitest';

describe('Stage 9 renderer contract', () => {
  it('exposes only typed operational state and rejects transcript or arguments', () => {
    const projection = {
      phase: 'awaiting_confirmation',
      reasonCode: 'CONFIRMATION_REQUIRED',
      elapsedMs: 120,
      correlationId: '10000000-0000-4000-8000-000000000001',
      tool: { name: 'obs.stop_stream', version: 1 },
      confirmation: {
        confirmationId: '10000000-0000-4000-8000-000000000002',
        tool: { name: 'obs.stop_stream', version: 1 },
        expiresAt: new Date(Date.now() + 15_000).toISOString(),
        summaryCode: 'CONFIRM_OBS_STOP_STREAM',
      },
    };
    expect(AgentInteractionProjectionSchema.parse(projection)).toEqual(projection);
    expect(() =>
      AgentInteractionProjectionSchema.parse({
        ...projection,
        transcript: 'private',
      }),
    ).toThrow();
    expect(() =>
      AgentInteractionProjectionSchema.parse({
        ...projection,
        arguments: { sceneName: 'private' },
      }),
    ).toThrow();
  });

  it('accepts only exact approve or deny confirmation decisions', () => {
    const confirmationId = '10000000-0000-4000-8000-000000000002';
    expect(
      AgentConfirmationDecisionPayloadSchema.parse({ confirmationId, decision: 'approve' }),
    ).toEqual({ confirmationId, decision: 'approve' });
    expect(() =>
      AgentConfirmationDecisionPayloadSchema.parse({ confirmationId, decision: 'always' }),
    ).toThrow();
  });
});
