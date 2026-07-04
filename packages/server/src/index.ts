import { initRapier } from '@trampa/shared';
import { PORT } from './env.js';
import { pool } from './db.js';
import { app } from './app.js';

/** Local / long-running server entrypoint (not used on serverless). */
async function main(): Promise<void> {
  // Rapier must be initialised before any anti-cheat re-simulation runs.
  await initRapier();

  const server = app.listen(PORT, () => {
    console.log(`[trampa] server listening on :${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[trampa] ${signal} received, shutting down`);
    server.close();
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[trampa] failed to start', err);
  process.exit(1);
});
