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

// ---- autoplay bot: dodge obstacles, jump gaps, stay on narrow floor ----
function botDecide() {
  const p = sim.getPlayer();
  // Where is floor at a given (x,z)?
  const floorAt = (x: number, z: number) =>
    course.floors.some(
      (f) => Math.abs(x - f.x) <= f.w / 2 + 0.1 && z >= f.z - f.d / 2 && z <= f.z + f.d / 2,
    );

  if (p.grounded) {
    // Gap ahead? jump when the near edge is close.
    if (floorAt(p.x, p.z + 0.6) && !floorAt(p.x, p.z + 3.2)) {
      pending.push('J');
      return;
    }
    // Narrow floor: drift toward centre if the edges are missing.
    if (!floorAt(p.x + 1.4, p.z + 2) && p.x > 0.3) return pending.push('L');
    if (!floorAt(p.x - 1.4, p.z + 2) && p.x < -0.3) return pending.push('R');

    // Obstacle in our lane just ahead? dodge to a clear side.
    for (const o of course.obstacles) {
      const b = obstacleAABB(o, sim.frame + 6);
      const ahead = o.z > p.z + 1 && o.z < p.z + 7;
      const inLane = p.x > b.minX - 0.7 && p.x < b.maxX + 0.7;
      if (ahead && inLane) {
        const goRight = b.minX - (-course.halfWidth) < course.halfWidth - b.maxX;
        pending.push(goRight ? 'R' : 'L');
        return;
      }
    }
  }
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
