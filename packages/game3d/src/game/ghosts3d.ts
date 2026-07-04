import { simulateRun3D } from '@trampa/shared';
import type { Course3D, InputLog3D, PlacedTrap3D } from '@trampa/shared';
import type { PreparedGhost3D } from '../types.js';

/**
 * Pre-simulate each friend's 3D input log against the same course to get their
 * exact frame-by-frame trajectory, so they can be rendered as translucent ghost
 * runners perfectly in sync (deterministic replay).
 */
export async function prepareGhosts3D(
  course: Course3D,
  logs: { handle: string; timeMs: number; inputLog: InputLog3D }[],
  placedTraps: PlacedTrap3D[],
): Promise<PreparedGhost3D[]> {
  const out: PreparedGhost3D[] = [];
  for (const g of logs) {
    try {
      const res = await simulateRun3D(course, g.inputLog, placedTraps, { recordFrames: true });
      out.push({ handle: g.handle, timeMs: g.timeMs, frames: res.frames });
    } catch {
      // skip a ghost that fails to replay
    }
  }
  return out;
}

export type { PreparedGhost3D } from '../types.js';
