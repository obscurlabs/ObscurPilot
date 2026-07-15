# ADR-0001: Electron Process Isolation

- **Status:** Accepted
- **Date:** 2026-07-15
- **Owners:** Core Desktop Engineer; Cloud and Security Engineer

## Context

ObscurPilot needs privileged access to global shortcuts, local audio, OS credential storage, local OBS, and remote SDKs. React renders provider-originated text and must therefore be treated as a potentially compromised presentation process.

## Decision

The Electron main process is the sole privileged composition root. It owns native operations, SDK clients, credentials, policies, and side effects. Preload exposes a frozen, capability-specific window.obscurPilot surface through contextBridge. Renderer windows use context isolation, disabled Node integration, sandboxing, web security, and a restrictive CSP. Production content is packaged and served through an application protocol; remote code is never executed in a privileged renderer.

Raw ipcRenderer, generic send/invoke, arbitrary channels, filesystem access, process environment, SDK clients, and shell access are prohibited in the renderer. Main validates the sending frame, exact channel, runtime payload schema, size, authorization, and lifecycle generation before work begins. Navigation, new windows, permissions, untrusted external URLs, webviews, and unsandboxed auxiliary renderers are denied unless a later ADR provides a bounded exception.

This follows Electron's official security guidance: <https://www.electronjs.org/docs/latest/tutorial/security>.

## Consequences

- More explicit contracts and projections are required.
- Renderer compromise has no direct Node or secret access.
- SDK and native work cannot accidentally enter React's rendering path.
- OAuth browser handoff requires an allowlisted URL and validated callback.

## Verification

Stage 2 must prove renderer globals lack Node/Electron primitives, arbitrary IPC is impossible, sender spoofing is rejected, CSP contains no undocumented unsafe-inline/unsafe-eval, navigation and permission tests fail closed, and renderer reloads do not leak subscriptions.
