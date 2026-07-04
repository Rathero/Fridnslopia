import 'dotenv/config';

/**
 * Centralised, typed access to environment configuration. Defaults are chosen
 * so the server runs against the bundled docker-compose Postgres out of the box.
 */

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://trampa:trampa@localhost:5432/trampa';

export const PORT = Number(process.env.PORT ?? 8787);

/** Optional Anthropic key. When absent, the LLM layer falls back to defaults. */
export const LLM_API_KEY = process.env.ANTHROPIC_API_KEY || undefined;

/** Model used for the daily-config generation call. */
export const LLM_MODEL = process.env.LLM_MODEL ?? 'claude-sonnet-5';
