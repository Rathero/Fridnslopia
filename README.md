# TRAMPA

Competitive, **async-first** mobile obstacle-race game for friends in private
leagues. One thumb, comedic physics, daily circuits, asynchronous sabotage, and a
shared league streak — plus streamer rooms with tournaments and a global daily
challenge you can share.

> You don't need everyone online at once: you race the **ghosts** of your friends
> against the clock on a shared daily circuit, and each player plants **one trap**
> for the others.

**New here / continuing the project? Read [`CLAUDE.md`](./CLAUDE.md)** — it's the
full handoff guide (architecture, run/verify, how to extend, known issues, and a
prioritised roadmap).

---

## Why it's built this way — determinism

Ghosts and fair leagues only work if the simulation is **bit-for-bit
deterministic** given the same seed + input:

- Seeded PRNG (`mulberry32`) from a `dailySeed` — never `Math.random()`.
- Fixed **60 Hz** timestep with an accumulator; the renderer interpolates.
- **Rapier2D (WASM)** physics — cross-platform deterministic (not Phaser Arcade/Matter).
- A run is a tiny **input-log stream** `{seed, events}`, not positions — the
  server **re-simulates** it to verify times (anti-cheat).

The same `SimWorld` drives live play, ghost replay, and the server's anti-cheat.

## Monorepo layout

```
packages/
  shared/   @trampa/shared — deterministic core: PRNG, physics, chunk library,
              assembler, verifier, Rapier SimWorld + headless simulate, autopilot,
              Zod-validated LLM daily config + fallback.
  client/   @trampa/client — Phaser 3 + Rapier2D game (the product). One-thumb
              controls, ghosts, traps, leagues, rooms, global daily, store; HTML
              overlay UI; Capacitor config for mobile.
  server/   @trampa/server — Node/Express + PostgreSQL. Leagues, daily/global
              course generate+verify, run submission with server-side re-sim,
              traps, shared streak, notifications, streamer rooms + tournaments,
              saboteur ranking, shareable SVG cards.
  game3d/   @trampa/game3d — Three.js + Rapier3D aerial "cenital" prototype
              (standalone; explored visual direction).
```

## Quick start

```bash
npm install
npm run build:shared          # client & server import the built shared package
npm test                       # determinism + completability + autopilot tests
npm run dev:client             # offline "Partida rápida" — no backend needed
```

Full stack (Postgres), 3D prototype, smoke tests, env vars, and ports are all
documented in **[`CLAUDE.md`](./CLAUDE.md)** and each package's README.

## Features

| Area | Status |
|---|---|
| Playable one-thumb runner, fixed-step loop, respawn, timer | ✅ |
| Deterministic seeded course generation + completability verifier | ✅ |
| Input-log recording + ghost re-simulation (race your friends' ghosts) | ✅ |
| Backend: leagues, daily course, submit + **server-side anti-cheat re-sim**, leaderboard | ✅ |
| Async traps: place 1/circuit (verified), render everyone's, hit counter | ✅ |
| Shared league streak, notifications, LLM daily config (Zod + fallback) | ✅ |
| **Global daily challenge** + shareable SVG result card ("¿me superas?") | ✅ |
| **Streamer rooms** (no player cap) + **tournament** of N circuits + **podium** | ✅ |
| **Saboteur ranking** (who catches the most players) + trap cap for big lobbies | ✅ |
| Cosmetics store (direct purchase, no loot boxes) | ✅ |
| Capacitor mobile config | ✅ |
| 3D aerial prototype (Three.js + Rapier3D) | ⚠️ prototype |
| Realtime live multiplayer, auth/accounts | ❌ future |

## Testing

- `npm test` — determinism (same seed → same course; same log → same sim),
  completability across seeds, autopilot finishing runs that re-sim to the exact
  time.
- `npm run smoke --workspace @trampa/server` — live API: run accepted, tampered
  time rejected, traps, leaderboard, ghosts, streak. There's also a rooms/global
  path exercised in development (see CLAUDE.md).

## Monetization (no gambling regulation)

Direct-purchase cosmetics only (no loot boxes), premium leagues, and a
**forfeit-tracker** that only announces the loser — the app never touches money.
