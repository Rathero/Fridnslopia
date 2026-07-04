# TRAMPA

Competitive, **async-first** mobile obstacle-race game for 2–6 friends in private
leagues. One thumb, comedic physics, daily AI-orchestrated circuits, asynchronous
sabotage, and a shared league streak. This repo implements the full MVP spec
(milestones **M0–M6**).

> Working name **TRAMPA** ("trap"). The differentiator: you don't need everyone
> online at once — you race the **ghosts** of your friends against the clock on a
> shared daily circuit, and each player plants **one trap** for the others.

---

## Why it's built this way (the golden rule: determinism)

Ghosts and fair leagues only work if the simulation is **bit-for-bit
deterministic** given the same seed + input. So everything that affects the sim:

- Uses a **seeded PRNG** (`mulberry32`) derived from a `dailySeed` — never
  `Math.random()`.
- Runs at a **fixed 60 Hz** timestep with an accumulator; the renderer
  interpolates, the sim never depends on framerate.
- Runs on **Rapier2D (WASM)** — cross-platform deterministic — not Phaser's
  Arcade/Matter physics.
- Represents a run as a tiny **input-log stream** (`{seed, events:[{f,t}]}`), not
  positions. The server **re-simulates** that log to verify times (anti-cheat).

The *exact same* `SimWorld` class drives live play (client), ghost replay, and the
server's anti-cheat re-sim — so a recorded run reproduces identically everywhere.

---

## Monorepo layout

```
packages/
  shared/   @trampa/shared — the deterministic core (no UI, no server):
              PRNG, physics constants, chunk library, assembler, completability
              verifier, Rapier SimWorld + headless simulate, autopilot bot,
              Zod-validated LLM config + fallback.
  client/   @trampa/client — Phaser 3 + Rapier game. Fixed-step loop, one-thumb
              controls, level/ghost/trap rendering, HTML overlay for menus /
              leagues / store / results / trap placement, Capacitor config.
  server/   @trampa/server — Node/Express + PostgreSQL. Leagues, daily course
              generate+verify on-demand, run submission with server-side re-sim,
              traps, shared streak, notifications, LLM daily config.
```

## Quick start

```bash
npm install
npm run build:shared          # client & server import the built shared package
npm test                       # determinism + completability + autopilot tests
```

### Play offline (no backend) — M0/M1/M2

```bash
npm run dev:client             # http://localhost:5173  -> "Partida rápida"
```

Quick Play generates a verified course locally and lets you race your own saved
ghost. Tap = jump, hold = charge a bigger jump.

### Full stack — M3/M4/M5

```bash
# 1. Postgres (docker compose file lives in packages/server)
cd packages/server && docker compose up -d && cd ../..

# 2. migrate + seed a demo league (invite code TRAMPA1)
DATABASE_URL=postgres://trampa:trampa@localhost:5432/trampa \
  npm run migrate --workspace @trampa/server
DATABASE_URL=postgres://trampa:trampa@localhost:5432/trampa \
  npm run seed --workspace @trampa/server

# 3. run the API
DATABASE_URL=postgres://trampa:trampa@localhost:5432/trampa \
  npm run dev:server            # http://localhost:8787

# 4. point the client at it and play the daily circuit
VITE_API_URL=http://localhost:8787 npm run dev:client

# 5. (optional) end-to-end smoke of the whole API pipeline
DATABASE_URL=postgres://trampa:trampa@localhost:5432/trampa \
  npm run smoke --workspace @trampa/server
```

The LLM daily config is optional: set `ANTHROPIC_API_KEY` to have the model pick
the theme / palette / tag-weights / modifier; without it (or on any error) a
validated `defaultConfig` is used — a model hiccup can never break the day.

### Mobile packaging — M6

`packages/client/capacitor.config.ts` documents the Capacitor steps to ship the
single TypeScript codebase to iOS / Android.

---

## Milestone status

| Milestone | What | Status |
|---|---|---|
| **M0** | Playable single-player skeleton, fixed-step loop, controls, respawn, timer | ✅ |
| **M1** | Chunk library, deterministic seeded assembler, completability verifier | ✅ |
| **M2** | Input-log recording + ghost re-simulation, race your own ghost | ✅ |
| **M3** | Node+Postgres backend, leagues, daily course, submit + server re-sim, leaderboard | ✅ |
| **M4** | Async traps: place 1/circuit (verified), render everyone's, hit counter | ✅ |
| **M5** | Shared league streak, notifications, LLM daily config (Zod + fallback) | ✅ |
| **M6** | Capacitor mobile config, cosmetics store (direct-purchase, no loot boxes) | ✅ |

## Testing

- `npm test` — determinism (same seed → same course; same log → same sim),
  completability across seeds, and the autopilot generating finishing runs whose
  logs re-simulate to the identical time.
- `npm run smoke --workspace @trampa/server` — live API: create league →
  autopilot run → **accepted**, tampered time → **rejected**, trap placement,
  leaderboard, ghosts, and the shared streak ticking when all members finish.

## Monetization (no gambling regulation)

Direct-purchase cosmetics only (no loot boxes), premium leagues, and a
**forfeit-tracker** that only announces the loser — the app never touches money.
See spec §8.
