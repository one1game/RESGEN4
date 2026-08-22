# CoreBox — Market Positioning & Product Priorities

## Position

**CoreBox is a cyberpunk command idle game:** the player runs a living outpost, makes one or two consequential decisions in a short session, leaves the system to operate, and returns to a readable report about what changed. The game should win through **meaningful planning under pressure**, not through an endless pile of multipliers.

This position sits between the accessibility of browser incremental games and the strategic texture of space-management games. CoreBox should not attempt to beat Cookie Clicker on raw scale or Melvor Idle on the number of skills. It should own the smaller but sharper fantasy of commanding a volatile cyberpunk outpost with mining, power, night threats, blueprints, fleet logistics and a persistent map.

## Competitive read

| Competitor | What players get | CoreBox lesson | CoreBox advantage to build |
|---|---|---|---|
| Cookie Clicker | Extremely low-friction loop, visible numbers, achievements, seasons and ascension | The first click must immediately communicate reward and the next goal | Replace generic scale with an authored outpost story and consequences |
| Melvor Idle | 20+ interacting skills, offline progression, bank/inventory, many items, bosses, pets, long-form depth | Every system must feed another system and support relaxed return play | Fewer systems, but each one changes the risk/reward state of the base |
| Unnamed Space Idle | Many unfolding systems, ship customization, enemy-specific decisions, sectors, prestige and frequent unlocks | New systems must arrive regularly and choices must be understandable | Day/night, rebel pressure and a readable command report create a distinct identity |
| Community indie incrementals | Players reward playable builds, constructive feedback, transparent iteration and honest scope | Ship a tight playable loop and listen publicly; avoid feature sprawl | Local-first ownership, deterministic Rust/WASM simulation and a clear no-cloud story |

## Audience wedge

The primary audience is browser and PC players who like automation, resource optimization, science-fiction management and persistent progress but cannot commit to a long uninterrupted session. The secondary audience is cyberpunk and strategy players who want atmosphere and decisions without a full 4X workload.

## Product pillars

1. **Return with consequences.** Offline progress is not a silent number dump. It is an operations report: production, burn, attacks, losses and one explicit next action.
2. **Automation preserves decisions.** Automation removes repetitive clicks while the player still chooses defense, modules, blueprint path, fleet risk and map priorities.
3. **Every resource has a job.** Resources should unlock a visible decision, not merely increase a counter.
4. **Frequent authored reveals.** The first session should reach the first upgrade, a readable night event, a quest reward and a blueprint reveal quickly. Later sessions should expose a new decision or narrative consequence on a predictable cadence.
5. **Trust is a feature.** Local SQLite saves, account isolation, transparent offline rules and recoverable snapshots are part of the product promise.

## Current release priority

| Priority | Change | Success signal |
|---|---|---|
| P0 | Offline report CTA opens Fleet, Development, Modules or Quests based on the actual state | Returning player reaches a useful decision in one click |
| P0 | Keep the first 5-minute route linear and legible: mine → upgrade → survive night → claim quest → reveal blueprint | New player can explain what to do next without FAQ |
| P0 | Make combat and ship-return notifications visually prominent and actionable | No important fleet result is buried in the log |
| P1 | Add a lightweight “Operations Brief” panel showing current threat, production rate, next unlock and last decision | HUD communicates state without reading every panel |
| P1 | Add authored incident cards with two non-destructive choices that alter the next offline window | Active sessions contain decisions, not only collection |
| P1 | Add a small set of named blueprint identities with trade-offs instead of flat stat upgrades | Players develop a preferred playstyle |
| P2 | Add seasonal map incidents and endgame orders only after the first loop is stable | Long-term content extends the loop without front-loading complexity |

## Guardrails

CoreBox should not add monetization, ads, forced timers or prestige resets merely to inflate retention. New content must pass four tests: it is understandable in one sentence, it creates a real choice, it feeds an existing system, and it remains fair during offline time. Balance should favor a meaningful return reward over punishment for absence.

## Sources

[1] Machinations Game Design, “How to design idle games,” https://machinations.io/articles/idle-games-and-how-to-design-them

[2] Alharthi et al., “Playing to Wait: A Taxonomy of Idle Games,” CHI 2018, https://doi.org/10.1145/3173574.3174195

[3] Liam Mullally, “Wasting Time: Human Idleness and Durational Mechanics in Idle Games,” Game Studies, 2026, https://gamestudies.org/2601/articles/mullally

[4] Melvor Idle official Steam page, https://store.steampowered.com/app/1267910/Melvor_Idle/

[5] Unnamed Space Idle official Steam page, https://store.steampowered.com/app/2471100/Unnamed_Space_Idle/

[6] Cookie Clicker official web game, https://orteil.dashnet.org/cookieclicker/

[7] r/incremental_games community rules and visible discussion signals, https://www.reddit.com/r/incremental_games/
