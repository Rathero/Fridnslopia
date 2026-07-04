/**
 * End-to-end smoke test against a running server (M3/M4/M5).
 *
 *   npm run migrate && npm run dev      # in one shell
 *   npm run smoke                        # in another
 *
 * Creates a fresh league, generates a real finishing run with the shared
 * autopilot, submits it (server re-simulates for anti-cheat), verifies a
 * tampered time is rejected, places a trap, and reads the leaderboard, ghosts
 * and shared streak. Exits non-zero on any failure.
 */
import { autopilot3d, initRapier3D, type InputLog3D } from '@trampa/shared';
import { PORT } from './env.js';

const API = process.env.SMOKE_API ?? `http://localhost:${PORT}`;

async function call<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body as T;
}

async function main() {
  await initRapier3D();
  const stamp = Date.now().toString(36);
  const handleA = `smoke_a_${stamp}`;
  const handleB = `smoke_b_${stamp}`;

  console.log('· creating league');
  const league = await call<{ id: string; inviteCode: string }>('/leagues', {
    method: 'POST',
    body: JSON.stringify({ name: `Smoke ${stamp}`, ownerHandle: handleA }),
  });
  await call('/leagues/join', {
    method: 'POST',
    body: JSON.stringify({ invite_code: league.inviteCode, handle: handleB }),
  });

  console.log('· fetching today course');
  const today = await call<{
    courseId: string;
    course: any;
    traps: any[];
    verified: boolean;
  }>(`/courses/today?leagueId=${league.id}`);
  assert(today.verified, 'daily course must be verified');

  console.log('· autopilot run');
  const run = autopilot3d(today.course, today.traps);
  assert(run.finished, 'autopilot must finish the course');

  console.log('· submitting valid run (A)');
  const subA = await call<{ ok: boolean; rank: number; timeMs: number }>('/runs', {
    method: 'POST',
    body: JSON.stringify({
      courseId: today.courseId,
      handle: handleA,
      timeMs: run.timeMs,
      inputLog: run.log as InputLog3D,
    }),
  });
  assert(subA.ok && subA.timeMs === run.timeMs, 'valid run must be accepted with matching time');

  console.log('· rejecting tampered run');
  let rejected = false;
  try {
    await call('/runs', {
      method: 'POST',
      body: JSON.stringify({
        courseId: today.courseId,
        handle: handleB,
        timeMs: 1,
        inputLog: run.log,
      }),
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'tampered time must be rejected by anti-cheat');

  console.log('· submitting valid run (B) -> streak should tick');
  const subB = await call<{ streak?: { allPlayed: boolean; streakCount: number } }>('/runs', {
    method: 'POST',
    body: JSON.stringify({
      courseId: today.courseId,
      handle: handleB,
      timeMs: run.timeMs,
      inputLog: run.log,
    }),
  });
  assert(subB.streak?.allPlayed === true, 'streak should register everyone played');

  console.log('· placing a trap');
  if (today.course.trapSlots.length) {
    const slot = today.course.trapSlots[0];
    const trap = await call<{ ok: boolean }>('/traps', {
      method: 'POST',
      body: JSON.stringify({
        courseId: today.courseId,
        handle: handleA,
        slotX: slot.x,
        slotZ: slot.z,
        trapType: 'spike',
      }),
    });
    assert(trap.ok, 'trap placement must succeed');
  }

  console.log('· reading leaderboard + ghosts');
  const lb = await call<any[]>(`/courses/${today.courseId}/leaderboard`);
  assert(lb.length >= 2, 'leaderboard should have both runners');
  const ghosts = await call<any[]>(`/courses/${today.courseId}/ghosts?excludeHandle=${handleA}`);
  assert(ghosts.length >= 1, 'ghosts endpoint should return at least one runner');

  const finalLeague = await call<{ streakCount: number }>(`/leagues/${league.id}`);
  console.log(
    `\n✅ SMOKE PASSED  run=${(run.timeMs / 1000).toFixed(2)}s  ` +
      `leaderboard=${lb.length}  ghosts=${ghosts.length}  streak=${finalLeague.streakCount}`,
  );
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

main().catch((err) => {
  console.error('\n❌ SMOKE FAILED:', err.message);
  process.exit(1);
});
