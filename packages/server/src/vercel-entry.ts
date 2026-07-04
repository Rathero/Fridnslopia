import { app, ensureReady } from './app.js';

/**
 * Vercel serverless entrypoint. The Express `app` already lazy-inits Rapier via
 * middleware, but we also await it here so the WASM sim is ready before the
 * first request is dispatched. Vercel's Node runtime drives an Express app
 * directly from a default `(req, res)` export.
 */
export default async function handler(req: unknown, res: unknown): Promise<void> {
  await ensureReady();
  return (app as unknown as (req: unknown, res: unknown) => void)(req, res);
}
