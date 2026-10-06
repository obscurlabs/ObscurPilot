# Brag Plan: ObscurPilot

## What is this app?
ObscurPilot is a voice-controlled stream copilot for OBS and Twitch: hold Alt + X, say what you want, and an LED-faced desktop sidekick called Pilot listens (Wispr Flow transcribes), thinks, asks before risky actions, and drives OBS.

## The angle
The star is Pilot, the living corner mascot. Every state of the app is an emotion on its LED visor, so the video is a character reel: Pilot wakes up, hears you, works, asks, celebrates, and then gets picked up and dropped into the corner of your screen. Real app screens prove it is a working product, not a concept.

## Hook (first 2-3 seconds)
Darkness. Pilot hangs dim and offline, a crossed-out signal mark by its antenna. On the first strong beat it reconnects: hops up, sparkles burst, LED eyes snap open. Line: "Your stream just got a copilot."

## Key moments (the middle)
- Alt + X keycaps press down; Pilot leans in to listen, the visor turns into a live voice meter while the command types out: "Pilot, switch to the gaming scene". Tag: "Voice by Wispr Flow".
- Mood run, one per beat pair: Thinking (eyes up, orbiting dots), Working (sparks), Asks first (raised brow, amber ring), Done (confetti).
- The real Connections screen: OBS Studio card with the green "ready" badge, then the real Logs page showing the OBS handshake lines.

## Outro / punchline
Pilot is grabbed (startled "o" face, arms up), carried, and dropped into the corner where it lands with a bounce. Lockup: "ObscurPilot" / "Hold Alt + X. Talk to your stream."

## User flow worth showing
Hold Alt + X and speak → Pilot listens and transcribes → it thinks, works, and asks for approval → OBS is connected and every step lands in the Logs page.

## Tone
- Preset: polished
- Creative direction: dark broadcast-studio product film starring an LED mascot
- Interpretation: restrained type and soft slides around a character who does all the emoting; motion energy lives in Pilot, the copy stays calm and short.

## Format: landscape — 1920x1080
## Duration: 23.2s

## Visual identity (from the project)
- Background: #0b0d12 (canvas), panels #12151d, raised #181c26
- Accent: #8b7cff (pilot violet); ready #3bd98b; sync #6fa8ff; warning #f5b84c; danger #ff4d5e
- Text: #eef1f7, secondary #9aa3b4
- Display font: Segoe UI Variable Display (fallback Segoe UI, Inter)
- Body font: Segoe UI Variable Text; mono Cascadia Code / Consolas for logs and keycaps
- Strongest visual element: Pilot, the glass robot with a 24x13 LED-matrix face and tally-light antenna (rendered from the app's own engine)

## Share copy (draft)
I built ObscurPilot entirely by voice with Wispr Flow: a stream copilot whose LED-faced sidekick listens, thinks, asks before it acts, and connects OBS in one click.

## Audio direction
- Role: warm bed with sparse, motion-matched accents
- Music: happy-beats-business-moves-vol-11-by-ende-dot-app.mp3 (114.84 BPM)
- Music treatment: start at track 0.0s, fade in over 0.4s, sit under the visuals, fade out over the final 1.2s
- Music cue guidance: preset read (`cues/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.md`). Strong cues to lock: 1.60s (Pilot reconnects), 12.65s (cut to real UI), 17.91s (grab and lockup). Beat grid for the mood labels: 8.96, 9.50 / 10.01, 10.54 / 11.06, 11.60 (labels on every other beat so each holds about 0.9s).
- Audio-reactive treatment: subtle; music RMS lets the violet floor glow under Pilot and the lockup glow breathe. No waveforms or equalizers.
- SFX posture: sparse; keycap clicks, a soft key tick per typed word, one soft impact on the reconnect, a glass clink on Done, a card slide into the UI shot, a soft thud on the corner landing.
- Audio-coupled moments: reconnect hop, Alt + X press, typed command, mood labels, UI slide, corner landing.
- Restraint rule: no sound on every animation; nothing harsh or high-frequency on repeated cues.

## Storyboard

### Scene 1 — Wake up — 3.7s (0.0-3.7)
Pilot centered, dim and offline with the no-signal mark. At 1.6s it reconnects (hop, sparkles, eyes open, violet glow returns). "Your stream just got a copilot." fades up at 1.8s and holds.
Sequential/interaction: yes, offline to online transition of Pilot.
Audio intent: quiet anticipation, then a warm lift on the reconnect.
Audio-coupled idea: soft impact on the hop at 1.6s.
Music: bed fades in.
Transition mood: soft → Scene 2

### Scene 2 — Say it — 5.26s (3.7-8.96)
Pilot moves left and listens (teal glow, voice meter on its visor, sound arcs). Right side: keycaps "Alt" + "X" press at 3.9s; the command types out word by word 4.4-6.4s: "Pilot, switch to the gaming scene". "Voice by Wispr Flow" tag rises at 6.8s and holds.
Sequential/interaction: yes, simulated key press and typed command.
Audio intent: tactile, close.
Audio-coupled idea: key clicks on the press, soft key ticks per word.
Transition mood: clean → Scene 3

### Scene 3 — Feels everything — 3.69s (8.96-12.65)
Pilot center; its mood changes on the beat: Thinking, Working, Asks first, Done. One label chip per mood, each holding about 0.9s, colored to the mood (violet, blue, amber, pink).
Sequential/interaction: yes, four moods in sequence (labels on every other beat).
Audio intent: playful momentum.
Audio-coupled idea: light tick per label, glass clink with Done's confetti.
Transition mood: slide → Scene 4

### Scene 4 — Real app — 5.26s (12.65-17.91)
The real Connections screen slides in (lands on 12.65s) and pushes into the OBS Studio card with its green "ready" badge. Caption: "One click. OBS connected." At 15.3s the real Logs page slides over, drifting through the OBS lines ending on "OBS ready". Caption: "Every move, logged."
Sequential/interaction: two real screenshots with a camera push.
Audio intent: confident, clean.
Audio-coupled idea: card slide on each screen entrance.
Transition mood: dramatic soft → Scene 5

### Scene 5 — Drop it in the corner — 5.29s (17.91-23.2)
Pilot is grabbed (startled face, arms up), swings as it is carried to the bottom-right corner, lands with a squash bounce. On 17.91s the lockup lands: "ObscurPilot" and "Hold Alt + X. Talk to your stream." Hold, then fade out.
Sequential/interaction: yes, simulated drag and snap.
Audio intent: payoff, then settle.
Audio-coupled idea: soft thud on landing; music fades under the final hold.
Transition mood: end

**Music mood for this video:** upbeat, warm
**Audio summary:** a warm 115 BPM bed that lifts when Pilot wakes, carries tactile key and mood accents through the middle, and settles under the lockup.

## Notes on source material
- Pilot animation clips are rendered from the app's own engine (`apps/desktop/src/agent/agent-engine.ts`) frame by frame, not redrawn.
- The two UI screens are real captures of the running app (Connections, Logs). They contain no personal data; the spoken command and scene name are fictional.
