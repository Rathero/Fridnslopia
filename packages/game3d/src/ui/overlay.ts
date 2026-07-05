import {
  generateVerifiedCourse3D,
  defaultConfig,
  type Course3D,
  type TrapType3D,
  type TrapSlot3D,
} from '@trampa/shared';
import type { InputLog3D } from '@trampa/shared';
import { CoursePreview3D } from '../game/coursePreview.js';
import { LiveHeat, type HeatStart } from '../net/live.js';
import {
  api,
  type LeaderboardEntry,
  type SaboteurEntry,
  type RoomState,
  type RoomStanding,
} from '../net/api.js';
import {
  getHandle,
  setHandle,
  getLeagueId,
  setLeagueId,
  getUserId,
  setUserId,
} from '../config.js';
import { SKINS, allSkins, ownedSkins, ownSkin, equipSkin, equippedSkin } from '../cosmetics.js';
import { hasModel } from '../game/modelLoader.js';
import { prepareGhosts3D, type PreparedGhost3D } from '../game/ghosts3d.js';
import type { GameData3D, RunResult3D } from '../types.js';
import { injectStyles } from './styles.js';

const PRACTICE_SEED = 1;

/** Persist an offline run so you can race your own ghost next time (M2). */
function saveLocalGhost(seed: number, handle: string, timeMs: number, log: InputLog3D) {
  localStorage.setItem(
    `trampa.ghost.${seed}`,
    JSON.stringify({ handle: handle || 'Tú', timeMs, inputLog: log }),
  );
}
function loadLocalGhost(
  seed: number,
): { handle: string; timeMs: number; inputLog: InputLog3D } | null {
  const raw = localStorage.getItem(`trampa.ghost.${seed}`);
  return raw ? JSON.parse(raw) : null;
}

export class Overlay {
  private root: HTMLDivElement;
  private card: HTMLDivElement;
  private trapPreview: CoursePreview3D | null = null;
  private liveHeat: LiveHeat | null = null;

  constructor(private onStartRun: (data: GameData3D) => void) {
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
    this.disposeTrapPreview();
    this.root.classList.add('hidden');
  }

  /** Entry point: onboard (ask name once) the first time, else the menu. */
  showStart() {
    if (!getHandle()) this.showOnboarding();
    else this.showMenu();
  }

  // ---------- ONBOARDING (first launch only) ----------
  showOnboarding() {
    this.show();
    this.card.innerHTML = `
      <div class="title">TRAMPA</div>
      <div class="subtitle">corre · esquiva · sabotea</div>
      <div class="space"></div>
      <label>¿Cómo te llamas?</label>
      <input id="handle" placeholder="tu nombre" maxlength="16" autofocus />
      <button class="btn" id="go">Empezar ▶</button>
      <div class="err" id="err"></div>
    `;
    const inp = this.$('#handle') as HTMLInputElement;
    const go = () => {
      const n = inp.value.trim();
      if (!n) return this.err('Escribe un nombre.');
      setHandle(n);
      this.showMenu();
    };
    this.$('#go').addEventListener('click', go);
    inp.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') go(); });
    setTimeout(() => inp.focus(), 50);
  }

  // ---------- MENU ----------
  async showMenu() {
    this.disposeTrapPreview();
    this.leaveLiveHeat();
    this.show();
    let leagueId = getLeagueId();
    let leagueLine = '';
    if (leagueId) {
      try {
        const l = await api.getLeague(leagueId);
        leagueLine = `<div class="center" style="margin:8px 0 0"><span class="chip">🏆 ${escapeHtml(l.name)}</span>
          <span class="streak" style="font-size:22px;vertical-align:middle">🔥 ${l.streakCount}</span></div>`;
      } catch (e: any) {
        if (isGone(e)) { setLeagueId(''); leagueId = null; } // dead league → drop silently
      }
    }
    const savedRoomId = localStorage.getItem('trampa.roomId');
    const roomBackBtn = savedRoomId
      ? '<button class="btn secondary" id="roomBack">↩ Volver a mi sala</button>' : '';

    this.card.innerHTML = `
      <div class="title">TRAMPA</div>
      <div class="subtitle">corre · esquiva · sabotea</div>
      ${leagueLine}
      <div class="space"></div>
      <button class="btn" id="league">🏆 Liga</button>
      <button class="btn secondary" id="global">🌍 Reto diario global</button>
      <button class="btn secondary" id="rooms">📺 Sala</button>
      ${roomBackBtn}
      <button class="btn secondary" id="quick">🎮 Partida rápida</button>
      <div class="row">
        <button class="btn ghost" id="store">🛍 Tienda</button>
        <button class="btn ghost" id="settings">⚙️ Ajustes</button>
      </div>
      <div class="err" id="err"></div>
    `;
    this.$('#league').addEventListener('click', () => this.showLeague());
    this.$('#global').addEventListener('click', () => this.playGlobal());
    this.$('#rooms').addEventListener('click', () => this.showRooms());
    this.$('#quick').addEventListener('click', () => this.playQuick());
    if (savedRoomId) this.$('#roomBack').addEventListener('click', () => this.showRoom(savedRoomId));
    this.$('#store').addEventListener('click', () => this.showStore());
    this.$('#settings').addEventListener('click', () => this.showSettings());
  }

  // ---------- SETTINGS ----------
  showSettings() {
    this.show();
    this.card.innerHTML = `
      <h2>⚙️ Ajustes</h2>
      <label>Tu nombre</label>
      <input id="handle" value="${escapeAttr(getHandle())}" maxlength="16" />
      <button class="btn" id="save">Guardar</button>
      <div class="ok" id="okmsg"></div>
      <button class="btn ghost" id="back">← Volver</button>
    `;
    this.$('#save').addEventListener('click', () => {
      const n = (this.$('#handle') as HTMLInputElement).value.trim();
      if (n) { setHandle(n); this.$('#okmsg').textContent = 'Guardado ✓'; }
    });
    this.$('#back').addEventListener('click', () => this.showMenu());
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
      const ghosts = await prepareGhosts3D(
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
      if (isGone(e)) {
        setLeagueId('');
        return this.showLeague('Esa liga ya no existe (se reinició el servidor). Crea o únete a una nueva.');
      }
      this.showMenu().then(() =>
        this.err(`No se pudo conectar: ${e.message}. Prueba partida rápida.`),
      );
    }
  }

  private async playGlobal() {
    const handle = getHandle();
    if (!handle) return this.err('Escribe tu nombre primero.');

    this.loading('Generando el reto global de hoy…');
    try {
      const today = await api.today(null);
      const ghostsRaw = await api.ghosts(today.courseId, handle).catch(() => []);
      const ghosts = await prepareGhosts3D(
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
        mode: 'global',
        shareable: true,
        playDate: today.playDate,
      });
    } catch (e: any) {
      this.showMenu().then(() =>
        this.err(`No se pudo conectar: ${e.message}. Prueba partida rápida.`),
      );
    }
  }

  private async playQuick(autoplay = false) {
    this.loading('Preparando circuito…');
    const { course } = generateVerifiedCourse3D(PRACTICE_SEED, defaultConfig);
    const local = loadLocalGhost(PRACTICE_SEED);
    const ghosts: PreparedGhost3D[] = local ? await prepareGhosts3D(course, [local], []) : [];
    this.startRun({ course, placedTraps: [], ghosts, online: false, autoplay });
  }

  /** Kick off an autopiloted offline run immediately (used by ?autoplay demos/CI). */
  startDemo() {
    if (!getHandle()) setHandle('Demo');
    this.playQuick(true);
  }

  private startRun(data: GameData3D) {
    this.hide();
    this.onStartRun(data);
  }

  // ---------- RESULT ----------
  async showResult(r: RunResult3D) {
    this.show();
    const timeStr = (r.timeMs / 1000).toFixed(2);
    const head = r.finished
      ? `<div class="big-time">${timeStr}s</div>`
      : `<div class="big-time" style="color:#ff6b6b">DNF</div>`;
    const styleLine = r.style
      ? `<div class="center" style="color:#ffd23c;font-weight:800;font-size:16px">✨ ${r.style} de estilo</div>`
      : '';
    this.card.innerHTML = `
      ${head}
      ${styleLine}
      <div class="center muted">${
        r.finished
          ? (r.attempts && r.attempts > 1 ? `conseguido al intento ${r.attempts} 💪` : '¡a la primera! 🏅')
          : 'no llegaste a meta'
      }${r.course.modifier !== 'none' ? ' · mod: ' + r.course.modifier : ''}</div>
      <div id="post"></div>
      <div class="row">
        <button class="btn" id="retry">↻ Reintentar</button>
        <button class="btn secondary" id="menu">Menú</button>
      </div>
    `;
    this.$('#retry').addEventListener('click', () => this.retryRun(r));
    this.$('#menu').addEventListener('click', () => this.showMenu());

    const post = this.$('#post');
    if (!r.online) {
      saveLocalGhost(r.course.seed, getHandle(), r.timeMs, r.inputLog);
      post.innerHTML = `<p class="ok">Fantasma guardado. En la próxima corres contra ti mismo.</p>`;
      return;
    }

    // Online: submit run, show leaderboard + saboteur ranking + context extras.
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
        const sab = await api.saboteurs(r.courseId).catch(() => [] as SaboteurEntry[]);
        post.innerHTML =
          `<p class="ok">Verificado ✓ Posición #${res.rank}</p>` +
          renderLeaderboard(lb, getHandle()) +
          renderSaboteurs(sab) +
          this.resultExtrasHtml(r);
        this.wireResultExtras(r);
      } catch (e: any) {
        post.innerHTML = `<p class="err">Rechazado: ${e.message}</p>`;
      }
    } else if (r.courseId) {
      post.innerHTML =
        `<p class="err">No terminaste — no cuenta para el ranking.</p>` +
        this.resultExtrasHtml(r);
      this.wireResultExtras(r);
    }
  }

  /** Route a "retry" from the result screen back to the right flow. */
  private retryRun(r: RunResult3D) {
    if (r.mode === 'global') this.playGlobal();
    else if (r.mode === 'room' && r.roomId) {
      this.playRoomCourse(r.roomId, r.roomIdx ?? 0, r.numCourses ?? 1);
    } else if (r.online) this.playDaily();
    else this.playQuick();
  }

  /** Context-specific section under the leaderboard (share / room nav / traps). */
  private resultExtrasHtml(r: RunResult3D): string {
    if (r.mode === 'room') {
      const idx = r.roomIdx ?? 0;
      const total = r.numCourses ?? 1;
      const next =
        idx + 1 < total
          ? '<button class="btn" id="nextCircuit">Siguiente circuito</button>'
          : '';
      return `
        <div class="space"></div>
        ${next}
        <button class="btn secondary" id="backToRoom">Volver a la sala</button>
        ${this.trapSectionHtml(r.course)}
      `;
    }
    const share = r.shareable
      ? '<button class="btn secondary" id="share">🔗 Compartir mi tiempo</button><div class="ok" id="shareMsg"></div>'
      : '';
    return share + this.trapSectionHtml(r.course);
  }

  /** Wire whatever resultExtrasHtml rendered. */
  private wireResultExtras(r: RunResult3D) {
    this.wireTrapSection(r);

    const nextBtn = this.card.querySelector('#nextCircuit');
    if (nextBtn && r.mode === 'room' && r.roomId) {
      nextBtn.addEventListener('click', () =>
        this.playRoomCourse(r.roomId!, (r.roomIdx ?? 0) + 1, r.numCourses ?? 1),
      );
    }
    const backRoom = this.card.querySelector('#backToRoom');
    if (backRoom && r.roomId) {
      backRoom.addEventListener('click', () => this.showRoom(r.roomId!));
    }

    const shareBtn = this.card.querySelector('#share');
    if (shareBtn && r.shareable && r.courseId) {
      shareBtn.addEventListener('click', () => {
        const url = api.shareCardUrl(r.courseId!, getHandle());
        window.open(url, '_blank');
        const msg = this.$('#shareMsg');
        navigator.clipboard?.writeText(url).then(
          () => {
            if (msg) msg.textContent = '¡Enlace copiado! Compártelo con quien quieras.';
          },
          () => {
            if (msg) msg.textContent = 'Abriendo tu tarjeta en una pestaña nueva.';
          },
        );
      });
    }
  }

  private trapSectionHtml(course: Course3D): string {
    if (!course.trapSlots.length) return '';
    return `
      <div class="space"></div>
      <div class="trapbox">
        <h2>😈 Deja una trampa</h2>
        <p class="muted">Sabotea a quien corra este circuito <b>después que tú</b>: si tu colega la pisa,
        pierde tiempo (o muere) y tú subes en el <b>Ranking Saboteador</b>. Tú no la sufres.</p>
        <p class="muted">Cada trampa es un <b>reto de habilidad</b>: si tu colega
        la torea, no le cuesta nada (y suma estilo); si falla, paga tiempo y tú
        sumas en el ranking. <b>1)</b> elige el tipo &nbsp; <b>2)</b> toca un punto
        <span style="color:#22ffcc">●</span> del mapa.</p>
        <label>Tipo de trampa</label>
        <select id="trapType">
          <option value="spike">🔻 Pincho — mata… si no lo SALTA</option>
          <option value="glue">🟢 Pegamento — frena… si no lo DASHea</option>
          <option value="bounce">🟡 Muelle — lo lanza y descoloca</option>
        </select>
        <div id="trapPreview3d" style="min-height:200px;margin-top:8px"></div>
        <div class="row" style="gap:8px;align-items:center;margin-top:8px">
          <button class="btn ghost" id="trapPrev" style="flex:0 0 auto;padding:8px 14px">◀</button>
          <div class="muted center" id="trapHint" style="flex:1;font-size:12px">Arrastra para girar · toca un pilar 💠 para colocar la trampa ahí</div>
          <button class="btn ghost" id="trapNext" style="flex:0 0 auto;padding:8px 14px">▶</button>
        </div>
        <div class="ok" id="trapMsg"></div>
      </div>
    `;
  }

  private disposeTrapPreview() {
    if (this.trapPreview) {
      this.trapPreview.dispose();
      this.trapPreview = null;
    }
  }

  private wireTrapSection(r: RunResult3D) {
    const host = this.card.querySelector('#trapPreview3d') as HTMLElement | null;
    if (!host || !r.course.trapSlots.length || !r.courseId) return;
    const typeSel = this.$('#trapType') as HTMLSelectElement;
    const hint = this.card.querySelector('#trapHint') as HTMLElement | null;
    const msg = this.$('#trapMsg');
    let placed = false;

    this.disposeTrapPreview();
    const preview = new CoursePreview3D(host, r.course, async (slot: TrapSlot3D) => {
      if (placed) return; // one trap per run
      try {
        await api.placeTrap({
          courseId: r.courseId!,
          handle: getHandle(),
          slotX: slot.x,
          slotZ: slot.z,
          trapType: typeSel.value as TrapType3D,
        });
        placed = true;
        preview.select(slot);
        preview.lock();
        const label = typeSel.options[typeSel.selectedIndex]?.text.split('—')[0].trim() || 'Trampa';
        msg.textContent = `¡${label} colocada aquí! Tus colegas la van a sufrir 😈`;
        if (hint) hint.textContent = 'Ya has puesto tu trampa de este circuito.';
      } catch (e: any) {
        msg.className = 'err';
        msg.textContent = `No se pudo: ${e.message}`;
      }
    });
    this.trapPreview = preview;

    // ◀ ▶ jump the camera between the available trap zones.
    const slots = r.course.trapSlots;
    let idx = 0;
    const go = (d: number) => {
      idx = (idx + d + slots.length) % slots.length;
      preview.focusSlot(slots[idx]);
    };
    this.card.querySelector('#trapPrev')?.addEventListener('click', () => go(-1));
    this.card.querySelector('#trapNext')?.addEventListener('click', () => go(1));
  }

  // ---------- LEAGUE ----------
  async showLeague(note?: string): Promise<void> {
    this.show();
    const leagueId = getLeagueId();

    // In a league → info + play today's circuit.
    if (leagueId) {
      this.card.innerHTML = `<h2>🏆 Liga</h2><p class="muted">Cargando…</p>`;
      try {
        const l = await api.getLeague(leagueId);
        this.card.innerHTML = `
          <h2>🏆 ${escapeHtml(l.name)}</h2>
          ${note ? `<p class="ok">${escapeHtml(note)}</p>` : ''}
          <div class="center"><span class="streak">🔥 ${l.streakCount}</span><div class="muted">racha de liga</div></div>
          <div class="members">${l.members.map((m) => `<span class="chip">${escapeHtml(m.handle)}</span>`).join('')}</div>
          ${l.inviteCode ? `<p class="muted center">Código: <b>${l.inviteCode}</b></p>` : ''}
          <div class="space"></div>
          <button class="btn" id="play">▶ Circuito de hoy</button>
          <button class="btn ghost" id="leave">Salir de la liga</button>
          <button class="btn ghost" id="back">← Volver</button>
          <div class="err" id="err"></div>
        `;
        this.$('#play').addEventListener('click', () => this.playDaily());
        this.$('#leave').addEventListener('click', () => { setLeagueId(''); this.showLeague(); });
        this.$('#back').addEventListener('click', () => this.showMenu());
      } catch (e: any) {
        if (isGone(e)) { setLeagueId(''); return this.showLeague('Esa liga ya no existe. Crea o únete a una nueva.'); }
        this.card.innerHTML = `<h2>🏆 Liga</h2><p class="err">No se pudo cargar la liga.</p>
          <button class="btn ghost" id="back">← Volver</button>`;
        this.$('#back').addEventListener('click', () => this.showMenu());
      }
      return;
    }

    // Not in a league → create / join (uses your saved name).
    this.card.innerHTML = `
      <h2>🏆 Liga</h2>
      ${note ? `<p class="ok">${escapeHtml(note)}</p>` : ''}
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
    this.$('#create').addEventListener('click', async () => {
      const name = (this.$('#newName') as HTMLInputElement).value.trim();
      if (!name) return this.err('Pon un nombre de liga.');
      try {
        const res = await api.createLeague(name, getHandle());
        setLeagueId(res.id);
        setUserId(res.userId);
        this.showLeague(`Liga creada. Código: ${res.inviteCode}`);
      } catch (e: any) {
        this.err(e.message);
      }
    });
    this.$('#join').addEventListener('click', async () => {
      const code = (this.$('#code') as HTMLInputElement).value.trim().toUpperCase();
      if (!code) return this.err('Pon el código.');
      try {
        const res = await api.joinLeague(code, getHandle());
        setLeagueId(res.id);
        if ((res as any).userId) setUserId((res as any).userId);
        this.showLeague('¡Dentro!');
      } catch (e: any) {
        this.err(e.message);
      }
    });
    this.$('#back').addEventListener('click', () => this.showMenu());
  }

  // ---------- ROOMS ----------
  async showRooms(note?: string) {
    this.show();
    this.card.innerHTML = `
      <h2>📺 Sala</h2>
      ${note ? `<p class="ok">${escapeHtml(note)}</p>` : ''}
      <label>Crear una sala nueva</label>
      <input id="roomName" placeholder="nombre de la sala" maxlength="24" />
      <label>Número de circuitos</label>
      <select id="numCourses">
        <option value="3">3 circuitos</option>
        <option value="5" selected>5 circuitos</option>
        <option value="7">7 circuitos</option>
      </select>
      <button class="btn" id="create">Crear sala</button>
      <div class="space"></div>
      <label>Unirse con código</label>
      <input id="code" placeholder="p.ej. SALA42" maxlength="12" style="text-transform:uppercase" />
      <button class="btn secondary" id="join">Unirse</button>
      <button class="btn ghost" id="back">← Volver</button>
      <div class="err" id="err"></div>
    `;
    this.$('#create').addEventListener('click', async () => {
      const name = (this.$('#roomName') as HTMLInputElement).value.trim();
      const numCourses = Number((this.$('#numCourses') as HTMLSelectElement).value);
      if (!name) return this.err('Pon un nombre de sala.');
      try {
        const res = await api.createRoom(name, getHandle(), numCourses);
        setUserId(res.userId);
        localStorage.setItem('trampa.roomId', res.id);
        this.showRoom(res.id);
      } catch (e: any) {
        this.err(e.message);
      }
    });
    this.$('#join').addEventListener('click', async () => {
      const code = (this.$('#code') as HTMLInputElement).value.trim().toUpperCase();
      if (!code) return this.err('Pon el código.');
      try {
        const res = await api.joinRoom(code, getHandle());
        setUserId(res.userId);
        localStorage.setItem('trampa.roomId', res.id);
        this.showRoom(res.id);
      } catch (e: any) {
        this.err(e.message);
      }
    });
    this.$('#back').addEventListener('click', () => this.showMenu());
  }

  async showRoom(roomId: string) {
    this.disposeTrapPreview();
    this.show();
    this.loading('Cargando sala…');
    let room: RoomState;
    try {
      room = await api.getRoom(roomId);
    } catch (e: any) {
      this.showRooms().then(() => this.err(`No se pudo cargar la sala: ${e.message}`));
      return;
    }

    const isHost = room.hostId === getUserId();
    const finished = room.status === 'finished';

    const circuits = Array.from(
      { length: room.numCourses },
      (_, i) => `<button class="btn" data-course="${i}">Circuito ${i + 1}</button>`,
    ).join('');

    this.card.innerHTML = `
      <h2>${escapeHtml(room.name)}</h2>
      <p class="muted center">comparte el código:</p>
      <div class="code-big">${escapeHtml(room.code)}</div>
      <div class="center muted">${room.members.length} jugador${room.members.length === 1 ? '' : 'es'} · ${room.numCourses} circuitos</div>
      <div class="space"></div>
      ${finished && room.podium.length ? renderPodium(room.podium) : ''}
      ${renderStandings(room.standings, getHandle())}
      ${finished ? '' : `<button class="btn" id="live">🏁 Carrera EN VIVO <span class="muted" style="font-size:11px">(beta)</span></button>`}
      ${finished ? '' : `<h2>Circuitos (contrarreloj)</h2><div class="circuits">${circuits}</div>`}
      ${isHost && !finished ? '<button class="btn secondary" id="finish">🏁 Finalizar torneo</button>' : ''}
      <button class="btn ghost" id="back">← Volver</button>
      <div class="err" id="err"></div>
    `;

    if (!finished) {
      this.card.querySelectorAll('[data-course]').forEach((n) =>
        n.addEventListener('click', () => {
          const idx = Number(n.getAttribute('data-course'));
          this.playRoomCourse(roomId, idx, room.numCourses);
        }),
      );
      this.$('#live').addEventListener('click', () => this.showLiveLobby(room));
    }

    if (isHost && !finished) {
      this.$('#finish').addEventListener('click', async () => {
        try {
          const res = await api.finishRoom(roomId, getHandle());
          if (res.podium && res.podium.length) {
            this.card.innerHTML = `
              <h2>${escapeHtml(room.name)} — 🏆 Podio</h2>
              ${renderPodium(res.podium)}
              ${renderStandings(res.standings, getHandle())}
              <button class="btn ghost" id="back">← Volver al menú</button>
            `;
            this.$('#back').addEventListener('click', () => this.showMenu());
          } else {
            this.showRoom(roomId);
          }
        } catch (e: any) {
          this.err(e.message);
        }
      });
    }

    this.$('#back').addEventListener('click', () => this.showMenu());
  }

  // ---------- LIVE MULTIPLAYER (MVP) ----------
  private leaveLiveHeat() {
    if (this.liveHeat) { this.liveHeat.leave(); this.liveHeat = null; }
  }

  /** A waiting room for a synchronized live race; the host fires the start. */
  private async showLiveLobby(room: RoomState) {
    this.show();
    const userId = getUserId();
    const handle = getHandle();
    if (!userId || !handle) return this.err('Necesitas tu nombre y estar en la sala.');
    this.leaveLiveHeat();
    const heat = new LiveHeat(room.id, { userId, handle });
    this.liveHeat = heat;
    const isHost = room.hostId === userId;

    this.card.innerHTML = `
      <h2>🏁 Carrera en vivo</h2>
      <p class="muted center">Todos corréis el <b>mismo circuito a la vez</b> y os veis en directo. Las trampas siguen fastidiando 😈. El anfitrión da la salida.</p>
      <div class="muted center">Circuito 1 · sala <b>${escapeHtml(room.code)}</b></div>
      <div class="space"></div>
      <label>Sala de espera</label>
      <div class="members" id="roster"><span class="chip">${escapeHtml(handle)} (tú)</span></div>
      <div class="space"></div>
      <div id="lobbyAction"><p class="muted center">Conectando…</p></div>
      <button class="btn ghost" id="back">← Salir</button>
      <div class="err" id="err"></div>
    `;
    this.$('#back').addEventListener('click', () => { this.leaveLiveHeat(); this.showRoom(room.id); });

    heat.onRoster = (members) => {
      const el = this.card.querySelector('#roster');
      if (!el) return;
      const list = members.length ? members : [{ userId, handle }];
      el.innerHTML = list
        .map((m) => `<span class="chip">${escapeHtml(m.handle)}${m.userId === userId ? ' (tú)' : ''}</span>`)
        .join('');
    };
    heat.onStart = (s) => this.beginLiveRun(room, s, heat);

    try {
      await heat.join();
    } catch (e: any) {
      if (this.liveHeat === heat) this.err(e.message || 'No se pudo conectar al modo en vivo.');
      return;
    }
    if (this.liveHeat !== heat) return; // navigated away while connecting
    const action = this.card.querySelector('#lobbyAction');
    if (!action) return;
    if (isHost) {
      action.innerHTML = `<button class="btn" id="go">▶ ¡DAR LA SALIDA!</button>`;
      this.$('#go').addEventListener('click', () => {
        (this.$('#go') as HTMLButtonElement).disabled = true;
        const s = heat.start(0);
        this.beginLiveRun(room, s, heat); // host starts locally (broadcast self:false)
      });
    } else {
      action.innerHTML = `<p class="muted center">⏳ Esperando a que el anfitrión dé la salida…</p>`;
    }
  }

  private async beginLiveRun(room: RoomState, start: HeatStart, heat: LiveHeat) {
    if (this.liveHeat !== heat) return; // already started / left
    heat.onStart = undefined; // one start only
    try {
      this.loading('Preparando la carrera…');
      const rc = await api.roomCourse(room.id, start.courseIdx);
      this.liveHeat = null; // ownership passes to the engine for the run
      this.startRun({
        course: rc.course,
        courseId: rc.courseId,
        placedTraps: rc.traps,
        ghosts: [],
        online: true,
        mode: 'room',
        roomId: room.id,
        roomIdx: start.courseIdx,
        numCourses: room.numCourses,
        live: heat,
        liveStartAtMs: start.startAtMs,
      });
    } catch (e: any) {
      heat.leave();
      this.showRoom(room.id).then(() => this.err(`No se pudo empezar la carrera: ${e.message}`));
    }
  }

  private async playRoomCourse(roomId: string, idx: number, numCourses: number) {
    const handle = getHandle();
    if (!handle) return this.err('Escribe tu nombre primero.');
    this.loading(`Cargando circuito ${idx + 1}…`);
    try {
      const rc = await api.roomCourse(roomId, idx);
      const ghostsRaw = await api.ghosts(rc.courseId, handle).catch(() => []);
      const ghosts = await prepareGhosts3D(
        rc.course,
        ghostsRaw.map((g) => ({ handle: g.handle, timeMs: g.timeMs, inputLog: g.inputLog })),
        rc.traps,
      );
      this.startRun({
        course: rc.course,
        courseId: rc.courseId,
        placedTraps: rc.traps,
        ghosts,
        online: true,
        mode: 'room',
        roomId,
        roomIdx: idx,
        numCourses,
      });
    } catch (e: any) {
      this.showRoom(roomId).then(() =>
        this.err(`No se pudo cargar el circuito: ${e.message}`),
      );
    }
  }

  // ---------- STORE ----------
  showStore() {
    this.show();
    const owned = ownedSkins();
    const eq = equippedSkin();
    const rows = allSkins().map((s) => {
      const isOwned = owned.includes(s.id);
      const isEq = eq.id === s.id;
      const is3d = hasModel(s.id);
      const btn = isEq
        ? '<span class="chip">equipado</span>'
        : isOwned
          ? `<button class="btn ghost" data-equip="${s.id}" style="width:auto;margin:0;padding:8px 12px">Equipar</button>`
          : `<button class="btn" data-buy="${s.id}" style="width:auto;margin:0;padding:8px 12px">${(s.price / 100).toFixed(2)}€</button>`;
      const tag = is3d
        ? '<span class="chip" style="font-size:10px;color:#8affd6;border-color:#2a6">modelo 3D</span>'
        : `<div class="muted" style="font-size:11px">${accessoryLabel(s.accessory)}</div>`;
      return `<div class="skin">
        <div class="swatch" style="background:#${s.body.toString(16).padStart(6, '0')}">${s.emoji}</div>
        <div class="grow"><b>${escapeHtml(s.name)}</b>${tag}</div>
        ${btn}
      </div>`;
    }).join('');
    this.card.innerHTML = `
      <h2>Tienda</h2>
      <p class="muted">Personajes. Compra directa, solo cosmético, sin cajas de botín.</p>
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

function renderSaboteurs(sab: SaboteurEntry[]): string {
  if (!sab.length) return '';
  const rows = sab
    .map(
      (e, i) =>
        `<tr><td class="rank">${i + 1}</td><td>${escapeHtml(e.handle)}</td><td class="time">${e.hits} pillado${e.hits === 1 ? '' : 's'}</td></tr>`,
    )
    .join('');
  return `<h2>😈 Ranking Saboteador</h2><table class="lb">${rows}</table>`;
}

function renderStandings(st: RoomStanding[], me: string): string {
  if (!st.length) return '<p class="muted">Aún no hay resultados. ¡Corre un circuito!</p>';
  const rows = st
    .map(
      (e, i) =>
        `<tr class="${e.handle === me ? 'me' : ''}"><td class="rank">${i + 1}</td><td>${escapeHtml(e.handle)}</td><td class="time">${e.points} pts · ${e.played} circ.</td></tr>`,
    )
    .join('');
  return `<h2>Clasificación</h2><table class="lb">${rows}</table>`;
}

function renderPodium(podium: RoomStanding[]): string {
  const medals = ['🥇', '🥈', '🥉'];
  const rows = podium
    .slice(0, 3)
    .map(
      (e, i) =>
        `<div class="podium-row"><span class="medal">${medals[i] || ''}</span><span class="grow">${escapeHtml(e.handle)}</span><span class="pts">${e.points} pts</span></div>`,
    )
    .join('');
  return `<h2>🏆 Podio</h2><div class="podium">${rows}</div>`;
}

/** True if an API error means the referenced thing no longer exists. */
function isGone(e: any): boolean {
  const m = String(e?.message || '').toLowerCase();
  return m.includes('not found') || m.includes('no encontrad');
}

function accessoryLabel(a: string): string {
  return (
    {
      none: 'básico', cap: 'con gorra', crown: 'con corona', horns: 'con cuernos',
      antenna: 'con antena', halo: 'con aureola', visor: 'con visor',
      headphones: 'con cascos', mohawk: 'con cresta',
    } as Record<string, string>
  )[a] ?? '';
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
