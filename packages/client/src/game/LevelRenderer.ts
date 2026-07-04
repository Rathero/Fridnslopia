import Phaser from 'phaser';
import type { Course, PlacedTrap } from '@trampa/shared';
import { PPM } from '../config.js';

/**
 * Draws the course: static platforms, moving platforms, hazards, traps,
 * checkpoints and the finish line. Movers/saws are recomputed each frame from
 * the same deterministic formula the sim uses, so what you see is what kills
 * you. Rendering only — never feeds back into the simulation.
 */
export class LevelRenderer {
  private staticG: Phaser.GameObjects.Graphics;
  private dynG: Phaser.GameObjects.Graphics;
  private course: Course;
  private traps: PlacedTrap[];

  constructor(scene: Phaser.Scene, course: Course, traps: PlacedTrap[]) {
    this.course = course;
    this.traps = traps;
    this.staticG = scene.add.graphics();
    this.dynG = scene.add.graphics();
    this.drawStatic();
  }

  private hex(s: string): number {
    return parseInt(s.replace('#', ''), 16);
  }

  private drawStatic() {
    const g = this.staticG;
    const c = this.course;
    const plat = this.hex(c.palette.platform);
    const accent = this.hex(c.palette.accent);

    // Platforms
    g.fillStyle(plat, 1);
    for (const p of c.platforms) {
      g.fillRect(p.x * PPM, p.y * PPM, p.w * PPM, p.h * PPM);
      g.lineStyle(2, accent, 0.5);
      g.strokeRect(p.x * PPM, p.y * PPM, p.w * PPM, 3);
    }

    // Static spikes
    g.fillStyle(0xff3355, 1);
    for (const h of c.hazards) {
      if (h.type !== 'spike') continue;
      this.drawSpike(g, h.x, h.y);
    }

    // Checkpoints (subtle flags)
    g.lineStyle(2, 0x66ff99, 0.7);
    for (const cp of c.checkpoints) {
      g.lineBetween(cp.x * PPM, (cp.y - 1.5) * PPM, cp.x * PPM, cp.y * PPM);
      g.fillStyle(0x66ff99, 0.7);
      g.fillTriangle(
        cp.x * PPM,
        (cp.y - 1.5) * PPM,
        cp.x * PPM,
        (cp.y - 0.9) * PPM,
        (cp.x + 0.6) * PPM,
        (cp.y - 1.2) * PPM,
      );
    }

    // Finish line (checkerboard-ish)
    const fx = c.finishX * PPM;
    for (let i = 0; i < 12; i++) {
      g.fillStyle(i % 2 === 0 ? 0xffffff : 0x111111, 1);
      g.fillRect(fx, (c.heightTiles - i) * (PPM * 0.5) - PPM * 6, 8, PPM * 0.5);
    }

    // Placed traps
    for (const t of this.traps) this.drawTrap(g, t);
  }

  private drawSpike(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    g.fillStyle(0xff3355, 1);
    g.fillTriangle(
      x * PPM,
      (y + 1) * PPM,
      (x + 0.5) * PPM,
      y * PPM,
      (x + 1) * PPM,
      (y + 1) * PPM,
    );
  }

  private drawTrap(g: Phaser.GameObjects.Graphics, t: PlacedTrap) {
    const color =
      t.trapType === 'spike' ? 0xff2266 : t.trapType === 'bounce' ? 0xffcc00 : 0x22ffcc;
    g.fillStyle(color, 0.9);
    g.fillCircle((t.slotX + 0.5) * PPM, (t.slotY + 0.5) * PPM, PPM * 0.35);
    g.lineStyle(2, 0x000000, 0.4);
    g.strokeCircle((t.slotX + 0.5) * PPM, (t.slotY + 0.5) * PPM, PPM * 0.35);
  }

  /** Redraw the moving elements for the given simulation frame. */
  updateDynamic(frame: number) {
    const g = this.dynG;
    g.clear();
    const c = this.course;
    const plat = this.hex(c.palette.platform);
    const accent = this.hex(c.palette.accent);

    for (const m of c.movers) {
      const off = m.amp * Math.sin((2 * Math.PI * (frame + (m.phase ?? 0))) / m.period);
      const dx = m.axis === 'x' ? off : 0;
      const dy = m.axis === 'y' ? off : 0;
      g.fillStyle(plat, 1);
      g.fillRect((m.x + dx) * PPM, (m.y + dy) * PPM, m.w * PPM, m.h * PPM);
      g.lineStyle(2, accent, 0.8);
      g.strokeRect((m.x + dx) * PPM, (m.y + dy) * PPM, m.w * PPM, 3);
    }

    for (const h of c.hazards) {
      if (h.type !== 'saw') continue;
      const off = (h.amp ?? 0) * Math.sin((2 * Math.PI * (frame + (h.phase ?? 0))) / (h.period ?? 1));
      const dx = h.axis === 'x' ? off : 0;
      const dy = h.axis === 'y' ? off : 0;
      const cx = (h.x + 0.5 + dx) * PPM;
      const cy = (h.y + 0.5 + dy) * PPM;
      g.fillStyle(0xcccccc, 1);
      g.fillCircle(cx, cy, PPM * 0.5);
      g.lineStyle(3, 0xff3355, 1);
      g.strokeCircle(cx, cy, PPM * 0.5);
      // spinning tick
      const a = (frame * 0.3) % (Math.PI * 2);
      g.lineStyle(2, 0x333333, 1);
      g.lineBetween(cx, cy, cx + Math.cos(a) * PPM * 0.5, cy + Math.sin(a) * PPM * 0.5);
    }
  }
}
