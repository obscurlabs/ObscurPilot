# Stage 2: Secure Desktop Shell and IPC Spine

Status: complete as of 2026-07-16.

- [Acceptance record](acceptance-record.md)

## Implemented boundary

- Electron single-instance ownership and deterministic lifecycle disposal
- Packaged app protocol with traversal and method rejection
- Denied navigation, popups, webviews, renderer permissions, and production DevTools
- Strict production CSP and security response headers
- Versioned request, result, event, error, bootstrap, and state contracts
- Central sender, timestamp, size, payload, result, and public-error validation
- Frozen capability-only preload with exact listener unsubscription
- Authoritative monotonic main-process snapshot and renderer gap resynchronization
- shadcn-pattern Card and Badge primitives for the diagnostic control surface

No provider SDK connection or audio work is included in this stage.
