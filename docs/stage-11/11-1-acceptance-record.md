# Stage 11.1 Acceptance Record

Status: **automated gates accepted; creator-observed live run pending**

Prepared on: 2026-07-17

## Implemented boundary

- The hidden audio renderer performs local VAD with 300 ms pre-roll, configurable threshold, 850 ms silence release, and a 30-second utterance cap.
- 'Hi Obscur', 'Hey Obscur', and common STT spelling variants open a five-minute follow-up window. Background utterances outside that window are discarded after wake detection.
- Groq receives detected utterances only. Audio clips remain memory-only and are zeroed after transcription.
- Native TTS speaks through the protected corner overlay. Capture is edge-suppressed while TTS is active and resumes after the renderer reports completion.
- A creator push-to-talk gesture authorizes the exact requested tool actions in that utterance; no second spoken approval is required.
- live_session.auto_prepare uses Groq model knowledge to compose a title, tags, language, and optional kickoff chat message. Twitch resolves the authoritative category, then the app provisions isolated OBS resources and saves the immutable plan.
- A requested live start continues through live_session.start_prepared in the same tool loop. The default path selects the live scene with no delay; a deterministic countdown runs only when explicitly requested.
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
3. Push to talk and say: 'We are streaming Sekiro today. Create the best Twitch title and tags, set up OBS, and start the stream.'
4. Verify Pilot resolves the Sekiro category and creates 'ObscurPilot - Starting Soon', 'ObscurPilot - Live', 'ObscurPilot Countdown', and 'ObscurPilot Game Capture'.
5. Verify the command runs without a second approval; the live scene is selected, Twitch metadata is applied, and the kickoff chat message is sent after authoritative live verification.
6. Verify OBS and Twitch start with no countdown delay unless one was requested.
7. Push to talk, say 'stop the stream', and verify OBS and Twitch are offline.

Do not declare the real-device gate accepted until all seven observations pass on the dedicated Twitch account.
