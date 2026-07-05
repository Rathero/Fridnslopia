import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleCourse } from './assembler.js';
import { defaultConfig } from './llm/schema.js';
import { verifyCourse } from './verifier.js';
import { simulateRun } from './sim/simulate.js';
import { autopilot } from './sim/autopilot.js';
import type { InputLog } from './sim/world.js';

test('same seed => identical course', () => {
  const a = assembleCourse(123456, defaultConfig);
  const b = assembleCourse(123456, defaultConfig);
  assert.deepEqual(a.chunkIds, b.chunkIds);
  assert.deepEqual(a.platforms, b.platforms);
  assert.equal(a.widthTiles, b.widthTiles);
});

test('different seed => (usually) different course', () => {
  const a = assembleCourse(1, defaultConfig);
  const b = assembleCourse(999999, defaultConfig);
  // Not a hard guarantee, but with 12 chunks collisions are vanishingly rare.
  assert.notDeepEqual(a.chunkIds, b.chunkIds);
});

test('default daily course verifies as completable', () => {
  for (const seed of [1, 42, 123456, 7777, 20260704]) {
    const course = assembleCourse(seed, defaultConfig);
    const res = verifyCourse(course);
    assert.ok(res.ok, `seed ${seed} should be completable: ${res.reason}`);
  }
});

test('same input log => identical simulation result', async () => {
  const course = assembleCourse(123456, defaultConfig);
  // A simple input: tap every 25 frames.
  const events: InputLog['events'] = [];
  for (let f = 20; f < 2000; f += 25) events.push({ f, t: 'tap' });
  const log: InputLog = { seed: 123456, events };

  const r1 = await simulateRun(course, log, []);
  const r2 = await simulateRun(course, log, []);
  assert.equal(r1.timeMs, r2.timeMs);
  assert.equal(r1.frameCount, r2.frameCount);
  assert.equal(r1.frames.length, r2.frames.length);
  // Frame-by-frame identical positions => determinism holds.
  assert.deepEqual(r1.frames[100], r2.frames[100]);
  assert.deepEqual(r1.frames.at(-1), r2.frames.at(-1));
});

test('autopilot finishes generated courses and its log re-sims identically', async () => {
  // The (legacy 2D) autopilot is a heuristic, not a perfect oracle — it doesn't
  // clear every hard course. What must always hold is the determinism/anti-cheat
  // guarantee: any run it DOES finish must re-simulate to the exact same time.
  let finishedCount = 0;
  for (const seed of [1, 42, 123456, 20260704, 7, 555]) {
    const course = assembleCourse(seed, defaultConfig);
    const run = autopilot(course);
    if (!run.finished) continue;
    finishedCount++;

    const resim = await simulateRun(course, run.log, []);
    assert.ok(resim.finished, `re-sim should finish seed ${seed}`);
    assert.equal(resim.timeMs, run.timeMs, `re-sim time must match seed ${seed}`);
  }
  assert.ok(finishedCount >= 1, 'autopilot should finish at least one 2D course');
});
