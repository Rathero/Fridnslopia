import {
  assembleCourse3D,
  generateVerifiedCourse3DAsync,
  seedFromString,
  type Course3D,
  type DailyConfig,
  type PlacedTrap3D,
  type TrapType3D,
} from '@trampa/shared';
import { query } from '../db.js';
import { getDailyConfig } from './llmService.js';

/** A daily_courses row as returned by pg (daily_seed is a string BIGINT). */
export interface DailyCourseRow {
  id: string;
  league_id: string | null;
  play_date: string;
  daily_seed: string;
  config: DailyConfig;
  verified: boolean;
  created_at: string;
}

/**
 * Fetch (or lazily create + verify) the daily course for a league on a date.
 * Global course is represented by league_id = null. Same (league, date) always
 * yields the same seed, hence the same course for every member (fairness, §4.2).
 */
export async function getOrCreateTodayCourse(
  leagueId: string | null,
  playDate: string,
): Promise<DailyCourseRow> {
  const existing = await selectCourse(leagueId, playDate);
  if (existing) return existing;

  // Derive a stable seed from the league + date, then generate + verify.
  const baseSeed = seedFromString(`${leagueId ?? 'global'}:${playDate}`);
  const recentThemes = await recentThemesFor(leagueId, playDate);
  const config = await getDailyConfig({ date: playDate, recentThemes });
  // Re-sample deterministically until the course is provably completable, then
  // persist the seed actually used so everyone rebuilds the identical course.
  const { seed: dailySeed, verified } = await generateVerifiedCourse3DAsync(baseSeed, config);

  try {
    const { rows } = await query<DailyCourseRow>(
      `insert into daily_courses (league_id, play_date, daily_seed, config, verified)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [leagueId, playDate, dailySeed, config, verified],
    );
    return rows[0];
  } catch (err: unknown) {
    // Race: another request inserted the same (league, date) first. Re-select.
    if (isUniqueViolation(err)) {
      const row = await selectCourse(leagueId, playDate);
      if (row) return row;
    }
    throw err;
  }
}

/** Deterministically rebuild the playable 3D Course from a stored row. */
export function buildCourseFromRow(row: DailyCourseRow): Course3D {
  return assembleCourse3D(Number(row.daily_seed), row.config);
}

/**
 * All traps placed on a course, mapped to shared PlacedTrap (with owner handle).
 * `cap` bounds how many are materialised — for a huge streamer lobby we keep the
 * most *effective* traps (most hits) so the circuit stays fun rather than being
 * carpeted in hazards.
 */
export async function getPlacedTraps(
  courseId: string,
  cap?: number,
): Promise<PlacedTrap3D[]> {
  const { rows } = await query<{
    slot_x: number;
    slot_y: number;
    trap_type: string;
    user_id: string;
    handle: string;
  }>(
    `select t.slot_x, t.slot_y, t.trap_type, t.user_id, u.handle
       from traps t
       join users u on u.id = t.user_id
      where t.course_id = $1
      order by ${cap ? 't.hits desc, t.created_at asc' : 't.created_at asc'}
      ${cap ? 'limit ' + Math.max(1, Math.floor(cap)) : ''}`,
    [courseId],
  );
  return rows.map((r) => ({
    slotX: r.slot_x,
    slotZ: r.slot_y, // the slot_y column stores the Z lane-position in 3D
    trapType: r.trap_type as TrapType3D,
    userId: r.user_id,
    ownerHandle: r.handle,
  }));
}

/** Look up an existing course row (null league_id handled with `is not distinct`). */
async function selectCourse(
  leagueId: string | null,
  playDate: string,
): Promise<DailyCourseRow | null> {
  const { rows } = await query<DailyCourseRow>(
    `select * from daily_courses
      where league_id is not distinct from $1 and play_date = $2
      limit 1`,
    [leagueId, playDate],
  );
  return rows[0] ?? null;
}

/** Recent themes for this league/global, newest first, to avoid repetition. */
async function recentThemesFor(
  leagueId: string | null,
  beforeDate: string,
): Promise<string[]> {
  const { rows } = await query<{ theme: string }>(
    `select config->>'theme' as theme
       from daily_courses
      where league_id is not distinct from $1 and play_date < $2
      order by play_date desc
      limit 5`,
    [leagueId, beforeDate],
  );
  return rows.map((r) => r.theme).filter((t): t is string => Boolean(t));
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
