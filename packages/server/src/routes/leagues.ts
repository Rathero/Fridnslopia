import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../utils/http.js';
import { todayString, toDateString } from '../utils/dates.js';
import { findOrCreateUserByHandle } from '../services/userService.js';

export const leaguesRouter = Router();

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

/** Generate a random uppercase alphanumeric invite code (default 7 chars). */
function generateInviteCode(len = 7): string {
  let out = '';
  for (let i = 0; i < len; i++) out += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return out;
}

interface LeagueRow {
  id: string;
  name: string;
  invite_code: string;
  owner_id: string;
  streak_count: number;
  streak_active_date: unknown;
  created_at: string;
}

/** POST /leagues — create a league; owner is resolved by handle. */
leaguesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, ownerHandle } = req.body ?? {};
    if (!name || typeof name !== 'string') throw badRequest('name is required');
    if (!ownerHandle || typeof ownerHandle !== 'string') {
      throw badRequest('ownerHandle is required');
    }

    const owner = await findOrCreateUserByHandle(ownerHandle);

    // Insert the league with a unique invite code, retrying on the rare clash.
    let league: LeagueRow | undefined;
    for (let attempt = 0; attempt < 5 && !league; attempt++) {
      const code = generateInviteCode();
      try {
        const { rows } = await query<LeagueRow>(
          `insert into leagues (name, invite_code, owner_id)
           values ($1, $2, $3) returning *`,
          [name.trim(), code, owner.id],
        );
        league = rows[0];
      } catch (err: unknown) {
        if (isUniqueViolation(err)) continue; // code collision, retry
        throw err;
      }
    }
    if (!league) throw badRequest('could not allocate a unique invite code');

    // Owner is automatically a member.
    await query(
      `insert into league_members (league_id, user_id) values ($1, $2)
       on conflict do nothing`,
      [league.id, owner.id],
    );

    res.status(201).json({
      id: league.id,
      name: league.name,
      inviteCode: league.invite_code,
      ownerId: league.owner_id,
      streakCount: league.streak_count,
      streakActiveDate: toDateString(league.streak_active_date),
      userId: owner.id,
    });
  }),
);

/** POST /leagues/join — join by invite code; user resolved/created by handle. */
leaguesRouter.post(
  '/join',
  asyncHandler(async (req, res) => {
    const { invite_code, handle } = req.body ?? {};
    if (!invite_code || typeof invite_code !== 'string') {
      throw badRequest('invite_code is required');
    }
    if (!handle || typeof handle !== 'string') throw badRequest('handle is required');

    const { rows } = await query<LeagueRow>(
      `select * from leagues where invite_code = $1`,
      [invite_code.trim().toUpperCase()],
    );
    const league = rows[0];
    if (!league) throw notFound('league not found for invite code');

    const user = await findOrCreateUserByHandle(handle);
    await query(
      `insert into league_members (league_id, user_id) values ($1, $2)
       on conflict do nothing`,
      [league.id, user.id],
    );

    res.json({ ...(await leagueState(league)), userId: user.id });
  }),
);

/** GET /leagues/:id — members, streak, and today's play date. */
leaguesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query<LeagueRow>(`select * from leagues where id = $1`, [
      req.params.id,
    ]);
    const league = rows[0];
    if (!league) throw notFound('league not found');
    res.json(await leagueState(league));
  }),
);

/** Assemble the public league-state payload. */
async function leagueState(league: LeagueRow) {
  const members = await query<{ id: string; handle: string; joined_at: string }>(
    `select u.id, u.handle, m.joined_at
       from league_members m join users u on u.id = m.user_id
      where m.league_id = $1
      order by m.joined_at asc`,
    [league.id],
  );
  return {
    id: league.id,
    name: league.name,
    inviteCode: league.invite_code,
    ownerId: league.owner_id,
    streakCount: league.streak_count,
    streakActiveDate: toDateString(league.streak_active_date),
    playDate: todayString(),
    members: members.rows.map((m) => ({
      id: m.id,
      handle: m.handle,
      joinedAt: m.joined_at,
    })),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
