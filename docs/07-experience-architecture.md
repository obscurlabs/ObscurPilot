# Experience and Motion Architecture

## Purpose

ObscurPilot uses one shared, typed interaction-state vocabulary from Electron main through React. Visual effects never invent operational truth: they render redacted projections of capture, transcription, reasoning, tool, provider, and speech states.

## Presence state model

| State        | Authoritative owner          | Visual semantics                            | Motion budget               |
| ------------ | ---------------------------- | ------------------------------------------- | --------------------------- |
| idle         | main interaction coordinator | quiet core, explicit ready label            | one 5 s ambient breath      |
| listening    | audio pipeline               | energy-responsive core and outward ring     | audio projected at <= 30 Hz |
| transcribing | Groq STT adapter             | contained rotating inner ring               | compositor-only transform   |
| reasoning    | orchestrator                 | slow orbital phase with model label         | one active loop             |
| tool-active  | tool gateway                 | directed pulse plus named operation         | 160–240 ms state transition |
| speaking     | Web Speech boundary          | speech envelope and response label          | boundary events             |
| confirmation | policy gateway               | stable interrupted ring and explicit action | no ambient distraction      |
| degraded     | connection supervisor        | desaturated core and recovery text          | no looping alert motion     |
| error        | owning service               | static error treatment and recovery action  | aria-live announcement      |

The runtime contract carries state, reason code, correlation identity, and bounded numeric energy. Raw audio, secrets, provider payloads, and unrestricted tool arguments never enter the visual contract.

## Rendering rules

- Only transform and opacity may change per frame. Layout, blur radius, width, and height are not animated.
- Audio energy updates a CSS custom property through a DOM ref. It does not rerender the application tree.
- At most two elements animate concurrently. Micro-interactions use 150–300 ms ease-out transitions; complex state changes stay below 400 ms.
- The reduced-motion media preference disables loops and energy scaling while retaining state text, badges, and focus indication.
- Every color state also has a text label. Normal text targets WCAG 2.2 AA contrast and every interactive control has a visible keyboard focus ring.
- Hidden/background windows stop nonessential animation. Event streams are batched; long timelines will be virtualized in Stage 10.

## Stage integration

- Stage 4 owns idle, arming, listening, encoding, ready, rejected, and microphone error projections.
- Stage 5 supplies normalized OBS health and authoritative mirror data without granting the renderer JSON-RPC authority.
- Stage 8 maps STT dispatch and completion to transcribing.
- Stage 9 maps bounded model and tool-loop phases to reasoning, tool-active, and confirmation.
- Stage 10 composes the production control board, activity virtualization, settings, recovery actions, and speechSynthesis speaking feedback.
- Stage 11 adds explicit feedback controls; learning never changes visual or tool policy without a versioned, evaluated release.

## Design system direction

The desktop surface uses near-black neutral layers, trust-oriented teal for live voice state, blue for synchronized runtime state, and violet only as a restrained intelligence accent. Typography is Inter/system-sans with tabular figures for timers and counters. The 4/8 px spacing rhythm, semantic tokens, consistent radii, and low-noise borders are mandatory across future panels.
