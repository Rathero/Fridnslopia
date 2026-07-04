import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { initRapier } from '@trampa/shared';
import { HttpError } from './utils/http.js';
import { leaguesRouter } from './routes/leagues.js';
import { coursesRouter } from './routes/courses.js';
import { runsRouter } from './routes/runs.js';
import { trapsRouter } from './routes/traps.js';
import { notificationsRouter } from './routes/notifications.js';
import { roomsRouter } from './routes/rooms.js';

/**
 * The Express app, with NO `listen()` — so it can be driven by a long-running
 * server (`index.ts`) OR wrapped as a serverless function (Vercel). Rapier is
 * initialised lazily on the first request (idempotent) so the anti-cheat re-sim
 * is always ready without a bootstrap step.
 */
export const app = express();

let rapierReady: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!rapierReady) rapierReady = initRapier();
  return rapierReady;
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Ensure the WASM sim is loaded before any route runs (cheap after the first).
app.use((_req, _res, next) => {
  ensureReady().then(() => next()).catch(next);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/leagues', leaguesRouter);
app.use('/courses', coursesRouter);
app.use('/runs', runsRouter);
app.use('/traps', trapsRouter);
app.use('/notifications', notificationsRouter);
app.use('/rooms', roomsRouter);

app.use((_req, res) => {
  res.status(404).json({ ok: false, reason: 'not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ ok: false, reason: err.message });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ ok: false, reason: 'internal server error' });
});

export { ensureReady };
