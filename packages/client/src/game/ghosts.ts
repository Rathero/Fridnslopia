import { simulateRun } from '@trampa/shared';
import type { Course, InputLog, PlacedTrap, SimFrame } from '@trampa/shared';

export interface PreparedGhost {
  handle: string;
  timeMs: number;
  frames: SimFrame[];
}

/**
 * Pre-simulate each friend's input log against the same course to get their
 * exact frame-by-frame trajectory (spec §7). Because the sim is deterministic
 * we can replay them as translucent "ghost runners" perfectly in sync.
 */
export async function prepareGhosts(
  course: Course,
  logs: { handle: string; timeMs: number; inputLog: InputLog }[],
  placedTraps: PlacedTrap[],
): Promise<PreparedGhost[]> {
  const out: PreparedGhost[] = [];
  for (const g of logs) {
    try {
      const res = await simulateRun(course, g.inputLog, placedTraps, {
        recordFrames: true,
      });
      out.push({ handle: g.handle, timeMs: g.timeMs, frames: res.frames });
    } catch {
      // Skip a ghost that fails to replay rather than break the run.
    }
  }
  return out;
}
