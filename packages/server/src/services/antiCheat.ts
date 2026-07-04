import {
  simulateRun,
  type Course,
  type InputLog,
  type PlacedTrap,
  type SimResult,
} from '@trampa/shared';

/** Tolerance (ms) allowed between the claimed and recomputed finish time. */
const TIME_TOLERANCE_MS = 150;

export interface VerifyRunResult {
  ok: boolean;
  recomputedTimeMs: number;
  finished: boolean;
  reason?: string;
  /** Full sim result (with deaths) so callers can drive trap-hit accounting. */
  sim: SimResult;
}

/**
 * Server-side anti-cheat (spec §6). Re-runs the exact deterministic simulation
 * with the submitted seed + input log against the same course and placed traps,
 * then checks that the run finished and that the recomputed time matches the
 * claimed time within tolerance. The authoritative time is the recomputed one.
 */
export async function verifyRun(
  course: Course,
  inputLog: InputLog,
  claimedTimeMs: number,
  placedTraps: PlacedTrap[] = [],
): Promise<VerifyRunResult> {
  const sim = await simulateRun(course, inputLog, placedTraps, { recordFrames: true });
  const recomputedTimeMs = sim.timeMs;

  if (!sim.finished) {
    return {
      ok: false,
      recomputedTimeMs,
      finished: false,
      reason: 'run did not finish in the re-simulation',
      sim,
    };
  }

  const delta = Math.abs(recomputedTimeMs - claimedTimeMs);
  if (delta > TIME_TOLERANCE_MS) {
    return {
      ok: false,
      recomputedTimeMs,
      finished: true,
      reason: `claimed time ${claimedTimeMs}ms differs from recomputed ${recomputedTimeMs}ms by ${delta}ms (tolerance ${TIME_TOLERANCE_MS}ms)`,
      sim,
    };
  }

  return { ok: true, recomputedTimeMs, finished: true, sim };
}
