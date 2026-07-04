import RAPIER from '@dimforge/rapier3d-compat';
import type { Course3D, Obstacle, PlacedTrap3D } from './course3d.js';
import type { DailyModifier } from '../constants.js';

export const FIXED_DT = 1 / 60;

export interface Params3D {
  runSpeed: number;
  /** Forward speed gained per second of survival (thrill ramp). Deterministic. */
  speedAccel: number;
  /** Cap on the ramp bonus added on top of runSpeed. */
  speedRamp: number;
  gravity: number;
  jumpImpulse: number;
  strafeAccel: number;
  maxStrafe: number;
  playerRadius: number;
  killY: number;
  laneStep: number;
  respawnPenalty: number;
}

export const PARAMS3D: Params3D = {
  runSpeed: 10.5,
  speedAccel: 0.2,
  speedRamp: 3,
  gravity: 32,
  jumpImpulse: 12.5,
  strafeAccel: 19,
  maxStrafe: 15,
  playerRadius: 0.55,
  killY: -5,
  laneStep: 2.4,
  respawnPenalty: 1.5,
};

/** Daily modifiers tweak the aerial physics deterministically (spec §4.4). */
export function applyModifier3D(modifier: DailyModifier): Params3D {
  const p: Params3D = { ...PARAMS3D };
  switch (modifier) {
    case 'low_gravity': p.gravity = 20; p.jumpImpulse = 11; break;
    case 'speed_up': p.runSpeed = 13; p.speedRamp = 4; break;
    case 'slippery': p.strafeAccel = 8; break;
    case 'bouncy': p.jumpImpulse = 15; break;
    default: break;
  }
  return p;
}

let ready: Promise<void> | null = null;
export function initRapier3D(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}

export type Input3D = 'L' | 'R' | 'J' | 'DL' | 'DR';

export interface PlayerState3D {
  x: number; y: number; z: number; vy: number; grounded: boolean; spin: number; speed: number;
  nearMisses: number; dashReady: boolean;
}

/** World-space AABB of a moving obstacle at a given frame. */
export function obstacleAABB(o: Obstacle, frame: number) {
  let dx = 0;
  if (o.kind === 'mover' && o.amp && o.period) {
    dx = o.amp * Math.sin((2 * Math.PI * (frame + (o.phase ?? 0))) / o.period);
  }
  return {
    minX: o.x + dx - o.w / 2, maxX: o.x + dx + o.w / 2,
    minY: o.y - o.h / 2, maxY: o.y + o.h / 2,
    minZ: o.z - o.d / 2, maxZ: o.z + o.d / 2, dx,
  };
}

interface Danger3D {
  effect: 'kill' | 'bounce' | 'glue';
  box: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

/**
 * Deterministic aerial runner sim (fixed 60Hz, seeded course, fixed body order)
 * — the movement source of truth for live play, ghost replay and server
 * anti-cheat, exactly like the 2D SimWorld. Only floor + player live in Rapier;
 * obstacles and traps resolve by manual AABB overlap so auto-run never wedges.
 */
export class Sim3D {
  readonly world: RAPIER.World;
  readonly course: Course3D;
  readonly params: Params3D;
  frame = 0;
  finished = false;
  deaths = 0;
  nearMisses = 0;
  penaltySeconds = 0;

  private player!: RAPIER.RigidBody;
  private targetX = 0;
  private grounded = false;
  private framesSinceGround = 99;
  private spin = 0;
  private lastCheckpointZ = 0;
  private r: number;
  private gluedFrames = 0;
  private bounceCooldown = 0;
  private dashFrames = 0;
  private dashCooldown = 0;
  private grazed = new Set<number>();
  private dangers: Danger3D[] = [];

  constructor(course: Course3D, placedTraps: PlacedTrap3D[] = []) {
    this.course = course;
    this.params = applyModifier3D(course.modifier as DailyModifier);
    this.r = this.params.playerRadius;

    this.world = new RAPIER.World({ x: 0, y: -this.params.gravity, z: 0 });
    this.world.timestep = FIXED_DT;

    for (const f of course.floors) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(f.x, f.y, f.z),
      );
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(f.w / 2, f.h / 2, f.d / 2).setFriction(0), body);
    }

    // Placed traps become manual-overlap dangers.
    for (const t of placedTraps) {
      const effect: Danger3D['effect'] = t.trapType === 'bounce' ? 'bounce' : t.trapType === 'glue' ? 'glue' : 'kill';
      this.dangers.push({
        effect,
        box: { minX: t.slotX - 1.1, maxX: t.slotX + 1.1, minY: 0, maxY: 2.0, minZ: t.slotZ - 0.9, maxZ: t.slotZ + 0.9 },
      });
    }

    this.player = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, this.r + 0.2, course.startZ)
        .lockRotations()
        .setLinearDamping(0),
    );
    this.world.createCollider(RAPIER.ColliderDesc.ball(this.r).setFriction(0).setRestitution(0), this.player);
  }

  /** Deterministic forward speed at the current frame (base + survival ramp). */
  baseSpeed(): number {
    const ramp = Math.min(this.params.speedRamp, (this.frame * FIXED_DT) * this.params.speedAccel);
    return this.params.runSpeed + ramp;
  }

  input(t: Input3D) {
    if (t === 'L') this.moveLeft();
    else if (t === 'R') this.moveRight();
    else if (t === 'DL') this.dash(-1);
    else if (t === 'DR') this.dash(1);
    else this.jump();
  }
  moveLeft() { this.targetX = Math.max(-this.course.halfWidth + 0.6, this.targetX - this.params.laneStep); }
  moveRight() { this.targetX = Math.min(this.course.halfWidth - 0.6, this.targetX + this.params.laneStep); }
  /** A quick 2-lane evade with a short cooldown — a burst sidestep at speed. */
  dash(dir: -1 | 1) {
    if (this.dashCooldown > 0) return;
    const lim = this.course.halfWidth - 0.6;
    this.targetX = Math.max(-lim, Math.min(lim, this.targetX + dir * this.params.laneStep * 2));
    this.dashFrames = 9;
    this.dashCooldown = 26;
  }
  jump() {
    if (!(this.grounded || this.framesSinceGround <= 6)) return;
    const v = this.player.linvel();
    this.player.setLinvel({ x: v.x, y: this.params.jumpImpulse, z: v.z }, true);
    this.framesSinceGround = 99;
  }

  step() {
    if (this.finished) return;
    const t = this.player.translation();
    const v = this.player.linvel();

    if (this.gluedFrames > 0) this.gluedFrames--;
    if (this.bounceCooldown > 0) this.bounceCooldown--;
    if (this.dashCooldown > 0) this.dashCooldown--;
    if (this.dashFrames > 0) this.dashFrames--;
    const speed = this.gluedFrames > 0 ? this.baseSpeed() * 0.4 : this.baseSpeed();
    const dx = this.targetX - t.x;
    // A dash briefly boosts lateral acceleration + cap so the 2-lane evade snaps.
    const cap = this.dashFrames > 0 ? this.params.maxStrafe * 2.4 : this.params.maxStrafe;
    const accel = this.dashFrames > 0 ? this.params.strafeAccel * 2 : this.params.strafeAccel;
    const vx = Math.max(-cap, Math.min(cap, dx * accel));
    this.player.setLinvel({ x: vx, y: v.y, z: speed }, true);

    this.world.step();
    this.frame++;

    const p = this.player.translation();
    const ray = new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, this.r + 0.15, true, undefined, undefined, undefined, this.player);
    this.grounded = hit !== null;
    if (this.grounded) this.framesSinceGround = 0; else this.framesSinceGround++;
    this.spin += (speed * FIXED_DT) / this.r;

    // Obstacles (kill).
    for (const o of this.course.obstacles) {
      const b = obstacleAABB(o, this.frame);
      if (this.overlaps(p, b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ)) { this.die(); break; }
    }
    // Placed traps.
    if (!this.finished) {
      for (const d of this.dangers) {
        const b = d.box;
        if (!this.overlaps(p, b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ)) continue;
        if (d.effect === 'kill') { this.die(); break; }
        if (d.effect === 'bounce' && this.bounceCooldown === 0) {
          const lv = this.player.linvel();
          this.player.setLinvel({ x: lv.x, y: this.params.jumpImpulse * 1.15, z: lv.z }, true);
          this.bounceCooldown = 18;
        } else if (d.effect === 'glue') {
          this.gluedFrames = Math.max(this.gluedFrames, 26);
        }
      }
    }

    if (this.player.translation().y < this.params.killY) this.die();

    // Near-miss / style: graze an obstacle (close but no hit) — counted once
    // per obstacle. Deterministic; feeds the client's style score. Only when we
    // didn't just die on it.
    if (!this.finished) {
      const graze = 0.6;
      for (let i = 0; i < this.course.obstacles.length; i++) {
        if (this.grazed.has(i)) continue;
        const o = this.course.obstacles[i];
        if (Math.abs(o.z - p.z) > 1.8) continue;
        const b = obstacleAABB(o, this.frame);
        if (this.overlaps(p, b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ)) continue; // a hit
        if (this.overlaps(p, b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ, graze)) {
          this.grazed.add(i);
          this.nearMisses++;
        }
      }
    }

    const cur = this.player.translation();
    for (const cz of this.course.checkpoints) {
      if (cz <= cur.z && cz > this.lastCheckpointZ) this.lastCheckpointZ = cz;
    }
    if (cur.z >= this.course.finishZ) this.finished = true;
  }

  private overlaps(p: { x: number; y: number; z: number }, minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number, extra = 0): boolean {
    const cx = Math.max(minX, Math.min(p.x, maxX));
    const cy = Math.max(minY, Math.min(p.y, maxY));
    const cz = Math.max(minZ, Math.min(p.z, maxZ));
    const ex = p.x - cx, ey = p.y - cy, ez = p.z - cz;
    const rad = this.r + extra;
    return ex * ex + ey * ey + ez * ez < rad * rad;
  }

  private die() {
    this.deaths++;
    this.penaltySeconds += this.params.respawnPenalty;
    this.player.setTranslation({ x: 0, y: this.r + 0.3, z: this.lastCheckpointZ + 0.5 }, true);
    this.player.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.targetX = 0;
    this.framesSinceGround = 99;
    this.gluedFrames = 0;
    this.bounceCooldown = 0;
    this.dashFrames = 0;
    this.dashCooldown = 0;
  }

  getPlayer(): PlayerState3D {
    const t = this.player.translation();
    const v = this.player.linvel();
    return {
      x: t.x, y: t.y, z: t.z, vy: v.y, grounded: this.grounded, spin: this.spin,
      speed: this.baseSpeed(), nearMisses: this.nearMisses, dashReady: this.dashCooldown === 0,
    };
  }
  progress(): number { return Math.max(0, Math.min(1, this.player.translation().z / this.course.finishZ)); }
  timeMs(): number { return Math.round((this.frame / 60 + this.penaltySeconds) * 1000); }
  free() { this.world.free(); }
}
