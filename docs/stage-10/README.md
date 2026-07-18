# Stage 10: Production Control Board

Status: **complete**

- [Acceptance record](acceptance-record.md)
- [Historical 15% progress record](progress-record.md)
- [Control-board design contract](../design-system/obscurpilot/pages/control-board.md)

## Delivered architecture

Stage 10 provides the production renderer for the typed Electron preload boundary:

- semantic dark tokens and shadcn-style Card, Badge, Button, Switch, and Skeleton primitives;
- adaptive workspace rail, health ribbon, authoritative restoration notice, and responsive control hierarchy;
- shared agent presence for microphone, transcription, reasoning, tool execution, confirmation, completion, and error states;
- confirmation expiry, protected-tool detail, keyboard approval/denial, and failure recovery messaging;
- bounded 10,000-event activity projection with animation-frame batching, deduplication, deferred filtering, fixed-row virtualization, and 100-event page navigation;
- versioned renderer-only settings for speech, motion, activity density, and connection announcements;
- native `speechSynthesis` queue, cancellation, voice selection, volume control, and visual fallback;
- complete public-error recovery catalog and provider-specific actions routed through typed preload APIs;
- document-visibility handling that pauses nonessential animation-frame work while hidden;
- reduced-motion, increased-contrast, enlarged-text, keyboard, screen-reader, and narrow-viewport support.

## Authority boundary

The renderer stores presentation preferences only. OBS, Twitch, Groq, Supabase, voice-command, confirmation, and connection mutations remain authoritative in Electron main-process services. Reload restoration uses typed provider projections and `AppSnapshot`; the UI never fabricates provider success.

## Stage boundary

Stage 10 does not implement the live-session, chat-analysis, or moderation capabilities assigned to Stage 11. It supplies the production interaction surface those capabilities will use.
