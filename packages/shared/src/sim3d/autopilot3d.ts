import type { Course3D, Obstacle, PlacedTrap3D } from './course3d.js';
import { Sim3D, obstacleAABB, FIXED_DT, type Input3D } from './sim3d.js';
import { MAX_RUN_FRAMES_3D, type InputLog3D } from './simulate3d.js';

/**
 * Heuristic bot that drives a 3D course to the finish DEATH-FREE, recording the
 * input log it produced. Not the game AI — it exists as the completability
 * oracle (the server re-samples the seed until this finishes) and to let CI
 * exercise submit + server re-sim without a human.
 *
 * Death is now terminal (one hit/fall = restart), so the bot must never touch a
 * hazard. Strategy: dense lateral sampling with generous safety margins; follow
 * the floor (handles winding / narrowing paths); jump gaps early; and for
 * crushers, predict whether the piston will be DOWN when we cross it and only
 * avoid the lane if so (otherwise pass under a raised piston) — so a wall of
 * pistons doesn't box us in.
 */
export function autopilot3d(course: Course3D, placedTraps: PlacedTrap3D[] = []): {
  log: InputLog3D;
  finished: boolean;
  timeMs: number;
  deaths: number;
} {
  const sim = new Sim3D(course, placedTraps);
  const R = sim.params.playerRadius;
  const events: { f: number; t: Input3D }[] = [];
  const rec = (t: Input3D) => { sim.input(t); events.push({ f: sim.frame, t }); };

  const half = course.halfWidth - R - 0.12;
  const cands: number[] = [];
  for (let x = -half; x <= half + 1e-6; x += 0.5) cands.push(Math.round(x * 100) / 100);
  if (!cands.some((x) => Math.abs(x) < 1e-6)) cands.push(0);

  // Solid floor under a ball centred at (x,z), with a margin so we never pick an
  // x that leaves the runner teetering on the slab edge (a fall = death).
  const edge = R + 0.18;
  const floorAt = (x: number, z: number) =>
    course.floors.some(
      (f) => x >= f.x - f.w / 2 + edge && x <= f.x + f.w / 2 - edge && z >= f.z - f.d / 2 && z <= f.z + f.d / 2,
    );
  const anyFloor = (x: number, z0: number, z1: number) => {
    for (let z = z0; z <= z1; z += 1.0) if (floorAt(x, z)) return true;
    return false;
  };
  // Continuous near-path floor at fixed x (short window → can follow bends).
  const nearFloor = (x: number, z: number) => floorAt(x, z + 1.3) && floorAt(x, z + 2.7);
  // Floor missing ahead but resuming within jump reach → a jumpable gap. Look a
  // good bit ahead so we take off early (air time clears ~10 units) rather than
  // at the very lip, which risks dropping into the void.
  const gapJump = (x: number, z: number) => !floorAt(x, z + 3.0) && anyFloor(x, z + 3.8, z + 11);

  // Will crusher `o` be lethal (head low enough to hit a grounded ball) during
  // the frames we'd cross its z-band, given our current forward speed?
  const crusherLethalOnArrival = (o: Obstacle, z: number, frame: number, speed: number): boolean => {
    const dz = o.z - z;
    if (dz <= 0) return false;
    const arrive = frame + Math.round(dz / Math.max(1e-3, speed * FIXED_DT));
    // Lethal only when the head dips near the runner's crown (~1.1); a raised
    // piston rests well above that, so we can pass safely under it.
    for (let df = -7; df <= 8; df++) {
      const b = obstacleAABB(o, arrive + df);
      if (b.minY < R + 0.7) return true;
    }
    return false;
  };

  // Frame at which we'd reach obstacle `o`, from current forward speed.
  const arrivalFrame = (o: Obstacle, z: number, frame: number, speed: number) =>
    frame + Math.round((o.z - z) / Math.max(1e-3, speed * FIXED_DT));

  const threat = (x: number, z: number, frame: number, speed: number): number => {
    let pen = 0;
    for (const o of course.obstacles) {
      const dz = o.z - z;
      // Ignore obstacles already cleared (behind our z past their half-depth).
      if (dz < -(o.d / 2 + 0.35) || dz > 16) continue;

      if (o.kind === 'crusher') {
        if (!crusherLethalOnArrival(o, z, frame, speed)) continue; // safe to pass under a raised piston
        const M = R + 0.5;
        if (x > o.x - o.w / 2 - M && x < o.x + o.w / 2 + M) pen += 16 / Math.max(1.2, dz);
        continue;
      }

      if (o.kind === 'mover') {
        // A sliding gate: only dangerous where it actually is when we cross it —
        // check just the crossing window so we can time the open side.
        const arrive = arrivalFrame(o, z, frame, speed);
        const M = R + 0.65;
        for (let df = -4; df <= 4; df++) {
          const b = obstacleAABB(o, arrive + df);
          if (x > b.minX - M && x < b.maxX + M) { pen += 16 / Math.max(1.2, dz); break; }
        }
        continue;
      }

      if (o.kind === 'spinner') {
        // Stay clear of the swept disc (the outer lanes are always safe).
        const b = obstacleAABB(o, frame); // disc box (frame-independent)
        const M = R + 0.7;
        if (x > b.minX - M && x < b.maxX + M) pen += 17 / Math.max(1.2, dz);
        continue;
      }

      // Static wall.
      const M = R + 0.8;
      const b = obstacleAABB(o, frame);
      if (x > b.minX - M && x < b.maxX + M) pen += 15 / Math.max(1.2, dz);
    }
    return pen;
  };

  let lastSteer = 0;
  while (!sim.finished && !sim.dead && sim.frame < MAX_RUN_FRAMES_3D) {
    const p = sim.getPlayer();

    // Jump a gap in our current lane, early (air time clears ~10 units).
    if (p.grounded && gapJump(p.x, p.z)) rec('J');

    let best = p.x, bestScore = Infinity;
    for (const x of cands) {
      let s = 0;
      if (!nearFloor(x, p.z)) {
        if (gapJump(x, p.z)) s += 4;   // passable by jumping
        else s += 1000;                // void → stay off
      }
      s += threat(x, p.z, sim.frame, p.speed) * 3;
      s += Math.abs(x - p.x) * 0.06;   // prefer minimal steering (less overshoot)
      s += Math.abs(x) * 0.02;         // mild centre bias
      if (s < bestScore - 1e-6) { bestScore = s; best = x; }
    }

    const dx = best - p.x;
    let steer = Math.abs(dx) < 0.15 ? 0 : Math.max(-100, Math.min(100, Math.round((dx * 62) / 5) * 5));
    if (steer !== lastSteer) { rec(`S${steer}`); lastSteer = steer; }

    sim.step();
  }

  const result = {
    log: { seed: course.seed, events },
    finished: sim.finished,
    timeMs: sim.timeMs(),
    deaths: sim.deaths,
  };
  sim.free();
  return result;
}
