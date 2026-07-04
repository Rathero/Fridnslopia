import type { Course, PlacedTrap } from './course.js';
import { PHYSICS, applyModifier, type DailyModifier } from './constants.js';
import {
  computeReachEnvelope,
  maxHorizontalReach,
  type ReachEnvelope,
} from './reach.js';
import type { Rect } from './chunks/types.js';

/** A walkable surface = the top line of a platform. */
interface Surface {
  x0: number;
  x1: number;
  y: number;
}

function surfaces(course: Course): Surface[] {
  return course.platforms
    .map((p: Rect) => ({ x0: p.x, x1: p.x + p.w, y: p.y }))
    .sort((a, b) => a.x0 - b.x0);
}

/**
 * Can the runner get from surface A to surface B moving left->right?
 * Uses the reach envelope. y grows downward, so "higher" means smaller y.
 */
function reachable(a: Surface, b: Surface, env: ReachEnvelope): boolean {
  // Ignore surfaces fully behind us.
  if (b.x1 <= a.x0) return false;
  const dyUp = a.y - b.y; // >0 means B is higher than A

  // Horizontal overlap (adjacent/stacked): just need to be within climb range.
  const overlap = b.x0 <= a.x1 + 1e-6 && b.x1 >= a.x0 - 1e-6;
  if (overlap) {
    return dyUp <= env.maxJumpHeight + 1e-6; // can always drop down
  }

  const gap = b.x0 - a.x1; // horizontal gap from A's right edge to B's left edge
  if (gap < 0) return dyUp <= env.maxJumpHeight + 1e-6;
  return gap <= maxHorizontalReach(env, dyUp) + 1e-6;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Completability check (spec §4.3). BFS over walkable surfaces from the one
 * beneath the start to any surface covering the finish line. Because all
 * library chunks share entryY==exitY and are individually authored to be
 * completable, this mostly catches (a) a broken boundary or (b) an assembly
 * that produced an unreachable stretch. Cheap and deterministic.
 */
export function verifyCourse(course: Course): VerifyResult {
  const physics = applyModifier(course.modifier as DailyModifier);
  const env = computeReachEnvelope(physics);
  const surfs = surfaces(course);
  if (surfs.length === 0) return { ok: false, reason: 'no surfaces' };

  // Start surface: the one under startX.
  const startIdx = surfs.findIndex(
    (s) => s.x0 <= course.startX && course.startX <= s.x1,
  );
  if (startIdx < 0) return { ok: false, reason: 'no floor under start' };

  const visited = new Set<number>([startIdx]);
  const queue = [startIdx];
  let reachedFinish = false;

  while (queue.length > 0) {
    const i = queue.shift()!;
    const cur = surfs[i];
    if (cur.x1 >= course.finishX - 1e-6) {
      reachedFinish = true;
      break;
    }
    for (let j = 0; j < surfs.length; j++) {
      if (visited.has(j)) continue;
      if (reachable(cur, surfs[j], env)) {
        visited.add(j);
        queue.push(j);
      }
    }
  }

  if (!reachedFinish) {
    return { ok: false, reason: 'finish not reachable from start' };
  }
  return { ok: true };
}

/**
 * Validate a proposed trap placement (spec §4.3 traps). A trap is accepted only
 * if it targets a real, authored slot on the course. Authored slots are
 * pre-vetted safe positions, so a trap there can only cost time (respawn/slow),
 * never make the day impossible for the league. `existingTraps` enforces the
 * "1 trap per player" rule at the domain level.
 */
export function verifyTrapPlacement(
  course: Course,
  trap: { slotX: number; slotY: number; userId: string },
  existingTraps: PlacedTrap[],
): VerifyResult {
  const slotExists = course.trapSlots.some(
    (s) => s.x === trap.slotX && s.y === trap.slotY,
  );
  if (!slotExists) return { ok: false, reason: 'invalid trap slot' };

  if (existingTraps.some((t) => t.userId === trap.userId)) {
    return { ok: false, reason: 'player already placed a trap' };
  }
  return { ok: true };
}

export { PHYSICS };
