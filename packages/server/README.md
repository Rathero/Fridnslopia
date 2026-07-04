# @trampa/server

Backend for **TRAMPA** — leagues, daily courses, run submission with server-side
anti-cheat re-simulation, async traps, shared league streaks, notifications, and
the LLM daily-config layer. Implements spec milestones **M3 / M4 / M5** (§5 data
model, §6 API).

Node + Express + PostgreSQL. All simulation/verification logic lives in the
deterministic `@trampa/shared` core; this package is the persistence + HTTP shell.

## Prerequisites

- Node 20+
- Docker (for the bundled Postgres), or an existing Postgres reachable via
  `DATABASE_URL`.

## Setup

```bash
cp .env.example .env          # adjust if needed
docker compose up -d          # starts Postgres on :5432 (user/pass/db = trampa)

npm run migrate               # apply SQL migrations
npm run seed                  # demo users + league (invite code TRAMPA1) + today's courses
npm run dev                   # start the API on :8787 (tsx watch)
```

Build / run compiled:

```bash
npm run build && npm start
```

## Environment

| Var                 | Default                                             | Notes |
|---------------------|-----------------------------------------------------|-------|
| `DATABASE_URL`      | `postgres://trampa:trampa@localhost:5432/trampa`    | pg connection string |
| `PORT`              | `8787`                                              | HTTP port |
| `ANTHROPIC_API_KEY` | _(unset)_                                           | If unset, daily config uses the deterministic fallback |
| `LLM_MODEL`         | `claude-sonnet-5`                                   | Model for daily-config generation |

## Endpoints

| Method | Path | Body / Query | Description |
|--------|------|--------------|-------------|
| GET  | `/health` | — | `{ ok: true }` |
| POST | `/leagues` | `{ name, ownerHandle }` | Create a league; returns `invite_code`. Owner auto-joined. |
| POST | `/leagues/join` | `{ invite_code, handle }` | Join a league (creates user by handle). |
| GET  | `/leagues/:id` | — | Members, streak, today's play date. |
| GET  | `/courses/today` | `?leagueId=` (omit = global) | Today's course (generated + verified on-demand): `courseId`, `dailySeed`, `config`, `course`, `traps`, `verified`, `playDate`. |
| GET  | `/courses/:id/leaderboard` | — | Best finished run per user, ranked: `{ rank, handle, timeMs, deaths, createdAt }`. |
| GET  | `/courses/:id/ghosts` | `?excludeUserId=` | Up to 5 best `{ handle, timeMs, inputLog }` for client ghost replay. |
| GET  | `/courses/:id/traps` | — | Placed traps for a course. |
| POST | `/runs` | `{ courseId, userId?\|handle?, timeMs, inputLog }` | Re-simulates (anti-cheat), stores authoritative time, updates trap hits / overtakes / streak. Returns `{ ok, timeMs, deaths, rank, streak }`. |
| POST | `/traps` | `{ courseId, userId?\|handle?, slotX, slotY, trapType }` | Place/move your single trap (validated for completability). |
| GET  | `/notifications` | `?userId=\|handle=` | Newest-first notifications. |

Most endpoints accept either a concrete `userId` (uuid) or a `handle` (created
on first use) — see `resolveUserId`.

## How it works

- **Daily course** — `getOrCreateTodayCourse(leagueId, date)` derives a stable
  seed `seedFromString("<leagueId|global>:<date>")`, asks the LLM layer for a
  validated `DailyConfig` (fallback on any failure), then
  `generateVerifiedCourse` assembles + verifies it. The row stores seed + config
  so any client rebuilds the identical course with `assembleCourse`.
- **Anti-cheat** — `/runs` calls `simulateRun` (Rapier, deterministic) with the
  submitted seed + input log and only accepts the run if it finished and the
  recomputed time matches the claim within ±150 ms. The **recomputed** time is
  what's stored.
- **Traps** — one per player per course (`unique (course_id, user_id)`), position
  validated by `verifyTrapPlacement`. Hits are credited heuristically when a
  re-sim shows a death near the slot; the owner is notified.
- **Streak** — a league's shared streak advances once every member has a finished
  run on today's course; increments if kept alive since yesterday, else resets.
- **LLM** — `getDailyConfig` never throws; without `ANTHROPIC_API_KEY` (or on any
  error/invalid output) it returns the deterministic `defaultConfig`.

## Migrations

Plain SQL files in `src/migrations`, applied in filename order and tracked in
`_migrations` (idempotent). `001_init.sql` is the exact spec §5 schema;
`002_notifications.sql` adds notifications; `003_run_deaths.sql` adds a persisted
death count to `runs` for the leaderboard.
