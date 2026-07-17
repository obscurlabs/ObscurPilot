# Stage 11.1 Acceptance Record

Status: **automated gates accepted; creator-observed live run pending**

Prepared on: 2026-07-17

## Implemented boundary

- The hidden audio renderer performs local VAD with 300 ms pre-roll, configurable threshold, 850 ms silence release, and a 30-second utterance cap.
- 'Hi Obscur', 'Hey Obscur', and common STT spelling variants open a five-minute follow-up window. Background utterances outside that window are discarded after wake detection.
- Groq receives detected utterances only. Audio clips remain memory-only and are zeroed after transcription.
- Native TTS speaks through the protected corner overlay. Capture is edge-suppressed while TTS is active and resumes after the renderer reports completion.
- A creator-initiated tap or push-to-talk gesture authorizes the exact actions requested in that utterance; no second spoken approval is required.
- live_session.auto_prepare resolves the Twitch category, creates isolated Starting Soon and Live scenes, creates countdown text and fullscreen game capture, saves a versioned profile, and prepares the immutable plan.
- live_session.start_prepared executes in the same bounded tool loop when the tapped command explicitly requests go-live. The default path selects the live scene and starts immediately; a deterministic countdown runs only when explicitly requested.
- Hosted migration 202607170002_stage111_hands_free.sql grants automatic preparation to existing and future default control profiles.

## Automated evidence

| Gate                            | Result     |
| ------------------------------- | ---------- |
| TypeScript, ESLint, Prettier    | Pass       |
| Unit tests                      | 96/96 pass |
| Wake phrase/window tests        | Pass       |
| Spoken confirmation test        | Pass       |
| Production build                | Pass       |
| Production renderer/preload E2E | Pass       |
| Hidden audio shutdown E2E       | Pass       |
| Hosted Supabase migration       | Pass       |

## Creator-observed acceptance

1. Start ObscurPilot and keep the main control board minimized or behind the game.
2. Confirm the protected corner Pilot says 'Say Hi Obscur'.
3. Tap to talk and say: 'We are streaming Sekiro today. Set up Twitch and OBS and start the stream.'
4. Verify Pilot resolves the Sekiro category and creates 'ObscurPilot - Starting Soon', 'ObscurPilot - Live', 'ObscurPilot Countdown', and 'ObscurPilot Game Capture'.
5. Verify the same command loop starts the requested production action without asking for a second approval.
6. Verify the live scene is selected before OBS starts and no countdown delay occurs.
7. Tap to talk, say 'stop the stream', and verify OBS and Twitch return offline without a second approval.

Do not declare the real-device gate accepted until all seven observations pass on the dedicated Twitch account.
