import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { initRapier } from '@trampa/shared';
import { PORT } from './env.js';
import { pool } from './db.js';
import { HttpError } from './utils/http.js';
import { leaguesRouter } from './routes/leagues.js';
import { coursesRouter } from './routes/courses.js';
import { runsRouter } from './routes/runs.js';
import { trapsRouter } from './routes/traps.js';
import { notificationsRouter } from './routes/notifications.js';

const app = express();

app.use(cors());
// Input logs can be a few KB; give generous headroom.
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/leagues', leaguesRouter);
app.use('/courses', coursesRouter);
app.use('/runs', runsRouter);
app.use('/traps', trapsRouter);
app.use('/notifications', notificationsRouter);

// 404 fallback.
app.use((_req, res) => {
  res.status(404).json({ ok: false, reason: 'not found' });
});

// Global error handler — HttpError carries a status; everything else is 500.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ ok: false, reason: err.message });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ ok: false, reason: 'internal server error' });
});

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
