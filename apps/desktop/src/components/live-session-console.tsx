import type {
  ChatAnalysisProjection,
  ChatMessageProjection,
  LiveSessionMode,
  LiveSessionProfileV1,
  LiveSessionProjection,
  ModerationIntentV1,
  PilotOverlayPreferences,
} from '@obscurpilot/contracts/live-session';
import type { ObsProjection } from '@obscurpilot/contracts/obs';
import type { TwitchCategory } from '@obscurpilot/contracts/twitch';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';

const EMPTY: LiveSessionProjection = {
  phase: 'draft',
  reasonCode: 'NO_PLAN',
  updatedAt: new Date(0).toISOString(),
  completedSteps: [],
  obsStreamActive: false,
  twitchLive: false,
  liveVerified: false,
};
const DEFAULT_OVERLAY: PilotOverlayPreferences = {
  visible: true,
  corner: 'bottom_right',
  scale: 1,
  clickThrough: true,
};
type Draft = {
  id: string;
  name: string;
  title: string;
  categoryId: string;
  categoryName: string;
  tags: string;
  language: string;
  preScene: string;
  liveScene: string;
  requiredInputs: string;
  countdown: string;
  countdownInput: string;
  recording: 'off' | 'on';
};
const csv = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
const blankDraft = (obs?: ObsProjection): Draft => {
  const scene = obs?.snapshot?.currentProgramSceneName ?? obs?.snapshot?.scenes[0]?.name ?? '';
  return {
    id: crypto.randomUUID(),
    name: '',
    title: '',
    categoryId: '',
    categoryName: '',
    tags: '',
    language: 'en',
    preScene: scene,
    liveScene: scene,
    requiredInputs: '',
    countdown: '300',
    countdownInput: '',
    recording: 'on',
  };
};
const fromProfile = (profile: LiveSessionProfileV1): Draft => ({
  id: profile.profileId,
  name: profile.name,
  title: profile.twitch.title,
  categoryId: profile.twitch.categoryId,
  categoryName: profile.twitch.categoryName,
  tags: profile.twitch.tags.join(', '),
  language: profile.twitch.language,
  preScene: profile.obs.preLiveSceneName,
  liveScene: profile.obs.liveSceneName,
  requiredInputs: profile.obs.requiredInputs.join(', '),
  countdown: String(profile.obs.countdownSeconds),
  countdownInput: profile.obs.countdownInputName ?? '',
  recording: profile.obs.recording,
});

export function LiveSessionConsole({ obs }: { readonly obs: ObsProjection | undefined }) {
  const [session, setSession] = useState<LiveSessionProjection>(EMPTY);
  const [profiles, setProfiles] = useState<readonly LiveSessionProfileV1[]>([]);
  const [draft, setDraft] = useState<Draft>(() => blankDraft(obs));
  const [mode, setMode] = useState<LiveSessionMode>('dry_run');
  const [overlay, setOverlay] = useState(DEFAULT_OVERLAY);
  const [messages, setMessages] = useState<readonly ChatMessageProjection[]>([]);
  const [analysis, setAnalysis] = useState<ReadonlyMap<string, ChatAnalysisProjection>>(
    () => new Map(),
  );
  const [moderation, setModeration] = useState<ModerationIntentV1>();
  const [pending, setPending] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [categoryOptions, setCategoryOptions] = useState<readonly TwitchCategory[]>([]);
  const [clock, setClock] = useState(() => Date.now());
  const snapshot = obs?.snapshot;

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.obscurPilot.getLiveSession(),
      window.obscurPilot.getLiveSessionProfiles(),
      window.obscurPilot.getPilotOverlayPreferences(),
    ]).then(([current, saved, preferences]) => {
      if (!active) return;
      setSession(current);
      setProfiles(saved.profiles);
      setOverlay(preferences);
      const selected =
        saved.profiles.find((profile) => profile.profileId === saved.activeProfileId) ??
        saved.profiles[0];
      if (selected) setDraft(fromProfile(selected));
    });
    const offSession = window.obscurPilot.onLiveSessionChanged((value) => {
      if (active) setSession(value);
    });
    const offMessage = window.obscurPilot.onChatMessage((value) => {
      if (active) setMessages((current) => [...current.slice(-79), value]);
    });
    const offAnalysis = window.obscurPilot.onChatAnalysis((value) => {
      if (!active) return;
      setAnalysis((current) => {
        const next = new Map(current);
        next.set(value.messageId, value);
        while (next.size > 80) next.delete(next.keys().next().value as string);
        return next;
      });
    });
    return () => {
      active = false;
      offSession();
      offMessage();
      offAnalysis();
    };
  }, []);

  useEffect(() => {
    if (session.phase !== 'awaiting_confirmation') return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [session.phase]);

  const reviewQueue = useMemo(
    () =>
      messages
        .filter((message) => (analysis.get(message.messageId)?.severity ?? 'none') !== 'none')
        .slice(-6)
        .reverse(),
    [analysis, messages],
  );
  const change = (key: keyof Draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const buildProfile = (): LiveSessionProfileV1 => {
    if (!snapshot) throw new Error('Connect OBS before preflight');
    const countdown = Number(draft.countdown);
    if (!Number.isInteger(countdown) || countdown < 0 || countdown > 3600) {
      throw new Error('Countdown must be between 0 and 3600 seconds');
    }
    const previous = profiles.find((profile) => profile.profileId === draft.id);
    return {
      schemaVersion: 1,
      profileId: draft.id,
      revision: (previous?.revision ?? 0) + 1,
      name: draft.name.trim(),
      twitch: {
        title: draft.title.trim(),
        categoryId: draft.categoryId.trim(),
        categoryName: draft.categoryName.trim(),
        tags: csv(draft.tags).slice(0, 10),
        language: draft.language.trim().toLowerCase(),
      },
      obs: {
        sceneCollectionName: snapshot.sceneCollectionName,
        preLiveSceneName: draft.preScene,
        liveSceneName: draft.liveScene,
        requiredInputs: csv(draft.requiredInputs),
        countdownSeconds: countdown,
        ...(draft.countdownInput ? { countdownInputName: draft.countdownInput } : {}),
        recording: draft.recording,
      },
      verification: { obsReadyTimeoutMs: 15_000, twitchLiveTimeoutMs: 90_000 },
    };
  };
  const prepare = async (event: FormEvent) => {
    event.preventDefault();
    setPending('prepare');
    setNotice(undefined);
    try {
      const profile = buildProfile();
      const next = await window.obscurPilot.prepareLiveSession(profile, mode);
      const saved = await window.obscurPilot.getLiveSessionProfiles();
      setSession(next);
      setProfiles(saved.profiles);
      setDraft(fromProfile(profile));
      setNotice(
        next.phase === 'awaiting_confirmation'
          ? 'Preflight passed. Review the locked plan, then approve.'
          : next.reasonCode.replaceAll('_', ' '),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Preflight failed');
    } finally {
      setPending(undefined);
    }
  };
  const decide = async (decision: 'approve' | 'deny') => {
    if (!session.plan) return;
    setPending(decision);
    try {
      setSession(
        await window.obscurPilot.decideLiveSession({ planId: session.plan.planId, decision }),
      );
    } catch {
      setNotice('The plan changed or expired. Run preflight again.');
    } finally {
      setPending(undefined);
    }
  };
  const stop = async (emergency: boolean) => {
    setPending('stop');
    try {
      setSession(
        emergency
          ? await window.obscurPilot.emergencyStopLiveSession()
          : await window.obscurPilot.stopLiveSession(),
      );
    } finally {
      setPending(undefined);
    }
  };
  const saveOverlay = async (value: PilotOverlayPreferences) => {
    setOverlay(value);
    try {
      setOverlay(await window.obscurPilot.setPilotOverlayPreferences(value));
    } catch {
      setNotice('Overlay preference could not be applied');
    }
  };
  const searchCategory = async () => {
    if (!draft.categoryName.trim()) return;
    setPending('category');
    try {
      const result = await window.obscurPilot.searchTwitchCategories(draft.categoryName);
      setCategoryOptions(result.categories);
      const exact = result.categories.find(
        (category) =>
          category.name.localeCompare(draft.categoryName, undefined, {
            sensitivity: 'accent',
          }) === 0,
      );
      if (exact) {
        setDraft((current) => ({
          ...current,
          categoryId: exact.id,
          categoryName: exact.name,
        }));
      }
      setNotice(
        result.categories.length
          ? 'Select the exact Twitch category returned by Helix.'
          : 'No Twitch category matched that name.',
      );
    } catch {
      setNotice('Category search requires a connected Twitch account.');
    } finally {
      setPending(undefined);
    }
  };
  const propose = (message: ChatMessageProjection, action: ModerationIntentV1['action']) => {
    setModeration({
      schemaVersion: 1,
      intentId: crypto.randomUUID(),
      action,
      targetUserId: message.userId,
      targetLogin: message.userLogin,
      ...(action === 'delete_message' ? { messageId: message.messageId } : {}),
      ...(action === 'timeout_user' ? { durationSeconds: 600 } : {}),
      reason: 'Creator-approved Stage 11 chat review action',
      evidenceMessageId: message.messageId,
    });
  };
  const confirmModeration = async () => {
    if (!moderation) return;
    setPending('moderation');
    try {
      await window.obscurPilot.executeModeration(moderation, true);
      setNotice(
        `${moderation.action.replaceAll('_', ' ')} completed for @${moderation.targetLogin}`,
      );
      setModeration(undefined);
    } catch {
      setNotice('Moderation failed. Verify Twitch scopes and account protections.');
    } finally {
      setPending(undefined);
    }
  };
  const expired = session.plan ? Date.parse(session.plan.expiresAt) <= clock : false;
  const running = [
    'applying_twitch',
    'preparing_obs',
    'starting_output',
    'verifying_live',
    'live',
  ].includes(session.phase);

  return (
    <Card className="span-full live-session-console" id="live-session">
      <CardHeader>
        <div className="live-session-heading">
          <div>
            <p className="eyebrow">Deterministic production saga</p>
            <h2 className="panel-title">Live session control</h2>
            <p className="panel-copy">
              Rehearse locally, inspect one immutable plan, then approve live output.
            </p>
          </div>
          <div className="live-state" aria-live="polite">
            <span className="session-pulse" data-phase={session.phase} />
            <div>
              <Badge
                tone={
                  session.phase === 'live'
                    ? 'ready'
                    : session.phase === 'failed'
                      ? 'waiting'
                      : 'neutral'
                }
              >
                {session.phase.replaceAll('_', ' ')}
              </Badge>
              <span>{session.reasonCode.replaceAll('_', ' ')}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="session-grid">
          <form className="session-profile" onSubmit={(event) => void prepare(event)}>
            <Section number="01" title="Production profile">
              <select
                aria-label="Load saved profile"
                value={profiles.some((profile) => profile.profileId === draft.id) ? draft.id : ''}
                onChange={(event) => {
                  const selected = profiles.find(
                    (profile) => profile.profileId === event.target.value,
                  );
                  setDraft(selected ? fromProfile(selected) : blankDraft(obs));
                }}
              >
                <option value="">New profile</option>
                {profiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </Section>
            <div className="session-form-grid">
              <Field label="Profile name">
                <input
                  required
                  maxLength={80}
                  value={draft.name}
                  onChange={(event) => change('name', event.target.value)}
                />
              </Field>
              <Field label="Stream title">
                <input
                  required
                  maxLength={140}
                  value={draft.title}
                  onChange={(event) => change('title', event.target.value)}
                />
              </Field>
              <Field label="Twitch category ID" help="Numeric ID; preflight checks the name.">
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]{1,32}"
                  value={draft.categoryId}
                  onChange={(event) => change('categoryId', event.target.value)}
                />
              </Field>
              <Field label="Twitch category name">
                <input
                  required
                  maxLength={120}
                  value={draft.categoryName}
                  onChange={(event) => change('categoryName', event.target.value)}
                />
              </Field>
              <div className="category-resolver">
                <Button
                  type="button"
                  size="compact"
                  variant="secondary"
                  disabled={!!pending || !draft.categoryName.trim()}
                  onClick={() => void searchCategory()}
                >
                  {pending === 'category' ? 'Searching…' : 'Resolve category ID'}
                </Button>
                {categoryOptions.length ? (
                  <select
                    aria-label="Twitch category search results"
                    value={draft.categoryId}
                    onChange={(event) => {
                      const selected = categoryOptions.find(
                        (category) => category.id === event.target.value,
                      );
                      if (selected) {
                        setDraft((current) => ({
                          ...current,
                          categoryId: selected.id,
                          categoryName: selected.name,
                        }));
                      }
                    }}
                  >
                    <option value="">Select exact category</option>
                    {categoryOptions.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name} · {category.id}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              <Field label="Starting scene">
                <SceneSelect
                  value={draft.preScene}
                  scenes={snapshot?.scenes ?? []}
                  onChange={(value) => change('preScene', value)}
                />
              </Field>
              <Field label="Live scene">
                <SceneSelect
                  value={draft.liveScene}
                  scenes={snapshot?.scenes ?? []}
                  onChange={(value) => change('liveScene', value)}
                />
              </Field>
              <Field label="Countdown seconds">
                <input
                  type="number"
                  min={0}
                  max={3600}
                  value={draft.countdown}
                  onChange={(event) => change('countdown', event.target.value)}
                />
              </Field>
              <Field label="Countdown text input">
                <select
                  value={draft.countdownInput}
                  onChange={(event) => change('countdownInput', event.target.value)}
                >
                  <option value="">No text input</option>
                  {snapshot?.inputs.map((input) => (
                    <option key={input.name}>{input.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Tags">
                <input
                  value={draft.tags}
                  onChange={(event) => change('tags', event.target.value)}
                  placeholder="tag one, tag two"
                />
              </Field>
              <Field label="Required OBS inputs">
                <input
                  value={draft.requiredInputs}
                  onChange={(event) => change('requiredInputs', event.target.value)}
                  placeholder="game capture, microphone"
                />
              </Field>
              <Field label="Language">
                <input
                  required
                  pattern="[a-z]{2}"
                  maxLength={2}
                  value={draft.language}
                  onChange={(event) => change('language', event.target.value)}
                />
              </Field>
              <Field label="Recording">
                <select
                  value={draft.recording}
                  onChange={(event) => change('recording', event.target.value)}
                >
                  <option value="on">Record local output</option>
                  <option value="off">Streaming only</option>
                </select>
              </Field>
            </div>
            <fieldset className="session-mode">
              <legend>Execution boundary</legend>
              {(['dry_run', 'live'] as const).map((value) => (
                <label key={value} data-selected={mode === value}>
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  <span>
                    <strong>{value === 'dry_run' ? 'Dry run' : 'Live'}</strong>
                    <small>
                      {value === 'dry_run'
                        ? 'Records locally; no Twitch mutation or stream.'
                        : 'Requires a second explicit approval.'}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <Button type="submit" disabled={!!pending || !snapshot}>
              {pending === 'prepare' ? 'Running preflight...' : 'Save and run preflight'}
            </Button>
          </form>
          <div className="session-operation">
            <Section number="02" title="Authoritative plan">
              <span className="session-hash">
                {session.plan?.planHash.slice(0, 12) ?? 'No plan'}
              </span>
            </Section>
            {!session.plan ? (
              <div className="session-empty">
                <strong>Waiting for preflight</strong>
                <span>Outputs remain locked.</span>
              </div>
            ) : (
              <>
                <dl className="session-facts">
                  <div>
                    <dt>Profile</dt>
                    <dd>{session.plan.profileName}</dd>
                  </div>
                  <div>
                    <dt>Mode</dt>
                    <dd>{session.plan.mode.replace('_', ' ')}</dd>
                  </div>
                  <div>
                    <dt>Title</dt>
                    <dd>{session.plan.plannedTwitch.title}</dd>
                  </div>
                  <div>
                    <dt>Category</dt>
                    <dd>
                      {session.plan.plannedTwitch.categoryName} /{' '}
                      {session.plan.plannedTwitch.categoryId}
                    </dd>
                  </div>
                  <div>
                    <dt>OBS route</dt>
                    <dd>
                      {session.plan.preLiveSceneName} to {session.plan.liveSceneName}
                    </dd>
                  </div>
                  <div>
                    <dt>Countdown</dt>
                    <dd>{session.plan.countdownSeconds}s</dd>
                  </div>
                </dl>
                <ol className="session-steps">
                  {session.plan.steps.map((step) => (
                    <li
                      key={step}
                      data-complete={session.completedSteps.includes(step)}
                      data-active={session.activeStep === step}
                    >
                      <span />
                      {step.replaceAll('_', ' ')}
                    </li>
                  ))}
                </ol>
                <section className="session-assurance" aria-label="Verified execution assurance">
                  <div className="assurance-summary">
                    <div>
                      <span>Preflight</span>
                      <strong>
                        {
                          (session.preflightChecks ?? []).filter(
                            (check) => check.status === 'passed',
                          ).length
                        }
                        /{session.preflightChecks?.length ?? 0}
                      </strong>
                    </div>
                    <div>
                      <span>Verified operations</span>
                      <strong>
                        {session.reliability?.verified ?? 0}/{session.reliability?.operations ?? 0}
                      </strong>
                    </div>
                    <div>
                      <span>P95 execution</span>
                      <strong>{session.reliability?.p95LatencyMs ?? 0}ms</strong>
                    </div>
                    <div>
                      <span>Recovery attempts</span>
                      <strong>{session.reliability?.recoveries ?? 0}</strong>
                    </div>
                  </div>
                  {(session.preflightChecks?.length ?? 0) > 0 ? (
                    <ul className="assurance-checks">
                      {session.preflightChecks?.map((check) => (
                        <li key={check.id} data-status={check.status}>
                          <span aria-hidden="true" />
                          <div>
                            <strong>{check.id.replaceAll('.', ' ')}</strong>
                            <small>{check.reasonCode.replaceAll('_', ' ')}</small>
                          </div>
                          <Badge
                            tone={
                              check.status === 'passed'
                                ? 'ready'
                                : check.status === 'warning'
                                  ? 'waiting'
                                  : 'neutral'
                            }
                          >
                            {check.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {(session.executionReceipts?.length ?? 0) > 0 ? (
                    <ol className="assurance-receipts" aria-label="Recent execution receipts">
                      {session.executionReceipts?.slice(-5).map((receipt) => (
                        <li key={receipt.receiptId} data-status={receipt.status}>
                          <span>{receipt.step.replaceAll('_', ' ')}</span>
                          <strong>{receipt.reasonCode.replaceAll('_', ' ')}</strong>
                          <small>
                            {receipt.verification.replaceAll('_', ' ')} · {receipt.durationMs ?? 0}
                            ms
                          </small>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </section>
                {session.countdownRemainingSeconds !== undefined ? (
                  <div className="countdown-readout">
                    <span>Starting soon</span>
                    <strong>{session.countdownRemainingSeconds}s</strong>
                  </div>
                ) : null}
                <div className="session-actions">
                  {session.phase === 'awaiting_confirmation' && !expired ? (
                    <>
                      <Button
                        variant="secondary"
                        disabled={!!pending}
                        onClick={() => void decide('deny')}
                      >
                        Deny
                      </Button>
                      <Button disabled={!!pending} onClick={() => void decide('approve')}>
                        {session.plan.mode === 'live' ? 'Approve and go live' : 'Approve dry run'}
                      </Button>
                    </>
                  ) : null}
                  {running ? (
                    <Button
                      variant="secondary"
                      disabled={!!pending}
                      onClick={() => void stop(false)}
                    >
                      Stop session
                    </Button>
                  ) : null}
                  <Button variant="danger" disabled={!!pending} onClick={() => void stop(true)}>
                    Emergency stop
                  </Button>
                </div>
                {expired && session.phase === 'awaiting_confirmation' ? (
                  <p className="session-notice">Plan expired. Repeat preflight.</p>
                ) : null}
              </>
            )}
            <div className="overlay-controls">
              <Section number="03" title="Pilot overlay">
                <Badge tone={overlay.visible ? 'ready' : 'neutral'}>
                  {overlay.visible ? 'visible' : 'hidden'}
                </Badge>
              </Section>
              <div className="overlay-grid">
                <label>
                  <input
                    type="checkbox"
                    checked={overlay.visible}
                    onChange={(event) =>
                      void saveOverlay({ ...overlay, visible: event.target.checked })
                    }
                  />
                  Show corner Pilot
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={overlay.clickThrough}
                    onChange={(event) =>
                      void saveOverlay({ ...overlay, clickThrough: event.target.checked })
                    }
                  />
                  Click-through
                </label>
                <label>
                  Corner
                  <select
                    value={overlay.corner}
                    onChange={(event) =>
                      void saveOverlay({
                        ...overlay,
                        corner: event.target.value as PilotOverlayPreferences['corner'],
                      })
                    }
                  >
                    <option value="top_left">Top left</option>
                    <option value="top_right">Top right</option>
                    <option value="bottom_left">Bottom left</option>
                    <option value="bottom_right">Bottom right</option>
                  </select>
                </label>
                <label>
                  Scale
                  <select
                    value={overlay.scale}
                    onChange={(event) =>
                      void saveOverlay({ ...overlay, scale: Number(event.target.value) })
                    }
                  >
                    <option value={0.75}>75%</option>
                    <option value={1}>100%</option>
                    <option value={1.25}>125%</option>
                    <option value={1.5}>150%</option>
                  </select>
                </label>
              </div>
              <p className="capture-boundary">
                Content protection is active. Verify the overlay stays excluded from OBS capture.
              </p>
            </div>
          </div>
        </div>
        <section className="chat-guard" aria-labelledby="chat-guard-title">
          <Section number="04" title="Chat intelligence">
            <span className="session-hash">{messages.length} bounded events</span>
          </Section>
          {!reviewQueue.length ? (
            <div className="chat-empty">No messages require review.</div>
          ) : (
            <div className="chat-list">
              {reviewQueue.map((message) => (
                <article
                  key={message.messageId}
                  data-severity={analysis.get(message.messageId)?.severity}
                >
                  <div>
                    <strong>{message.userDisplayName}</strong>
                    <span>
                      {analysis
                        .get(message.messageId)
                        ?.reasonCodes.join(' / ')
                        .replaceAll('_', ' ')}
                    </span>
                    <p>{message.text}</p>
                  </div>
                  <div>
                    <Button
                      size="compact"
                      variant="ghost"
                      onClick={() => propose(message, 'delete_message')}
                    >
                      Delete
                    </Button>
                    <Button
                      size="compact"
                      variant="secondary"
                      onClick={() => propose(message, 'timeout_user')}
                    >
                      Timeout
                    </Button>
                    <Button
                      size="compact"
                      variant="danger"
                      onClick={() => propose(message, 'ban_user')}
                    >
                      Ban
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {moderation ? (
            <div
              className="moderation-confirm"
              role="alertdialog"
              aria-labelledby="moderation-confirm-title"
            >
              <div>
                <strong id="moderation-confirm-title">
                  Confirm {moderation.action.replaceAll('_', ' ')}
                </strong>
                <span>Target locked to @{moderation.targetLogin} with immutable evidence.</span>
              </div>
              <div>
                <Button variant="ghost" onClick={() => setModeration(undefined)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={pending === 'moderation'}
                  onClick={() => void confirmModeration()}
                >
                  Confirm action
                </Button>
              </div>
            </div>
          ) : null}
        </section>
        {notice ? (
          <p className="session-global-notice" role="status" aria-live="polite">
            {notice}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Section({
  number,
  title,
  children,
}: {
  readonly number: string;
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="session-section">
      <div>
        <span>{number}</span>
        <strong>{title}</strong>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  readonly label: string;
  readonly help?: string;
  readonly children: ReactNode;
}) {
  return (
    <label>
      {label}
      {children}
      {help ? <small>{help}</small> : null}
    </label>
  );
}

function SceneSelect({
  value,
  scenes,
  onChange,
}: {
  readonly value: string;
  readonly scenes: readonly { name: string }[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <select required value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select OBS scene</option>
      {scenes.map((scene) => (
        <option key={scene.name}>{scene.name}</option>
      ))}
    </select>
  );
}
