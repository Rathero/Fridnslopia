import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleCourse3D } from './course3d.js';
import { simulateRun3D } from './simulate3d.js';
import { autopilot3d } from './autopilot3d.js';
import { defaultConfig } from '../llm/schema.js';

test('same seed+config => identical 3D course', () => {
  const a = assembleCourse3D(123456, defaultConfig);
  const b = assembleCourse3D(123456, defaultConfig);
  assert.deepEqual(a.chunkIds, b.chunkIds);
  assert.deepEqual(a.floors, b.floors);
  assert.equal(a.finishZ, b.finishZ);
});

test('3D determinism: same input log => identical sim (Node re-sim = anti-cheat)', async () => {
  const course = assembleCourse3D(20260704, defaultConfig);
  // Deterministic sample input.
  const events: { f: number; t: 'L' | 'R' | 'J' }[] = [];
  for (let f = 20; f < 3000; f += 30) events.push({ f, t: f % 90 === 0 ? 'J' : f % 60 === 0 ? 'L' : 'R' });
  const log = { seed: course.seed, events };

  const r1 = await simulateRun3D(course, log, []);
  const r2 = await simulateRun3D(course, log, []);
  assert.equal(r1.timeMs, r2.timeMs, '3D re-sim time must be identical');
  assert.equal(r1.frameCount, r2.frameCount);
  assert.deepEqual(r1.frames[200], r2.frames[200]);
  assert.deepEqual(r1.frames.at(-1), r2.frames.at(-1));
});

test('3D autopilot produces a finishing log that re-sims to the same time', async () => {
  let finishedCount = 0;
  for (const seed of [1, 42, 123456, 20260704, 7]) {
    const course = assembleCourse3D(seed, defaultConfig);
    const run = autopilot3d(course);
    if (!run.finished) continue; // bot isn't a perfect oracle; count what it clears
    finishedCount++;
    const resim = await simulateRun3D(course, run.log, []);
    assert.ok(resim.finished, `re-sim should finish seed ${seed}`);
    assert.equal(resim.timeMs, run.timeMs, `re-sim time must match autopilot for seed ${seed}`);
  }
  assert.ok(finishedCount >= 1, 'autopilot should finish at least one course');
});
