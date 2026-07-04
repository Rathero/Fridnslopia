import { MAX_RUN_FRAMES } from '../constants.js';
import type { Course, PlacedTrap } from '../course.js';
import { SimWorld, initRapier, type InputLog } from './world.js';

export interface SimFrame {
  x: number;
  y: number;
  spin: number;
}

export interface SimResult {
  finished: boolean;
  timeMs: number;
  frames: SimFrame[];
  deaths: number;
  frameCount: number;
}

/**
 * Headless deterministic replay of an input log against a course. This is the
 * shared engine behind two things:
 *   - Ghosts (client): the returned `frames` are rendered as a translucent runner.
 *   - Anti-cheat (server): compare `timeMs` against the submitted time (spec §6).
 *
 * Because it drives the exact same SimWorld as live play, the same input log
 * always yields the identical result on any machine.
 */
export async function simulateRun(
  course: Course,
  inputLog: InputLog,
  placedTraps: PlacedTrap[] = [],
  opts: { recordFrames?: boolean } = {},
): Promise<SimResult> {
  await initRapier();
  const world = new SimWorld(course, placedTraps);
  const recordFrames = opts.recordFrames ?? true;
  const frames: SimFrame[] = [];

  // Index events by frame for O(1) lookup.
  const byFrame = new Map<number, typeof inputLog.events>();
  for (const ev of inputLog.events) {
    const arr = byFrame.get(ev.f) ?? [];
    arr.push(ev);
    byFrame.set(ev.f, arr);
  }

  let guard = 0;
  while (!world.finished && guard < MAX_RUN_FRAMES) {
    const evs = byFrame.get(world.frame);
    if (evs) {
      for (const ev of evs) {
        if (ev.t === 'press') world.press();
        else if (ev.t === 'release') world.release();
        else if (ev.t === 'tap') world.tap();
      }
    }
    world.step();
    if (recordFrames) {
      const p = world.getPlayer();
      frames.push({ x: p.x, y: p.y, spin: p.spin });
    }
    guard++;
  }

  const result: SimResult = {
    finished: world.finished,
    timeMs: world.timeMs(),
    frames,
    deaths: world.deaths,
    frameCount: world.frame,
  };
  world.free();
  return result;
}
