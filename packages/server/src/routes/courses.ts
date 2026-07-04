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
import { buildShareCard } from '../services/shareService.js';

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

    // A stale/unknown league would FK-violate on course insert (500). Fail clean
    // so the client can drop the dead league id and prompt to create/join one.
    if (leagueId) {
      const { rows } = await query<{ id: string }>('select id from leagues where id = $1', [leagueId]);
      if (!rows[0]) throw notFound('league not found');
    }

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

/**
 * GET /courses/:id/saboteurs — the "Saboteur" ranking: who has caught the most
 * players in their traps. This is the second axis of competition (§ trap rework)
 * so sabotage is its own game with its own reward, not just a tax on the runner.
 */
coursesRouter.get(
  '/:id/saboteurs',
  asyncHandler(async (req, res) => {
    await assertCourseExists(req.params.id);
    const { rows } = await query<{ handle: string; hits: number; trap_type: string }>(
      `select u.handle, t.hits, t.trap_type
         from traps t join users u on u.id = t.user_id
        where t.course_id = $1 and t.hits > 0
        order by t.hits desc
        limit 20`,
      [req.params.id],
    );
    res.json(rows.map((r) => ({ handle: r.handle, hits: r.hits, trapType: r.trap_type })));
  }),
);

/**
 * GET /courses/:id/card.svg?handle= — a shareable result card (SVG). The viral
 * hook for the global daily: "he hecho Xs, ¿me superas?".
 */
coursesRouter.get(
  '/:id/card.svg',
  asyncHandler(async (req, res) => {
    const row = await assertCourseExists(req.params.id);
    const handle = typeof req.query.handle === 'string' ? req.query.handle : undefined;

    let timeMs: number | null = null;
    let rank: number | null = null;
    let players: number | null = null;
    if (handle) {
      const best = await query<{ best: number | null }>(
        `select min(r.time_ms) as best from runs r
           join users u on u.id = r.user_id
          where r.course_id = $1 and u.handle = $2 and r.finished = true`,
        [row.id, handle],
      );
      timeMs = best.rows[0]?.best ?? null;
      if (timeMs != null) {
        const agg = await query<{ better: string; total: string }>(
          `with bests as (
             select user_id, min(time_ms) as best from runs
              where course_id = $1 and finished = true group by user_id
           )
           select count(*) filter (where best < $2)::int as better,
                  count(*)::int as total from bests`,
          [row.id, timeMs],
        );
        rank = Number(agg.rows[0]?.better ?? 0) + 1;
        players = Number(agg.rows[0]?.total ?? 0);
      }
    }

    const svg = buildShareCard({
      config: row.config,
      playDate: String(row.play_date).slice(0, 10),
      handle,
      timeMs,
      rank,
      players,
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.send(svg);
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
