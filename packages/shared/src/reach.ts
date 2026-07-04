import { PHYSICS } from './constants.js';

/**
 * The character's "reach envelope" (spec §4.3): derived analytically from the
 * physics constants so the verifier can decide, cheaply, whether one platform
 * can be reached from another. This is the MVP approach — no RL agent needed.
 */
export interface ReachEnvelope {
  /** Max upward height (tiles) a full-charge jump can climb. */
  maxJumpHeight: number;
  /** Max flat horizontal gap (tiles) clearable at run speed. */
  maxFlatGap: number;
  g: number;
  runSpeed: number;
  vMax: number;
}

export function computeReachEnvelope(
  physics: typeof PHYSICS = PHYSICS,
): ReachEnvelope {
  const g = physics.gravity;
  const v = physics.chargeJumpImpulse;
  const maxJumpHeight = (v * v) / (2 * g);
  const maxFlatGap = physics.runSpeed * ((2 * v) / g);
  return { maxJumpHeight, maxFlatGap, g, runSpeed: physics.runSpeed, vMax: v };
}

/**
 * Max horizontal distance (tiles) reachable to a landing whose top is `dyUp`
 * tiles HIGHER than the takeoff (negative dyUp = landing is lower). Conservative
 * ballistic approximation using the strongest jump.
 */
export function maxHorizontalReach(env: ReachEnvelope, dyUp: number): number {
  const { g, runSpeed, vMax, maxJumpHeight } = env;
  if (dyUp > maxJumpHeight + 1e-6) return -Infinity; // can't climb that high
  const tApex = vMax / g;
  if (dyUp >= 0) {
    // time up to apex + partial descent to the (higher) target
    const descentFrac = Math.sqrt(Math.max(0, 1 - dyUp / maxJumpHeight));
    return runSpeed * tApex * (1 + descentFrac);
  }
  // target is lower: full arc plus extra fall time
  const tFall = Math.sqrt((2 * -dyUp) / g);
  return runSpeed * (2 * tApex + tFall);
}
