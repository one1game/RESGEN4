# CoreBox — Mechanics and Commercial Value

## Product pitch

CoreBox is a cyberpunk command simulator where the player manages a living outpost through short decisions and long offline consequences. The differentiator is the combination of deterministic Rust/WASM simulation, local-first persistence and a strategic map with risk rather than an infinite multiplier-only loop.

## Player loop

1. Return to the outpost and read the Operations Brief.
2. Review production, power, threat, fleet and sector heat.
3. Choose one operation or defensive posture.
4. Leave the outpost running through an offline window.
5. Return to a Welcome-back timeline with rewards, incidents and consequences.
6. Spend resources on mastery, infrastructure, sector influence or a new cycle.

## Feature inventory

| System | Current capability |
|---|---|
| Simulation | Rust/WASM state transitions, day/night loop, power, heat and resource bounds. |
| Persistence | Local SQLite HTTP server plus browser-local operations state. |
| Operations | Expedition, Recon, Guard and Void contracts with risk/reward. |
| Retention | Goals, season XP, mastery, Codex, sector control and alternate cycle. |
| World | Spiral map, sector hotspots, active flight lines, NPC convoy and local PvP. |
| Fleet | Defense Stance, Fleetsave, Support Order and mission timing. |
| Testing | JavaScript checks, static audit, Rust tests, WASM build, local DB/PvP checks, map load and 1000-hour retention harness. |

## Honest limitations

There is no proven revenue, public retention cohort, established community, or production-scale hosted service included in this package. The buyer should perform a clean-machine build and a full local/cloud adapter audit. The current repository has no seller credentials or local database in the clean transfer package.

## Commercial positioning

This is more valuable than a generic HTML5 template because it contains a connected game concept and non-trivial simulation/backend work. It is less valuable than a shipped game business because it has no verified revenue, audience or live operations history. The correct sale category is `working prototype / early-stage game IP / source-code transfer`.
