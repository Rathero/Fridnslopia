import type { Course3D, PlacedTrap3D } from './course3d.js';
import { Sim3D, initRapier3D, type Input3D, type TrapHit3D } from './sim3d.js';

export const MAX_RUN_FRAMES_3D = 60 * 180; // 3 min safety cap

export interface InputEvent3D { f: number; t: Input3D }
export interface InputLog3D { seed: number; events: InputEvent3D[] }

export interface SimFrame3D { x: number; y: number; z: number; spin: number }
export interface SimResult3D {
  finished: boolean;
  timeMs: number;
  frames: SimFrame3D[];
  deaths: number;
  frameCount: number;
  nearMisses: number;
  trapHits: TrapHit3D[];
}

/**
 * Headless deterministic replay of a 3D input log — the engine behind ghosts
 * (client) and anti-cheat (server), identical to the 2D `simulateRun`. Same
 * course + log => identical result on any machine.
 */
export async function simulateRun3D(
  course: Course3D,
  log: InputLog3D,
  placedTraps: PlacedTrap3D[] = [],
  opts: { recordFrames?: boolean } = {},
): Promise<SimResult3D> {
  await initRapier3D();
  const sim = new Sim3D(course, placedTraps);
  const record = opts.recordFrames ?? true;
  const frames: SimFrame3D[] = [];

  const byFrame = new Map<number, Input3D[]>();
  for (const ev of log.events) {
    const arr = byFrame.get(ev.f) ?? [];
    arr.push(ev.t);
    byFrame.set(ev.f, arr);
  }

  let guard = 0;
  // Terminal death: stop as soon as the runner dies — such a run "did not
  // finish", so anti-cheat rejects it. A clean submitted run never dies.
  while (!sim.finished && !sim.dead && guard < MAX_RUN_FRAMES_3D) {
    const evs = byFrame.get(sim.frame);
    if (evs) for (const t of evs) sim.input(t);
    sim.step();
    if (record) {
      const p = sim.getPlayer();
      frames.push({ x: p.x, y: p.y, z: p.z, spin: p.spin });
    }
    guard++;
  }

  const result: SimResult3D = {
    finished: sim.finished,
    timeMs: sim.timeMs(),
    frames,
    deaths: sim.deaths,
    frameCount: sim.frame,
    nearMisses: sim.nearMisses,
    trapHits: sim.trapHits,
  };
  sim.free();
  return result;
}
