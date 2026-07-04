import { tx } from '../db.js';
import { previousDay, toDateString, todayString } from '../utils/dates.js';

export interface StreakState {
  streakCount: number;
  streakActiveDate: string | null;
  allPlayed: boolean;
}

/**
 * Advance a league's shared streak (spec §3/§5 M5). The streak ticks up once
 * ALL members have a finished run on the league's course for `playDate`.
 *
 * Rules:
 *  - If not everyone has played yet: no change.
 *  - If everyone has played and the streak is already marked for today: no-op.
 *  - Otherwise: if the streak was active yesterday (or never), increment;
 *    if there was a gap, reset to 1. Then mark today active.
 *
 * Runs in a transaction with a row lock so concurrent submits don't double-tick.
 */
export async function updateLeagueStreak(
  leagueId: string,
  playDateInput: string | Date,
): Promise<StreakState> {
  // pg returns `date` columns as Date objects; normalise to YYYY-MM-DD so the
  // string comparisons and date arithmetic below are correct.
  const playDate = toDateString(playDateInput) ?? todayString();
  return tx(async (client) => {
    // Lock the league row for the duration of the update.
    const leagueRes = await client.query<{
      streak_count: number;
      streak_active_date: unknown;
    }>(
      `select streak_count, streak_active_date from leagues where id = $1 for update`,
      [leagueId],
    );
    const league = leagueRes.rows[0];
    if (!league) {
      return { streakCount: 0, streakActiveDate: null, allPlayed: false };
    }

    const currentCount = league.streak_count;
    const activeDate = toDateString(league.streak_active_date);

    // Member count for this league.
    const memberRes = await client.query<{ n: string }>(
      `select count(*)::int as n from league_members where league_id = $1`,
      [leagueId],
    );
    const memberCount = Number(memberRes.rows[0]?.n ?? 0);

    // Distinct members with a finished run on the league's course for today.
    const playedRes = await client.query<{ n: string }>(
      `select count(distinct r.user_id)::int as n
         from runs r
         join daily_courses c on c.id = r.course_id
        where c.league_id = $1
          and c.play_date = $2
          and r.finished = true
          and r.user_id in (select user_id from league_members where league_id = $1)`,
      [leagueId, playDate],
    );
    const playedCount = Number(playedRes.rows[0]?.n ?? 0);

    const allPlayed = memberCount > 0 && playedCount >= memberCount;

    // Already counted for today, or not everyone in yet.
    if (!allPlayed || activeDate === playDate) {
      return { streakCount: currentCount, streakActiveDate: activeDate, allPlayed };
    }

    const yesterday = previousDay(playDate);
    const nextCount = activeDate == null || activeDate === yesterday ? currentCount + 1 : 1;

    await client.query(
      `update leagues set streak_count = $1, streak_active_date = $2 where id = $3`,
      [nextCount, playDate, leagueId],
    );

    return { streakCount: nextCount, streakActiveDate: playDate, allPlayed: true };
  });
}
