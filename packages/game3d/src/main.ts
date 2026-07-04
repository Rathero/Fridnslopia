import { initRapier, Sim3D, FIXED_DT, obstacleAABB } from './sim.js';
import { makeCourse, type Course3D } from './course.js';
import { Renderer3D } from './render.js';
import { Ui, hexColor } from './ui.js';

const app = document.getElementById('app')!;
const timeEl = document.getElementById('time')!;
const subEl = document.getElementById('sub')!;

const AUTOPLAY = new URLSearchParams(location.search).has('autoplay');
// Daily-style fixed seed: stable for everyone on a given build unless overridden.
const DAILY_SEED = 20260704;
const SEED = Number(new URLSearchParams(location.search).get('seed') ?? DAILY_SEED);

type GhostFrames = { x: number; y: number; z: number }[];
type Mode = 'menu' | 'run' | 'result';

let sim: Sim3D;
let course: Course3D;
let renderer: Renderer3D;
let ui: Ui;
let mode: Mode = 'menu';
let acc = 0;
let last = 0;
const pending: ('L' | 'R' | 'J')[] = [];
let recording: GhostFrames = [];
let ghostFrames: GhostFrames | null = null;

async function boot() {
  await initRapier();
  course = makeCourse(SEED);
  renderer = new Renderer3D(app, course);
  ui = new Ui(hexColor(course.palette.accent));
  sim = new Sim3D(course);
  subEl.textContent = `TRAMPA 3D · ${course.theme}`;

  if (AUTOPLAY) {
    startRun();
  } else {
    showMenu();
  }
  requestAnimationFrame(loop);
}

function showMenu() {
  mode = 'menu';
  ui.showMenu(course.theme, () => startRun());
}

function startRun() {
  if (sim) sim.free();
  sim = new Sim3D(course);
  acc = 0;
  last = 0;
  pending.length = 0;
  recording = [];
  mode = 'run';
}

function showResult() {
  mode = 'result';
  ui.showResult(
    { finished: sim.finished, timeMs: sim.timeMs(), deaths: sim.deaths },
    {
      onReplay: () => {
        // Race your previous run as a ghost.
        if (recording.length) ghostFrames = recording;
        startRun();
      },
      onMenu: () => {
        ghostFrames = null;
        showMenu();
      },
    },
  );
}

// ---- input ----
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') pending.push('L');
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') pending.push('R');
  else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') pending.push('J');
});
document.getElementById('zl')!.addEventListener('pointerdown', () => pending.push('L'));
document.getElementById('zr')!.addEventListener('pointerdown', () => pending.push('R'));
document.getElementById('zj')!.addEventListener('pointerdown', () => pending.push('J'));

// ---- autoplay bot: pick a clear lane, dodge early, jump gaps ----
// Lanes reachable from the 2.4-per-tap strafe (clamped to the playfield).
function reachableLanes(): number[] {
  const half = course.halfWidth - 0.6;
  return [-4.4, -2.4, 0, 2.4, 4.4].filter((x) => Math.abs(x) <= half);
}

function botDecide() {
  const p = sim.getPlayer();
  if (!p.grounded) return;

  const floorAt = (x: number, z: number) =>
    course.floors.some(
      (f) => Math.abs(x - f.x) <= f.w / 2 + 0.05 && z >= f.z - f.d / 2 && z <= f.z + f.d / 2,
    );

  // 1. Gap directly ahead in the current lane -> jump before the edge.
  if (floorAt(p.x, p.z + 0.6) && !floorAt(p.x, p.z + 3.4)) {
    pending.push('J');
    return;
  }

  // 2. A lane is unsafe if it loses floor soon, or an obstacle will occupy it
  //    around the time we arrive (sample a few upcoming frames for movers).
  const laneBlocked = (x: number): boolean => {
    if (!floorAt(x, p.z + 3.5)) return true; // would run into a gap/edge
    for (const o of course.obstacles) {
      if (o.z <= p.z + 0.5 || o.z >= p.z + 9) continue;
      for (const df of [4, 9, 14, 20]) {
        const b = obstacleAABB(o, sim.frame + df);
        if (x > b.minX - 0.7 && x < b.maxX + 0.7) return true;
      }
    }
    return false;
  };

  // 3. Steer toward the clear lane nearest us (ties prefer the centre).
  const clear = reachableLanes()
    .filter((x) => !laneBlocked(x))
    .sort((a, b) => Math.abs(a - p.x) - Math.abs(b - p.x) || Math.abs(a) - Math.abs(b));
  const target = clear.length ? clear[0] : 0;

  if (target > p.x + 0.35) pending.push('R');
  else if (target < p.x - 0.35) pending.push('L');
}

// ---- loop ----
function loop(t: number) {
  requestAnimationFrame(loop);
  if (!last) last = t;
  const dt = Math.min((t - last) / 1000, 0.1);
  last = t;

  if (mode === 'run') {
    acc += dt;
    while (acc >= FIXED_DT) {
      if (AUTOPLAY) botDecide();
      for (const m of pending) {
        if (m === 'L') sim.moveLeft();
        else if (m === 'R') sim.moveRight();
        else sim.jump();
      }
      pending.length = 0;

      sim.step();
      recording.push(cameralessPos());
      acc -= FIXED_DT;

      if (sim.finished || sim.frame > 60 * 150) {
        showResult();
        break;
      }
    }
  } else {
    // Not simulating; drain any stray input so it doesn't queue up.
    pending.length = 0;
  }

  const p = sim.getPlayer();
  renderer.updateDynamic(sim.frame);
  renderer.updatePlayer(p.x, p.y, p.z, p.spin, p.vy, p.grounded);

  if (ghostFrames && mode === 'run') {
    const g = ghostFrames[Math.min(sim.frame, ghostFrames.length - 1)];
    if (g) renderer.setGhost(g.x, g.y, g.z, true);
  } else {
    renderer.setGhost(0, 0, 0, false);
  }

  timeEl.textContent = (sim.timeMs() / 1000).toFixed(2);
  renderer.render();
}

function cameralessPos() {
  const p = sim.getPlayer();
  return { x: p.x, y: p.y, z: p.z };
}

boot();
