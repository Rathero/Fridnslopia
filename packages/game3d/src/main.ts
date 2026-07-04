import { initRapier, Sim3D, FIXED_DT, obstacleAABB } from './sim.js';
import { makeCourse, type Course3D } from './course.js';
import { Renderer3D } from './render.js';

const app = document.getElementById('app')!;
const timeEl = document.getElementById('time')!;
const subEl = document.getElementById('sub')!;
const banner = document.getElementById('banner')!;
const btitle = document.getElementById('btitle')!;
const bsub = document.getElementById('bsub')!;
const bbtn = document.getElementById('bbtn')!;

const AUTOPLAY = new URLSearchParams(location.search).has('autoplay');
const SEED = Number(new URLSearchParams(location.search).get('seed') ?? 20260704);

type GhostFrames = { x: number; y: number; z: number }[];

let sim: Sim3D;
let course: Course3D;
let renderer: Renderer3D;
let raf = 0;
let acc = 0;
let last = 0;
const pending: ('L' | 'R' | 'J')[] = [];
let recording: GhostFrames = [];
let ghostFrames: GhostFrames | null = null;
let ended = false;

async function boot() {
  await initRapier();
  course = makeCourse(SEED);
  renderer = new Renderer3D(app, course);
  start();
  requestAnimationFrame(loop);
}

function start() {
  if (sim) sim.free();
  sim = new Sim3D(course);
  acc = 0;
  last = 0;
  ended = false;
  pending.length = 0;
  recording = [];
  banner.style.display = 'none';
  subEl.textContent = `TRAMPA 3D · ${course.theme}`;
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
bbtn.addEventListener('click', () => {
  // Race your previous run as a ghost.
  if (recording.length) ghostFrames = recording;
  start();
});

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
  raf = requestAnimationFrame(loop);
  if (!last) last = t;
  const dt = Math.min((t - last) / 1000, 0.1);
  last = t;
  acc += dt;

  while (acc >= FIXED_DT) {
    if (AUTOPLAY && !ended) botDecide();
    for (const m of pending) {
      if (m === 'L') sim.moveLeft();
      else if (m === 'R') sim.moveRight();
      else sim.jump();
    }
    pending.length = 0;

    sim.step();
    recording.push({ ...cameralessPos() });
    acc -= FIXED_DT;

    if (!ended && (sim.finished || sim.frame > 60 * 150)) finish();
    if (ended) break;
  }

  const p = sim.getPlayer();
  renderer.updateDynamic(sim.frame);
  renderer.updatePlayer(p.x, p.y, p.z, p.spin);

  if (ghostFrames) {
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

function finish() {
  ended = true;
  const finished = sim.finished;
  btitle.textContent = finished ? '¡META!' : 'FIN';
  bsub.innerHTML = finished
    ? `Tiempo <b>${(sim.timeMs() / 1000).toFixed(2)}s</b> · ${sim.deaths} caídas<br/>Dale otra y córrete contra tu fantasma.`
    : 'No llegaste. Otra vez.';
  banner.style.display = 'flex';
}

boot();
