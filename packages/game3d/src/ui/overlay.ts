import {
  generateVerifiedCourse3D,
  defaultConfig,
  type Course3D,
  type TrapType3D,
} from '@trampa/shared';
import type { InputLog3D } from '@trampa/shared';
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
import { SKINS, ownedSkins, ownSkin, equipSkin, equippedSkin } from '../cosmetics.js';
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

    const savedRoomId = localStorage.getItem('trampa.roomId');
    const roomBackBtn = savedRoomId
      ? `<button class="btn secondary" id="roomBack">↩ Volver a mi sala</button>
         <div class="desc">Sigue el torneo que ya tienes abierto.</div>`
      : '';

    this.card.innerHTML = `
      <div class="title">TRAMPA</div>
      <div class="subtitle">corre · esquiva · sabotea</div>
      ${leagueLine}
      <div class="space"></div>
      <label>Tu nombre</label>
      <input id="handle" placeholder="p.ej. rubén" value="${escapeAttr(handle)}" maxlength="16" />
      <button class="btn" id="daily">▶ Circuito de hoy</button>
      <div class="desc">El reto diario de tu liga. Corre, deja tu tiempo y una trampa.</div>
      <button class="btn secondary" id="global">🌍 Reto diario global</button>
      <div class="desc">El mismo circuito para todo el mundo hoy. Comparte tu marca.</div>
      <button class="btn secondary" id="rooms">📺 Salas (torneo)</button>
      <div class="desc">Torneo de varios circuitos con podio. Para un directo o quedada.</div>
      ${roomBackBtn}
      <button class="btn secondary" id="quick">🎮 Partida rápida (sin conexión)</button>
      <div class="desc">Practica y corre contra tu propio fantasma.</div>
      <div class="row">
        <button class="btn ghost" id="league">🏆 Liga</button>
        <button class="btn ghost" id="store">🛍 Tienda</button>
      </div>
      <div class="desc center">Liga = tu grupo fijo con reto diario y racha. Sala = torneo puntual con podio.</div>
      <div class="err" id="err"></div>
    `;
    const handleInput = this.$('#handle') as HTMLInputElement;
    handleInput.addEventListener('change', () => setHandle(handleInput.value.trim()));

    this.$('#daily').addEventListener('click', () => {
      setHandle(handleInput.value.trim());
      this.playDaily();
    });
    this.$('#global').addEventListener('click', () => {
      setHandle(handleInput.value.trim());
      this.playGlobal();
    });
    this.$('#rooms').addEventListener('click', () => {
      setHandle(handleInput.value.trim());
      this.showRooms();
    });
    this.$('#quick').addEventListener('click', () => {
      setHandle(handleInput.value.trim());
      this.playQuick();
    });
    if (savedRoomId) {
      this.$('#roomBack').addEventListener('click', () => this.showRoom(savedRoomId));
    }
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

  private async playQuick() {
    this.loading('Preparando circuito…');
    const { course } = generateVerifiedCourse3D(PRACTICE_SEED, defaultConfig);
    const local = loadLocalGhost(PRACTICE_SEED);
    const ghosts: PreparedGhost3D[] = local ? await prepareGhosts3D(course, [local], []) : [];
    this.startRun({ course, placedTraps: [], ghosts, online: false });
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
    this.card.innerHTML = `
      ${head}
      <div class="center muted">${r.deaths} muertes${r.course.modifier !== 'none' ? ' · mod: ' + r.course.modifier : ''}</div>
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
        <p class="muted"><b>1)</b> elige el tipo &nbsp; <b>2)</b> toca un punto
        <span style="color:#22ffcc">●</span> del mapa (son los sitios permitidos).</p>
        <label>Tipo de trampa</label>
        <select id="trapType">
          <option value="spike">🔻 Pincho — mata al instante</option>
          <option value="bounce">🟡 Muelle — lo lanza por los aires</option>
          <option value="glue">🟢 Pegamento — lo frena unos segundos</option>
        </select>
        ${renderTrapMap(course)}
        <div class="muted center" id="trapHint">☝ Toca un punto verde para colocarla.</div>
        <div class="ok" id="trapMsg"></div>
      </div>
    `;
  }

  private wireTrapSection(r: RunResult3D) {
    const svg = this.card.querySelector('#trapmap');
    if (!svg) return;
    const typeSel = this.$('#trapType') as HTMLSelectElement;
    const hint = this.card.querySelector('#trapHint') as HTMLElement | null;
    let placed = false;
    const slotNodes = svg.querySelectorAll('[data-slot]');
    slotNodes.forEach((node) => {
      node.addEventListener('click', async () => {
        if (placed) return; // one trap per run
        const [sx, sz] = (node.getAttribute('data-slot') || '').split(',').map(parseFloatSafe);
        const msg = this.$('#trapMsg');
        try {
          await api.placeTrap({
            courseId: r.courseId!,
            handle: getHandle(),
            slotX: sx,
            slotZ: sz,
            trapType: typeSel.value as TrapType3D,
          });
          placed = true;
          const label =
            typeSel.options[typeSel.selectedIndex]?.text.split('—')[0].trim() || 'Trampa';
          msg.textContent = `¡${label} colocada aquí! Tus colegas la van a sufrir 😈`;
          if (hint) hint.textContent = 'Ya has puesto tu trampa de este circuito.';
          // Highlight the chosen slot, dim the rest.
          slotNodes.forEach((n) => {
            const chosen = n === node;
            (n as SVGCircleElement).setAttribute('fill', chosen ? '#ff2266' : '#2a3550');
            (n as SVGCircleElement).setAttribute('r', chosen ? '11' : '6');
          });
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

  // ---------- ROOMS ----------
  async showRooms(note?: string) {
    this.show();
    const handle = getHandle();
    this.card.innerHTML = `
      <h2>📺 Salas</h2>
      ${note ? `<p class="ok">${escapeHtml(note)}</p>` : ''}
      <p class="muted">Crea una sala y comparte el código, o únete a una existente.</p>
      <label>Tu nombre</label>
      <input id="handle" value="${escapeAttr(handle)}" maxlength="16" placeholder="tu nombre" />
      <div class="space"></div>
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
    const h = this.$('#handle') as HTMLInputElement;
    this.$('#create').addEventListener('click', async () => {
      const name = (this.$('#roomName') as HTMLInputElement).value.trim();
      const nm = h.value.trim();
      const numCourses = Number((this.$('#numCourses') as HTMLSelectElement).value);
      if (!nm) return this.err('Pon tu nombre.');
      if (!name) return this.err('Pon un nombre de sala.');
      setHandle(nm);
      try {
        const res = await api.createRoom(name, nm, numCourses);
        setUserId(res.userId);
        localStorage.setItem('trampa.roomId', res.id);
        this.showRoom(res.id);
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
        const res = await api.joinRoom(code, nm);
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
      ${finished ? '' : `<h2>Circuitos</h2><div class="circuits">${circuits}</div>`}
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

/**
 * Top-down minimap of the 3D course for placing traps. Forward (Z) maps to the
 * VERTICAL axis (top = far / finish), lateral (X) maps to the HORIZONTAL axis.
 * Each trap slot is a clickable circle carrying its absolute course coords.
 */
function renderTrapMap(course: Course3D): string {
  const W = 400;
  const H = 300;
  const pad = 26;
  const halfW = course.halfWidth > 0 ? course.halfWidth : 6;
  const zSpan = course.finishZ - course.startZ || 1;
  // X (-halfW..halfW) -> horizontal; Z (start..finish) -> vertical, far at top.
  const mapX = (x: number) => pad + ((x + halfW) / (2 * halfW)) * (W - 2 * pad);
  const mapY = (z: number) => pad + (1 - (z - course.startZ) / zSpan) * (H - 2 * pad);
  const track = `<rect x="${(pad - 6).toFixed(1)}" y="${(pad - 6).toFixed(1)}" width="${(W - 2 * pad + 12).toFixed(1)}" height="${(H - 2 * pad + 12).toFixed(1)}" rx="10" fill="#16233c"/>`;
  const finishLine = `<line x1="${pad}" y1="${pad}" x2="${W - pad}" y2="${pad}" stroke="#38e1ff" stroke-width="2.5" stroke-dasharray="7 5"/>`;
  const startLine = `<line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#4a5a80" stroke-width="2" stroke-dasharray="4 4"/>`;
  const metaLabel = `<text x="${W / 2}" y="15" text-anchor="middle" fill="#38e1ff" font-size="12" font-weight="700" font-family="system-ui,sans-serif">META ▲</text>`;
  const salidaLabel = `<text x="${W / 2}" y="${H - 8}" text-anchor="middle" fill="#8093b5" font-size="11" font-family="system-ui,sans-serif">SALIDA</text>`;
  const slots = course.trapSlots
    .map(
      (s) =>
        `<circle data-slot="${s.x},${s.z}" cx="${mapX(s.x).toFixed(1)}" cy="${mapY(s.z).toFixed(1)}" r="9" fill="#22ffcc" stroke="#04121f" stroke-width="1.5" style="cursor:pointer"><title>Colocar trampa aquí</title></circle>`,
    )
    .join('');
  return `<svg id="trapmap" class="trapmap" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${track}${finishLine}${startLine}${metaLabel}${salidaLabel}${slots}</svg>`;
}

function parseFloatSafe(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
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
