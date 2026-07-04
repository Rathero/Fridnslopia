import { randomInt } from 'node:crypto';
import {
  generateVerifiedCourse3DAsync,
  seedFromString,
  type DailyConfig,
} from '@trampa/shared';
import { query } from '../db.js';
import { getDailyConfig } from './llmService.js';
import { todayString } from '../utils/dates.js';
import type { DailyCourseRow } from './courseService.js';

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  host_id: string;
  num_courses: number;
  status: string;
  created_at: string;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function makeCode(len = 5): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** Create a room (open, no player cap) and add the host as first member. */
export async function createRoom(
  hostId: string,
  name: string,
  numCourses: number,
): Promise<RoomRow> {
  const n = Math.max(1, Math.min(20, Math.floor(numCourses) || 5));
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = makeCode();
    try {
      const { rows } = await query<RoomRow>(
        `insert into rooms (code, name, host_id, num_courses)
         values ($1, $2, $3, $4) returning *`,
        [code, name.trim().slice(0, 40) || 'Sala', hostId, n],
      );
      await query(
        `insert into room_members (room_id, user_id) values ($1, $2)
         on conflict do nothing`,
        [rows[0].id, hostId],
      );
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error('could not allocate a unique room code');
}

export async function findRoomByCode(code: string): Promise<RoomRow | null> {
  const { rows } = await query<RoomRow>(`select * from rooms where code = $1`, [
    code.trim().toUpperCase(),
  ]);
  return rows[0] ?? null;
}

export async function getRoomById(id: string): Promise<RoomRow | null> {
  const { rows } = await query<RoomRow>(`select * from rooms where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function joinRoom(roomId: string, userId: string): Promise<void> {
  await query(
    `insert into room_members (room_id, user_id) values ($1, $2) on conflict do nothing`,
    [roomId, userId],
  );
}

/**
 * Fetch (or lazily create + verify) circuit `idx` of a room's session. Seed is
 * derived from the room id + idx, so every viewer in the room runs the exact
 * same circuit (fairness) — the async model scales to unlimited players.
 */
export async function getOrCreateRoomCourse(
  room: RoomRow,
  idx: number,
): Promise<DailyCourseRow> {
  const existing = await selectRoomCourse(room.id, idx);
  if (existing) return existing;

  const baseSeed = seedFromString(`room:${room.id}:${idx}`);
  const config: DailyConfig = await getDailyConfig({ date: `${room.code}-${idx}`, recentThemes: [] });
  const { seed: dailySeed, verified } = await generateVerifiedCourse3DAsync(baseSeed, config);

  try {
    const { rows } = await query<DailyCourseRow>(
      `insert into daily_courses (league_id, room_id, idx, play_date, daily_seed, config, verified)
       values (null, $1, $2, $3, $4, $5, $6) returning *`,
      [room.id, idx, todayString(), dailySeed, config, verified],
    );
    return rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) {
      const row = await selectRoomCourse(room.id, idx);
      if (row) return row;
    }
    throw err;
  }
}

async function selectRoomCourse(roomId: string, idx: number): Promise<DailyCourseRow | null> {
  const { rows } = await query<DailyCourseRow>(
    `select * from daily_courses where room_id = $1 and idx = $2 limit 1`,
    [roomId, idx],
  );
  return rows[0] ?? null;
}

export interface StandingEntry {
  userId: string;
  handle: string;
  points: number;
  played: number;
  bestRank: number | null;
}

/**
 * Tournament points for a finishing rank. Top places get a fixed premium; the
 * rest scale by percentile so scoring stays meaningful whether 4 friends or
 * 4000 viewers are racing.
 */
export function pointsFor(rank: number, participants: number): number {
  const premium = [25, 18, 15, 12, 10, 8, 6, 5, 4, 3];
  if (rank <= premium.length) return premium[rank - 1];
  const pct = (participants - rank + 1) / Math.max(1, participants);
  return Math.max(1, Math.round(2 + 8 * pct));
}

/** Cumulative standings across all of the room's circuits, best-time per user. */
export async function roomStandings(roomId: string): Promise<StandingEntry[]> {
  const { rows } = await query<{
    user_id: string;
    handle: string;
    idx: number;
    rnk: string;
    participants: string;
  }>(
    `with course_best as (
       select dc.idx, r.user_id, min(r.time_ms) as best
         from daily_courses dc
         join runs r on r.course_id = dc.id
        where dc.room_id = $1 and r.finished = true
        group by dc.idx, r.user_id
     ),
     ranked as (
       select idx, user_id, best,
              rank() over (partition by idx order by best asc) as rnk,
              count(*) over (partition by idx) as participants
         from course_best
     )
     select rk.idx, rk.user_id, u.handle, rk.rnk, rk.participants
       from ranked rk join users u on u.id = rk.user_id`,
    [roomId],
  );

  const byUser = new Map<string, StandingEntry>();
  for (const r of rows) {
    const rank = Number(r.rnk);
    const participants = Number(r.participants);
    const pts = pointsFor(rank, participants);
    const cur =
      byUser.get(r.user_id) ??
      { userId: r.user_id, handle: r.handle, points: 0, played: 0, bestRank: null };
    cur.points += pts;
    cur.played += 1;
    cur.bestRank = cur.bestRank == null ? rank : Math.min(cur.bestRank, rank);
    byUser.set(r.user_id, cur);
  }
  return [...byUser.values()].sort((a, b) => b.points - a.points || a.bestRank! - b.bestRank!);
}

export async function roomMembers(roomId: string): Promise<{ id: string; handle: string }[]> {
  const { rows } = await query<{ id: string; handle: string }>(
    `select u.id, u.handle from room_members m join users u on u.id = m.user_id
      where m.room_id = $1 order by m.joined_at asc`,
    [roomId],
  );
  return rows;
}
