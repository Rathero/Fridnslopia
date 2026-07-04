import type { Course3D, PlacedTrap3D, SimResult3D } from '@trampa/shared';
import { query } from '../db.js';

/** Notification categories emitted by the backend (spec §3 / M5). */
export type NotificationType = 'overtaken' | 'trap_hit' | 'streak';

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

/**
 * Best-effort notification insert. Wrapped so a notification failure can never
 * break the request that triggered it.
 */
export async function notify(
  userId: string,
  type: NotificationType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await query(
      `insert into notifications (user_id, type, payload) values ($1, $2, $3)`,
      [userId, type, JSON.stringify(payload)],
    );
  } catch (err) {
    console.warn('[notify] failed (ignored)', err);
  }
}

/** Fetch a user's notifications, newest first. */
export async function getNotifications(userId: string): Promise<NotificationRow[]> {
  const { rows } = await query<NotificationRow>(
    `select * from notifications where user_id = $1 order by created_at desc limit 100`,
    [userId],
  );
  return rows;
}

/** Small tolerance when matching a recorded hit back to a placed trap slot. */
const SLOT_EPS = 0.05;

/**
 * Exact trap-hit accounting. The deterministic re-sim records precisely which
 * traps caught the runner (a trap the runner dashed/jumped past does NOT count
 * — that's the skill-check). We credit each caught trap once and notify its
 * owner. Best-effort — never throws.
 */
export async function processTrapHits(
  course: Course3D,
  sim: SimResult3D,
  runnerUserId: string,
  placedTraps: PlacedTrap3D[],
): Promise<void> {
  try {
    if (!sim.trapHits?.length) return;

    for (const hit of sim.trapHits) {
      const trap = placedTraps.find(
        (t) => Math.abs(t.slotX - hit.slotX) < SLOT_EPS && Math.abs(t.slotZ - hit.slotZ) < SLOT_EPS,
      );
      if (!trap || !trap.userId || trap.userId === runnerUserId) continue; // not your own trap

      const { rows } = await query<{ hits: number }>(
        `update traps set hits = hits + 1
          where course_id = $1 and user_id = $2 and slot_x = $3 and slot_y = $4
          returning hits`,
        [courseIdOf(course), trap.userId, trap.slotX, trap.slotZ],
      );
      const hits = rows[0]?.hits ?? undefined;
      await notify(trap.userId, 'trap_hit', {
        courseSeed: course.seed,
        slotX: trap.slotX,
        slotZ: trap.slotZ,
        trapType: trap.trapType,
        byUserId: runnerUserId,
        totalHits: hits,
      });
    }
  } catch (err) {
    console.warn('[trapHits] failed (ignored)', err);
  }
}

/**
 * Notify everyone the runner just leapfrogged on the leaderboard. A user is
 * "overtaken" if their best finished time now sits between the runner's new
 * time and the runner's *previous* best (i.e. the runner passed them).
 * Best-effort — never throws.
 */
export async function processOvertakes(
  courseId: string,
  runnerUserId: string,
  newTimeMs: number,
  previousBestMs: number | null,
): Promise<void> {
  try {
    // When the runner had no previous best, everyone slower than the new time
    // was overtaken — no upper bound. Otherwise bound by the old best. Avoid a
    // JS sentinel here: time_ms is an int4 column and MAX_SAFE_INTEGER overflows it.
    const { rows } = await query<{ user_id: string }>(
      `select r.user_id, min(r.time_ms) as best
         from runs r
        where r.course_id = $1
          and r.finished = true
          and r.user_id <> $2
        group by r.user_id
        having min(r.time_ms) > $3
           and ($4::int is null or min(r.time_ms) <= $4::int)`,
      [courseId, runnerUserId, newTimeMs, previousBestMs],
    );
    for (const row of rows) {
      await notify(row.user_id, 'overtaken', {
        courseId,
        byUserId: runnerUserId,
        newTimeMs,
      });
    }
  } catch (err) {
    console.warn('[overtakes] failed (ignored)', err);
  }
}

/**
 * The Course carries a numeric seed, not the DB row id, so trap-hit updates
 * need the course id passed in. We stash it via a WeakMap keyed by course.
 */
const courseIdMap = new WeakMap<Course3D, string>();
export function tagCourseId(course: Course3D, courseId: string): void {
  courseIdMap.set(course, courseId);
}
function courseIdOf(course: Course3D): string {
  const id = courseIdMap.get(course);
  if (!id) throw new Error('course id not tagged; call tagCourseId first');
  return id;
}
