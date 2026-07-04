// ---- Deterministic core ----
export { Rng, seedFromString } from './prng.js';
export * from './constants.js';

// ---- Chunks / course ----
export * from './chunks/types.js';
export { CHUNKS, CHUNKS_BY_ID } from './chunks/library.js';
export * from './course.js';
export { assembleCourse } from './assembler.js';

// ---- Verification ----
export { computeReachEnvelope, maxHorizontalReach } from './reach.js';
export type { ReachEnvelope } from './reach.js';
export { verifyCourse, verifyTrapPlacement } from './verifier.js';
export type { VerifyResult } from './verifier.js';

// ---- Simulation ----
export {
  SimWorld,
  initRapier,
} from './sim/world.js';
export type {
  InputLog,
  InputEvent,
  InputEventType,
  PlayerState,
} from './sim/world.js';
export { simulateRun } from './sim/simulate.js';
export type { SimResult, SimFrame } from './sim/simulate.js';
export { autopilot } from './sim/autopilot.js';

// ---- LLM config ----
export {
  DailyConfigSchema,
  defaultConfig,
  parseDailyConfig,
} from './llm/schema.js';
export type { DailyConfig } from './llm/schema.js';
export { buildDailyConfigPrompt } from './llm/prompt.js';

// ---- Convenience: full generate + verify pipeline ----
import { assembleCourse } from './assembler.js';
import { verifyCourse } from './verifier.js';
import type { DailyConfig } from './llm/schema.js';
import type { Course } from './course.js';

/**
 * Generate a course for a seed+config and verify completability. If the first
 * assembly fails verification, re-sample with an advanced seed a few times
 * (spec §4.3). Guaranteed to return a course; `verified` says whether the
 * returned one passed. The daily course must be fair for the whole league.
 */
export function generateVerifiedCourse(
  dailySeed: number,
  config: DailyConfig,
  maxAttempts = 6,
): { course: Course; verified: boolean } {
  let seed = dailySeed >>> 0;
  let last: Course = assembleCourse(seed, config);
  for (let i = 0; i < maxAttempts; i++) {
    const course = assembleCourse(seed, config);
    const res = verifyCourse(course);
    if (res.ok) return { course, verified: true };
    last = course;
    seed = (seed + 0x9e3779b1) >>> 0; // advance deterministically and retry
  }
  return { course: last, verified: false };
}
