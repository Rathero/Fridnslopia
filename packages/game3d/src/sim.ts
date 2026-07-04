import RAPIER from '@dimforge/rapier3d-compat';
import type { Course3D, Obstacle } from './course.js';

export const FIXED_DT = 1 / 60;

export const PARAMS = {
  runSpeed: 10, // forward, +Z (m/s)
  gravity: 32,
  jumpImpulse: 12.5,
  strafeAccel: 16, // how snappily you slide toward the target lane
  maxStrafe: 13,
  playerRadius: 0.55,
  killY: -5,
};

let ready: Promise<void> | null = null;
export function initRapier() {
  if (!ready) ready = RAPIER.init();
  return ready;
}

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
  spin: number;
}

/** Current world-space AABB of an obstacle at a given frame (movers oscillate). */
export function obstacleAABB(o: Obstacle, frame: number) {
  let dx = 0;
  if (o.kind === 'mover' && o.amp && o.period) {
    dx = o.amp * Math.sin((2 * Math.PI * (frame + (o.phase ?? 0))) / o.period);
  }
  return {
    minX: o.x + dx - o.w / 2,
    maxX: o.x + dx + o.w / 2,
    minY: o.y - o.h / 2,
    maxY: o.y + o.h / 2,
    minZ: o.z - o.d / 2,
    maxZ: o.z + o.d / 2,
    dx,
  };
}

/**
 * Deterministic aerial runner sim. Fixed 60Hz, seeded, fixed body-creation
 * order — so an input log replays identically (ghosts + anti-cheat, same as 2D).
 * Only the floor + player live in Rapier; obstacles are resolved by manual AABB
 * overlap so auto-run never gets wedged against a wall.
 */
export class Sim3D {
  readonly world: RAPIER.World;
  readonly course: Course3D;
  frame = 0;
  finished = false;
  deaths = 0;
  penaltySeconds = 0;

  private player!: RAPIER.RigidBody;
  private targetX = 0;
  private grounded = false;
  private framesSinceGround = 99;
  private spin = 0;
  private lastCheckpointZ = 0;
  private r = PARAMS.playerRadius;

  constructor(course: Course3D) {
    this.course = course;
    this.world = new RAPIER.World({ x: 0, y: -PARAMS.gravity, z: 0 });
    this.world.timestep = FIXED_DT;

    for (const f of course.floors) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(f.x, f.y, f.z),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(f.w / 2, f.h / 2, f.d / 2).setFriction(0),
        body,
      );
    }

    this.player = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, this.r + 0.2, course.startZ)
        .lockRotations()
        .setLinearDamping(0),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(this.r).setFriction(0).setRestitution(0),
      this.player,
    );
  }

  moveLeft() {
    this.targetX = Math.max(-this.course.halfWidth + 0.6, this.targetX - 2.4);
  }
  moveRight() {
    this.targetX = Math.min(this.course.halfWidth - 0.6, this.targetX + 2.4);
  }
  jump() {
    const coyote = this.grounded || this.framesSinceGround <= 6;
    if (!coyote) return;
    const v = this.player.linvel();
    this.player.setLinvel({ x: v.x, y: PARAMS.jumpImpulse, z: v.z }, true);
    this.framesSinceGround = 99;
  }

  step() {
    if (this.finished) return;
    const t = this.player.translation();
    const v = this.player.linvel();

    // Auto-run forward; steer X toward the target lane.
    const dx = this.targetX - t.x;
    const vx = Math.max(-PARAMS.maxStrafe, Math.min(PARAMS.maxStrafe, dx * PARAMS.strafeAccel));
    this.player.setLinvel({ x: vx, y: v.y, z: PARAMS.runSpeed }, true);

    this.world.step();
    this.frame++;

    // Ground check.
    const p = this.player.translation();
    const ray = new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, this.r + 0.15, true, undefined, undefined, undefined, this.player);
    this.grounded = hit !== null;
    if (this.grounded) this.framesSinceGround = 0;
    else this.framesSinceGround++;

    this.spin += PARAMS.runSpeed * FIXED_DT / this.r;

    // Obstacle collisions (manual AABB vs player sphere).
    for (const o of this.course.obstacles) {
      const b = obstacleAABB(o, this.frame);
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
      const cy = Math.max(b.minY, Math.min(p.y, b.maxY));
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      const ex = p.x - cx, ey = p.y - cy, ez = p.z - cz;
      if (ex * ex + ey * ey + ez * ez < this.r * this.r) {
        this.die();
        break;
      }
    }

    // Fell off / into a gap.
    if (this.player.translation().y < PARAMS.killY) this.die();

    // Checkpoints + finish.
    const cur = this.player.translation();
    for (const cz of this.course.checkpoints) {
      if (cz <= cur.z && cz > this.lastCheckpointZ) this.lastCheckpointZ = cz;
    }
    if (cur.z >= this.course.finishZ) this.finished = true;
  }

  private die() {
    this.deaths++;
    this.penaltySeconds += 1.5;
    this.player.setTranslation({ x: 0, y: this.r + 0.3, z: this.lastCheckpointZ + 0.5 }, true);
    this.player.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.targetX = 0;
    this.framesSinceGround = 99;
  }

  getPlayer(): PlayerState {
    const t = this.player.translation();
    const v = this.player.linvel();
    return { x: t.x, y: t.y, z: t.z, vy: v.y, grounded: this.grounded, spin: this.spin };
  }

  progress(): number {
    return Math.max(0, Math.min(1, this.player.translation().z / this.course.finishZ));
  }

  timeMs(): number {
    return Math.round((this.frame / 60 + this.penaltySeconds) * 1000);
  }

  free() {
    this.world.free();
  }
}
