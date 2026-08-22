# CoreBox Launch Brief

## Product position

CoreBox is a browser/desktop-first cyberpunk incremental command simulator. The player operates an autonomous outpost, balances resources and computation, survives night threats and rebel attacks, develops ship blueprints, sends a fleet across a living space map, and returns to readable offline reports with meaningful next decisions.

## Market wedge

The opportunity is the intersection of incremental/idle players who enjoy planning and long-term progression with players attracted to cyberpunk management, survival pressure, fleet logistics, and world-state simulation. CoreBox should not compete with Cookie Clicker on raw scale or with a full 4X game on breadth. It should own the short-session “command a living outpost” niche: a player can check the state in minutes, make one consequential decision, leave, and return to consequences.

## Audience

The primary audience is PC/browser players who enjoy incremental games, automation, resource optimization, science-fiction management, and persistent progression without requiring a long uninterrupted session. The secondary audience is players who like cyberpunk atmosphere and strategy but do not want a large real-time commitment.

## Differentiators to emphasize

1. Rust/WASM simulation gives deterministic, testable long-running state.
2. Local-first SQLite persistence reduces dependency and provides a clear ownership story.
3. Day/night cycle and rebel pressure make the world react instead of only accumulating numbers.
4. Fleet blueprints, planets, PvP, achievements, and endgame quests create several interacting paths.
5. Offline return is a decision report: income, losses, threats, and a recommended next action.

## Launch-critical experience

The first session must move from mining to a first upgrade, a readable night event, the first quest reward, and a blueprint reveal without requiring documentation. Every major screen must expose one clear next action. Offline return must be capped, predictable enough to feel fair, and summarized. Automation should remove repetitive clicks while preserving strategic choices about defense, modules, fleet, map, and resource allocation.

## Non-goals for this phase

Monetization, ads, paid boosts, and aggressive notifications are intentionally excluded. Prestige should not be added merely to create another reset; it must introduce a distinct strategic layer before it is shipped.

## Ready-to-launch criteria

- Local runtime boots and serves index, WASM, config, and health endpoints.
- SQLite save/load, emergency restore, fleet, blueprints, and account isolation have automated checks.
- Balance audit reports no progression warnings.
- Quest contract checks Rust/frontend/config alignment.
- Headless simulation covers at least 168 hours without corruption.
- New player flow has onboarding, clear first milestone, and visible feedback.
- Browser visual playtest passes the complete first-session and return-session scenario.
