import {
  initRapier3D,
  Sim3D,
  FIXED_DT_3D,
  MAX_RUN_FRAMES_3D,
  autopilot3d,
  type Input3D,
} from '@trampa/shared';
import { Renderer3D } from './render.js';
import { Overlay } from './ui/overlay.js';
import type { GameData3D, RunResult3D } from './types.js';

const app = document.getElementById('app')!;
const timeEl = document.getElementById('time')!;
const subEl = document.getElementById('sub')!;
const hint = document.getElementById('hint');

const AUTOPLAY = new URLSearchParams(location.search).has('autoplay');

let sim: Sim3D | null = null;
let renderer: Renderer3D | null = null;
let data: GameData3D | null = null;
let running = false;
let acc = 0;
let last = 0;
let deaths = 0;
const pending: Input3D[] = [];
let events: { f: number; t: Input3D }[] = [];
let autoEvents: Map<number, Input3D[]> | null = null;

const overlay = new Overlay((d: GameData3D) => startRun(d));

async function boot() {
  await initRapier3D();
  requestAnimationFrame(loop);
  if (AUTOPLAY) overlay.startDemo();
  else overlay.showMenu();
}

function startRun(d: GameData3D) {
  data = d;
  if (renderer) renderer.dispose();
  sim = new Sim3D(d.course, d.placedTraps);
  renderer = new Renderer3D(app, d.course, d.placedTraps);
  acc = 0;
  last = 0;
  deaths = 0;
  pending.length = 0;
  events = [];
  autoEvents = null;
  subEl.textContent = `TRAMPA 3D · ${d.course.theme}`;
  if (hint) hint.style.display = '';

  if (d.autoplay || AUTOPLAY) {
    const log = autopilot3d(d.course, d.placedTraps).log;
    autoEvents = new Map();
    for (const ev of log.events) {
      const arr = autoEvents.get(ev.f) ?? [];
      arr.push(ev.t);
      autoEvents.set(ev.f, arr);
    }
  }
  running = true;
}

function finish() {
  if (!sim || !data) return;
  running = false;
  const result: RunResult3D = {
    course: data.course,
    courseId: data.courseId,
    timeMs: sim.timeMs(),
    deaths: sim.deaths,
    finished: sim.finished,
    inputLog: { seed: data.course.seed, events },
    placedTraps: data.placedTraps,
    online: data.online,
    playDate: data.playDate,
    mode: data.mode,
    roomId: data.roomId,
    roomIdx: data.roomIdx,
    numCourses: data.numCourses,
    shareable: data.shareable,
  };
  if (hint) hint.style.display = 'none';
  overlay.showResult(result);
}

// ---- input ----
addEventListener('keydown', (e) => {
  if (!running || e.repeat) return;
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') pending.push('L');
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') pending.push('R');
  else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') pending.push('J');
});
const zone = (id: string, t: Input3D) =>
  document.getElementById(id)?.addEventListener('pointerdown', () => { if (running) pending.push(t); });
zone('zl', 'L');
zone('zr', 'R');
zone('zj', 'J');

// ---- loop ----
function loop(tms: number) {
  requestAnimationFrame(loop);
  if (!running || !sim || !renderer || !data) return;
  if (!last) last = tms;
  const dt = Math.min((tms - last) / 1000, 0.1);
  last = tms;
  acc += dt;

  while (acc >= FIXED_DT_3D) {
    if (autoEvents) {
      const evs = autoEvents.get(sim.frame);
      if (evs) for (const t of evs) pending.push(t);
    }
    for (const t of pending) {
      sim.input(t);
      events.push({ f: sim.frame, t });
    }
    pending.length = 0;

    sim.step();
    if (sim.deaths > deaths) { deaths = sim.deaths; renderer.hit(); }
    acc -= FIXED_DT_3D;
    if (sim.finished || sim.frame >= MAX_RUN_FRAMES_3D) { finish(); return; }
  }

  const p = sim.getPlayer();
  renderer.updateDynamic(sim.frame);
  renderer.updatePlayer(p.x, p.y, p.z, p.spin, p.vy, p.grounded, p.speed);

  // Ghosts at the current frame.
  const f = sim.frame;
  renderer.setGhosts(
    data.ghosts.map((g) => {
      const fr = g.frames[Math.min(f, g.frames.length - 1)];
      return fr ? { x: fr.x, y: fr.y, z: fr.z } : null;
    }),
  );

  timeEl.textContent = (sim.timeMs() / 1000).toFixed(2);
  renderer.render();
}

boot();
