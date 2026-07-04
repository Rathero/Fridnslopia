import { Rng } from '@trampa/shared';

/**
 * A 3D "cenital" (aerial) obstacle course. Forward is +Z; the runner auto-runs
 * into the screen, dodging left/right and jumping gaps. Everything is generated
 * deterministically from a seed so the same seed => the same course for the
 * whole lobby (same principle as the 2D game — ghosts + fair leagues survive).
 *
 * Coordinate convention: X = lateral (left/right), Y = up, Z = forward. Boxes
 * are centre + full size (w=x, h=y, d=z).
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
}

const PALETTES = [
  { theme: 'neon', floor: 0x243154, floor2: 0x1b2540, accent: 0x45e0ff, obstacle: 0xff5470, fog: 0x0a1024 },
  { theme: 'sunset', floor: 0x40243f, floor2: 0x301a30, accent: 0xffb703, obstacle: 0xef476f, fog: 0x1a0f1e },
  { theme: 'toxic', floor: 0x213a2a, floor2: 0x172a1f, accent: 0x9dff3c, obstacle: 0xff7b00, fog: 0x0c1a10 },
  { theme: 'ice', floor: 0x27384f, floor2: 0x1c2a3c, accent: 0x8ad7ff, obstacle: 0xff5470, fog: 0x0b1622 },
];

const HALF = 5; // playfield spans X in [-5, 5]
const SEG = 14; // length of each segment along Z
const FLOOR_TOP = 0;
const FLOOR_H = 1.2;

function floorBox(zStart: number, zEnd: number, xCenter = 0, width = HALF * 2): Box {
  const d = zEnd - zStart;
  return { x: xCenter, y: FLOOR_TOP - FLOOR_H / 2, z: zStart + d / 2, w: width, h: FLOOR_H, d };
}

/** Generate a deterministic aerial course. */
export function makeCourse(seed: number, segments = 14): Course3D {
  const rng = new Rng(seed);
  const palette = PALETTES[rng.int(0, PALETTES.length - 1)];

  const floors: Box[] = [];
  const obstacles: Obstacle[] = [];
  const checkpoints: number[] = [];

  let z = 0;
  // Safe run-up.
  floors.push(floorBox(-6, SEG));
  checkpoints.push(0);
  z = SEG;

  const types = ['flat', 'gap', 'weave', 'movers', 'narrow'] as const;

  for (let i = 0; i < segments; i++) {
    checkpoints.push(z);
    // Ramp difficulty: early segments are calmer.
    const pool = i < 2 ? (['flat', 'weave'] as const) : types;
    const type = rng.pick(pool);
    const z0 = z;
    const z1 = z + SEG;

    if (type === 'flat') {
      floors.push(floorBox(z0, z1));
    } else if (type === 'gap') {
      const a = z0 + rng.float(4, 6);
      const gap = rng.float(3.2, 4.2);
      floors.push(floorBox(z0, a));
      floors.push(floorBox(a + gap, z1));
    } else if (type === 'weave') {
      floors.push(floorBox(z0, z1));
      const n = rng.int(2, 3);
      for (let k = 0; k < n; k++) {
        const lane = rng.pick([-3.1, 0, 3.1]);
        const zc = z0 + 3 + (k * (SEG - 4)) / n + rng.float(-0.6, 0.6);
        obstacles.push({ kind: 'wall', x: lane, y: 1.1, z: zc, w: 3.4, h: 2.2, d: 1.1 });
      }
    } else if (type === 'movers') {
      floors.push(floorBox(z0, z1));
      const zc = z0 + SEG / 2;
      obstacles.push({
        kind: 'mover',
        x: 0,
        y: 1.1,
        z: zc,
        w: 4.2,
        h: 2.2,
        d: 1.1,
        amp: 3.2,
        period: rng.int(70, 110),
        phase: rng.int(0, 60),
      });
    } else {
      // narrow: only the centre has floor; edges are gaps.
      const w = rng.float(3.4, 4.4);
      floors.push(floorBox(z0, z1, 0, w));
    }
    z = z1;
  }

  // Finish pad.
  floors.push(floorBox(z, z + SEG));
  const finishZ = z + 2;

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
  };
}
