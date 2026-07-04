import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, notFound } from '../utils/http.js';
import { todayString } from '../utils/dates.js';
import {
  buildCourseFromRow,
  getOrCreateTodayCourse,
  getPlacedTraps,
  type DailyCourseRow,
} from '../services/courseService.js';

export const coursesRouter = Router();

/**
 * GET /courses/today?leagueId=
 * Returns today's course (generated + verified on-demand), placed traps, and
 * the seed/config so the client can assemble the exact same course locally.
 */
coursesRouter.get(
  '/today',
  asyncHandler(async (req, res) => {
    const leagueId = normaliseLeagueId(req.query.leagueId);
    const playDate = todayString();

    const row = await getOrCreateTodayCourse(leagueId, playDate);
    const course = buildCourseFromRow(row);
    const traps = await getPlacedTraps(row.id);

    res.json({
      courseId: row.id,
      dailySeed: Number(row.daily_seed),
      config: row.config,
      course,
      traps,
      verified: row.verified,
      playDate: row.play_date,
    });
  }),
);

/**
 * GET /courses/:id/leaderboard
 * Finished runs ordered by time, one best row per user, with handles.
 */
coursesRouter.get(
  '/:id/leaderboard',
  asyncHandler(async (req, res) => {
    const courseId = req.params.id;
    await assertCourseExists(courseId);

    const { rows } = await query<{
      handle: string;
      time_ms: number;
      deaths: number;
      created_at: string;
    }>(
      // Best (min time) finished run per user, then ordered ascending.
      `select distinct on (r.user_id) u.handle, r.time_ms, r.deaths, r.created_at
         from runs r
         join users u on u.id = r.user_id
        where r.course_id = $1 and r.finished = true
        order by r.user_id, r.time_ms asc`,
      [courseId],
    );

    const leaderboard = rows
      .map((r) => ({
        handle: r.handle,
        timeMs: r.time_ms,
        deaths: r.deaths,
        createdAt: r.created_at,
      }))
      .sort((a, b) => a.timeMs - b.timeMs)
      .map((r, i) => ({ rank: i + 1, ...r }));

    res.json(leaderboard);
  }),
);

/**
 * GET /courses/:id/ghosts?excludeUserId=
 * Best finished runs' input logs for client-side ghost re-simulation.
 */
coursesRouter.get(
  '/:id/ghosts',
  asyncHandler(async (req, res) => {
    const courseId = req.params.id;
    await assertCourseExists(courseId);
    const excludeUserId =
      typeof req.query.excludeUserId === 'string' ? req.query.excludeUserId : null;
    // The client identifies players by handle, so support excludeHandle too.
    const excludeHandle =
      typeof req.query.excludeHandle === 'string' ? req.query.excludeHandle : null;

    const { rows } = await query<{
      handle: string;
      time_ms: number;
      input_log: unknown;
    }>(
      `select distinct on (r.user_id) u.handle, r.time_ms, r.input_log
         from runs r
         join users u on u.id = r.user_id
        where r.course_id = $1
          and r.finished = true
          and ($2::uuid is null or r.user_id <> $2)
          and ($3::text is null or u.handle <> $3)
        order by r.user_id, r.time_ms asc`,
      [courseId, excludeUserId, excludeHandle],
    );

    const ghosts = rows
      .map((r) => ({ handle: r.handle, timeMs: r.time_ms, inputLog: r.input_log }))
      .sort((a, b) => a.timeMs - b.timeMs)
      .slice(0, 5);

    res.json(ghosts);
  }),
);

/** GET /courses/:id/traps — placed traps for a course (convenience). */
coursesRouter.get(
  '/:id/traps',
  asyncHandler(async (req, res) => {
    await assertCourseExists(req.params.id);
    res.json(await getPlacedTraps(req.params.id));
  }),
);

function normaliseLeagueId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'global' || trimmed === 'null') return null;
  return trimmed;
}

async function assertCourseExists(courseId: string): Promise<DailyCourseRow> {
  const { rows } = await query<DailyCourseRow>(
    `select * from daily_courses where id = $1`,
    [courseId],
  );
  if (!rows[0]) throw notFound('course not found');
  return rows[0];
}
