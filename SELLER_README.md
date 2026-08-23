# CoreBox — Sell-Ready Prototype Package

## Status

CoreBox is a playable cyberpunk command idle strategy prototype. It includes a Rust/WASM simulation core, a local-first SQLite HTTP backend, offline progression, operations, sector heat, fleet systems, PvP contracts, mobile UI and long-run retention mechanics.

This package is a technical prototype transfer package, not a representation that the project has proven revenue, a live audience, or production-grade multiplayer operations.

## Quick start

Requirements: Node.js 22+, Rust toolchain, `wasm-pack`, and a modern Chromium/Edge browser.

```bash
npm install
npm run check
npm run start:local
```

Open `http://localhost:3000` or the port printed by the local server. The project uses SQLite under `data/local.db` at runtime. A clean buyer copy must create its own local database and must not contain the seller's database.

## Verification commands

```bash
npm run check:js
npm run audit:static
npm run test:local-db
npm run test:retention-1000h
npm run audit:balance
npm run test:quest-contract
npm run test:save-integrity
npm run check
```

The `test:retention-1000h` harness simulates 1000 accelerated game hours and checks operations, reports, incidents, projects, goals, NPC convoys, sector heat, resource bounds and alternate-cycle unlocks.

## Included systems

The package contains Expedition Contracts, Welcome-back reports, Safe Automation, Recon Reports, sector heat, mastery, Support Order, Sector Control, NPC convoy flow, infrastructure sinks, Codex/Archive, local PvP and Rust/WASM state simulation. The primary UX entry point is the Operations Deck inside Command Center.

## Important transfer notes

The repository currently contains a Supabase-compatible adapter because the local backend mirrors the former API contract. Before an exclusive commercial transfer, the buyer should verify every path in `game.js`, `fleet.js`, `save.js`, `space-module.js` and `multiplayer_combat.js` against the selected local or production adapter. Do not promise cloud-free multiplayer until this verification is complete.

The project does not include the seller's local database, credentials, personal accounts, tokens, browser sessions or private test data. Never transfer GitHub credentials or personal email access as part of the project.

## Suggested deal language

Transfer of source code, project files and exclusive commercial rights should occur only under a written agreement and after secured payment or escrow confirmation. Ownership of third-party libraries, fonts, music and image assets must be checked separately before making an exclusive IP claim.
