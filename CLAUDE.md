# CLAUDE.md — handoff guide for TRAMPA

Read this first if you're an AI or a developer picking up this repo. It tells you
what exists, how to run/verify it, the rules you must not break, how to extend
each part, the known rough edges, and the recommended next steps.

TRAMPA is an **async-first** competitive obstacle-race game for private friend
leagues: race the *ghosts* of your friends against the clock on a shared daily
circuit, plant one trap each, and keep a shared league streak. There's a working
2D game (the product) and a 3D "cenital"/aerial prototype (an explored visual
direction). The design spec lives in the original brief the repo was built from
(`specmvpjuego.md`, provided to the first session) — this file is the operational
guide.

---

## Status at a glance

| Area | State |
|---|---|
| Deterministic core (`@trampa/shared`) — 2D **and** 3D (`sim3d`) | ✅ done, unit-tested |
| **3D aerial game client** (`@trampa/game3d`, Three.js + Rapier3D) — the primary/only client | ✅ playable, all online flows, deployed |
| Backend (`@trampa/server`, Node/Express + Postgres) — runs on the **3D** engine | ✅ done, smoke + e2e tested |
| Leagues, daily course, runs+anti-cheat, traps, streak, notifications | ✅ (3D) |
| Global daily challenge + shareable SVG card | ✅ |
| Streamer rooms + tournament (N circuits, points, podium) | ✅ |
| Saboteur ranking + trap cap for big lobbies | ✅ |
| 2D game client (`@trampa/client`, Phaser + Rapier2D) | ⚠️ legacy — code kept, not deployed |
| Realtime live multiplayer | ❌ future (v2) |
| Auth / accounts | ❌ handles are trust-based (MVP) |

> **Engine decision (done):** the game shipped **3D-only**. The server, anti-cheat,
> daily generation, rooms and traps all run on the deterministic 3D engine
> (`packages/shared/src/sim3d/`). The 2D packages (`client`, and the 2D half of
> `shared`) remain in the tree as legacy/reference but are not part of the live
> product. Live URLs + redeploy steps are in `DEPLOY.md`.

---

## The golden rules (do NOT break these)

The entire product — ghosts, fair leagues, server-side anti-cheat — depends on
the simulation being **bit-for-bit deterministic**. Before touching sim/course
code, internalise:

1. **No `Math.random()` in the sim or in course generation.** Every random draw
   comes from the seeded PRNG (`Rng`/`mulberry32` in `@trampa/shared`), derived
   from a `dailySeed`. Same seed ⇒ same course, everywhere, forever.
2. **No `Date.now()` / `new Date()` / `Math.random()` inside deterministic code.**
   They're fine in server request handlers and browser UI, never in the sim.
3. **Fixed 60 Hz timestep with an accumulator.** The renderer interpolates; the
   sim never depends on framerate. `FIXED_DT = 1/60`.
4. **Deterministic body-creation order.** Colliders/bodies are created in array
   order. Don't reorder.
5. **A run is an input-log** `{ seed, events: [{ f, t }] }` (frame-indexed), not
   positions. The server re-simulates it to verify the time (anti-cheat). Keep
   this contract; a few KB per run.
6. The **exact same `SimWorld`** drives live play, ghost replay, and server
   re-sim. If you change movement, change it in one place (`packages/shared/src/sim/world.ts`).

If you break determinism, ghosts desync and anti-cheat rejects honest runs.
The determinism tests (`npm test`) are your tripwire — keep them green.

---

## Repo map

```
packages/
  shared/    @trampa/shared — deterministic core (no UI, no server, no DB)
    src/prng.ts            mulberry32 Rng + seedFromString
    src/constants.ts       physics params, daily modifiers, applyModifier
    src/chunks/            chunk types + hand-authored 2D chunk library
    src/assembler.ts       deterministic seeded course assembler (2D)
    src/reach.ts           analytic reach envelope
    src/verifier.ts        completability + trap-placement verification
    src/course.ts          Course / PlacedTrap / TrapType types
    src/sim/world.ts       Rapier2D SimWorld (the movement source of truth)
    src/sim/simulate.ts    headless simulateRun (ghosts + anti-cheat)
    src/sim/autopilot.ts   heuristic bot that produces finishing input logs (tests/CI)
    src/llm/               Zod daily-config schema + defaultConfig + prompt
    src/index.ts           barrel + generateVerifiedCourse()
    src/determinism.test.ts  node:test determinism/completability/autopilot tests

  client/    @trampa/client — Phaser 3 + Rapier2D game (the product)
    src/scenes/BootScene.ts / GameScene.ts   Boot(Rapier init) + fixed-step gameplay
    src/game/                InputRecorder, LevelRenderer, GhostRunner, ghosts
    src/ui/overlay.ts        HTML overlay: menu, league, rooms, store, result, share
    src/net/api.ts           typed fetch client for the backend
    src/main.ts              wires Phaser + overlay; reads ?autoplay
    capacitor.config.ts      mobile packaging (M6)

  server/    @trampa/server — Node/Express + PostgreSQL
    src/index.ts             app wiring + routers + startup
    src/db.ts, env.ts        pg pool + query/tx; env vars
    src/migrations/*.sql     001 init, 002 notifications, 003 run deaths, 004 rooms
    src/migrate.ts, seed.ts, smoke.ts   migrate / seed demo / end-to-end smoke
    src/routes/              leagues, courses, runs, traps, rooms, notifications
    src/services/            courseService, roomService, antiCheat, streakService,
                             llmService, shareService, notifications, userService

  game3d/    @trampa/game3d — Three.js + Rapier3D aerial prototype (standalone)
    src/course.ts            3D chunk library + seeded assembler
    src/sim.ts               Rapier3D deterministic Sim3D
    src/render.ts            Three.js aerial renderer (sky, shadows, fog, trail)
    src/ui.ts, main.ts       menu/result overlays + loop + ?autoplay bot
```

---

## Run everything

Prereqs: Node ≥ 20, and PostgreSQL 16 (or Docker) for the backend.

```bash
npm install
npm run build:shared        # client & server import the BUILT shared package
npm test                    # determinism + completability + autopilot tests
```

### 2D game offline (no backend)
```bash
npm run dev:client          # http://localhost:5173  → "Partida rápida"
```
Append `?autoplay` to have the shared autopilot play the run (demos/CI).

### Full stack (leagues, daily, rooms, global)
```bash
# Postgres (compose file in packages/server) OR a local cluster:
#   docker compose -f packages/server/docker-compose.yml up -d
export DATABASE_URL=postgres://trampa:trampa@localhost:5432/trampa
npm run migrate --workspace @trampa/server
npm run seed    --workspace @trampa/server     # demo league, invite code TRAMPA1
npm run dev:server                              # http://localhost:8787
VITE_API_URL=http://localhost:8787 npm run dev:client
```

### Backend smoke (proves the whole API pipeline)
```bash
export DATABASE_URL=postgres://trampa:trampa@localhost:5432/trampa
npm run smoke --workspace @trampa/server
# create league → autopilot run accepted → tampered time rejected →
# trap placed → leaderboard + ghosts → shared streak ticks
```

### 3D prototype
```bash
npm run dev --workspace @trampa/game3d          # http://localhost:5183
# controls: ← → dodge, Space jump. ?autoplay to auto-run.
```

**Env vars** (`packages/server/.env.example`): `DATABASE_URL`, `PORT` (8787),
`ANTHROPIC_API_KEY` (optional — enables LLM daily config; falls back to
`defaultConfig` if unset or on any error), `LLM_MODEL` (default `claude-sonnet-5`).

---

## How to verify a change

- **Determinism / logic:** `npm test` (in `@trampa/shared`). Add cases to
  `src/determinism.test.ts`.
- **Backend:** `npm run smoke --workspace @trampa/server` against a running server.
- **In-browser behaviour:** build + `vite preview`, then load `?autoplay` and
  watch it play (the autopilot drives real gameplay). Screenshot with a headless
  Chromium (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) via
  `playwright-core` if you need visual proof.
- **Typecheck everything:** `npm run typecheck --workspaces --if-present`.

---

## How to extend (recipes)

**Add a 2D chunk** → `packages/shared/src/chunks/library.ts`. Keep
`entryY === exitY === 8` (seams always connect), add `trapSlots` (authored = safe),
give it `tags` + a `difficulty` (1–5). Rebuild shared; `npm test` verifies
completability across seeds. Tag weights are chosen by the daily config.

**Add a 3D chunk** → `packages/game3d/src/course.ts` `CHUNKS[]`. Full-width floor
at `top:0` at both seams; keep it completable by auto-forward + dodge + jump.

**Add an API endpoint** → new file in `packages/server/src/routes/`, mount it in
`src/index.ts`. Reuse `asyncHandler` + `badRequest/notFound`, parameterised
queries only, camelCase JSON responses (the client expects camelCase).

**Add a trap type** → extend `TrapType` in `packages/shared/src/course.ts`,
materialise its effect in `SimWorld` (`sim/world.ts` danger resolution), add it to
the client trap-type `<select>` in `overlay.ts`, and accept it server-side.
Re-verify anti-cheat still matches (traps affect the sim).

**Add a daily modifier** → `DAILY_MODIFIERS` + `applyModifier` in
`constants.ts`, and the enum in `llm/schema.ts`.

**Add a room/tournament rule** → `roomService.ts` (`pointsFor`, `roomStandings`).

---

## Data model + migrations

Postgres, migrations in `packages/server/src/migrations/` applied in order by
`migrate.ts` (tracked in a `_migrations` table). Tables: `users`, `leagues`,
`league_members`, `daily_courses` (also holds room circuits via `room_id`+`idx`),
`runs` (input_log, deaths), `traps` (hits), `notifications`, `rooms`,
`room_members`. `daily_seed` is BIGINT → always `Number(row.daily_seed)` before
passing to shared. Room circuits reuse `daily_courses`+`runs`, so anti-cheat,
leaderboards and ghosts work for them unchanged.

## API reference (compact)

```
GET  /health
POST /leagues                         {name, ownerHandle} → {id, inviteCode, userId}
POST /leagues/join                    {invite_code, handle} → league state + userId
GET  /leagues/:id                     members, streakCount, playDate
GET  /courses/today[?leagueId=]       daily course (omit leagueId = GLOBAL)
POST /runs                            {courseId, handle, timeMs, inputLog} → verified {rank, streak}
POST /traps                           {courseId, handle, slotX, slotY, trapType}
GET  /courses/:id/leaderboard         [{handle, timeMs, deaths}]
GET  /courses/:id/ghosts[?excludeHandle=]  [{handle, timeMs, inputLog}]
GET  /courses/:id/saboteurs           [{handle, hits, trapType}]
GET  /courses/:id/card.svg[?handle=]  shareable SVG result card
POST /rooms                           {name, handle, numCourses} → {id, code, userId}
POST /rooms/join                      {code, handle} → room + userId
GET  /rooms/:id                       members, live standings, podium
GET  /rooms/:id/courses/:idx          the Nth circuit (generated on demand)
POST /rooms/:id/finish                {handle} → final standings + podium (host only)
```

---

## Known issues / rough edges (read before extending)

1. **3D autoplay bot** doesn't complete every generated course — it stalls on
   dense weave/combo chunks (`game3d/src/main.ts botDecide`). Humans steer fine;
   the bot is only for demos/CI. Either improve the heuristic (lane sampling with
   longer lookahead) or accept it.
2. **`prepareGhosts` blocks the main thread** in the client — it synchronously
   `simulateRun`s each friend's ghost (~30s of sim each) before a run starts, so
   a course with several ghosts stalls the UI. Move it to a **Web Worker**, cap
   the number of ghosts, or precompute ghost frames server-side.
3. **3D prototype is standalone** — not wired to leagues/online/traps/anti-cheat.
   Porting means giving `Sim3D` the same input-log recording + server submit as
   the 2D `SimWorld`.
4. **Autopilot ≠ completability oracle.** The analytic `verifier` can pass a
   course the heuristic autopilot can't finish (esp. room circuits). For a hard
   guarantee, add a proper reachability/RL verify (spec calls this a v2 nicety).
5. **Trap-hit detection** (server `notifications.processTrapHits`) is a proximity
   heuristic on the re-sim, not exact.
6. **No auth** — identity is a handle (auto-created). Fine for MVP; add real auth
   before any public launch. **Cosmetics entitlements are localStorage-only.**
7. `courses/:id/ghosts` accepts both `excludeHandle` and `excludeUserId`.
8. "Streak in danger" notification is not implemented (table/hooks exist).
9. Global "one course per date" keys on the server's **UTC** date — mind
   timezones for a real launch.

---

## Recommended next steps (what I'd do next, prioritised)

With the current knowledge of the codebase, in order:

1. **Pick the engine (biggest fork).** Run a real feel playtest of 2D vs the 3D
   aerial prototype and commit to one as the primary client. All game *logic*
   (leagues, daily, rooms, traps, anti-cheat) is engine-agnostic and portable, so
   this decision only gates where the *rendering/UX* investment goes. Don't build
   more client polish until this is decided.
2. **Fix the two concrete debts** regardless of engine:
   - Move `prepareGhosts` to a Web Worker (or cap ghosts / server-precompute).
   - Make course generation robust: either harden the autopilot, or add a
     reachability verify so served circuits are guaranteed completable.
3. **If 3D wins:** port the deterministic input-log + server integration into
   `game3d` (record events in `Sim3D`, submit to `/runs`, fetch+replay ghosts),
   then expand the 3D chunk library and invest in art. **If 2D wins:** a visual
   pass (parallax, particles, juice) — cheap, high ROI.
4. **Trap design pass.** Implement the "skill-check + shortcut risk/reward" trap
   types concretely (spec discussion): traps that only cost time if you fail the
   check, and that reward the placer via the Saboteur ranking. Tune numbers.
5. **Auth + accounts** and server-synced cosmetics/entitlements — prerequisite
   for anything public.
6. **LLM daily config live.** Wire `ANTHROPIC_API_KEY`, add theme-history
   avoidance, and a safety/validation pass (already Zod-guarded with a fallback).
7. **Realtime "live" rooms (v2).** The deterministic sim + rollback netcode
   enables 2–6 live players. Large but architecturally already enabled.
8. **Mobile.** Capacitor build (`packages/client/capacitor.config.ts`), device
   testing, one-thumb ergonomics.
9. **Observability + retention.** Structured logging, error tracking (e.g.
   Sentry), and analytics on the retention loops (streaks, overtakes, traps).
10. **Content tooling.** A small chunk-authoring/preview tool (2D and 3D) so
    non-engineers can expand the libraries — content is the long-term moat.

---

## Conventions

- TypeScript, ESM everywhere; imports use `.js` specifiers (bundler/node
  resolution). Monorepo via npm workspaces.
- Server JSON responses are **camelCase**; DB columns are snake_case (map at the
  edge). `daily_seed` is BIGINT → `Number()` it before shared.
- Parameterised SQL only. Wrap route handlers in `asyncHandler`.
- Commit style: imperative subject + a short body. Tests/smoke green before
  committing sim/server changes.
- When delegating to sub-agents: keep them to **disjoint directories** and have
  them WRITE FILES ONLY (don't let concurrent agents run `npm install` — it races
  and corrupts `node_modules`); the orchestrator installs/builds/tests.
