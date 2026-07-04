# @trampa/client

Phaser 3 + Rapier2D game client. All gameplay input is one thumb (tap = jump,
hold = charge). The deterministic simulation lives in `@trampa/shared` and is
driven here at a fixed 60 Hz with render interpolation.

## Run

```bash
# from the repo root, once:
npm install
npm run build:shared     # the client imports the built shared package

# then:
npm run dev:client       # http://localhost:5173
```

Point it at a backend with `VITE_API_URL` (defaults to `http://localhost:8787`):

```bash
VITE_API_URL=http://localhost:8787 npm run dev --workspace @trampa/client
```

## Play

Menu flows (all in the HTML overlay, `src/ui/overlay.ts`):

- **Partida rápida (offline)** — no backend; generates a verified course locally
  and lets you race your own saved ghost.
- **Jugar circuito de hoy** — league daily: create/join a league (invite code),
  race the shared course, submit your time (server re-simulates it), see the
  leaderboard + saboteur ranking, and place a trap.
- **🌍 Reto diario global** — the worldwide daily. Same course for everyone;
  after finishing, "Compartir mi tiempo" opens/copies a shareable SVG card.
- **📺 Salas** — create or join a streamer room (no player cap), play a session
  of N circuits, watch the live standings, and see the final podium.
- **Tienda** — direct-purchase cosmetic skins (no loot boxes).

`?autoplay` in the URL makes the shared autopilot play each run (demos/CI).

## Controls

- Tap anywhere = jump. Hold = charge a bigger jump, release to launch.
- Keyboard (desktop): Space / Up = jump (hold to charge).

## Architecture note

Phaser owns only Boot + the gameplay scene (pure one-thumb). Everything else —
menus, leagues, rooms, store, results, trap placement, share — is an HTML overlay
driven via a `run:finished` game event, so the two never fight over the pointer.
Run context (`mode`, `roomId`, `roomIdx`, `shareable`) flows through
`GameSceneData → GameScene → RunResult` so the result screen knows what to show.

**Known perf note:** `prepareGhosts` synchronously re-simulates each friend's ghost
before a run starts — with several ghosts this blocks the UI. Move it to a Web
Worker or cap the ghost count. See `../../CLAUDE.md`.

## Mobile packaging (M6)

See `capacitor.config.ts`.
