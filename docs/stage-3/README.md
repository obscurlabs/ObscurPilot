# Stage 3: Domain Kernel and Connection Supervisor

Status: complete as of 2026-07-16.

- [Acceptance record](acceptance-record.md)

## Implemented kernel

- Connection finite-state machine and single-flight supervisor
- Full-jitter backoff, abortable timers, and circuit breaker
- Typed event bus and monotonic snapshot store/consumer
- TTL and capacity-bounded command idempotency ledger
- Grant, scope, risk, and confirmation policy
- Versioned compiled tool registry and bounded loop controller
- Bounded activity normalization and durable-outbox interface

The kernel has no Electron or provider SDK dependency. Provider adapters consume it in their owning later stages.
