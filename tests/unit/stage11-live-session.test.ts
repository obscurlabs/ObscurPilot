import type { LiveSessionProfileV1 } from '@obscurpilot/contracts/live-session';
import type { ObsSnapshot } from '@obscurpilot/contracts/obs';
import {
  LiveSessionCoordinator,
  type LiveSessionObsPort,
  type LiveSessionTwitchPort,
} from '@obscurpilot/domain/live-session-coordinator';
import { BoundedChatIntelligence, ModerationGuard } from '@obscurpilot/domain/chat-intelligence';
import { describe, expect, it, vi } from 'vitest';

const profile: LiveSessionProfileV1 = {
  schemaVersion: 1,
  profileId: '11111111-1111-4111-8111-111111111111',
  revision: 1,
  name: 'Acceptance profile',
  twitch: {
    title: 'Acceptance title',
    categoryId: '42',
    categoryName: 'Test category',
    tags: ['acceptance'],
    language: 'en',
  },
  obs: {
    sceneCollectionName: 'Primary',
    preLiveSceneName: 'Starting',
    liveSceneName: 'Game',
    requiredInputs: ['Game Capture'],
    countdownSeconds: 0,
    recording: 'on',
  },
  verification: { obsReadyTimeoutMs: 1_000, twitchLiveTimeoutMs: 5_000 },
};

function snapshot(): ObsSnapshot {
  return {
    snapshotVersion: 7,
    generation: 3,
    capturedAt: '2026-07-17T00:00:00.000Z',
    obsVersion: '31.0.0',
    webSocketVersion: '5.6.0',
    rpcVersion: 1,
    sceneCollectionName: 'Primary',
    currentProgramSceneName: 'Starting',
    currentPreviewSceneName: null,
    studioModeEnabled: false,
    streamActive: false,
    recordActive: false,
    scenes: [
      { name: 'Starting', index: 0 },
      { name: 'Game', index: 1 },
    ],
    inputs: [{ name: 'Game Capture', kind: 'game_capture' }],
  };
}

function harness(scopes: readonly string[] = ['channel:manage:broadcast']) {
  const state = snapshot();
  const obs: LiveSessionObsPort = {
    snapshot: () => state,
    setProgramScene: vi.fn(async (name) => {
      state.currentProgramSceneName = name;
    }),
    setCountdownText: vi.fn(async () => undefined),
    startStream: vi.fn(async () => {
      state.streamActive = true;
    }),
    stopStream: vi.fn(async () => {
      state.streamActive = false;
    }),
    startRecord: vi.fn(async () => {
      state.recordActive = true;
    }),
    stopRecord: vi.fn(async () => {
      state.recordActive = false;
    }),
  };
  const twitch: LiveSessionTwitchPort = {
    preflight: vi.fn(async () => ({
      metadata: {
        title: 'Previous',
        categoryId: '1',
        categoryName: 'Previous',
        tags: [],
        language: 'en',
      },
      scopes,
      categoryValid: true,
      live: false,
    })),
    updateMetadata: vi.fn(async () => undefined),
    restoreMetadata: vi.fn(async () => undefined),
    isLive: vi.fn(async () => state.streamActive),
  };
  const coordinator = new LiveSessionCoordinator({
    obs,
    twitch,
    onProjection: vi.fn(),
    id: () => '22222222-2222-4222-8222-222222222222',
    sleep: async () => undefined,
  });
  return { coordinator, obs, twitch, state };
}

describe('Stage 11 live-session safety', () => {
  it('dry-run records and switches scenes without mutating Twitch or starting a stream', async () => {
    const { coordinator, obs, twitch } = harness([]);
    const prepared = await coordinator.prepare(profile, 'dry_run');
    expect(prepared.phase).toBe('awaiting_confirmation');
    coordinator.decide(prepared.plan!.planId, 'approve');
    await vi.waitFor(() => expect(coordinator.snapshot().phase).toBe('live'));
    expect(obs.startRecord).toHaveBeenCalledOnce();
    expect(obs.startStream).not.toHaveBeenCalled();
    expect(twitch.updateMetadata).not.toHaveBeenCalled();
    expect(obs.setProgramScene).toHaveBeenNthCalledWith(
      2,
      'Game',
      expect.any(String),
      expect.any(AbortSignal),
    );
  });

  it('fails closed when live authorization lacks the broadcast scope', async () => {
    const { coordinator, obs, twitch } = harness([]);
    const result = await coordinator.prepare(profile, 'live');
    expect(result).toMatchObject({ phase: 'failed', reasonCode: 'TWITCH_SCOPE_REQUIRED' });
    expect(obs.startStream).not.toHaveBeenCalled();
    expect(twitch.updateMetadata).not.toHaveBeenCalled();
  });
});

describe('Stage 11 bounded chat and moderation', () => {
  it('deduplicates message IDs and evicts beyond the configured bound', () => {
    const intelligence = new BoundedChatIntelligence(2);
    const ingest = (messageId: string, text: string) =>
      intelligence.ingest({
        messageId,
        broadcasterId: 'broadcaster',
        userId: 'viewer',
        userLogin: 'viewer',
        userDisplayName: 'Viewer',
        text,
        occurredAt: '2026-07-17T00:00:00.000Z',
        roles: { broadcaster: false, moderator: false, subscriber: false },
      });
    expect(ingest('one', 'hello').accepted).toBe(true);
    expect(ingest('one', 'duplicate').accepted).toBe(false);
    ingest('two', 'second');
    ingest('three', 'THREE THREE THREE THREE!!!!!!!!!');
    expect(intelligence.snapshot().map((message) => message.messageId)).toEqual(['two', 'three']);
  });

  it('requires confirmation, matching evidence, and rejects the broadcaster', () => {
    const intelligence = new BoundedChatIntelligence();
    const evidence = intelligence.ingest({
      messageId: 'message-1',
      broadcasterId: 'owner',
      userId: 'viewer',
      userLogin: 'viewer',
      userDisplayName: 'Viewer',
      text: 'evidence',
      occurredAt: '2026-07-17T00:00:00.000Z',
      roles: { broadcaster: false, moderator: false, subscriber: false },
    }).message;
    const guard = new ModerationGuard(new Set());
    const intent = {
      schemaVersion: 1 as const,
      intentId: '33333333-3333-4333-8333-333333333333',
      action: 'timeout_user' as const,
      targetUserId: 'viewer',
      targetLogin: 'viewer',
      durationSeconds: 600,
      reason: 'Creator review',
      evidenceMessageId: 'message-1',
    };
    expect(() => guard.authorize(intent, evidence, 'owner', false)).toThrow(
      'CONFIRMATION_REQUIRED',
    );
    expect(guard.authorize(intent, evidence, 'owner', true)).toEqual(intent);
    expect(() =>
      guard.authorize({ ...intent, targetUserId: 'owner' }, evidence, 'owner', true),
    ).toThrow('PROTECTED_ACCOUNT');
  });
});
