# CoreBox — Public Demo

CoreBox is a cyberpunk command simulator prototype. This repository contains **only the public playable demo** for review and does not contain the commercial source package, production database, credentials, or private deployment configuration.

## Run locally

Serve this folder with any static web server, then open `index.html` through the server. For example:

```bash
python3 -m http.server 8080
```

The demo has no account system and no external API calls. A visitor enters a callsign and plays a self-contained local simulation. Progress is stored in the visitor's own browser using `localStorage`.

## Demo systems

The public build showcases outpost resources, power and heat management, operational stances, expedition contracts, fleet launch flow, local activity, milestones, and a spiral sector map with an active flight trace.

The full commercial package is distributed separately under a private purchase agreement.
