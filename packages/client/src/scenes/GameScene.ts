import Phaser from 'phaser';
import {
  SimWorld,
  FIXED_DT,
  MAX_RUN_FRAMES,
  autopilot,
  type Course,
  type PlacedTrap,
  type InputEventType,
} from '@trampa/shared';
import { PPM } from '../config.js';
import { LevelRenderer } from '../game/LevelRenderer.js';
import { InputRecorder } from '../game/InputRecorder.js';
import type { PreparedGhost } from '../game/ghosts.js';
import { equippedSkin } from '../cosmetics.js';

export interface GameSceneData {
  course: Course;
  courseId?: string;
  placedTraps: PlacedTrap[];
  ghosts: PreparedGhost[];
  online: boolean;
  playDate?: string;
  /** Run context: which mode/flow produced this run (see result screen). */
  mode?: 'league' | 'global' | 'room';
  roomId?: string;
  roomIdx?: number;
  numCourses?: number;
  shareable?: boolean;
  /** Dev/demo mode: let the shared autopilot play the run (see ?autoplay). */
  autoplay?: boolean;
}

const GHOST_COLORS = [0xff6b9d, 0xffd23c, 0x6bffb0, 0x6b9dff, 0xd26bff];

export class GameScene extends Phaser.Scene {
  private runData!: GameSceneData;
  private world!: SimWorld;
  private recorder!: InputRecorder;
  private level!: LevelRenderer;

  private playerGfx!: Phaser.GameObjects.Container;
  private playerBody!: Phaser.GameObjects.Arc;
  private ghostGfx: Phaser.GameObjects.Arc[] = [];
  private ghostLabels: Phaser.GameObjects.Text[] = [];

  private acc = 0;
  private pending: InputEventType[] = [];
  private autoEvents: Map<number, InputEventType[]> | null = null;
  private prevX = 0;
  private prevY = 0;
  private done = false;

  private timerText!: Phaser.GameObjects.Text;
  private flavorText!: Phaser.GameObjects.Text;
  private chargeBar!: Phaser.GameObjects.Graphics;
  private charging = false;

  constructor() {
    super('Game');
  }

  init(data: GameSceneData) {
    this.runData = data;
    this.acc = 0;
    this.pending = [];
    this.done = false;
    this.charging = false;
    this.ghostGfx = [];
    this.ghostLabels = [];
  }

  create() {
    const c = this.runData.course;
    this.cameras.main.setBackgroundColor(c.palette.bg);

    this.world = new SimWorld(c, this.runData.placedTraps);
    this.recorder = new InputRecorder(c.seed);
    this.level = new LevelRenderer(this, c, this.runData.placedTraps);

    // Demo/CI autoplay: precompute the autopilot's input log and replay it,
    // frame-indexed, so the run drives itself deterministically.
    if (this.runData.autoplay) {
      const log = autopilot(c, this.runData.placedTraps).log;
      this.autoEvents = new Map();
      for (const ev of log.events) {
        const arr = this.autoEvents.get(ev.f) ?? [];
        arr.push(ev.t);
        this.autoEvents.set(ev.f, arr);
      }
    }

    // Ghosts
    this.runData.ghosts.forEach((g, i) => {
      const color = GHOST_COLORS[i % GHOST_COLORS.length];
      const arc = this.add.circle(0, 0, this.world.physics.playerRadius * PPM, color, 0.35);
      arc.setStrokeStyle(2, color, 0.6);
      this.ghostGfx.push(arc);
      const label = this.add
        .text(0, 0, g.handle, { fontSize: '12px', color: '#ffffff' })
        .setAlpha(0.6)
        .setOrigin(0.5, 1);
      this.ghostLabels.push(label);
    });

    // Player
    const skin = equippedSkin();
    this.playerBody = this.add.circle(0, 0, this.world.physics.playerRadius * PPM, skin.body, 1);
    this.playerBody.setStrokeStyle(3, skin.trail, 1);
    const eye = this.add.circle(this.world.physics.playerRadius * PPM * 0.3, -this.world.physics.playerRadius * PPM * 0.2, 3, 0x000000, 1);
    this.playerGfx = this.add.container(0, 0, [this.playerBody, eye]);
    this.playerGfx.setDepth(10);

    const p = this.world.getPlayer();
    this.prevX = p.x;
    this.prevY = p.y;

    // Camera
    this.cameras.main.setBounds(0, -PPM * 6, c.widthTiles * PPM + PPM * 4, c.heightTiles * PPM + PPM * 12);
    this.cameras.main.startFollow(this.playerGfx, true, 0.15, 0.15);
    this.cameras.main.setDeadzone(120, 200);
    this.cameras.main.setZoom(1);

    // HUD (fixed to screen)
    this.timerText = this.add
      .text(16, 16, '0.00', { fontSize: '28px', color: '#ffffff', fontStyle: 'bold' })
      .setScrollFactor(0)
      .setDepth(100);
    this.flavorText = this.add
      .text(16, 52, c.flavorText, { fontSize: '14px', color: '#8fa' })
      .setScrollFactor(0)
      .setDepth(100);
    if (c.modifier && c.modifier !== 'none') {
      this.add
        .text(16, 74, `MODIFICADOR: ${c.modifier}`, { fontSize: '13px', color: '#ffd23c' })
        .setScrollFactor(0)
        .setDepth(100);
    }
    this.add
      .text(this.scale.width - 16, 16, 'TAP = salto · MANTÉN = cargar', {
        fontSize: '12px',
        color: '#aaa',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100);

    this.chargeBar = this.add.graphics().setScrollFactor(0).setDepth(100);

    // Input: pointer + keyboard (desktop dev)
    this.input.on('pointerdown', () => this.onPress());
    this.input.on('pointerup', () => this.onRelease());
    this.input.keyboard?.on('keydown-SPACE', (e: KeyboardEvent) => {
      if (!e.repeat) this.onPress();
    });
    this.input.keyboard?.on('keyup-SPACE', () => this.onRelease());
    this.input.keyboard?.on('keydown-UP', (e: KeyboardEvent) => {
      if (!e.repeat) this.onPress();
    });
    this.input.keyboard?.on('keyup-UP', () => this.onRelease());
  }

  private onPress() {
    if (this.done) return;
    this.pending.push('press');
    this.charging = true;
  }
  private onRelease() {
    if (this.done) return;
    this.pending.push('release');
    this.charging = false;
  }

  update(_time: number, deltaMs: number) {
    if (this.done) return;

    // Clamp delta to avoid the spiral of death on a hitch.
    const dt = Math.min(deltaMs / 1000, 0.1);
    this.acc += dt;

    while (this.acc >= FIXED_DT) {
      this.prevX = this.world.getPlayer().x;
      this.prevY = this.world.getPlayer().y;

      // Autoplay: inject the autopilot's events for this frame.
      if (this.autoEvents) {
        const evs = this.autoEvents.get(this.world.frame);
        if (evs) for (const t of evs) this.pending.push(t);
      }

      // Apply queued input at this exact frame (recorded identically).
      if (this.pending.length) {
        for (const t of this.pending) {
          if (t === 'press') this.world.press();
          else if (t === 'release') this.world.release();
          else this.world.tap();
          this.recorder.record(this.world.frame, t);
        }
        this.pending.length = 0;
      }

      this.world.step();
      this.acc -= FIXED_DT;

      if (this.world.finished || this.world.frame >= MAX_RUN_FRAMES) {
        this.finish();
        return;
      }
    }

    const alpha = this.acc / FIXED_DT;
    this.render(alpha);
  }

  private render(alpha: number) {
    const p = this.world.getPlayer();
    const ix = Phaser.Math.Linear(this.prevX, p.x, alpha);
    const iy = Phaser.Math.Linear(this.prevY, p.y, alpha);
    this.playerGfx.setPosition(ix * PPM, iy * PPM);
    this.playerGfx.setRotation(p.spin);

    this.level.updateDynamic(this.world.frame);

    // Ghosts at the current frame.
    const f = this.world.frame;
    this.runData.ghosts.forEach((g, i) => {
      const fr = g.frames[Math.min(f, g.frames.length - 1)];
      if (!fr) return;
      const arc = this.ghostGfx[i];
      arc.setPosition(fr.x * PPM, fr.y * PPM);
      const label = this.ghostLabels[i];
      label.setPosition(fr.x * PPM, fr.y * PPM - this.world.physics.playerRadius * PPM - 4);
    });

    // HUD
    this.timerText.setText((this.world.timeMs() / 1000).toFixed(2));
    this.drawCharge();
  }

  private drawCharge() {
    const g = this.chargeBar;
    g.clear();
    if (!this.charging) return;
    const w = 160;
    const x = this.scale.width / 2 - w / 2;
    const y = this.scale.height - 40;
    g.fillStyle(0x000000, 0.4);
    g.fillRect(x, y, w, 12);
    // Approximate charge fill from how long the pointer has been down.
    const held = Math.min(
      (this.world.frame - (this.world as any).chargeStartFrame) / 60,
      0.5,
    );
    const frac = Math.max(0, Math.min(1, held / 0.5));
    g.fillStyle(0x38e1ff, 1);
    g.fillRect(x, y, w * frac, 12);
  }

  private finish() {
    if (this.done) return;
    this.done = true;
    const finished = this.world.finished;
    const result: RunResult = {
      course: this.runData.course,
      courseId: this.runData.courseId,
      timeMs: this.world.timeMs(),
      deaths: this.world.deaths,
      finished,
      inputLog: this.recorder.toLog(),
      placedTraps: this.runData.placedTraps,
      online: this.runData.online,
      playDate: this.runData.playDate,
      mode: this.runData.mode,
      roomId: this.runData.roomId,
      roomIdx: this.runData.roomIdx,
      numCourses: this.runData.numCourses,
      shareable: this.runData.shareable,
    };
    this.world.free();
    this.scene.stop();
    this.game.events.emit('run:finished', result);
  }
}

export interface RunResult {
  course: Course;
  courseId?: string;
  timeMs: number;
  deaths: number;
  finished: boolean;
  inputLog: ReturnType<InputRecorder['toLog']>;
  placedTraps: PlacedTrap[];
  online: boolean;
  playDate?: string;
  mode?: 'league' | 'global' | 'room';
  roomId?: string;
  roomIdx?: number;
  numCourses?: number;
  shareable?: boolean;
}
