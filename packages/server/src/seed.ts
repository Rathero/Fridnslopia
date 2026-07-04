import { pool, query } from './db.js';
import { todayString } from './utils/dates.js';
import { getOrCreateTodayCourse } from './services/courseService.js';

/**
 * Idempotent demo seed: two users, one league with a known invite code, both as
 * members, and today's global + league courses generated. Safe to re-run.
 */

const INVITE_CODE = 'TRAMPA1';
const LEAGUE_NAME = 'Los Cabrones';

async function upsertUser(handle: string): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `insert into users (handle) values ($1)
     on conflict (handle) do update set handle = excluded.handle
     returning id`,
    [handle],
  );
  return rows[0].id;
}

async function seed(): Promise<void> {
  const rubenId = await upsertUser('ruben');
  const alexId = await upsertUser('alex');
  console.log(`[seed] users: ruben=${rubenId} alex=${alexId}`);

  // League with a fixed invite code, owned by ruben.
  const leagueRes = await query<{ id: string }>(
    `insert into leagues (name, invite_code, owner_id) values ($1, $2, $3)
     on conflict (invite_code) do update set name = excluded.name
     returning id`,
    [LEAGUE_NAME, INVITE_CODE, rubenId],
  );
  const leagueId = leagueRes.rows[0].id;
  console.log(`[seed] league '${LEAGUE_NAME}' id=${leagueId} invite=${INVITE_CODE}`);

  for (const userId of [rubenId, alexId]) {
    await query(
      `insert into league_members (league_id, user_id) values ($1, $2)
       on conflict do nothing`,
      [leagueId, userId],
    );
  }

  const playDate = todayString();
  const global = await getOrCreateTodayCourse(null, playDate);
  const leagueCourse = await getOrCreateTodayCourse(leagueId, playDate);
  console.log(
    `[seed] courses for ${playDate}: global=${global.id} (verified=${global.verified}), ` +
      `league=${leagueCourse.id} (verified=${leagueCourse.verified})`,
  );

  console.log('\n[seed] done.');
  console.log(`       invite code: ${INVITE_CODE}`);
  console.log(`       ruben: ${rubenId}`);
  console.log(`       alex:  ${alexId}`);
  console.log(`       league: ${leagueId}`);
}

seed()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
