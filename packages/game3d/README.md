# @trampa/game3d

A **3D "cenital" (aerial) obstacle-runner prototype** for TRAMPA — Three.js
rendering over a deterministic **Rapier3D** simulation. It explores an aerial,
Fall-Guys-ish visual direction while keeping the determinism that makes ghosts and
fair leagues possible.

> This is a **standalone prototype**: it is NOT wired to the backend
> (leagues/online/traps/anti-cheat). See the roadmap in the repo-root
> [`CLAUDE.md`](../../CLAUDE.md) for how to promote it to a real client.

## Run

```bash
npm install
npm run dev --workspace @trampa/game3d     # http://localhost:5183
```

- Controls: **← →** dodge lanes, **Space** jump. Touch: bottom-left / bottom-right
  = dodge, centre = jump.
- `?autoplay` — a heuristic bot auto-runs the course (for demos/screenshots).
- `?seed=<n>` — pick a course seed (default is a fixed daily-style seed).

## How it works

Same deterministic ideas as the 2D game, in 3D:

- **`src/course.ts`** — a hand-authored **chunk library** (14 templates: weave,
  slalom, pinch, chicane, moving gates, gaps, narrow beam, ramps/steps, combos)
  plus a **seeded assembler** (difficulty ramp, no immediate repeats). Same seed ⇒
  same course. Coordinates: X = lateral, Y = up, Z = forward.
- **`src/sim.ts`** — `Sim3D`, a fixed-60 Hz Rapier3D world. Auto-run forward (+Z),
  lateral steering toward a target lane, jump; gaps and obstacles kill → respawn at
  the last checkpoint; finish at the end. Only the floor + player live in Rapier;
  obstacles are resolved by manual AABB overlap so auto-run never wedges. No
  `Math.random`/`Date.now` in the sim — determinism preserved (ghosts remain
  possible).
- **`src/render.ts`** — `Renderer3D`: angled aerial follow-cam, directional shadow
  light + fill, gradient sky (shader sphere), distance fog, emissive obstacle rims,
  lane markings, player squash/stretch + soft contact shadow, glowing finish arch,
  and a translucent ghost of your previous run.
- **`src/ui.ts` / `src/main.ts`** — framework-free menu/result overlays and the
  `menu → run → result` loop.

## Extending

Add a chunk in `src/course.ts` `CHUNKS[]`: full-width floor at `top:0` at both
seams (so chunks snap together), and keep it completable by auto-forward + dodge +
jump. Run `npm run typecheck --workspace @trampa/game3d` before committing.

## Known limitation

The `?autoplay` bot (`src/main.ts botDecide`) does not complete every generated
course — it stalls on dense weave/combo chunks. Humans steer fine; the bot is only
for demos/CI. Improving the lane-sampling heuristic (longer lookahead, plan the
jump/dodge earlier) is a good first task.
