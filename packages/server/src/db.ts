import pg from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DATABASE_URL } from './env.js';

const { Pool } = pg;

// Managed Postgres (Supabase/Neon/etc.) requires TLS; local dev doesn't. Enable
// SSL for non-local hosts (or when PGSSL=require). In serverless keep the pool
// tiny so many warm instances don't exhaust the database's connection cap.
const isRemote =
  process.env.PGSSL === 'require' ||
  /sslmode=require|supabase|neon|amazonaws|render|railway/i.test(DATABASE_URL) ||
  !/localhost|127\.0\.0\.1/.test(DATABASE_URL);

/** Shared connection pool. One per process is the recommended pg pattern. */
export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PGPOOL_MAX ?? (process.env.VERCEL ? 2 : 10)),
  idleTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  // Idle client errors must not crash the process.
  console.error('[db] unexpected idle client error', err);
});

export type QueryParams = ReadonlyArray<unknown>;

/** Thin parameterised query helper. Always use $1,$2… placeholders. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: QueryParams = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

/**
 * Run `fn` inside a transaction. Commits on success, rolls back on any throw,
 * and always releases the client back to the pool.
 */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}
