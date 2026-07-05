import type { Course3D, PlacedTrap3D, InputLog3D, SimFrame3D } from '@trampa/shared';
import type { LiveHeat } from './net/live.js';

export interface PreparedGhost3D {
  handle: string;
  timeMs: number;
  frames: SimFrame3D[];
}

/** What the overlay hands to the engine to start a run. */
export interface GameData3D {
  course: Course3D;
  courseId?: string;
  placedTraps: PlacedTrap3D[];
  ghosts: PreparedGhost3D[];
  online: boolean;
  playDate?: string;
  mode?: 'league' | 'global' | 'room';
  roomId?: string;
  roomIdx?: number;
  numCourses?: number;
  shareable?: boolean;
  autoplay?: boolean;
  /** Live multiplayer heat (MVP): stream my position + see rivals live. */
  live?: LiveHeat;
  liveStartAtMs?: number;
}

/** What the engine emits when a run ends. */
export interface RunResult3D {
  course: Course3D;
  courseId?: string;
  timeMs: number;
  deaths: number;
  finished: boolean;
  style?: number;
  attempts?: number;
  inputLog: InputLog3D;
  placedTraps: PlacedTrap3D[];
  online: boolean;
  playDate?: string;
  mode?: 'league' | 'global' | 'room';
  roomId?: string;
  roomIdx?: number;
  numCourses?: number;
  shareable?: boolean;
}
