import { MAX_RUN_FRAMES } from '../constants.js';
import type { Course, PlacedTrap } from '../course.js';
import { SimWorld, type InputLog, type InputEventType } from './world.js';

/**
 * A deterministic heuristic "bot" that drives a course to the finish, recording
 * the input log it produced. It is NOT the game AI — it exists so tests / CI can
 * generate a genuine finishing run (to exercise submit + server re-sim) without
 * a human, and it doubles as a stronger generate-and-test completability probe
 * than the analytic verifier.
 *
 * Strategy: auto-run; hop spike rows with a short charged jump; clear gaps with
 * a jump sized to the next platform (charged early so release fires at the
 * takeoff edge). Returns the finishing input log, or null if it could not
 * complete within the frame budget.
 */
export function autopilot(course: Course, placedTraps: PlacedTrap[] = []): {
  log: InputLog;
  finished: boolean;
  timeMs: number;
  deaths: number;
} {
  const world = new SimWorld(course, placedTraps);
  const P = world.physics;
  const g = P.gravity;
  const run = P.runSpeed;
  const ji = P.jumpImpulse;
  const cj = P.chargeJumpImpulse;

  const events: { f: number; t: InputEventType }[] = [];
  const rec = (t: InputEventType) => events.push({ f: world.frame, t });
  const press = () => (world.press(), rec('press'));
  const release = () => (world.release(), rec('release'));
  const tap = () => (world.tap(), rec('tap'));

  const holdFor = (v: number) =>
    Math.round(Math.max(0, Math.min(1, (v - ji) / (cj - ji))) * P.chargeMax * 60);

  const surfaces = course.platforms
    .map((p) => ({ x0: p.x, x1: p.x + p.w, y: p.y }))
    .sort((a, b) => a.x0 - b.x0);
  const spikes = course.hazards.filter((h) => h.type === 'spike');

  let releaseAt = -1;
  let planned = false;
  let lastHopFrame = -99;

  while (!world.finished && world.frame < MAX_RUN_FRAMES) {
    const p = world.getPlayer();
    if (releaseAt === world.frame) {
      release();
      planned = false;
    }

    if (p.grounded && !planned && releaseAt < world.frame) {
      const cur = surfaces
        .filter((s) => s.x0 - 0.2 <= p.x && p.x <= s.x1 + 0.2 && s.y >= p.y - 0.1)
        .sort((a, b) => a.y - b.y)[0];

      const planJumpTo = (dxEdge: number, reach: number, dyUp: number) => {
        let v = ((reach + 1.0) * g) / (2 * run);
        if (dyUp > 0) v = Math.max(v, Math.sqrt(2 * g * dyUp) * 1.5);
        v = Math.max(ji, Math.min(cj, v));
        const hold = holdFor(v);
        if (hold <= 1) {
          if (dxEdge < 0.6) tap();
          return;
        }
        const startPressX = p.x + dxEdge - 0.4 - (hold * run) / 60;
        if (p.x >= startPressX - 0.05) {
          press();
          releaseAt = world.frame + hold;
          planned = true;
        }
      };

      let spikeDx = Infinity;
      for (const s of spikes) {
        const dx = s.x - p.x;
        if (dx > 0.2 && dx < 5 && cur && Math.abs(s.y - cur.y) < 1.5) spikeDx = Math.min(spikeDx, dx);
      }

      // Next platform that continues/follows the current one (touching => no gap).
      const next = surfaces
        .filter((s) => cur && s.x1 > cur.x1 + 0.05 && s.x0 >= cur.x1 - 0.05)
        .sort((a, b) => a.x0 - b.x0)[0];
      const gap = next && cur ? Math.max(0, next.x0 - cur.x1) : Infinity;

      if (spikeDx < 3.0 && world.frame - lastHopFrame > 8) {
        press();
        releaseAt = world.frame + 10;
        planned = true;
        lastHopFrame = world.frame;
      } else if (cur && cur.x1 < course.finishX - 0.5 && next && gap > 0.2) {
        planJumpTo(cur.x1 - p.x, gap, cur.y - next.y);
      }
    }
    world.step();
  }

  const result = {
    log: { seed: course.seed, events },
    finished: world.finished,
    timeMs: world.timeMs(),
    deaths: world.deaths,
  };
  world.free();
  return result;
}
