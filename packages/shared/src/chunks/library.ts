import type { Chunk } from './types.js';

/**
 * The hand-authored chunk library (spec §4.1, M1 asks for ~15). Every chunk is
 * 20x12 tiles with entryY == exitY == 8, so boundary continuity is guaranteed
 * and the assembler can always snap any two together. Variety lives INSIDE the
 * chunk (gaps, spikes, movers, midair hops), not in the seam.
 *
 * Floor convention: the walkable surface is the line y=8; ground rects are
 * {y:8,h:4} filling to the bottom (y=12). A "gap" is simply missing floor.
 */

const W = 20;
const H = 12;
const FLOOR_Y = 8;
const FLOOR_H = 4;

/** Ground rect helper. */
function floor(x: number, w: number) {
  return { x, y: FLOOR_Y, w, h: FLOOR_H };
}

export const CHUNKS: Chunk[] = [
  {
    id: 'start_run',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 1,
    tags: ['start', 'flat'],
    platforms: [floor(0, W)],
    trapSlots: [{ x: 12, y: 7 }],
    checkpoint: { x: 2, y: 7 },
  },
  {
    id: 'flat_breather',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 1,
    tags: ['flat'],
    platforms: [floor(0, W)],
    trapSlots: [
      { x: 7, y: 7 },
      { x: 13, y: 7 },
    ],
  },
  {
    id: 'gap_single',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 2,
    tags: ['gap', 'jump'],
    platforms: [floor(0, 9), floor(12, 8)],
    trapSlots: [{ x: 6, y: 7 }, { x: 14, y: 7 }],
    checkpoint: { x: 18, y: 7 },
  },
  {
    id: 'gap_double_01',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 2,
    tags: ['gap', 'jump', 'midair'],
    platforms: [floor(0, 5), floor(8, 4), floor(15, 5)],
    trapSlots: [{ x: 9, y: 7 }, { x: 12, y: 7 }],
    checkpoint: { x: 18, y: 7 },
  },
  {
    id: 'gap_wide',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 3,
    tags: ['gap', 'jump'],
    platforms: [floor(0, 8), floor(13, 7)],
    hazards: [{ type: 'spike', x: 10, y: 11 }],
    trapSlots: [{ x: 15, y: 7 }],
  },
  {
    id: 'stairs_hop',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 2,
    tags: ['jump', 'climb', 'midair'],
    platforms: [
      floor(0, W),
      { x: 6, y: 6, w: 3, h: 1 },
      { x: 10, y: 4, w: 3, h: 1 },
      { x: 14, y: 6, w: 3, h: 1 },
    ],
    trapSlots: [{ x: 11, y: 3 }],
  },
  {
    id: 'spikes_row',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 2,
    tags: ['spike', 'jump'],
    platforms: [floor(0, W)],
    hazards: [
      { type: 'spike', x: 8, y: 7 },
      { type: 'spike', x: 9, y: 7 },
      { type: 'spike', x: 10, y: 7 },
    ],
    trapSlots: [{ x: 5, y: 7 }, { x: 14, y: 7 }],
  },
  {
    id: 'spike_gauntlet',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 4,
    tags: ['spike', 'jump'],
    platforms: [floor(0, W)],
    hazards: [
      { type: 'spike', x: 5, y: 7 },
      { type: 'spike', x: 10, y: 7 },
      { type: 'spike', x: 15, y: 7 },
    ],
    trapSlots: [{ x: 7, y: 7 }, { x: 12, y: 7 }],
    checkpoint: { x: 18, y: 7 },
  },
  {
    id: 'saw_pit',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 3,
    tags: ['gap', 'moving', 'saw'],
    platforms: [floor(0, 7), floor(13, 7)],
    hazards: [
      { type: 'saw', x: 10, y: 9, axis: 'y', amp: 2.5, period: 90 },
    ],
    trapSlots: [{ x: 15, y: 7 }],
    checkpoint: { x: 18, y: 7 },
  },
  {
    id: 'moving_bridge',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 3,
    tags: ['moving', 'gap'],
    platforms: [floor(0, 8), floor(12, 8)],
    movers: [{ x: 9, y: 6, w: 2, h: 1, axis: 'y', amp: 2, period: 100 }],
    trapSlots: [{ x: 14, y: 7 }],
  },
  {
    id: 'midair_hops',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 3,
    tags: ['midair', 'jump', 'gap'],
    platforms: [
      floor(0, 5),
      { x: 7, y: 7, w: 2, h: 1 },
      { x: 11, y: 6, w: 2, h: 1 },
      floor(15, 5),
    ],
    trapSlots: [{ x: 11, y: 5 }],
    checkpoint: { x: 18, y: 7 },
  },
  {
    id: 'bounce_alley',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 3,
    tags: ['gap', 'jump'],
    platforms: [floor(0, 4), floor(7, 4), floor(14, 6)],
    trapSlots: [{ x: 8, y: 7 }],
  },
  {
    id: 'high_road',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 2,
    tags: ['climb', 'midair'],
    // The decorative overhead ledge sits HIGH (y=3) so a normal hop over the
    // floor spikes clears cleanly — it is scenery, not a ceiling trap.
    platforms: [
      floor(0, W),
      { x: 4, y: 3, w: 12, h: 1 },
    ],
    hazards: [{ type: 'spike', x: 9, y: 7 }, { type: 'spike', x: 10, y: 7 }],
    trapSlots: [{ x: 7, y: 5 }, { x: 12, y: 5 }],
  },
  {
    id: 'chaos_mix',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 4,
    tags: ['gap', 'spike', 'moving'],
    platforms: [floor(0, 6), floor(10, 10)],
    movers: [{ x: 7, y: 6, w: 2, h: 1, axis: 'y', amp: 1.5, period: 80 }],
    hazards: [{ type: 'spike', x: 13, y: 7 }],
    trapSlots: [{ x: 16, y: 7 }],
    checkpoint: { x: 18, y: 7 },
  },
  {
    id: 'twin_towers',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 4,
    tags: ['gap', 'jump', 'midair'],
    platforms: [
      floor(0, 4),
      { x: 6, y: 6, w: 2, h: 6 },
      { x: 12, y: 6, w: 2, h: 6 },
      floor(16, 4),
    ],
    trapSlots: [{ x: 9, y: 5 }],
    checkpoint: { x: 18, y: 7 },
  },
  {
    id: 'long_flat_traps',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 1,
    tags: ['flat'],
    platforms: [floor(0, W)],
    trapSlots: [
      { x: 5, y: 7 },
      { x: 10, y: 7 },
      { x: 15, y: 7 },
    ],
  },
  {
    id: 'saw_row',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 5,
    tags: ['saw', 'spike', 'jump'],
    platforms: [floor(0, W)],
    hazards: [
      { type: 'saw', x: 7, y: 7, axis: 'x', amp: 2, period: 70 },
      { type: 'spike', x: 12, y: 7 },
      { type: 'saw', x: 15, y: 7, axis: 'x', amp: 2, period: 70, phase: 35 },
    ],
    trapSlots: [{ x: 10, y: 7 }],
    checkpoint: { x: 18, y: 7 },
  },
  {
    id: 'finish_flat',
    widthTiles: W,
    heightTiles: H,
    entryY: 8,
    exitY: 8,
    difficulty: 1,
    tags: ['finish', 'flat'],
    platforms: [floor(0, W)],
    checkpoint: { x: 2, y: 7 },
    trapSlots: [{ x: 10, y: 7 }],
  },
];

export const CHUNKS_BY_ID: Record<string, Chunk> = Object.fromEntries(
  CHUNKS.map((c) => [c.id, c]),
);
