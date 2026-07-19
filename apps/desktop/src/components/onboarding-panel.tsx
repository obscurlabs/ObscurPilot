import type { OnboardingProjection } from '@obscurpilot/contracts/onboarding';
import { useState } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';

interface OnboardingPanelProperties {
  readonly projection: OnboardingProjection;
  readonly twitchPending: boolean;
  readonly onOpenAccount: () => void;
  readonly onConnectTwitch: () => Promise<void>;
  readonly onProjection: (projection: OnboardingProjection) => void;
  readonly onDismiss: () => void;
  readonly onObsProjectionChanged: () => void;
}

const STEP_COPY = {
  account: {
    number: '01',
    title: 'Creator account',
    description: 'Sign in securely. Provider authorization is bound to this identity.',
  },
  twitch: {
    number: '02',
    title: 'Connect Twitch',
    description: 'Approve Twitch in the browser. Tokens never enter the control board.',
  },
  obs: {
    number: '03',
    title: 'Pair local OBS',
    description: 'ObscurPilot detects OBS on port 4455 and encrypts its password locally.',
  },
} as const;

export function OnboardingPanel({
  projection,
  twitchPending,
  onOpenAccount,
  onConnectTwitch,
  onProjection,
  onDismiss,
  onObsProjectionChanged,
}: OnboardingPanelProperties) {
  const [password, setPassword] = useState('');
  const [pairing, setPairing] = useState(false);
  const [notice, setNotice] = useState<string>();
  const pairObs = async () => {
    setPairing(true);
    setNotice(undefined);
    try {
      const next = await window.obscurPilot.pairObs(password === '' ? {} : { password });
      onProjection(next);
      setPassword('');
      setNotice('OBS verified and paired. The password is protected by the operating system.');
      onObsProjectionChanged();
    } catch (error: unknown) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'OBS pairing failed. Confirm OBS is open and the WebSocket password is correct.',
      );
    } finally {
      setPairing(false);
    }
  };
  const clearPairing = async () => {
    setPairing(true);
    setNotice(undefined);
    try {
      const next = await window.obscurPilot.clearObsPairing();
      onProjection(next);
      setPassword('');
      setNotice('The stored OBS password was removed from this device.');
      onObsProjectionChanged();
    } catch {
      setNotice('The local OBS pairing could not be cleared. Try again.');
    } finally {
      setPairing(false);
    }
  };
  return (
    <Card className="onboarding-card" id="setup" aria-labelledby="setup-title">
      <CardHeader className="onboarding-header">
        <div>
          <p className="eyebrow">Stage 12 · First-run pairing</p>
          <h2 className="panel-title" id="setup-title">
            Connect your production workspace
          </h2>
          <p className="panel-copy">
            No environment files or provider tokens. Complete these one-time connections and
            ObscurPilot will restore them securely.
          </p>
        </div>
        <div className="onboarding-heading-actions">
          <Badge tone={projection.complete ? 'ready' : 'waiting'}>
            {projection.complete ? 'Ready to produce' : 'Setup required'}
          </Badge>
          <Button size="compact" variant="ghost" onClick={onDismiss}>
            Explore control board
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="onboarding-steps" aria-label="Production setup progress">
          {(['account', 'twitch', 'obs'] as const).map((step) => {
            const state = projection[step];
            const copy = STEP_COPY[step];
            return (
              <li data-status={state.status} key={step}>
                <div className="onboarding-step-heading">
                  <span aria-hidden="true">{copy.number}</span>
                  <div>
                    <strong>{copy.title}</strong>
                    <small>{state.status.replace('_', ' ')}</small>
                  </div>
                  <span className="onboarding-step-indicator" aria-hidden="true" />
                </div>
                <p>{copy.description}</p>
                {step === 'account' && !state.ready ? (
                  <Button
                    variant="secondary"
                    disabled={state.status === 'blocked'}
                    onClick={onOpenAccount}
                  >
                    Sign in or create account
                  </Button>
                ) : null}
                {step === 'twitch' && !state.ready ? (
                  <Button
                    variant="secondary"
                    disabled={state.status !== 'current' || twitchPending}
                    onClick={() => void onConnectTwitch()}
                  >
                    {twitchPending ? 'Opening Twitch…' : 'Connect with Twitch'}
                  </Button>
                ) : null}
                {step === 'obs' ? (
                  <form
                    className="obs-pairing-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void pairObs();
                    }}
                  >
                    <label htmlFor="obs-pairing-password">OBS WebSocket password</label>
                    <input
                      id="obs-pairing-password"
                      name="obs-password"
                      type="password"
                      autoComplete="off"
                      maxLength={256}
                      value={password}
                      disabled={pairing || state.status === 'waiting'}
                      aria-describedby="obs-pairing-help"
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <span id="obs-pairing-help">
                      Leave empty only when OBS WebSocket authentication is disabled. Endpoint:{' '}
                      {projection.obs.endpoint}
                    </span>
                    <div className="obs-pairing-actions">
                      <Button
                        variant="primary"
                        type="submit"
                        disabled={
                          pairing ||
                          state.status === 'waiting' ||
                          (password !== '' && !projection.obs.secureStorageAvailable)
                        }
                      >
                        {pairing
                          ? 'Testing OBS…'
                          : state.ready
                            ? 'Re-pair OBS'
                            : 'Test and pair OBS'}
                      </Button>
                      {projection.obs.passwordStored ? (
                        <Button
                          variant="ghost"
                          disabled={pairing}
                          onClick={() => void clearPairing()}
                        >
                          Forget password
                        </Button>
                      ) : null}
                    </div>
                  </form>
                ) : null}
                {state.ready ? <span className="onboarding-complete-copy">Verified</span> : null}
                {state.status === 'blocked' ? (
                  <span className="onboarding-blocked" role="alert">
                    {state.reasonCode.replaceAll('_', ' ')}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        {notice === undefined ? null : (
          <p className="onboarding-notice" role="status" aria-live="polite">
            {notice}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
