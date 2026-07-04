import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

/**
 * Minimal forward-only migration runner. Applies every `*.sql` file in
 * src/migrations in filename order, tracking applied files in `_migrations`.
 * Each unapplied file runs inside its own transaction. Idempotent.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    create table if not exists _migrations (
      name        text primary key,
      applied_at  timestamptz not null default now()
    );
  `);
}

async function appliedNames(): Promise<Set<string>> {
  const { rows } = await pool.query<{ name: string }>('select name from _migrations');
  return new Set(rows.map((r) => r.name));
}

async function run(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedNames();

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] skip   ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('insert into _migrations (name) values ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] apply  ${file}`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error(`[migrate] FAILED ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(`[migrate] done. ${count} migration(s) applied, ${files.length} total.`);
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
