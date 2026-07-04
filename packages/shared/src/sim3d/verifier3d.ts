import { assembleCourse3D, type Course3D, type PlacedTrap3D } from './course3d.js';
import { autopilot3d } from './autopilot3d.js';
import { initRapier3D } from './sim3d.js';
import type { DailyConfig } from '../llm/schema.js';

export interface VerifyResult3D { ok: boolean; reason?: string }

/**
 * Completability check for a 3D course. Because the course is assembled from
 * authored chunks that each hand off a full-width floor at both seams and are
 * individually completable (auto-run + dodge + gap-jump), a course is
 * completable by construction — so this is a structural sanity check, matching
 * the 2D "good enough generator" philosophy (spec §4.4). A full reachability /
 * bot oracle can be layered later if needed.
 */
export function verifyCourse3D(course: Course3D): VerifyResult3D {
  if (!course.floors.length) return { ok: false, reason: 'no floors' };
  if (course.finishZ <= course.startZ) return { ok: false, reason: 'empty course' };
  return { ok: true };
}

/** Assemble + structurally verify a daily 3D course (always returns a course). */
export function generateVerifiedCourse3D(
  seed: number,
  config: DailyConfig,
): { course: Course3D; verified: boolean } {
  const course = assembleCourse3D(seed, config);
  return { course, verified: verifyCourse3D(course).ok };
}

/**
 * Generate a course that is actually COMPLETABLE, using the autopilot as the
 * oracle: re-sample the seed (deterministically) until a run finishes, so the
 * daily/room circuit is fair for the whole lobby. Returns the seed that was
 * finally used — the caller MUST store it so everyone rebuilds the same course.
 */
export async function generateVerifiedCourse3DAsync(
  seed: number,
  config: DailyConfig,
  maxAttempts = 10,
): Promise<{ course: Course3D; seed: number; verified: boolean }> {
  await initRapier3D();
  let s = seed >>> 0;
  for (let i = 0; i < maxAttempts; i++) {
    const course = assembleCourse3D(s, config);
    if (verifyCourse3D(course).ok && autopilot3d(course).finished) {
      return { course, seed: s, verified: true };
    }
    s = (s + 0x9e3779b1) >>> 0; // advance deterministically and retry
  }
  const course = assembleCourse3D(seed >>> 0, config);
  return { course, seed: seed >>> 0, verified: false };
}

/**
 * Validate a proposed 3D trap placement: the slot must be a real authored slot
 * (pre-vetted safe), and the player may only have one trap per course.
 */
export function verifyTrapPlacement3D(
  course: Course3D,
  trap: { slotX: number; slotZ: number; userId: string },
  existing: PlacedTrap3D[],
): VerifyResult3D {
  const slotExists = course.trapSlots.some(
    (s) => Math.abs(s.x - trap.slotX) < 0.01 && Math.abs(s.z - trap.slotZ) < 0.01,
  );
  if (!slotExists) return { ok: false, reason: 'invalid trap slot' };
  if (existing.some((t) => t.userId === trap.userId)) {
    return { ok: false, reason: 'player already placed a trap' };
  }
  return { ok: true };
}
