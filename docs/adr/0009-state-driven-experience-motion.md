# ADR-0009: State-Driven Experience and Motion

Status: Accepted

Date: 2026-07-16

## Context

Voice, model, tool, provider, and spoken-feedback activity needs an expressive interface without turning decoration into false operational state or letting high-frequency data overload React.

## Decision

Electron main owns interaction truth and sends bounded typed projections. React derives labels and accessible status from those projections. Audio energy is throttled and applied through a CSS custom property/ref. Motion uses transform and opacity, is limited to two concurrent elements, and is disabled under reduced motion. No visual state can authorize or imply completion of an operation.

## Consequences

The voice presence can become more expressive as Stages 8–10 add states without changing the security boundary. Provider flicker remains explicit, accessibility does not depend on color or motion, and renderer performance is isolated from raw audio frequency.
