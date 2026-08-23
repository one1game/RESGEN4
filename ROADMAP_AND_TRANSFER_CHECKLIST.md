# Roadmap and Transfer Checklist

## Roadmap

### Release hardening

Complete the local/cloud adapter audit, remove ambiguous external fallbacks, add a formal LICENSE and NOTICE, verify all third-party asset licenses, and run a clean-machine installation test.

### Public beta

Publish a stable browser build, record a two-minute gameplay walkthrough, add basic privacy and error reporting documentation, and recruit a small group of external testers.

### Retention validation

Measure first-session completion, next-day return, seven-day return, average session length, operation choice distribution, failed-operation rate and resource-cap frequency. Balance should be changed from real cohort data rather than simulated assumptions.

### Production expansion

Add richer incident chains, rare blueprint variants, dynamic faction events, more NPC convoy types, deeper cycle differences and a hosted backend only if the product requires live multiplayer.

## Transfer checklist

- [ ] Confirm the seller owns or can transfer the game name, code, design, text, music, fonts and images.
- [ ] Add a project license or execute a separate written IP assignment.
- [ ] Review every dependency and third-party asset license.
- [ ] Remove personal accounts, credentials, tokens, local databases and browser data.
- [ ] Rotate any secret that may have appeared in development history.
- [ ] Confirm the clean archive builds on a new machine.
- [ ] Confirm whether the deal is source-code license, exclusive license or full IP assignment.
- [ ] Define support period, bug-fix obligations and what is explicitly excluded.
- [ ] Use escrow or secured payment before delivering exclusive rights or repository ownership.
- [ ] Transfer the repository only after payment conditions are satisfied.

## Buyer acceptance test

The buyer should install dependencies, run `npm run check`, start the local server, create a fresh local database and verify the core loop, save/export, operations, fleet, map and 1000-hour retention harness. The buyer should also decide whether the Supabase-compatible adapter is retained as a local API abstraction or replaced with a hosted adapter.
