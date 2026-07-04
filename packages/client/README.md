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

- **Partida rápida (offline)** works with no backend — generates a verified
  course locally and lets you race your own saved ghost (M2).
- **Jugar circuito de hoy** needs the backend running: create/join a league,
  race the shared daily course, submit your time, see the leaderboard, and
  place a trap for your friends (M3/M4).

## Controls

- Tap anywhere = jump. Hold = charge a bigger jump, release to launch.
- Keyboard (desktop): Space / Up = jump (hold to charge).

## Mobile packaging (M6)

See `capacitor.config.ts`.
