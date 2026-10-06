# Hyperframes Composition Brief: ObscurPilot

## Objective
Create a short launch-style brag video for ObscurPilot, starring its LED-faced mascot Pilot.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape, 1920x1080, 30 fps
- Duration: 23.2 seconds

## Source Material
- Project root: `D:\Workspace\Active\ObscurPilot`
- Primary files read: `README.md`, `apps/desktop/src/styles.css`, `apps/desktop/src/app/App.tsx`, `apps/desktop/src/pages/logs.tsx`, `apps/desktop/src/agent/agent-engine.ts`, `apps/desktop/src/agent/agent-mood.ts`
- Product name: ObscurPilot (sidebar subtitle: "STREAM COPILOT")
- Tagline / strongest claim: hold Alt + X and talk; "works everywhere: in game, in OBS, minimized" (home screen copy)
- Key UI moments: Pilot's LED face (rendered from the app's own engine), the real Connections screen (OBS Studio card, green "ready" badge), the real Logs page (OBS handshake lines)
- Copy that must appear verbatim: "ObscurPilot"; "Alt" and "X" keycaps
- Pilot clips (`assets/video/pilot-*.mp4`) are frame-stepped renders of `agent-engine.ts` over the canvas color #0b0d12; blend with `lighten` so the frame edge disappears.

## Creative Direction
- Tone preset: polished
- Creative direction: dark broadcast-studio product film starring an LED mascot
- Interpretation: calm, short copy and soft slides; the character carries the energy
- Angle: Pilot is a character reel; every app state is an emotion, proven by real app screens
- Hook: offline Pilot reconnects on the first strong beat (1.60s); "Your stream just got a copilot."
- Outro / punchline: Pilot is grabbed and dropped into the corner; lockup "ObscurPilot" / "Hold Alt + X. Talk to your stream." / "Built entirely by voice with Wispr Flow"
- Avoid: generic SaaS language, abstract filler visuals, redesigning the app UI

## Visual Identity
- Background: #0b0d12; panels #12151d / #181c26
- Text: #eef1f7; secondary #9aa3b4
- Accent: #8b7cff; ready #3bd98b; teal #2dd4bf; amber #ffb547; sky #38bdf8; pink #f472b6
- Display and body font: Inter (local woff2; the app's Segoe UI stack falls back to Inter)
- Mono: JetBrains Mono (keycaps)

## Storyboard
Creative contract: `brag-output/brag-plan.md`.
1. Wake up — 3.7s — offline Pilot reconnects; hook line
2. Say it — 5.26s — Alt + X press, Pilot listens, command types out, "Voice by Wispr Flow"
3. Feels everything — 3.69s — Thinking, Working, Asks first, Done chips accumulate as Pilot changes mood
4. Real app — 5.26s — Connections screen with OBS "ready", then the Logs page
5. Drop it in the corner — 5.29s — grab, carry, land; lockup

## Audio
- Role: warm bed with sparse, motion-matched accents
- Music: `assets/music/happy-beats-business-moves-vol-11-by-ende-dot-app.mp3`, volume 0.5, fade in 0-0.4s, fade out 21.9-23.2s
- Cue locks: 1.60s reconnect, 12.65s UI slide-in, 17.91s grab; lockup on beat 18.96s
- Audio-reactive: subtle; music RMS drives the floor glow under Pilot and the lockup title glow
- SFX: soft impact on reconnect and landing, key clicks on Alt + X, quiet key ticks per typed word, light click per mood chip, glass clink on Done, card slide on each screen, one bell on the lockup
