/**
 * Deterministic PRNG — mulberry32.
 *
 * The golden rule (spec §2): NOTHING that affects the simulation may use
 * Math.random(). Every random draw derives from the dailySeed through a
 * seeded PRNG so that the same seed reproduces the exact same course, on
 * every machine, forever. This is what makes ghosts and fair leagues work.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Force to uint32 so behaviour is identical regardless of how the seed
    // arrived (bigint from Postgres, float, etc).
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Pick one element uniformly. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /**
   * Weighted pick. weights[i] corresponds to arr[i]. Deterministic given the
   * PRNG state. Falls back to a uniform pick if all weights are <= 0.
   */
  weightedPick<T>(arr: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, w) => a + Math.max(0, w), 0);
    if (total <= 0) return this.pick(arr);
    let r = this.next() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return arr[i];
    }
    return arr[arr.length - 1];
  }
}

/**
 * Derive a stable integer seed from a string (e.g. a league id + date).
 * FNV-1a 32-bit. Deterministic and cross-platform.
 */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
