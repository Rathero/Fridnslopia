import { query } from '../db.js';
import { badRequest } from '../utils/http.js';

/** A minimal user row. */
export interface UserRow {
  id: string;
  handle: string;
  created_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Find a user by id. Returns null if missing. */
export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>('select * from users where id = $1', [id]);
  return rows[0] ?? null;
}

/** Find-or-create a user by handle (case-sensitive handle, unique). */
export async function findOrCreateUserByHandle(handle: string): Promise<UserRow> {
  const clean = handle.trim();
  if (!clean) throw badRequest('handle is required');
  // Upsert-and-return: on conflict we still get the existing row back.
  const { rows } = await query<UserRow>(
    `insert into users (handle) values ($1)
     on conflict (handle) do update set handle = excluded.handle
     returning *`,
    [clean],
  );
  return rows[0];
}

/**
 * Pragmatic identity resolver used across routes. Accepts either a concrete
 * `userId` (uuid) or a `handle` (creating the user if new). Returns the user id.
 */
export async function resolveUserId(input: {
  userId?: string | null;
  handle?: string | null;
}): Promise<string> {
  const { userId, handle } = input;
  if (userId && UUID_RE.test(userId)) {
    const user = await findUserById(userId);
    if (!user) throw badRequest(`unknown userId ${userId}`);
    return user.id;
  }
  if (handle && handle.trim()) {
    const user = await findOrCreateUserByHandle(handle);
    return user.id;
  }
  throw badRequest('either userId or handle is required');
}
