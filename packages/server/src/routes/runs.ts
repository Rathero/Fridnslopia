import { Router } from 'express';
import type { InputLog } from '@trampa/shared';
import { query } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../utils/http.js';
import { todayString } from '../utils/dates.js';
import { resolveUserId } from '../services/userService.js';
import {
  buildCourseFromRow,
  getPlacedTraps,
  type DailyCourseRow,
} from '../services/courseService.js';
import { verifyRun } from '../services/antiCheat.js';
import {
  processOvertakes,
  processTrapHits,
  tagCourseId,
} from '../services/notifications.js';
import { updateLeagueStreak } from '../services/streakService.js';

export const runsRouter = Router();

/**
 * POST /runs — submit a run.
 * Body: { courseId, userId? | handle?, timeMs, inputLog }
 * The server re-simulates the input log (anti-cheat), stores the authoritative
 * recomputed time, then updates trap hits, leaderboard overtakes, and — for a
 * league course — the shared streak.
 */
runsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { courseId, userId, handle, timeMs, inputLog } = req.body ?? {};

    if (!courseId || typeof courseId !== 'string') throw badRequest('courseId is required');
    if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) {
      throw badRequest('timeMs (number) is required');
    }
    if (!isInputLog(inputLog)) throw badRequest('inputLog { seed, events[] } is required');

    // Load the course + rebuild the exact playable geometry.
    const row = await getCourseRow(courseId);
    if (!row) throw notFound('course not found');
    const course = buildCourseFromRow(row);
    tagCourseId(course, row.id);

    const uid = await resolveUserId({ userId, handle });
    const placedTraps = await getPlacedTraps(row.id);

    // Anti-cheat: re-run the deterministic sim and validate the claimed time.
    const verdict = await verifyRun(course, inputLog, timeMs, placedTraps);
    if (!verdict.ok) {
      return res.status(400).json({ ok: false, reason: verdict.reason });
    }

    const recomputedTimeMs = verdict.recomputedTimeMs;

    // The runner's previous best (before this run) — used for overtake logic.
    const prevBest = await previousBest(row.id, uid);

    // Persist the run with the authoritative time + death count.
    await query(
      `insert into runs (course_id, user_id, time_ms, input_log, finished, deaths)
       values ($1, $2, $3, $4, true, $5)`,
      [row.id, uid, recomputedTimeMs, JSON.stringify(inputLog), verdict.sim.deaths],
    );

    // Best-effort side effects (never throw): traps, overtakes, streak.
    await processTrapHits(course, verdict.sim, uid, placedTraps);
    await processOvertakes(row.id, uid, recomputedTimeMs, prevBest);

    let streak: Awaited<ReturnType<typeof updateLeagueStreak>> | null = null;
    if (row.league_id) {
      try {
        streak = await updateLeagueStreak(row.league_id, row.play_date ?? todayString());
      } catch (err) {
        console.warn('[runs] streak update failed (ignored)', err);
      }
    }

    const rank = await currentRank(row.id, recomputedTimeMs);

    return res.status(201).json({
      ok: true,
      timeMs: recomputedTimeMs,
      deaths: verdict.sim.deaths,
      rank,
      streak,
    });
  }),
);

async function getCourseRow(courseId: string): Promise<DailyCourseRow | null> {
  const { rows } = await query<DailyCourseRow>(
    `select * from daily_courses where id = $1`,
    [courseId],
  );
  return rows[0] ?? null;
}

/** Runner's best finished time on this course before the new run, or null. */
async function previousBest(courseId: string, userId: string): Promise<number | null> {
  const { rows } = await query<{ best: number | null }>(
    `select min(time_ms) as best from runs
      where course_id = $1 and user_id = $2 and finished = true`,
    [courseId, userId],
  );
  return rows[0]?.best ?? null;
}

/** 1-based rank of `timeMs` among distinct users' best finished times. */
async function currentRank(courseId: string, timeMs: number): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `select count(*)::int as n from (
       select user_id, min(time_ms) as best from runs
        where course_id = $1 and finished = true
        group by user_id
     ) b where b.best < $2`,
    [courseId, timeMs],
  );
  return Number(rows[0]?.n ?? 0) + 1;
}

function isInputLog(v: unknown): v is InputLog {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as InputLog).seed === 'number' &&
    Array.isArray((v as InputLog).events)
  );
}
