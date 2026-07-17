# Stage 11.1 Acceptance Record

Status: **automated gates accepted; creator-observed live run pending**

Prepared on: 2026-07-17

## Implemented boundary

- The hidden audio renderer performs local VAD with 300 ms pre-roll, configurable threshold, 850 ms silence release, and a 30-second utterance cap.
- 'Hi Obscur', 'Hey Obscur', and common STT spelling variants open a five-minute follow-up window. Background utterances outside that window are discarded after wake detection.
- Groq receives detected utterances only. Audio clips remain memory-only and are zeroed after transcription.
- Native TTS speaks through the protected corner overlay. Capture is edge-suppressed while TTS is active and resumes after the renderer reports completion.
- Spoken 'yes' or 'no' settles the application-owned confirmation promise without cancelling or bypassing the protected tool.
- live_session.auto_prepare resolves the Twitch category, creates isolated Starting Soon and Live scenes, creates countdown text and fullscreen game capture, saves a versioned profile, and prepares the immutable plan.
- Output start remains protected by live_session.start_prepared. The five-minute countdown and final scene switch remain inside the deterministic coordinator.
- Hosted migration 202607170002_stage111_hands_free.sql grants automatic preparation to existing and future default control profiles.

## Automated evidence

| Gate                            | Result     |
| ------------------------------- | ---------- |
| TypeScript, ESLint, Prettier    | Pass       |
| Unit tests                      | 92/92 pass |
| Wake phrase/window tests        | Pass       |
| Spoken confirmation test        | Pass       |
| Production build                | Pass       |
| Production renderer/preload E2E | Pass       |
| Hidden audio shutdown E2E       | Pass       |
| Hosted Supabase migration       | Pass       |

## Creator-observed acceptance

1. Start ObscurPilot and keep the main control board minimized or behind the game.
2. Confirm the protected corner Pilot says 'Say Hi Obscur'.
3. Say: 'Hi Obscur, we are streaming Sekiro today. Set up Twitch and OBS, show Starting Soon for five minutes, and then start the stream.'
4. Verify Pilot resolves the Sekiro category and creates 'ObscurPilot - Starting Soon', 'ObscurPilot - Live', 'ObscurPilot Countdown', and 'ObscurPilot Game Capture'.
5. When Pilot asks for approval, say 'yes'.
6. Verify OBS and Twitch start, the countdown updates from five minutes, and the program scene switches at zero.
7. Say 'stop the stream', then approve the protected stop and verify OBS and Twitch are offline.

Do not declare the real-device gate accepted until all seven observations pass on the dedicated Twitch account.
