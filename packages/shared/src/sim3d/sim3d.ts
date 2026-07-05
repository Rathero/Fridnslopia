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

/**
 * Input log token. `'J'` = jump; `'S<int>'` sets the analog lateral steer axis,
 * int in [-100,100] (percent of max strafe). Continuous control — how far/fast
 * you move is up to the joystick (mobile) or how long you hold the arrows (PC).
 */
export type Input3D = string;

export interface PlayerState3D {
  x: number; y: number; z: number; vy: number; grounded: boolean; spin: number; speed: number;
  nearMisses: number; steer: number;
}

/** World-space AABB of a moving obstacle at a given frame.
 *  - `mover`   sweeps laterally (dx).
 *  - `crusher` bobs vertically (dy): rests up (dy=0), slams down for half its cycle.
 *  - `spinner` returns its conservative swept-disc box (used by the autopilot's
 *    lane scorer + graze detection; the actual kill test is `spinnerHit`, precise).
 */
export function obstacleAABB(o: Obstacle, frame: number) {
  let dx = 0, dy = 0;
  if (o.kind === 'mover' && o.amp && o.period) {
    dx = o.amp * Math.sin((2 * Math.PI * (frame + (o.phase ?? 0))) / o.period);
  } else if (o.kind === 'crusher' && o.amp && o.period) {
    const s = Math.sin((2 * Math.PI * (frame + (o.phase ?? 0))) / o.period);
    dy = s > 0 ? -o.amp * s : 0;
  } else if (o.kind === 'spinner') {
    const L = o.amp ?? o.w / 2;
    return {
      minX: o.x - L, maxX: o.x + L,
      minY: o.y - o.h / 2, maxY: o.y + o.h / 2,
      minZ: o.z - L, maxZ: o.z + L, dx: 0,
    };
  }
  return {
    minX: o.x + dx - o.w / 2, maxX: o.x + dx + o.w / 2,
    minY: o.y + dy - o.h / 2, maxY: o.y + dy + o.h / 2,
    minZ: o.z - o.d / 2, maxZ: o.z + o.d / 2, dx,
  };
}

/** Spinner arm angle (radians) at a frame — shared by sim collision + renderer. */
export function spinnerAngle(o: Obstacle, frame: number): number {
  return (2 * Math.PI * (frame + (o.phase ?? 0))) / (o.period || 120);
}

/** Precise spinner collision: player ball vs the rotating bar segment (in the XZ
 *  plane, gated by vertical overlap). Deterministic from the frame. */
export function spinnerHit(o: Obstacle, frame: number, p: { x: number; y: number; z: number }, r: number): boolean {
  if (Math.abs(p.y - o.y) > o.h / 2 + r) return false; // bar out of vertical reach
  const L = o.amp ?? o.w / 2;
  const th = spinnerAngle(o, frame);
  const dirX = Math.cos(th), dirZ = Math.sin(th);
  const px = p.x - o.x, pz = p.z - o.z;
  let t = px * dirX + pz * dirZ;            // project onto the arm axis
  if (t < -L) t = -L; else if (t > L) t = L;
  const ex = px - t * dirX, ez = pz - t * dirZ;
  const reach = r + (o.d ?? 0.6) / 2;
  return ex * ex + ez * ez < reach * reach;
}

interface Danger3D {
  effect: 'kill' | 'bounce' | 'glue';
  trap: PlacedTrap3D;
  box: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

/** A trap that actually caught the runner (exact, deterministic). */
export interface TrapHit3D { slotX: number; slotZ: number; trapType: string }

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
  /** Traps that actually applied their effect (exact saboteur accounting). */
  readonly trapHits: TrapHit3D[] = [];

  private player!: RAPIER.RigidBody;
  private steer = 0;          // target lateral axis, -1..1 (analog)
  private appliedSteer = 0;   // smoothed axis actually applied
  private grounded = false;
  private framesSinceGround = 99;
  private spin = 0;
  private lastCheckpointZ = 0;
  private r: number;
  private gluedFrames = 0;
  private bounceCooldown = 0;
  private grazed = new Set<number>();
  private dangers: Danger3D[] = [];
  private trapHitSet = new Set<Danger3D>();
  private trapBeaten = new Set<Danger3D>();

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
      // Spikes sit low so a well-timed jump clears them (a jump-check).
      const maxY = effect === 'kill' ? 1.35 : 2.0;
      this.dangers.push({
        effect,
        trap: t,
        box: { minX: t.slotX - 1.1, maxX: t.slotX + 1.1, minY: 0, maxY, minZ: t.slotZ - 0.9, maxZ: t.slotZ + 0.9 },
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
    if (t === 'J') { this.jump(); return; }
    // 'S<int>' → set the analog steer axis (percent, -100..100).
    if (t.charCodeAt(0) === 83 /* 'S' */) {
      const v = parseInt(t.slice(1), 10);
      if (!Number.isNaN(v)) this.steer = Math.max(-1, Math.min(1, v / 100));
    }
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
    const speed = this.gluedFrames > 0 ? this.baseSpeed() * 0.4 : this.baseSpeed();
    // Analog lateral control: the steer axis (-1..1) maps to lateral velocity,
    // smoothed for feel. Distance moved = how hard/long you push — no fixed step.
    this.appliedSteer += (this.steer - this.appliedSteer) * 0.4;
    let vx = this.appliedSteer * this.params.maxStrafe * (this.gluedFrames > 0 ? 0.5 : 1);
    const lim = this.course.halfWidth - this.r;
    if ((t.x <= -lim && vx < 0) || (t.x >= lim && vx > 0)) vx = 0; // don't push off the outer edge
    this.player.setLinvel({ x: vx, y: v.y, z: speed }, true);

    this.world.step();
    this.frame++;

    // Keep the runner within the outer track bounds (analog control can overshoot).
    const pt = this.player.translation();
    if (pt.x < -lim) this.player.setTranslation({ x: -lim, y: pt.y, z: pt.z }, true);
    else if (pt.x > lim) this.player.setTranslation({ x: lim, y: pt.y, z: pt.z }, true);

    const p = this.player.translation();
    const ray = new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, this.r + 0.15, true, undefined, undefined, undefined, this.player);
    this.grounded = hit !== null;
    if (this.grounded) this.framesSinceGround = 0; else this.framesSinceGround++;
    this.spin += (speed * FIXED_DT) / this.r;

    // Obstacles (kill). Spinners use a precise rotating-segment test; the rest
    // are manual AABB overlaps (crushers only reach the player while slammed).
    for (const o of this.course.obstacles) {
      let hit: boolean;
      if (o.kind === 'spinner') {
        hit = spinnerHit(o, this.frame, p, this.r);
      } else {
        const b = obstacleAABB(o, this.frame);
        hit = this.overlaps(p, b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ);
      }
      if (hit) { this.die(); break; }
    }
    // Placed traps — each is a skill-check: beat it and you pay nothing (and
    // score style); fail and it costs you AND credits the saboteur (exact).
    if (!this.finished) {
      for (const d of this.dangers) {
        const b = d.box;
        if (!this.overlaps(p, b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ)) continue;
        if (d.effect === 'glue') {
          // Steering hard through the glue (or jumping over it) beats it cleanly.
          if (Math.abs(this.appliedSteer) > 0.7) { this.beatTrap(d); continue; }
          this.gluedFrames = Math.max(this.gluedFrames, 26);
          this.recordTrapHit(d);
        } else if (d.effect === 'bounce') {
          if (this.bounceCooldown === 0) {
            const lv = this.player.linvel();
            this.player.setLinvel({ x: lv.x, y: this.params.jumpImpulse * 1.15, z: lv.z }, true);
            this.bounceCooldown = 18;
            this.recordTrapHit(d);
          }
        } else {
          this.recordTrapHit(d);
          this.die();
          break;
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
    this.steer = 0;
    this.appliedSteer = 0;
    this.framesSinceGround = 99;
    this.gluedFrames = 0;
    this.bounceCooldown = 0;
  }

  /** Credit a trap that caught the runner — once per trap (deterministic). */
  private recordTrapHit(d: Danger3D) {
    if (this.trapHitSet.has(d)) return;
    this.trapHitSet.add(d);
    this.trapHits.push({ slotX: d.trap.slotX, slotZ: d.trap.slotZ, trapType: d.trap.trapType });
  }

  /** Beating a trap (e.g. dashing through glue) scores style — once per trap. */
  private beatTrap(d: Danger3D) {
    if (this.trapBeaten.has(d)) return;
    this.trapBeaten.add(d);
    this.nearMisses += 2; // worth more than a plain graze
  }

  getPlayer(): PlayerState3D {
    const t = this.player.translation();
    const v = this.player.linvel();
    return {
      x: t.x, y: t.y, z: t.z, vy: v.y, grounded: this.grounded, spin: this.spin,
      speed: this.baseSpeed(), nearMisses: this.nearMisses, steer: this.appliedSteer,
    };
  }
  progress(): number { return Math.max(0, Math.min(1, this.player.translation().z / this.course.finishZ)); }
  timeMs(): number { return Math.round((this.frame / 60 + this.penaltySeconds) * 1000); }
  free() { this.world.free(); }
}
