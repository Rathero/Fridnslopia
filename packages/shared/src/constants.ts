/**
 * Physics + world constants (spec §3.1). These are the "feel" knobs.
 *
 * Units: metres, seconds, m/s. 1 tile == 1 metre. Rendering multiplies by
 * PIXELS_PER_METRE. The simulation is unit-consistent and framerate
 * independent (fixed step).
 */

export const FIXED_DT = 1 / 60; // seconds per simulation step
export const FIXED_HZ = 60;

export const TILE = 1; // metres per tile
export const PIXELS_PER_METRE = 40; // render scale only — never used in sim

export interface PhysicsParams {
  gravity: number;
  runSpeed: number;
  jumpImpulse: number;
  chargeMax: number;
  chargeJumpImpulse: number;
  coyoteTime: number;
  airControl: number;
  respawnPenalty: number;
  playerRadius: number;
}

/** Movement / feel parameters — spec §3.1 arranque values. */
export const PHYSICS: PhysicsParams = {
  gravity: 30, // m/s^2 (exaggerated, arcade feel)
  runSpeed: 8, // m/s constant auto-run
  jumpImpulse: 12, // m/s applied on a short tap
  chargeMax: 0.5, // s to reach a full charged jump
  chargeJumpImpulse: 20, // m/s at full charge
  coyoteTime: 0.1, // s of forgiveness after leaving a ledge
  airControl: 0.3, // horizontal nudge factor while airborne (feel)
  respawnPenalty: 2.0, // s added to the clock on death
  playerRadius: 0.4, // m — the runner is a ball for deterministic collision
};

/** Daily modifiers — a CLOSED enum (spec §4.4) so the LLM can't inject junk. */
export const DAILY_MODIFIERS = [
  'none',
  'low_gravity',
  'speed_up',
  'slippery',
  'bouncy',
] as const;
export type DailyModifier = (typeof DAILY_MODIFIERS)[number];

/**
 * How a modifier tweaks the base physics. Applied deterministically before the
 * sim starts, so every league member gets the identical modified physics.
 */
export function applyModifier(modifier: DailyModifier): PhysicsParams {
  const p: PhysicsParams = { ...PHYSICS };
  switch (modifier) {
    case 'low_gravity':
      p.gravity = 18;
      break;
    case 'speed_up':
      p.runSpeed = 11;
      break;
    case 'slippery':
      p.airControl = 0.05;
      break;
    case 'bouncy':
      p.jumpImpulse = 15;
      p.chargeJumpImpulse = 24;
      break;
    case 'none':
    default:
      break;
  }
  return p;
}

/** Max frames a single run may last before we call it a DNF (safety cap). */
export const MAX_RUN_FRAMES = 60 * 180; // 3 minutes
