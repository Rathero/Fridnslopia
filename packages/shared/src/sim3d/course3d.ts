import { Rng } from '../prng.js';
import type { DailyConfig } from '../llm/schema.js';
import type { DailyModifier } from '../constants.js';

/**
 * 3D "cenital" (aerial) course. Forward is +Z; the runner auto-runs into the
 * screen, dodging left/right and jumping gaps. Deterministic from a seed +
 * config so the same daily seed => the same course for the whole lobby (the
 * ghosts + fair-leagues guarantee, now in 3D). X = lateral, Y = up, Z = forward.
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
  /**
   * `wall` static kill; `mover` sweeps laterally (amp/period/phase);
   * `crusher` a piston that slams down periodically (lethal only while down);
   * `spinner` a bar rotating in the ground plane about (x,z) (arm half-length in `amp`);
   * `trap` a player-placed skill-check.
   */
  kind: 'wall' | 'mover' | 'trap' | 'crusher' | 'spinner';
  amp?: number;
  period?: number;
  phase?: number;
  /** For placed traps: what it does + who put it (render/label only). */
  trapType?: TrapType3D;
  ownerHandle?: string;
}

export type TrapType3D = 'spike' | 'bounce' | 'glue';

/** A position where a player may drop their trap (absolute course coords). */
export interface TrapSlot3D {
  id: string;
  x: number;
  z: number;
}

export interface PlacedTrap3D {
  slotX: number;
  slotZ: number;
  trapType: TrapType3D;
  userId?: string;
  ownerHandle?: string;
}

export interface Course3D {
  seed: number;
  halfWidth: number;
  floors: Box[];
  obstacles: Obstacle[];
  trapSlots: TrapSlot3D[];
  checkpoints: number[];
  startZ: number;
  finishZ: number;
  palette: { floor: number; floor2: number; accent: number; obstacle: number; fog: number };
  theme: string;
  modifier: string;
  flavorText: string;
  chunkIds: string[];
}

const PALETTES = [
  { theme: 'neon', floor: 0x243154, floor2: 0x1b2540, accent: 0x45e0ff, obstacle: 0xff5470, fog: 0x0a1024 },
  { theme: 'sunset', floor: 0x40243f, floor2: 0x301a30, accent: 0xffb703, obstacle: 0xef476f, fog: 0x1a0f1e },
  { theme: 'toxic', floor: 0x213a2a, floor2: 0x172a1f, accent: 0x9dff3c, obstacle: 0xff7b00, fog: 0x0c1a10 },
  { theme: 'ice', floor: 0x27384f, floor2: 0x1c2a3c, accent: 0x8ad7ff, obstacle: 0xff5470, fog: 0x0b1622 },
];

const HALF = 5;
const FLOOR_H = 1.2;

interface ChunkFloor { z0: number; z1: number; x?: number; w?: number; top?: number }
interface ChunkObs {
  kind: 'wall' | 'mover' | 'crusher' | 'spinner';
  x: number; z: number; y?: number; w?: number; h?: number; d?: number;
  amp?: number; period?: number; phase?: number;
}
interface Chunk {
  id: string;
  len: number;
  difficulty: number;
  tags: string[];
  floors: ChunkFloor[];
  obstacles?: ChunkObs[];
  /** Authored trap-drop positions (local z, lane x) — pre-vetted safe. */
  trapSlots?: { x: number; z: number }[];
}

const fl = (z0: number, z1: number, top = 0): ChunkFloor => ({ z0, z1, top });
const beam = (z0: number, z1: number, w: number, x = 0, top = 0): ChunkFloor => ({ z0, z1, x, w, top });
const wall = (x: number, z: number, w = 3.4): ChunkObs => ({ kind: 'wall', x, z, y: 1.1, w, h: 2.2, d: 1.1 });
const gate = (x: number, z: number, amp: number, period: number, phase: number, w = 4.0): ChunkObs =>
  ({ kind: 'mover', x, z, y: 1.1, w, h: 2.2, d: 1.2, amp, period, phase });
// A piston that rests up (safe) and slams down for half its cycle — lethal only
// while down. Partial width so a lane beside it is always open (autopilot-safe);
// a human can time the shortcut straight through. `amp` = slam depth.
const crusher = (x: number, z: number, period = 84, phase = 0, w = 1.8): ChunkObs =>
  ({ kind: 'crusher', x, z, y: 2.7, w, h: 2.2, d: 1.5, amp: 2.2, period, phase });
// A bar rotating in the ground plane about (x,z). `amp` = arm half-length, so the
// swept disc is [x-amp, x+amp]; keep amp small enough that the outer lanes stay
// clear (autopilot rounds the disc; humans weave through the sweeping gaps).
const spinner = (x: number, z: number, period = 170, phase = 0, len = 3.6): ChunkObs =>
  ({ kind: 'spinner', x, z, y: 1.05, w: len, h: 1.7, d: 0.7, amp: len / 2, period, phase });

const CHUNKS: Chunk[] = [
  { id: 'start_run', len: 16, difficulty: 0, tags: ['start', 'flat'], floors: [fl(0, 16)] },
  { id: 'flat_breather', len: 10, difficulty: 0, tags: ['flat'], floors: [fl(0, 10)], trapSlots: [{ x: 0, z: 5 }] },
  { id: 'weave_three', len: 15, difficulty: 2, tags: ['weave', 'dodge'], floors: [fl(0, 15)],
    obstacles: [wall(3.1, 4), wall(-3.1, 8.5), wall(3.1, 12.5)], trapSlots: [{ x: -3.1, z: 4 }, { x: 3.1, z: 8.5 }] },
  { id: 'slalom_four', len: 18, difficulty: 4, tags: ['weave', 'dodge', 'hard'], floors: [fl(0, 18)],
    obstacles: [wall(-3.1, 3.5), wall(3.1, 7.5), wall(-3.1, 11), wall(3.1, 14.5)] },
  { id: 'pinch_lane', len: 13, difficulty: 3, tags: ['pinch', 'center'], floors: [fl(0, 13)],
    obstacles: [wall(4.3, 6.5, 3.1), wall(-4.3, 6.5, 3.1)], trapSlots: [{ x: 0, z: 6.5 }] },
  { id: 'chicane', len: 14, difficulty: 3, tags: ['weave', 'dodge'], floors: [fl(0, 14)],
    obstacles: [wall(-2.6, 5, 4.2), wall(2.6, 10, 4.2)] },
  { id: 'gate_single', len: 14, difficulty: 3, tags: ['mover', 'dodge'], floors: [fl(0, 14)],
    obstacles: [gate(0, 7, 3.2, 92, 0)] },
  { id: 'gate_twin', len: 18, difficulty: 4, tags: ['mover', 'dodge', 'hard'], floors: [fl(0, 18)],
    obstacles: [gate(0, 5.5, 3.0, 96, 0), gate(0, 12.5, 3.0, 96, 48)] },
  { id: 'gap_single', len: 14, difficulty: 2, tags: ['gap', 'jump'], floors: [fl(0, 5), fl(9, 14)],
    trapSlots: [{ x: 0, z: 11.5 }] },
  { id: 'gap_double', len: 20, difficulty: 3, tags: ['gap', 'jump', 'midair'], floors: [fl(0, 5), fl(8.5, 14), fl(17.5, 20)] },
  { id: 'narrow_beam', len: 15, difficulty: 3, tags: ['narrow', 'center'], floors: [fl(0, 3.5), beam(3.5, 11.5, 3.6, 0), fl(11.5, 15)] },
  { id: 'plateau_kerb', len: 14, difficulty: 2, tags: ['ramp', 'step'], floors: [fl(0, 4), fl(4, 10, 0.4), fl(10, 14)],
    trapSlots: [{ x: 0, z: 7 }] },
  { id: 'stairs_up', len: 16, difficulty: 3, tags: ['ramp', 'step'], floors: [fl(0, 3), fl(3, 6, 0.4), fl(6, 10, 0.8), fl(10, 12, 0.4), fl(12, 16)] },
  { id: 'gap_then_gate', len: 20, difficulty: 4, tags: ['gap', 'mover', 'hard'], floors: [fl(0, 5), fl(9, 20)],
    obstacles: [gate(0, 15, 3.0, 100, 0)] },
  { id: 'weave_then_gap', len: 20, difficulty: 4, tags: ['weave', 'gap', 'hard'], floors: [fl(0, 13), fl(16.5, 20)],
    obstacles: [wall(3.1, 3.5), wall(-3.1, 7)] },
  // Extra variety (Tanda 2) — all built from the same wall/gate the bot can read.
  { id: 'wall_wave', len: 20, difficulty: 3, tags: ['weave', 'dodge'], floors: [fl(0, 20)],
    obstacles: [wall(-3.1, 4), wall(3.1, 9), wall(-3.1, 14), wall(3.1, 19)] },
  { id: 'triple_weave', len: 22, difficulty: 4, tags: ['weave', 'dodge', 'hard'], floors: [fl(0, 22)],
    obstacles: [wall(-3.1, 4), wall(3.1, 8), wall(-3.1, 12), wall(3.1, 16), wall(-3.1, 20)] },
  { id: 'gate_wide', len: 16, difficulty: 4, tags: ['mover', 'dodge', 'hard'], floors: [fl(0, 16)],
    obstacles: [gate(0, 8, 3.6, 90, 0, 4.4)] },
  { id: 'gap_gate_gap', len: 24, difficulty: 4, tags: ['gap', 'mover', 'jump', 'hard'], floors: [fl(0, 5), fl(9, 17), fl(21, 24)],
    obstacles: [gate(0, 13, 2.8, 98, 0)] },
  { id: 'kerb_weave', len: 18, difficulty: 3, tags: ['step', 'weave'], floors: [fl(0, 4), fl(4, 14, 0.4), fl(14, 18)],
    obstacles: [wall(3.1, 8), wall(-3.1, 11.5)], trapSlots: [{ x: 0, z: 6 }] },
  // --- Verticality (changing heights, Fall-Guys style). Up-steps are small
  // (≤0.4, the ball rolls over); drops are free; every chunk starts & ends at
  // top 0 so seams connect and the autopilot stays completable. ---
  { id: 'ascend_descend', len: 20, difficulty: 2, tags: ['ramp', 'step', 'height'], floors: [
    fl(0, 3), fl(3, 5, 0.35), fl(5, 7, 0.7), fl(7, 11, 1.0), fl(11, 13, 0.7), fl(13, 15, 0.35), fl(15, 20)] },
  { id: 'stepped_mesa', len: 22, difficulty: 2, tags: ['ramp', 'step', 'height'], floors: [
    fl(0, 3), fl(3, 5, 0.35), fl(5, 7, 0.7), fl(7, 14, 1.05), fl(14, 16, 0.7), fl(16, 18, 0.35), fl(18, 22)],
    trapSlots: [{ x: 0, z: 10 }] },
  { id: 'undulate', len: 20, difficulty: 3, tags: ['ramp', 'step', 'height'], floors: [
    fl(0, 2), fl(2, 4, 0.35), fl(4, 6), fl(6, 8, 0.35), fl(8, 10), fl(10, 12, 0.35), fl(12, 14), fl(14, 16, 0.35), fl(16, 20)] },
  { id: 'sunken_dip', len: 18, difficulty: 2, tags: ['step', 'height'], floors: [
    fl(0, 4), fl(4, 6, -0.35), fl(6, 12, -0.7), fl(12, 14, -0.35), fl(14, 18)],
    trapSlots: [{ x: 0, z: 9 }] },
  // Ascend to a plateau, descend back to flat, then a GROUND-LEVEL gap (a step
  // up right before a gap launches the ball and breaks the jump — always take
  // off from flat ground).
  { id: 'ramp_gap_ramp', len: 24, difficulty: 4, tags: ['ramp', 'gap', 'jump', 'height', 'hard'], floors: [
    fl(0, 3), fl(3, 5, 0.35), fl(5, 8, 0.7), fl(8, 10, 0.35), fl(10, 14), fl(17, 24)] },
  { id: 'plateau_weave', len: 22, difficulty: 3, tags: ['ramp', 'weave', 'height'], floors: [
    fl(0, 3), fl(3, 5, 0.35), fl(5, 16, 0.7), fl(16, 18, 0.35), fl(18, 22)],
    obstacles: [wall(3.1, 8), wall(-3.1, 12)] },

  // --- Fall-Guys moving hazards. Every one leaves a guaranteed clear lane
  // (partial-width pistons / centre spinners with clear outer lanes) so the
  // autopilot stays completable, while humans get a risky timed shortcut. ---
  { id: 'spinner_gate', len: 18, difficulty: 3, tags: ['spinner', 'dodge'], floors: [fl(0, 18)],
    obstacles: [spinner(0, 9, 175, 0)] },
  { id: 'twin_spinners', len: 26, difficulty: 4, tags: ['spinner', 'dodge', 'hard'], floors: [fl(0, 26)],
    obstacles: [spinner(0, 8, 165, 0), spinner(0, 17, 165, 82)] },
  { id: 'piston_row', len: 18, difficulty: 3, tags: ['crusher', 'dodge'], floors: [fl(0, 18)],
    obstacles: [crusher(-2.4, 7, 84, 0), crusher(2.4, 7, 84, 42), crusher(0, 13, 84, 20)] },
  { id: 'piston_gauntlet', len: 24, difficulty: 4, tags: ['crusher', 'dodge', 'hard'], floors: [fl(0, 24)],
    obstacles: [crusher(-2.4, 7, 82, 0), crusher(2.4, 13, 82, 40), crusher(0, 19, 82, 16)] },
  { id: 'spin_and_smash', len: 26, difficulty: 4, tags: ['spinner', 'crusher', 'dodge', 'hard'], floors: [fl(0, 26)],
    obstacles: [spinner(0, 8, 150, 0), crusher(-2.4, 17, 84, 0), crusher(2.4, 17, 84, 42)] },

  // --- Non-linear "giros": the safe path snakes hard left↔right, climbs high,
  // and (winding_beam) threads a curving ribbon over the void. Longer chunks =
  // longer levels. All kept death-free-completable by the autopilot. ---
  { id: 'serpentine', len: 26, difficulty: 3, tags: ['weave', 'dodge', 'giros'], floors: [fl(0, 26)],
    obstacles: [wall(-3.4, 4, 3.8), wall(3.4, 9, 3.8), wall(-3.4, 14, 3.8), wall(3.4, 19, 3.8), wall(-3.4, 24, 3.8)] },
  { id: 'grand_stairs', len: 28, difficulty: 3, tags: ['ramp', 'step', 'height'], floors: [
    fl(0, 3), fl(3, 5, 0.4), fl(5, 7, 0.8), fl(7, 9, 1.2), fl(9, 14, 1.6), fl(14, 16, 1.2), fl(16, 18, 0.8), fl(18, 20, 0.4), fl(20, 28)],
    // Trap on the flat top-0 run-out — a trap box is anchored at ground level,
    // so a slot on the 1.6-high plateau would sit buried below the runner.
    trapSlots: [{ x: 0, z: 24 }] },
  { id: 'winding_beam', len: 24, difficulty: 4, tags: ['narrow', 'giros', 'hard'], floors: [
    fl(0, 3.5), beam(3.5, 8, 5.6, -1.8), beam(8, 12.5, 5.6, 1.8), beam(12.5, 17, 5.6, -1.8), fl(17, 24)] },
  { id: 'hill_weave', len: 24, difficulty: 4, tags: ['weave', 'height', 'hard'], floors: [
    fl(0, 3), fl(3, 5, 0.4), fl(5, 19, 0.8), fl(19, 21, 0.4), fl(21, 24)],
    obstacles: [wall(-3.2, 8, 3.6), wall(3.2, 13, 3.6), wall(-3.2, 18, 3.6)] },
];

const START = CHUNKS.find((c) => c.id === 'start_run')!;
const POOL = CHUNKS.filter((c) => c.id !== 'start_run');

function appendChunk(chunk: Chunk, base: number, floors: Box[], obstacles: Obstacle[], slots: TrapSlot3D[]) {
  for (const f of chunk.floors) {
    const top = f.top ?? 0;
    const z0 = base + f.z0;
    const z1 = base + f.z1;
    const d = z1 - z0;
    floors.push({ x: f.x ?? 0, y: top - FLOOR_H / 2, z: z0 + d / 2, w: f.w ?? HALF * 2, h: FLOOR_H, d });
  }
  for (const o of chunk.obstacles ?? []) {
    obstacles.push({
      kind: o.kind, x: o.x, y: o.y ?? 1.1, z: base + o.z,
      w: o.w ?? 3.4, h: o.h ?? 2.2, d: o.d ?? 1.1, amp: o.amp, period: o.period, phase: o.phase,
    });
  }
  for (const s of chunk.trapSlots ?? []) {
    slots.push({ id: `${base.toFixed(0)}:${s.x}:${s.z}`, x: s.x, z: base + s.z });
  }
}

/**
 * Deterministically assemble an aerial course from a seed + daily config.
 * `config.length` sets the number of chunks, `config.maxDifficulty` caps the
 * ramp, `config.dailyModifier` tweaks physics (applied at sim time). Same
 * (seed, config) => identical course for the whole league.
 */
export function assembleCourse3D(seed: number, config: DailyConfig): Course3D {
  const rng = new Rng(seed);
  const palette = PALETTES[rng.int(0, PALETTES.length - 1)];
  const segments = Math.max(6, Math.min(20, config.length ?? 14));
  const maxDiff = Math.max(1, Math.min(4, config.maxDifficulty ?? 4));

  const floors: Box[] = [];
  const obstacles: Obstacle[] = [];
  const trapSlots: TrapSlot3D[] = [];
  const checkpoints: number[] = [];
  const chunkIds: string[] = [];

  let z = 0;
  checkpoints.push(0);
  appendChunk(START, z, floors, obstacles, trapSlots);
  chunkIds.push(START.id);
  z += START.len;

  let lastId = START.id;
  for (let i = 0; i < segments; i++) {
    const t = segments <= 1 ? 1 : i / (segments - 1);
    const target = 1 + t * (maxDiff - 1);
    const weights = POOL.map((c) => {
      if (c.id === lastId) return 0;
      if (c.difficulty > maxDiff + 0.5) return 0;
      const diff = Math.abs(c.difficulty - target);
      let w = 1 / (1 + diff * diff);
      if (c.tags.includes('flat')) w = 0.12;
      return w;
    });
    const chunk = rng.weightedPick(POOL, weights);
    checkpoints.push(z);
    appendChunk(chunk, z, floors, obstacles, trapSlots);
    chunkIds.push(chunk.id);
    z += chunk.len;
    lastId = chunk.id;
  }

  checkpoints.push(z);
  appendChunk({ id: 'finish_pad', len: 16, difficulty: 0, tags: ['finish'], floors: [fl(0, 16)] }, z, floors, obstacles, trapSlots);
  chunkIds.push('finish_pad');

  return {
    seed,
    halfWidth: HALF,
    floors,
    obstacles,
    trapSlots,
    checkpoints,
    startZ: 0,
    finishZ: z + 3,
    palette,
    theme: config.theme ?? palette.theme,
    modifier: config.dailyModifier ?? 'none',
    flavorText: config.flavorText ?? '',
    chunkIds,
  };
}

export const DEFAULT_SEGMENTS = 14;
export type { DailyModifier };
