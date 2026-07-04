import type { Hazard, Mover, Point, Rect } from './chunks/types.js';

/** A trap a player placed into a course slot (spec §5 traps table). */
export type TrapType = 'spike' | 'bounce' | 'glue';

export interface PlacedTrap {
  slotX: number;
  slotY: number;
  trapType: TrapType;
  /** Who placed it — used purely for rendering/labels, not the sim. */
  userId?: string;
  ownerHandle?: string;
}

/** A trap slot with a stable id (absolute tile coords). */
export interface CourseTrapSlot {
  id: string;
  x: number;
  y: number;
}

/**
 * A fully laid-out, absolute-coordinate course ready for the sim + renderer.
 * Produced deterministically by the assembler from (dailySeed, config).
 */
export interface Course {
  seed: number;
  chunkIds: string[];
  widthTiles: number;
  heightTiles: number;

  platforms: Rect[];
  movers: Mover[];
  hazards: Hazard[];
  trapSlots: CourseTrapSlot[];
  /** Sorted ascending by x. Player respawns at the last one passed. */
  checkpoints: Point[];

  startX: number;
  startY: number;
  finishX: number;

  /** Presentation + rules metadata (from the daily config). */
  theme: string;
  palette: { bg: string; platform: string; accent: string };
  modifier: string;
  flavorText: string;
}
