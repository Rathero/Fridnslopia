import {
  generateVerifiedCourse,
  defaultConfig,
  type Course,
  type InputLog,
  type PlacedTrap,
  type TrapType,
} from '@trampa/shared';
import { api, type LeaderboardEntry } from '../net/api.js';
import {
  getHandle,
  setHandle,
  getLeagueId,
  setLeagueId,
  setUserId,
} from '../config.js';
import { SKINS, ownedSkins, ownSkin, equipSkin, equippedSkin } from '../cosmetics.js';
import { prepareGhosts, type PreparedGhost } from '../game/ghosts.js';
import type { GameSceneData } from '../scenes/GameScene.js';
import type { RunResult } from '../scenes/GameScene.js';
import { injectStyles } from './styles.js';

const PRACTICE_SEED = 1;

/** Persist an offline run so you can race your own ghost next time (M2). */
function saveLocalGhost(seed: number, handle: string, timeMs: number, log: InputLog) {
  localStorage.setItem(
    `trampa.ghost.${seed}`,
    JSON.stringify({ handle: handle || 'Tú', timeMs, inputLog: log }),
  );
}
function loadLocalGhost(seed: number): { handle: string; timeMs: number; inputLog: InputLog } | null {
  const raw = localStorage.getItem(`trampa.ghost.${seed}`);
  return raw ? JSON.parse(raw) : null;
}

export class Overlay {
  private root: HTMLDivElement;
  private card: HTMLDivElement;

  constructor(private onStartRun: (data: GameSceneData) => void) {
    injectStyles();
    this.root = document.createElement('div');
    this.root.id = 'ui';
    this.card = document.createElement('div');
    this.card.className = 'card';
    this.root.appendChild(this.card);
    document.body.appendChild(this.root);
  }

  show() {
    this.root.classList.remove('hidden');
  }
  hide() {
    this.root.classList.add('hidden');
  }

  // ---------- MENU ----------
  async showMenu() {
    this.show();
    const handle = getHandle();
    const leagueId = getLeagueId();
    let leagueLine = '<p class="muted">Sin liga. Crea o únete a una.</p>';
    if (leagueId) {
      try {
        const l = await api.getLeague(leagueId);
        leagueLine = `<div class="center"><div class="chip">🏆 ${l.name}</div>
          <div class="streak">🔥 ${l.streakCount}</div>
          <div class="muted">racha de liga · ${l.members.length} miembros</div></div>`;
      } catch {
        leagueLine = '<p class="muted">No se pudo cargar la liga (¿servidor apagado?).</p>';
      }
    }

    this.card.innerHTML = `
      <div class="title">TRAMPA</div>
      <div class="subtitle">corre · esquiva · sabotea</div>
      ${leagueLine}
      <div class="space"></div>
      <label>Tu nombre</label>
      <input id="handle" placeholder="p.ej. rubén" value="${escapeAttr(handle)}" maxlength="16" />
      <button class="btn" id="daily">▶ Jugar circuito de hoy</button>
      <button class="btn secondary" id="quick">Partida rápida (offline)</button>
      <div class="row">
        <button class="btn ghost" id="league">Liga</button>
        <button class="btn ghost" id="store">Tienda</button>
      </div>
      <div class="err" id="err"></div>
    `;
    const handleInput = this.$('#handle') as HTMLInputElement;
    handleInput.addEventListener('change', () => setHandle(handleInput.value.trim()));

    this.$('#daily').addEventListener('click', () => {
      setHandle(handleInput.value.trim());
      this.playDaily();
    });
    this.$('#quick').addEventListener('click', () => {
      setHandle(handleInput.value.trim());
      this.playQuick();
    });
    this.$('#league').addEventListener('click', () => this.showLeague());
    this.$('#store').addEventListener('click', () => this.showStore());
  }

  private async playDaily() {
    const handle = getHandle();
    if (!handle) return this.err('Escribe tu nombre primero.');
    const leagueId = getLeagueId();
    if (!leagueId) return this.showLeague('Únete a una liga para jugar el diario.');

    this.loading('Generando el circuito de hoy…');
    try {
      const today = await api.today(leagueId);
      const ghostsRaw = await api.ghosts(today.courseId, handle).catch(() => []);
      const ghosts = await prepareGhosts(
        today.course,
        ghostsRaw.map((g) => ({ handle: g.handle, timeMs: g.timeMs, inputLog: g.inputLog })),
        today.traps,
      );
      this.startRun({
        course: today.course,
        courseId: today.courseId,
        placedTraps: today.traps,
        ghosts,
        online: true,
        playDate: today.playDate,
      });
    } catch (e: any) {
      this.showMenu().then(() => this.err(`No se pudo conectar: ${e.message}. Prueba partida rápida.`));
    }
  }

  private async playQuick() {
    this.loading('Preparando circuito…');
    const { course } = generateVerifiedCourse(PRACTICE_SEED, defaultConfig);
    const local = loadLocalGhost(PRACTICE_SEED);
    const ghosts: PreparedGhost[] = local
      ? await prepareGhosts(course, [local], [])
      : [];
    this.startRun({ course, placedTraps: [], ghosts, online: false });
  }

  private startRun(data: GameSceneData) {
    this.hide();
    this.onStartRun(data);
  }

  // ---------- RESULT ----------
  async showResult(r: RunResult) {
    this.show();
    const timeStr = (r.timeMs / 1000).toFixed(2);
    const head = r.finished
      ? `<div class="big-time">${timeStr}s</div>`
      : `<div class="big-time" style="color:#ff6b6b">DNF</div>`;
    this.card.innerHTML = `
      ${head}
      <div class="center muted">${r.deaths} muertes${r.course.modifier !== 'none' ? ' · mod: ' + r.course.modifier : ''}</div>
      <div id="post"></div>
      <div class="row">
        <button class="btn" id="retry">↻ Reintentar</button>
        <button class="btn secondary" id="menu">Menú</button>
      </div>
    `;
    this.$('#retry').addEventListener('click', () => {
      if (r.online) this.playDaily();
      else this.playQuick();
    });
    this.$('#menu').addEventListener('click', () => this.showMenu());

    const post = this.$('#post');
    if (!r.online) {
      saveLocalGhost(r.course.seed, getHandle(), r.timeMs, r.inputLog);
      post.innerHTML = `<p class="ok">Fantasma guardado. En la próxima corres contra ti mismo.</p>`;
      return;
    }

    // Online: submit run, show leaderboard + trap placement.
    if (r.finished && r.courseId) {
      post.innerHTML = '<p class="muted">Enviando tiempo…</p>';
      try {
        const res = await api.submitRun({
          courseId: r.courseId,
          handle: getHandle(),
          timeMs: r.timeMs,
          inputLog: r.inputLog,
        });
        const lb = await api.leaderboard(r.courseId).catch(() => [] as LeaderboardEntry[]);
        post.innerHTML =
          `<p class="ok">Verificado ✓ Posición #${res.rank}</p>` +
          renderLeaderboard(lb, getHandle()) +
          this.trapSectionHtml(r.course);
        this.wireTrapSection(r);
      } catch (e: any) {
        post.innerHTML = `<p class="err">Rechazado: ${e.message}</p>`;
      }
    } else if (r.courseId) {
      post.innerHTML = `<p class="err">No terminaste — no cuenta para el ranking.</p>` + this.trapSectionHtml(r.course);
      this.wireTrapSection(r);
    }
  }

  private trapSectionHtml(course: Course): string {
    if (!course.trapSlots.length) return '';
    return `
      <div class="space"></div>
      <h2>Coloca tu trampa 😈</h2>
      <label>Tipo</label>
      <select id="trapType">
        <option value="spike">Pincho (mata)</option>
        <option value="bounce">Muelle (rebota)</option>
        <option value="glue">Pegamento (frena)</option>
      </select>
      ${renderTrapMap(course)}
      <div class="ok" id="trapMsg"></div>
    `;
  }

  private wireTrapSection(r: RunResult) {
    const svg = this.card.querySelector('#trapmap');
    if (!svg) return;
    const typeSel = this.$('#trapType') as HTMLSelectElement;
    svg.querySelectorAll('[data-slot]').forEach((node) => {
      node.addEventListener('click', async () => {
        const [sx, sy] = (node.getAttribute('data-slot') || '').split(',').map(Number);
        const msg = this.$('#trapMsg');
        try {
          await api.placeTrap({
            courseId: r.courseId!,
            handle: getHandle(),
            slotX: sx,
            slotY: sy,
            trapType: typeSel.value as TrapType,
          });
          msg.textContent = '¡Trampa colocada! Tus colegas la van a sufrir.';
          (node as SVGCircleElement).setAttribute('fill', '#ff2266');
        } catch (e: any) {
          msg.className = 'err';
          msg.textContent = `No se pudo: ${e.message}`;
        }
      });
    });
  }

  // ---------- LEAGUE ----------
  async showLeague(note?: string) {
    this.show();
    const handle = getHandle();
    const leagueId = getLeagueId();
    let current = '';
    if (leagueId) {
      try {
        const l = await api.getLeague(leagueId);
        current = `
          <div class="chip">🏆 ${l.name}</div>
          <div class="streak">🔥 ${l.streakCount}</div>
          <div class="members">${l.members.map((m) => `<span class="chip">${escapeHtml(m.handle)}</span>`).join('')}</div>
          ${l.inviteCode ? `<p class="muted">Código de invitación: <b>${l.inviteCode}</b></p>` : ''}
          <hr style="border-color:#22304e"/>`;
      } catch {
        current = '<p class="muted">No se pudo cargar la liga actual.</p>';
      }
    }
    this.card.innerHTML = `
      <h2>Liga</h2>
      ${note ? `<p class="ok">${escapeHtml(note)}</p>` : ''}
      ${current}
      <label>Tu nombre</label>
      <input id="handle" value="${escapeAttr(handle)}" maxlength="16" placeholder="tu nombre" />
      <div class="space"></div>
      <label>Crear una liga nueva</label>
      <input id="newName" placeholder="nombre de la liga" maxlength="24" />
      <button class="btn" id="create">Crear liga</button>
      <div class="space"></div>
      <label>Unirse con código</label>
      <input id="code" placeholder="p.ej. TRAMPA1" maxlength="12" style="text-transform:uppercase" />
      <button class="btn secondary" id="join">Unirse</button>
      <button class="btn ghost" id="back">← Volver</button>
      <div class="err" id="err"></div>
    `;
    const h = this.$('#handle') as HTMLInputElement;
    this.$('#create').addEventListener('click', async () => {
      const name = (this.$('#newName') as HTMLInputElement).value.trim();
      const nm = h.value.trim();
      if (!nm) return this.err('Pon tu nombre.');
      if (!name) return this.err('Pon un nombre de liga.');
      setHandle(nm);
      try {
        const res = await api.createLeague(name, nm);
        setLeagueId(res.id);
        setUserId(res.userId);
        this.showLeague(`Liga creada. Comparte el código: ${res.inviteCode}`);
      } catch (e: any) {
        this.err(e.message);
      }
    });
    this.$('#join').addEventListener('click', async () => {
      const code = (this.$('#code') as HTMLInputElement).value.trim().toUpperCase();
      const nm = h.value.trim();
      if (!nm) return this.err('Pon tu nombre.');
      if (!code) return this.err('Pon el código.');
      setHandle(nm);
      try {
        const res = await api.joinLeague(code, nm);
        setLeagueId(res.id);
        if ((res as any).userId) setUserId((res as any).userId);
        this.showLeague('¡Dentro! A correr el diario.');
      } catch (e: any) {
        this.err(e.message);
      }
    });
    this.$('#back').addEventListener('click', () => this.showMenu());
  }

  // ---------- STORE ----------
  showStore() {
    this.show();
    const owned = ownedSkins();
    const eq = equippedSkin();
    const rows = SKINS.map((s) => {
      const isOwned = owned.includes(s.id);
      const isEq = eq.id === s.id;
      const btn = isEq
        ? '<span class="chip">equipado</span>'
        : isOwned
          ? `<button class="btn ghost" data-equip="${s.id}" style="width:auto;margin:0;padding:8px 12px">Equipar</button>`
          : `<button class="btn" data-buy="${s.id}" style="width:auto;margin:0;padding:8px 12px">${(s.price / 100).toFixed(2)}€</button>`;
      return `<div class="skin">
        <div class="swatch" style="background:#${s.body.toString(16).padStart(6, '0')}"></div>
        <div class="grow"><b>${s.name}</b></div>
        ${btn}
      </div>`;
    }).join('');
    this.card.innerHTML = `
      <h2>Tienda</h2>
      <p class="muted">Solo cosméticos. Compra directa, sin cajas de botín.</p>
      ${rows}
      <button class="btn ghost" id="back">← Volver</button>
    `;
    this.card.querySelectorAll('[data-buy]').forEach((n) =>
      n.addEventListener('click', () => {
        ownSkin(n.getAttribute('data-buy')!);
        equipSkin(n.getAttribute('data-buy')!);
        this.showStore();
      }),
    );
    this.card.querySelectorAll('[data-equip]').forEach((n) =>
      n.addEventListener('click', () => {
        equipSkin(n.getAttribute('data-equip')!);
        this.showStore();
      }),
    );
    this.$('#back').addEventListener('click', () => this.showMenu());
  }

  // ---------- helpers ----------
  private loading(msg: string) {
    this.show();
    this.card.innerHTML = `<div class="center" style="padding:30px 0"><div class="title" style="font-size:26px">…</div><p class="muted">${escapeHtml(msg)}</p></div>`;
  }
  private err(msg: string) {
    const e = this.$('#err');
    if (e) e.textContent = msg;
  }
  private $(sel: string): HTMLElement {
    return this.card.querySelector(sel) as HTMLElement;
  }
}

// ---------- pure render helpers ----------
function renderLeaderboard(lb: LeaderboardEntry[], me: string): string {
  if (!lb.length) return '<p class="muted">Aún no hay tiempos.</p>';
  const rows = lb
    .map(
      (e, i) =>
        `<tr class="${e.handle === me ? 'me' : ''}"><td class="rank">${i + 1}</td><td>${escapeHtml(e.handle)}</td><td class="time">${(e.timeMs / 1000).toFixed(2)}s</td></tr>`,
    )
    .join('');
  return `<h2>Ranking de hoy</h2><table class="lb">${rows}</table>`;
}

function renderTrapMap(course: Course): string {
  const W = 400;
  const scale = W / course.widthTiles;
  const H = Math.round(course.heightTiles * scale);
  const plats = course.platforms
    .map(
      (p) =>
        `<rect x="${(p.x * scale).toFixed(1)}" y="${(p.y * scale).toFixed(1)}" width="${(p.w * scale).toFixed(1)}" height="${(p.h * scale).toFixed(1)}" fill="#2a3550"/>`,
    )
    .join('');
  const slots = course.trapSlots
    .map(
      (s) =>
        `<circle data-slot="${s.x},${s.y}" cx="${((s.x + 0.5) * scale).toFixed(1)}" cy="${((s.y + 0.5) * scale).toFixed(1)}" r="6" fill="#22ffcc" stroke="#000" stroke-width="1" style="cursor:pointer"/>`,
    )
    .join('');
  return `<svg id="trapmap" class="trapmap" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${plats}${slots}</svg>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
