import { Rng } from './prng.js';
import { CHUNKS } from './chunks/library.js';
import type { Chunk } from './chunks/types.js';
import type { Course } from './course.js';
import type { DailyConfig } from './llm/schema.js';
import { PHYSICS } from './constants.js';

/**
 * Build a difficulty curve that ramps from 1 up to maxDifficulty across the
 * course, with the final chunk eased back down (that's the finish stretch).
 */
function difficultyCurve(target: number, maxDifficulty: number): number[] {
  const curve: number[] = [];
  for (let i = 0; i < target; i++) {
    const t = target <= 1 ? 1 : i / (target - 1);
    curve.push(Math.max(1, Math.round(1 + (maxDifficulty - 1) * t)));
  }
  return curve;
}

/** Average of a chunk's tag weights (missing tags default to 1). */
function tagWeight(chunk: Chunk, weights: Record<string, number>): number {
  if (chunk.tags.length === 0) return 1;
  let sum = 0;
  for (const tag of chunk.tags) sum += weights[tag] ?? 1;
  return sum / chunk.tags.length;
}

function chunksWithTag(tag: string): Chunk[] {
  return CHUNKS.filter((c) => c.tags.includes(tag));
}

/**
 * Deterministic assembler (spec §4.2). Same (dailySeed, config) => same course
 * for the whole league. No Math.random anywhere — every draw comes from the
 * seeded Rng.
 */
export function assembleCourse(
  dailySeed: number,
  config: DailyConfig,
): Course {
  const rng = new Rng(dailySeed);
  const target = Math.max(4, config.length);
  const curve = difficultyCurve(target, config.maxDifficulty);

  const starts = chunksWithTag('start');
  const finishes = chunksWithTag('finish');
  const middlePool = CHUNKS.filter(
    (c) => !c.tags.includes('start') && !c.tags.includes('finish'),
  );

  const chosen: Chunk[] = [];
  chosen.push(rng.pick(starts));

  for (let i = 1; i < target - 1; i++) {
    const last = chosen[chosen.length - 1];
    const maxDiff = curve[i];
    // Boundary contract: |exitY - entryY| <= 1 (all library chunks are 8/8).
    let candidates = middlePool.filter(
      (c) =>
        Math.abs(last.exitY - c.entryY) <= 1 && c.difficulty <= maxDiff,
    );
    // Never get stuck: if the difficulty filter empties the pool, relax it.
    if (candidates.length === 0) {
      candidates = middlePool.filter(
        (c) => Math.abs(last.exitY - c.entryY) <= 1,
      );
    }
    const weights = candidates.map((c) => tagWeight(c, config.chunkWeights));
    chosen.push(rng.weightedPick(candidates, weights));
  }

  chosen.push(rng.pick(finishes));

  return layout(dailySeed, chosen, config);
}

/** Offset every chunk by an accumulating X and flatten to absolute coords. */
function layout(seed: number, chunks: Chunk[], config: DailyConfig): Course {
  const course: Course = {
    seed,
    chunkIds: chunks.map((c) => c.id),
    widthTiles: 0,
    heightTiles: chunks[0]?.heightTiles ?? 12,
    platforms: [],
    movers: [],
    hazards: [],
    trapSlots: [],
    checkpoints: [],
    startX: 1.5,
    startY: 0,
    finishX: 0,
    theme: config.theme,
    palette: config.palette,
    modifier: config.dailyModifier,
    flavorText: config.flavorText,
  };

  let offsetX = 0;
  chunks.forEach((chunk, ci) => {
    for (const p of chunk.platforms) {
      course.platforms.push({ ...p, x: p.x + offsetX });
    }
    for (const m of chunk.movers ?? []) {
      course.movers.push({ ...m, x: m.x + offsetX });
    }
    for (const h of chunk.hazards ?? []) {
      course.hazards.push({ ...h, x: h.x + offsetX });
    }
    for (const s of chunk.trapSlots ?? []) {
      course.trapSlots.push({
        id: `${ci}:${s.x}:${s.y}`,
        x: s.x + offsetX,
        y: s.y,
      });
    }
    // Implicit checkpoint at each chunk entry so deaths never rewind too far.
    course.checkpoints.push({ x: offsetX + 1, y: chunk.entryY });
    if (chunk.checkpoint) {
      course.checkpoints.push({
        x: chunk.checkpoint.x + offsetX,
        y: chunk.checkpoint.y,
      });
    }
    offsetX += chunk.widthTiles;
  });

  course.widthTiles = offsetX;
  course.startY = (chunks[0]?.entryY ?? 8) - PHYSICS.playerRadius;
  // Finish just before the very end so the last floor is solid under the line.
  course.finishX = offsetX - 1;
  course.checkpoints.sort((a, b) => a.x - b.x);
  return course;
}
