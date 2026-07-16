# ObscurPilot Control Board Override

This page override replaces the generated light palette with the established dark desktop trust palette. The master layout, spacing, typography, accessibility, and motion rules still apply.

## Surface and semantic tokens

| Role           | Value     | Use                                      |
| -------------- | --------- | ---------------------------------------- |
| Canvas         | `#06080D` | Application background                   |
| Sidebar        | `#080C12` | Persistent workspace navigation          |
| Surface        | `#0C1118` | Primary panels                           |
| Raised surface | `#111821` | Interactive and confirmation surfaces    |
| Primary text   | `#F2F5F9` | Headings and authoritative values        |
| Secondary text | `#A4B0BF` | Body and labels                          |
| Muted text     | `#7F8C9C` | Metadata only                            |
| Ready          | `#5EEAD4` | Voice readiness and verified local state |
| Synchronized   | `#60A5FA` | Provider synchronization                 |
| Intelligence   | `#A78BFA` | Groq and reasoning state only            |
| Warning        | `#FBBF24` | Confirmation and degraded attention      |
| Danger         | `#F87171` | Error and destructive action only        |

## Layout contract

- Desktop uses a 216 px workspace rail and a fluid content canvas.
- Voice command and authoritative OBS truth remain the first content row.
- Provider health appears in a compact ribbon without duplicating full diagnostics.
- Navigation uses semantic anchors and preserves keyboard focus.
- At 900 px, operational panels collapse to one column. Below 720 px, the rail becomes a top navigation region.

## Motion contract

- Ambient motion remains limited to the agent presence.
- Status and navigation transitions use 160–240 ms ease-out.
- No staggered entrance animation is used for live operational data.
- Reduced-motion disables all loops and smooth scrolling.

## Stage 10 completion boundary

The completed control board includes tokens, hierarchy, navigation, readiness and restoration, virtualized activity, settings, recovery, native speech feedback, full confirmation states, accessibility automation, responsive behavior, and final production polish. Live-session, chat, and moderation surfaces remain Stage 11 scope.
