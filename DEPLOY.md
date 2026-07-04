# Deployment — TRAMPA (live)

The game is deployed and public.

| What | URL |
|------|-----|
| **Play** (2D client) | https://trampa-nu.vercel.app |
| API | https://trampa-api.vercel.app |
| 3D "cenital" prototype (beta) | https://trampa-3d.vercel.app |

The 2D client's menu has a "🎮 Modo 3D cenital (beta)" button that opens the 3D
prototype. The 3D is a **separate static Vercel project** (`trampa-3d`, from
`packages/game3d`), backend-independent — deploy it with
`npm run build --workspace @trampa/game3d` then `vercel deploy --prod` from
`packages/game3d/dist`.

- **Public, no auth** — anyone with the link plays by entering a name. Create a
  league or a room and share the invite code with friends.
- Hosting: **Vercel** team `hola-glow` — two projects: `trampa` (static client)
  and `trampa-api` (serverless function). Database: **Supabase** project
  `trampa-game` (org ViajeChina, region `eu-west-3`, ref `bncuwqwvxafhthlymxyd`),
  a fresh isolated project.

## Architecture of the deploy

- **Client** — the Vite build (`packages/client`) deployed as static files, built
  with `VITE_API_URL=https://trampa-api.vercel.app` baked in.
- **API** — the Express app bundled by esbuild into ONE self-contained serverless
  function (`npm run bundle:vercel`, output `packages/server/vercel-out/`),
  including `@trampa/shared` and the Rapier WASM inline. `vercel.json` routes all
  paths to it. This avoids Vercel having to resolve the npm workspace or WASM.
- **DB** — Supabase Postgres. **Important:** the app connects via the Supabase
  **connection pooler** (IPv4), NOT the direct `db.<ref>.supabase.co` host — that
  one is IPv6-only and Vercel serverless functions are IPv4-only, so direct
  connections fail with a DNS/connect error. Pooler string (transaction mode):
  `postgresql://trampa_app.<ref>:<password>@aws-0-eu-west-3.pooler.supabase.com:6543/postgres`
  A dedicated login role `trampa_app` (not the project's `postgres` superuser) is
  used, with full privileges on the `public` schema.

## Environment variables (Vercel project `trampa-api`, Production)

| Var | Value |
|-----|-------|
| `DATABASE_URL` | the Supabase **pooler** connection string (transaction mode, port 6543) |
| `PGSSL` | `require` (also auto-detected for supabase hosts in `db.ts`) |
| `PGPOOL_MAX` | `2` (small pool for serverless; auto-defaults to 2 on Vercel anyway) |

## Redeploy

Needs the Vercel CLI and a token with access to the `hola-glow` team
(`vercel deploy` / `vercel env`). DB migrations are already applied.

```bash
# API (after code changes)
npm run build:shared
npm run bundle:vercel --workspace @trampa/server
cd packages/server/vercel-out
vercel deploy --prod --yes --scope hola-glow        # DATABASE_URL is a project env var

# Client (after code changes) — must bake the API URL at build time
VITE_API_URL=https://trampa-api.vercel.app npm run build --workspace @trampa/client
cd packages/client/dist
vercel deploy --prod --yes --scope hola-glow
```

## Database migrations

Applied to Supabase via the migration SQL in `packages/server/src/migrations/`
(001 init, 002 notifications, 003 run_deaths, 004 rooms). To apply new ones,
run them against the pooler connection string, or via the Supabase SQL editor.

## Security / housekeeping

- The **Vercel deploy token can be deleted** now that the deploy is done
  (Vercel → Account Settings → Tokens). It's only needed to redeploy.
- The Postgres app-role password lives only in the Vercel `DATABASE_URL` env var.
  To rotate: `alter role trampa_app with password '<new>'` in Supabase, then
  update `DATABASE_URL` and redeploy the API.
- It's public and unauthenticated by design (MVP for playing with friends). Add
  auth before any real launch (see the roadmap in `CLAUDE.md`).
- Costs: Supabase + Vercel free tiers; $0.
