import RAPIER from '@dimforge/rapier2d-compat';
import {
  FIXED_DT,
  applyModifier,
  type DailyModifier,
} from '../constants.js';
import type { Course, PlacedTrap } from '../course.js';

let rapierReady: Promise<void> | null = null;

/** Idempotently initialise the Rapier WASM module. Must be awaited once. */
export function initRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

export type InputEventType = 'press' | 'release' | 'tap';
export interface InputEvent {
  f: number;
  t: InputEventType;
}
export interface InputLog {
  seed: number;
  events: InputEvent[];
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  /** Visual spin (radians) for the sprite — derived, not simulated. */
  spin: number;
}

interface Danger {
  effect: 'kill' | 'bounce' | 'glue';
  aabb: (frame: number) => { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * The single source of truth for movement. Live play, ghost replay and the
 * server's anti-cheat re-sim ALL run this exact class, so a recorded input log
 * reproduces bit-for-bit. Fixed 60Hz step, seeded, deterministic body order.
 */
export class SimWorld {
  readonly world: RAPIER.World;
  readonly course: Course;
  readonly physics: ReturnType<typeof applyModifier>;

  frame = 0;
  finished = false;
  penaltySeconds = 0;
  deaths = 0;

  private player!: RAPIER.RigidBody;
  private playerRadius: number;
  private movers: { body: RAPIER.RigidBody; base: { x: number; y: number }; def: any }[] = [];
  private dangers: Danger[] = [];

  private chargeStartFrame = -1;
  private charging = false;
  private framesSinceGrounded = 999;
  private groundedNow = false;
  private gluedFrames = 0;
  private bounceCooldown = 0;
  private spin = 0;
  private lastCheckpoint: { x: number; y: number };
  private killY: number;

  constructor(course: Course, placedTraps: PlacedTrap[] = []) {
    this.course = course;
    this.physics = applyModifier(course.modifier as DailyModifier);
    this.playerRadius = this.physics.playerRadius;
    this.killY = course.heightTiles + 3;
    this.lastCheckpoint = { x: course.startX, y: course.startY };

    this.world = new RAPIER.World({ x: 0, y: this.physics.gravity });
    this.world.timestep = FIXED_DT;

    // --- Static platforms (created in array order = deterministic) ---
    for (const p of course.platforms) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(p.x + p.w / 2, p.y + p.h / 2),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(p.w / 2, p.h / 2).setFriction(0.0),
        body,
      );
    }

    // --- Kinematic moving platforms ---
    for (const m of course.movers) {
      const cx = m.x + m.w / 2;
      const cy = m.y + m.h / 2;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, cy),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(m.w / 2, m.h / 2).setFriction(0.0),
        body,
      );
      this.movers.push({ body, base: { x: cx, y: cy }, def: m });
    }

    // --- Static hazards (spikes) + moving hazards (saws) ---
    for (const h of course.hazards) {
      if (h.type === 'spike') {
        this.dangers.push({
          effect: 'kill',
          aabb: () => ({ minX: h.x, minY: h.y, maxX: h.x + 1, maxY: h.y + 1 }),
        });
      } else if (h.type === 'saw') {
        const amp = h.amp ?? 0;
        const period = h.period ?? 1;
        const phase = h.phase ?? 0;
        this.dangers.push({
          effect: 'kill',
          aabb: (frame) => {
            const off = amp * Math.sin((2 * Math.PI * (frame + phase)) / period);
            const dx = h.axis === 'x' ? off : 0;
            const dy = h.axis === 'y' ? off : 0;
            return { minX: h.x + dx, minY: h.y + dy, maxX: h.x + 1 + dx, maxY: h.y + 1 + dy };
          },
        });
      }
    }

    // --- Placed traps materialise as dangers ---
    for (const t of placedTraps) {
      const effect: Danger['effect'] =
        t.trapType === 'spike' ? 'kill' : t.trapType === 'bounce' ? 'bounce' : 'glue';
      this.dangers.push({
        effect,
        aabb: () => ({ minX: t.slotX, minY: t.slotY, maxX: t.slotX + 1, maxY: t.slotY + 1 }),
      });
    }

    // --- Player (created last; single dynamic body) ---
    this.player = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(course.startX, course.startY)
        .lockRotations()
        .setLinearDamping(0.0)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(this.playerRadius).setFriction(0.0).setRestitution(0.0),
      this.player,
    );
  }

  // ---- Input API (called by live scene, or fed from a log by simulate) ----
  press() {
    this.charging = true;
    this.chargeStartFrame = this.frame;
  }
  release() {
    if (!this.charging) return;
    const held = (this.frame - this.chargeStartFrame) / 60;
    this.charging = false;
    this.chargeStartFrame = -1;
    this.tryJump(held);
  }
  tap() {
    this.tryJump(0);
  }

  private canJump(): boolean {
    const coyoteFrames = Math.round(this.physics.coyoteTime * 60);
    return this.groundedNow || this.framesSinceGrounded <= coyoteFrames;
  }

  private tryJump(heldSeconds: number) {
    if (!this.canJump()) return;
    const charge = Math.min(heldSeconds, this.physics.chargeMax) / this.physics.chargeMax;
    const impulse =
      this.physics.jumpImpulse +
      (this.physics.chargeJumpImpulse - this.physics.jumpImpulse) * charge;
    const lv = this.player.linvel();
    this.player.setLinvel({ x: lv.x, y: -impulse }, true);
    this.framesSinceGrounded = 999; // consume coyote
  }

  /** Advance one fixed simulation step. */
  step() {
    if (this.finished) return;

    // 1. Move kinematic platforms + saws deterministically by frame.
    for (const mv of this.movers) {
      const { def, base } = mv;
      const off = def.amp * Math.sin((2 * Math.PI * (this.frame + (def.phase ?? 0))) / def.period);
      const nx = base.x + (def.axis === 'x' ? off : 0);
      const ny = base.y + (def.axis === 'y' ? off : 0);
      mv.body.setNextKinematicTranslation({ x: nx, y: ny });
    }

    // 2. Auto-run: force constant horizontal velocity (glue slows it).
    if (this.gluedFrames > 0) this.gluedFrames--;
    if (this.bounceCooldown > 0) this.bounceCooldown--;
    const speed = this.gluedFrames > 0 ? this.physics.runSpeed * 0.35 : this.physics.runSpeed;
    const lv = this.player.linvel();
    this.player.setLinvel({ x: speed, y: lv.y }, true);

    // 3. Physics integration.
    this.world.step();
    this.frame++;

    // 4. Ground check via short downward ray, excluding the player body.
    const t = this.player.translation();
    const ray = new RAPIER.Ray({ x: t.x, y: t.y }, { x: 0, y: 1 });
    const hit = this.world.castRay(
      ray,
      this.playerRadius + 0.12,
      true,
      undefined,
      undefined,
      undefined,
      this.player,
    );
    this.groundedNow = hit !== null;
    if (this.groundedNow) this.framesSinceGrounded = 0;
    else this.framesSinceGrounded++;

    // 5. Visual spin (render only).
    this.spin += (speed * FIXED_DT) / this.playerRadius;

    // 6. Hazard / trap resolution.
    this.resolveDangers(t.x, t.y);

    // 7. Death by falling.
    if (t.y > this.killY) this.die();

    // 8. Checkpoints + finish.
    this.updateCheckpoint(t.x, t.y);
    if (t.x >= this.course.finishX) this.finished = true;
  }

  private resolveDangers(px: number, py: number) {
    for (const d of this.dangers) {
      const box = d.aabb(this.frame);
      const cx = Math.max(box.minX, Math.min(px, box.maxX));
      const cy = Math.max(box.minY, Math.min(py, box.maxY));
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy > this.playerRadius * this.playerRadius) continue;

      if (d.effect === 'kill') {
        this.die();
        return;
      } else if (d.effect === 'bounce' && this.bounceCooldown === 0) {
        const lv = this.player.linvel();
        this.player.setLinvel({ x: lv.x, y: -this.physics.jumpImpulse * 1.1 }, true);
        this.bounceCooldown = 20;
      } else if (d.effect === 'glue') {
        this.gluedFrames = Math.max(this.gluedFrames, 30);
      }
    }
  }

  private die() {
    this.deaths++;
    this.penaltySeconds += this.physics.respawnPenalty;
    const cp = this.lastCheckpoint;
    this.player.setTranslation({ x: cp.x, y: cp.y - this.playerRadius - 0.05 }, true);
    this.player.setLinvel({ x: 0, y: 0 }, true);
    this.charging = false;
    this.chargeStartFrame = -1;
    this.gluedFrames = 0;
    this.bounceCooldown = 0;
    this.framesSinceGrounded = 999;
  }

  private updateCheckpoint(px: number, py: number) {
    for (const c of this.course.checkpoints) {
      if (c.x <= px && c.x > this.lastCheckpoint.x) {
        this.lastCheckpoint = { x: c.x, y: c.y };
      }
    }
  }

  /** Current player state for rendering / recording. */
  getPlayer(): PlayerState {
    const t = this.player.translation();
    const v = this.player.linvel();
    return { x: t.x, y: t.y, vx: v.x, vy: v.y, grounded: this.groundedNow, spin: this.spin };
  }

  /** Elapsed simulated time in ms, including respawn penalties. */
  timeMs(): number {
    return Math.round((this.frame / 60 + this.penaltySeconds) * 1000);
  }

  free() {
    this.world.free();
  }
}
