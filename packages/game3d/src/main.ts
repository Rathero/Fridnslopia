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
import type { GameData3D, RunResult3D, PreparedGhost3D } from './types.js';

const app = document.getElementById('app')!;
const timeEl = document.getElementById('time')!;
const subEl = document.getElementById('sub')!;
const deltaEl = document.getElementById('delta')!;
const posEl = document.getElementById('pos')!;
const progressWrap = document.getElementById('progressWrap')!;
const progressBar = document.getElementById('progressBar')!;
const countdownEl = document.getElementById('countdown')!;
const hint = document.getElementById('hint');

const AUTOPLAY = new URLSearchParams(location.search).has('autoplay');
const COUNTDOWN_MS = 2600;

let sim: Sim3D | null = null;
let renderer: Renderer3D | null = null;
let data: GameData3D | null = null;
let running = false;
let acc = 0;
let last = 0;
let deaths = 0;
let countdownMs = 0;
let slowmoMs = 0;
let bestGhost: PreparedGhost3D | null = null;
let bestCursor = 0;
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
  slowmoMs = 0;
  countdownMs = COUNTDOWN_MS;
  pending.length = 0;
  events = [];
  autoEvents = null;

  // Fastest friend's ghost drives the live delta readout.
  bestGhost = d.ghosts.length
    ? d.ghosts.reduce((a, b) => (b.timeMs < a.timeMs ? b : a))
    : null;
  bestCursor = 0;

  subEl.textContent = `TRAMPA 3D · ${d.course.theme}`;
  if (hint) hint.style.display = '';
  deltaEl.textContent = '';
  posEl.textContent = '';
  progressBar.style.width = '0%';
  progressWrap.style.opacity = '0';

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
  progressWrap.style.opacity = '0';
  posEl.textContent = '';
  deltaEl.textContent = '';
  countdownEl.style.opacity = '0';
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
  document.getElementById(id)?.addEventListener('pointerdown', () => {
    if (running && countdownMs <= 0) pending.push(t);
  });
zone('zl', 'L');
zone('zr', 'R');
zone('zj', 'J');

// ---- HUD helpers ----
function renderGhosts(f: number) {
  if (!renderer || !data) return;
  renderer.setGhosts(
    data.ghosts.map((g) => {
      const fr = g.frames[Math.min(f, g.frames.length - 1)];
      return fr ? { x: fr.x, y: fr.y, z: fr.z } : null;
    }),
  );
}

function updateCountdown() {
  const ms = countdownMs;
  let txt = '';
  if (ms > 1900) txt = '3';
  else if (ms > 1200) txt = '2';
  else if (ms > 500) txt = '1';
  else txt = '¡YA!';
  countdownEl.textContent = txt;
  countdownEl.style.opacity = '1';
  // Pop scale within each ~700ms slot.
  const inSlot = txt === '¡YA!' ? 500 - ms : (ms % 700);
  const scale = 1 + Math.max(0, 0.4 - inSlot / 1750);
  countdownEl.style.transform = `scale(${scale.toFixed(3)})`;
  countdownEl.style.color = txt === '¡YA!' ? '#8affd6' : '#ffffff';
}

// ---- loop ----
function loop(tms: number) {
  requestAnimationFrame(loop);
  if (!running || !sim || !renderer || !data) return;
  if (!last) last = tms;
  const dt = Math.min((tms - last) / 1000, 0.1);
  last = tms;

  // Countdown gate: render the scene at the start line but don't step the sim.
  if (countdownMs > 0) {
    countdownMs -= dt * 1000;
    updateCountdown();
    const p0 = sim.getPlayer();
    renderer.updateDynamic(0);
    renderer.updatePlayer(p0.x, p0.y, p0.z, p0.spin, p0.vy, p0.grounded, p0.speed);
    renderGhosts(0);
    renderer.render();
    if (countdownMs <= 0) {
      countdownEl.style.opacity = '0';
      progressWrap.style.opacity = '1';
    }
    return;
  }

  // Death slow-mo makes real time crawl briefly; sim frames are unchanged.
  if (slowmoMs > 0) slowmoMs -= dt * 1000;
  acc += dt * (slowmoMs > 0 ? 0.3 : 1);

  while (acc >= FIXED_DT_3D) {
    if (autoEvents) {
      const evs = autoEvents.get(sim.frame);
      if (evs) for (const t of evs) pending.push(t);
    }
    for (const t of pending) {
      if (t === 'J') {
        const pp = sim.getPlayer();
        if (pp.grounded) renderer.burstJump(pp.x, pp.y, pp.z);
      }
      sim.input(t);
      events.push({ f: sim.frame, t });
    }
    pending.length = 0;

    sim.step();
    if (sim.deaths > deaths) { deaths = sim.deaths; renderer.hit(); slowmoMs = 340; }
    acc -= FIXED_DT_3D;
    if (sim.finished || sim.frame >= MAX_RUN_FRAMES_3D) { finish(); return; }
  }

  const p = sim.getPlayer();
  const f = sim.frame;
  renderer.updateDynamic(f);
  renderer.updatePlayer(p.x, p.y, p.z, p.spin, p.vy, p.grounded, p.speed);
  renderGhosts(f);

  // HUD: progress bar, live position among ghosts, delta vs the best ghost.
  progressBar.style.width = `${(sim.progress() * 100).toFixed(1)}%`;

  if (data.ghosts.length) {
    let ahead = 0;
    for (const g of data.ghosts) {
      const fr = g.frames[Math.min(f, g.frames.length - 1)];
      if (fr && fr.z > p.z + 0.15) ahead++;
    }
    posEl.textContent = `${ahead + 1}º / ${data.ghosts.length + 1}`;
  }

  if (bestGhost) {
    const fr = bestGhost.frames;
    while (bestCursor < fr.length - 1 && fr[bestCursor].z < p.z) bestCursor++;
    const d = f / 60 - bestCursor / 60; // seconds; <0 = ahead of the ghost
    const behind = d > 0.02;
    const ahead = d < -0.02;
    deltaEl.textContent = `${behind ? '▼ +' : ahead ? '▲ −' : '≈ '}${Math.abs(d).toFixed(2)}s`;
    deltaEl.style.color = behind ? '#ff8080' : ahead ? '#6bffab' : '#cfe0ff';
  }

  timeEl.textContent = (sim.timeMs() / 1000).toFixed(2);
  renderer.render();
}

boot();
