# Stage 13 Eight-Hour Reference Soak

## Preconditions

1. Use a dedicated test Twitch account/channel and non-sensitive OBS profile.
2. Start OBS WebSocket on loopback port 4455 and confirm ObscurPilot shows OBS, Twitch, and Supabase ready.
3. Close games and utilities that could independently exhaust memory or terminate audio devices.
4. Run `npm run verify:stage13`, `npm run audit:stage13`, and `npm run package:dir` successfully.
5. Record Windows version, OBS version, microphone, network type, app commit, start time, and initial provider state.

## Automated duration gate

Run:

```powershell
npm run test:soak
```

The runner holds the production renderer for 480 minutes, requests an authoritative snapshot every 15 seconds, watches renderer crashes, main-process RSS and heap, active Node resources, and BrowserWindow count, then enforces:

- zero renderer crashes;
- zero snapshot failures;
- no more than three Electron windows;
- tail RSS growth below 256 MiB after warm-up;
- tail heap growth below 128 MiB after warm-up;
- active-resource growth no greater than 64.

## Creator-observed outage schedule

During the same dedicated eight-hour window, record these observations without changing application source or credentials:

1. Hour 1: restart OBS once; verify a fresh handshake and snapshot precede any new action.
2. Hour 2: remove remote network connectivity for 60 seconds; verify local controls remain available and remote providers recover through synchronization.
3. Hour 3: disconnect and reconnect the selected microphone; verify capture stops safely and resumes only after a valid device selection.
4. Hour 4: allow one Groq request to receive a rate-limit or controlled unavailable response; verify bounded retry/circuit behavior and no repeated side effect.
5. Hour 5: reconnect Twitch/EventSub; verify subscription reconciliation and no duplicated event-driven action.
6. Hour 6: leave Supabase unavailable for one synchronization interval; verify the bounded outbox retains and later delivers each mutation once.
7. Hours 7–8: steady-state voice, OBS, and Twitch operation with at least one start/readback/stop test on the dedicated channel.

Do not inject credential revocation into the same run; that is a separate Stage 14 revoked-credential drill.

## Acceptance record

The witness records start/end timestamps, all outage timestamps, recovery attempts, unexpected UI states, memory/resource result, provider receipts, and duplicate count. Acceptance requires zero crashes, zero duplicate provider side effects, no secret canary in logs, all automated budgets passing, and every injected outage reconciled to authoritative state.
