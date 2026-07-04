import type { Course3D, PlacedTrap3D } from './course3d.js';
import { Sim3D, obstacleAABB, type Input3D } from './sim3d.js';
import { MAX_RUN_FRAMES_3D, type InputLog3D } from './simulate3d.js';

/**
 * Heuristic bot that drives a 3D course to the finish, recording the input log
 * it produced. Not the game AI — it exists so tests/CI can generate a genuine
 * finishing run (to exercise submit + server re-sim) without a human. Strategy:
 * auto-run; jump gaps in the current lane; otherwise steer to the clear lane
 * nearest us (ties prefer centre), sampling upcoming frames for movers.
 */
export function autopilot3d(course: Course3D, placedTraps: PlacedTrap3D[] = []): {
  log: InputLog3D;
  finished: boolean;
  timeMs: number;
  deaths: number;
} {
  const sim = new Sim3D(course, placedTraps);
  const events: { f: number; t: Input3D }[] = [];
  const rec = (t: Input3D) => { sim.input(t); events.push({ f: sim.frame, t }); };

  const half = course.halfWidth - 0.6;
  const lanes = [-4.4, -2.4, 0, 2.4, 4.4].filter((x) => Math.abs(x) <= half);

  const floorAt = (x: number, z: number) =>
    course.floors.some(
      (f) => Math.abs(x - f.x) <= f.w / 2 + 0.05 && z >= f.z - f.d / 2 && z <= f.z + f.d / 2,
    );

  while (!sim.finished && sim.frame < MAX_RUN_FRAMES_3D) {
    const p = sim.getPlayer();
    if (p.grounded) {
      // Gap directly ahead in the current lane -> jump before the edge.
      if (floorAt(p.x, p.z + 0.6) && !floorAt(p.x, p.z + 3.4)) {
        rec('J');
      } else {
        // Score each reachable lane by how "unsafe" it is: obstacles within the
        // lookahead penalise a lane in proportion to how SOON we'd reach them
        // (closer = worse). This makes the bot dodge the IMMINENT obstacle even
        // when a later, staggered one also conflicts — instead of freezing at
        // centre (which killed it on chicanes). A lane with no floor is out.
        const margin = 0.62; // ~player radius
        const score = (x: number): number => {
          if (!floorAt(x, p.z + 3.2) || !floorAt(x, p.z + 5)) return Infinity;
          let penalty = 0;
          for (const o of course.obstacles) {
            const dz = o.z - p.z;
            if (dz <= 0.4 || dz > 8) continue;
            for (const df of [3, 8, 13]) {
              const b = obstacleAABB(o, sim.frame + df);
              if (x > b.minX - margin && x < b.maxX + margin) {
                penalty += 10 / dz; // the nearer the obstacle, the worse
                break;
              }
            }
          }
          return penalty;
        };
        let best = 0;
        let bestScore = Infinity;
        for (const x of lanes) {
          const s = score(x) + Math.abs(x - p.x) * 0.05 + Math.abs(x) * 0.02;
          if (s < bestScore) { bestScore = s; best = x; }
        }
        if (best > p.x + 0.35) rec('R');
        else if (best < p.x - 0.35) rec('L');
      }
    }
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
