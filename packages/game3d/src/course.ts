import { Rng } from '@trampa/shared';

/**
 * A 3D "cenital" (aerial) obstacle course. Forward is +Z; the runner auto-runs
 * into the screen, dodging left/right and jumping gaps. Everything is generated
 * deterministically from a seed so the same seed => the same course for the
 * whole lobby (same principle as the 2D game — ghosts + fair leagues survive).
 *
 * Coordinate convention: X = lateral (left/right), Y = up, Z = forward. Boxes
 * are centre + full size (w=x, h=y, d=z).
 *
 * ARCHITECTURE (mirrors the 2D game): instead of ad-hoc per-segment generation,
 * the course is assembled from an authored LIBRARY of hand-designed chunk
 * templates (see CHUNKS below). Each chunk is a fixed-length segment along Z
 * that hands off a full-width floor at height 0 at both its entry and exit
 * seams, so any two chunks snap together. A deterministic seeded assembler
 * picks chunks along a difficulty ramp. Same seed => same course.
 */

export interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface Obstacle extends Box {
  kind: 'wall' | 'mover' | 'trap';
  /** Deterministic oscillation for movers (position = base + amp*sin). */
  amp?: number;
  period?: number;
  phase?: number;
}

export interface Course3D {
  seed: number;
  halfWidth: number;
  floors: Box[];
  obstacles: Obstacle[];
  checkpoints: number[]; // z positions, ascending
  startZ: number;
  finishZ: number;
  palette: { floor: number; floor2: number; accent: number; obstacle: number; fog: number };
  theme: string;
  /** Ordered list of chunk ids used, for debugging / telemetry. */
  chunkIds: string[];
}

const PALETTES = [
  { theme: 'neon', floor: 0x243154, floor2: 0x1b2540, accent: 0x45e0ff, obstacle: 0xff5470, fog: 0x0a1024 },
  { theme: 'sunset', floor: 0x40243f, floor2: 0x301a30, accent: 0xffb703, obstacle: 0xef476f, fog: 0x1a0f1e },
  { theme: 'toxic', floor: 0x213a2a, floor2: 0x172a1f, accent: 0x9dff3c, obstacle: 0xff7b00, fog: 0x0c1a10 },
  { theme: 'ice', floor: 0x27384f, floor2: 0x1c2a3c, accent: 0x8ad7ff, obstacle: 0xff5470, fog: 0x0b1622 },
];

const HALF = 5; // playfield spans X in [-5, 5]
const FLOOR_TOP = 0; // walkable surface height for the entry/exit seam
const FLOOR_H = 1.2;

// ---------------------------------------------------------------------------
// Chunk template model (authored in LOCAL coords: z in [0, len]).
// ---------------------------------------------------------------------------

/**
 * A floor slab in a chunk's local frame. Spans z in [z0, z1]. `top` is the
 * height of its WALKABLE surface (default 0 = the seam height). Raised `top`
 * values make steps / plateaus the player runs up and over. Width defaults to
 * the full playfield; narrow it (with optional x centre) for beams.
 */
interface ChunkFloor {
  z0: number;
  z1: number;
  x?: number;
  w?: number;
  top?: number;
}

/** An obstacle in a chunk's local frame (z is the centre along the chunk). */
interface ChunkObs {
  kind: 'wall' | 'mover' | 'trap';
  x: number;
  z: number;
  y?: number;
  w?: number;
  h?: number;
  d?: number;
  amp?: number;
  period?: number;
  phase?: number;
}

interface Chunk {
  id: string;
  /** Length along Z. */
  len: number;
  /** Authored difficulty 0..4 (0 = start/breather). */
  difficulty: number;
  tags: string[];
  floors: ChunkFloor[];
  obstacles?: ChunkObs[];
}

// Authoring helpers -----------------------------------------------------------

/** Full-width floor slab. */
function fl(z0: number, z1: number, top = 0): ChunkFloor {
  return { z0, z1, top };
}
/** Narrow beam (centred on x by default). */
function beam(z0: number, z1: number, w: number, x = 0, top = 0): ChunkFloor {
  return { z0, z1, x, w, top };
}
/** A static wall that blocks part of the lane (dodge around it). */
function wall(x: number, z: number, w = 3.4): ChunkObs {
  return { kind: 'wall', x, z, y: 1.1, w, h: 2.2, d: 1.1 };
}
/** A moving gate that sweeps along X (deterministic sine). */
function gate(x: number, z: number, amp: number, period: number, phase: number, w = 4.0): ChunkObs {
  return { kind: 'mover', x, z, y: 1.1, w, h: 2.2, d: 1.2, amp, period, phase };
}

// ---------------------------------------------------------------------------
// The hand-authored chunk library. Every chunk begins and ends with full-width
// floor at top=0 so seams always connect, and every one is completable by the
// autoplay bot (auto-forward + lateral dodge + gap jump).
// ---------------------------------------------------------------------------

const CHUNKS: Chunk[] = [
  // --- Start / breathers ---------------------------------------------------
  {
    id: 'start_run',
    len: 16,
    difficulty: 0,
    tags: ['start', 'flat'],
    floors: [fl(0, 16)],
  },
  {
    id: 'flat_breather',
    len: 10,
    difficulty: 0,
    tags: ['flat'],
    floors: [fl(0, 10)],
  },

  // --- Lateral dodging (walls) --------------------------------------------
  {
    id: 'weave_three',
    len: 15,
    difficulty: 2,
    tags: ['weave', 'dodge'],
    floors: [fl(0, 15)],
    obstacles: [wall(3.1, 4), wall(-3.1, 8.5), wall(3.1, 12.5)],
  },
  {
    id: 'slalom_four',
    len: 18,
    difficulty: 4,
    tags: ['weave', 'dodge', 'hard'],
    floors: [fl(0, 18)],
    obstacles: [wall(-3.1, 3.5), wall(3.1, 7.5), wall(-3.1, 11), wall(3.1, 14.5)],
  },
  {
    id: 'pinch_lane',
    len: 13,
    difficulty: 3,
    tags: ['pinch', 'center'],
    floors: [fl(0, 13)],
    // Two side walls leave a generous centre lane (~x in [-2.75, 2.75]).
    obstacles: [wall(4.3, 6.5, 3.1), wall(-4.3, 6.5, 3.1)],
  },
  {
    id: 'chicane',
    len: 14,
    difficulty: 3,
    tags: ['weave', 'dodge'],
    floors: [fl(0, 14)],
    obstacles: [wall(-2.6, 5, 4.2), wall(2.6, 10, 4.2)],
  },

  // --- Moving gates --------------------------------------------------------
  {
    id: 'gate_single',
    len: 14,
    difficulty: 3,
    tags: ['mover', 'dodge'],
    floors: [fl(0, 14)],
    obstacles: [gate(0, 7, 3.2, 92, 0)],
  },
  {
    id: 'gate_twin',
    len: 18,
    difficulty: 4,
    tags: ['mover', 'dodge', 'hard'],
    floors: [fl(0, 18)],
    obstacles: [gate(0, 5.5, 3.0, 96, 0), gate(0, 12.5, 3.0, 96, 48)],
  },

  // --- Gaps to jump --------------------------------------------------------
  {
    id: 'gap_single',
    len: 14,
    difficulty: 2,
    tags: ['gap', 'jump'],
    floors: [fl(0, 5), fl(9, 14)],
  },
  {
    id: 'gap_double',
    len: 20,
    difficulty: 3,
    tags: ['gap', 'jump', 'midair'],
    floors: [fl(0, 5), fl(8.5, 14), fl(17.5, 20)],
  },

  // --- Narrow beams --------------------------------------------------------
  {
    id: 'narrow_beam',
    len: 15,
    difficulty: 3,
    tags: ['narrow', 'center'],
    // Full floor at the seams, a narrow centred beam through the middle.
    floors: [fl(0, 3.5), beam(3.5, 11.5, 3.6, 0), fl(11.5, 15)],
  },

  // --- Ramps / steps -------------------------------------------------------
  {
    id: 'plateau_kerb',
    len: 14,
    difficulty: 2,
    tags: ['ramp', 'step'],
    // A low kerb up onto a plateau, then back down. Steps < player radius so
    // the auto-runner rolls straight up them.
    floors: [fl(0, 4), fl(4, 10, 0.4), fl(10, 14)],
  },
  {
    id: 'stairs_up',
    len: 16,
    difficulty: 3,
    tags: ['ramp', 'step'],
    floors: [fl(0, 3), fl(3, 6, 0.4), fl(6, 10, 0.8), fl(10, 12, 0.4), fl(12, 16)],
  },

  // --- Combos --------------------------------------------------------------
  {
    id: 'gap_then_gate',
    len: 20,
    difficulty: 4,
    tags: ['gap', 'mover', 'hard'],
    floors: [fl(0, 5), fl(9, 20)],
    obstacles: [gate(0, 15, 3.0, 100, 0)],
  },
  {
    id: 'weave_then_gap',
    len: 20,
    difficulty: 4,
    tags: ['weave', 'gap', 'hard'],
    // Weave early, a flat breather, then a clean gap — so the bot has fully
    // dodged clear of the walls before it needs to jump.
    floors: [fl(0, 13), fl(16.5, 20)],
    obstacles: [wall(3.1, 3.5), wall(-3.1, 7)],
  },
];

const START = CHUNKS.find((c) => c.id === 'start_run')!;
/** Pool the assembler draws from (everything except the fixed start chunk). */
const POOL = CHUNKS.filter((c) => c.id !== 'start_run');

// ---------------------------------------------------------------------------
// Assembler.
// ---------------------------------------------------------------------------

function appendChunk(
  chunk: Chunk,
  base: number,
  floors: Box[],
  obstacles: Obstacle[],
) {
  for (const f of chunk.floors) {
    const top = f.top ?? 0;
    const z0 = base + f.z0;
    const z1 = base + f.z1;
    const d = z1 - z0;
    floors.push({
      x: f.x ?? 0,
      y: top - FLOOR_H / 2,
      z: z0 + d / 2,
      w: f.w ?? HALF * 2,
      h: FLOOR_H,
      d,
    });
  }
  for (const o of chunk.obstacles ?? []) {
    obstacles.push({
      kind: o.kind,
      x: o.x,
      y: o.y ?? 1.1,
      z: base + o.z,
      w: o.w ?? 3.4,
      h: o.h ?? 2.2,
      d: o.d ?? 1.1,
      amp: o.amp,
      period: o.period,
      phase: o.phase,
    });
  }
}

/**
 * Generate a deterministic aerial course by assembling authored chunks along a
 * difficulty ramp. `segments` is the number of library chunks placed after the
 * fixed start run-up.
 */
export function makeCourse(seed: number, segments = 14): Course3D {
  const rng = new Rng(seed);
  const palette = PALETTES[rng.int(0, PALETTES.length - 1)];

  const floors: Box[] = [];
  const obstacles: Obstacle[] = [];
  const checkpoints: number[] = [];
  const chunkIds: string[] = [];

  let z = 0;

  // Fixed safe run-up.
  checkpoints.push(0);
  appendChunk(START, z, floors, obstacles);
  chunkIds.push(START.id);
  z += START.len;

  let lastId = START.id;
  for (let i = 0; i < segments; i++) {
    // Difficulty ramp: target rises from ~1 up to 4 across the course.
    const t = segments <= 1 ? 1 : i / (segments - 1);
    const target = 1 + t * 3; // 1 .. 4

    // Weight each candidate by proximity to the target difficulty; forbid an
    // immediate repeat so the course reads with variety.
    const weights = POOL.map((c) => {
      if (c.id === lastId) return 0;
      const diff = Math.abs(c.difficulty - target);
      let w = 1 / (1 + diff * diff);
      // Sprinkle in the occasional breather regardless of ramp.
      if (c.tags.includes('flat')) w = 0.12;
      return w;
    });
    const chunk = rng.weightedPick(POOL, weights);

    checkpoints.push(z);
    appendChunk(chunk, z, floors, obstacles);
    chunkIds.push(chunk.id);
    z += chunk.len;
    lastId = chunk.id;
  }

  // Finish pad + checkpoint.
  checkpoints.push(z);
  appendChunk({ id: 'finish_pad', len: 16, difficulty: 0, tags: ['finish'], floors: [fl(0, 16)] }, z, floors, obstacles);
  chunkIds.push('finish_pad');
  const finishZ = z + 3;

  return {
    seed,
    halfWidth: HALF,
    floors,
    obstacles,
    checkpoints,
    startZ: 0,
    finishZ,
    palette,
    theme: palette.theme,
    chunkIds,
  };
}
