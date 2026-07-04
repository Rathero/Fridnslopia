/**
 * Lightweight menu + result overlays, injected from TS with no framework. The
 * renderer keeps drawing the course behind these, so they read as glassy panels
 * floating over the world. All strings are Spanish to match the game's voice.
 */

export interface ResultInfo {
  finished: boolean;
  timeMs: number;
  deaths: number;
}

const STYLE_ID = 'trampa3d-ui-style';

const CSS = `
.t3d-overlay {
  position: fixed; inset: 0; z-index: 10; display: flex;
  align-items: center; justify-content: center;
  font-family: system-ui, -apple-system, sans-serif;
  background: radial-gradient(120% 90% at 50% 20%, rgba(10,18,38,.55), rgba(3,4,9,.9));
  backdrop-filter: blur(3px);
  animation: t3d-fade .35s ease;
}
@keyframes t3d-fade { from { opacity: 0; } to { opacity: 1; } }
.t3d-card {
  text-align: center; color: #eaf2ff; padding: 34px 40px;
  border-radius: 22px; max-width: 90vw;
  background: linear-gradient(180deg, rgba(18,28,52,.72), rgba(8,12,26,.82));
  border: 1px solid rgba(120,200,255,.18);
  box-shadow: 0 24px 70px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.06);
}
.t3d-title {
  margin: 0; font-weight: 900; letter-spacing: 2px; line-height: .95;
  font-size: clamp(40px, 9vw, 74px);
  background: linear-gradient(180deg, #eaf7ff, var(--t3d-accent, #45e0ff));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: 0 0 30px rgba(69,224,255,.25);
}
.t3d-tag {
  display: inline-block; margin-top: 10px; padding: 4px 12px; border-radius: 999px;
  font-size: 12px; letter-spacing: 2px; text-transform: uppercase;
  color: #04121a; font-weight: 800; background: var(--t3d-accent, #45e0ff);
}
.t3d-sub { margin: 16px 0 4px; font-size: 16px; color: #a9c7e6; line-height: 1.5; }
.t3d-stats { display: flex; gap: 26px; justify-content: center; margin: 20px 0 6px; }
.t3d-stat b { display: block; font-size: 34px; font-weight: 800; color: #eaf2ff; }
.t3d-stat span { font-size: 12px; letter-spacing: 1px; color: #7f9dbf; text-transform: uppercase; }
.t3d-actions { display: flex; gap: 12px; justify-content: center; margin-top: 22px; flex-wrap: wrap; }
.t3d-btn {
  padding: 14px 28px; border: none; border-radius: 14px; cursor: pointer;
  font-size: 17px; font-weight: 800; letter-spacing: .5px;
  color: #04121a; background: var(--t3d-accent, #45e0ff);
  box-shadow: 0 10px 26px rgba(69,224,255,.35); transition: transform .1s ease, filter .1s ease;
}
.t3d-btn:hover { filter: brightness(1.08); }
.t3d-btn:active { transform: translateY(1px) scale(.98); }
.t3d-btn.ghost {
  background: transparent; color: #cfe4ff; box-shadow: none;
  border: 1px solid rgba(150,200,255,.3);
}
.t3d-hint { margin-top: 18px; font-size: 13px; color: #6f8bab; letter-spacing: .3px; }
.t3d-hint kbd {
  display: inline-block; padding: 1px 7px; margin: 0 2px; border-radius: 6px;
  background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12);
  font-family: inherit; font-size: 12px;
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export class Ui {
  private root: HTMLDivElement | null = null;

  constructor(private accentHex: string) {
    ensureStyle();
  }

  private mount(html: string): HTMLDivElement {
    this.hide();
    const el = document.createElement('div');
    el.className = 't3d-overlay';
    el.style.setProperty('--t3d-accent', this.accentHex);
    el.innerHTML = html;
    document.body.appendChild(el);
    this.root = el;
    return el;
  }

  hide() {
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
  }

  /** Start menu. `onPlay` fires when the player taps Jugar. */
  showMenu(theme: string, onPlay: () => void) {
    const el = this.mount(`
      <div class="t3d-card">
        <h1 class="t3d-title">TRAMPA 3D</h1>
        <div class="t3d-tag">Reto diario · ${theme}</div>
        <p class="t3d-sub">Corre en picado, esquiva y salta.<br/>El mismo reto para todo el mundo hoy.</p>
        <div class="t3d-actions">
          <button class="t3d-btn" id="t3d-play">Jugar</button>
        </div>
        <div class="t3d-hint">
          <kbd>←</kbd><kbd>→</kbd> esquiva · <kbd>Espacio</kbd> salta · o toca los lados / centro
        </div>
      </div>
    `);
    el.querySelector<HTMLButtonElement>('#t3d-play')!.addEventListener('click', () => {
      this.hide();
      onPlay();
    });
  }

  /** Result screen. `onReplay` races your previous ghost; `onMenu` returns home. */
  showResult(info: ResultInfo, actions: { onReplay: () => void; onMenu: () => void }) {
    const secs = (info.timeMs / 1000).toFixed(2);
    const title = info.finished ? '¡META!' : 'FIN';
    const sub = info.finished
      ? 'Reto diario completado. ¿Bajas tu tiempo?'
      : 'No llegaste al final. Otra vez.';
    const el = this.mount(`
      <div class="t3d-card">
        <h1 class="t3d-title">${title}</h1>
        <div class="t3d-tag">Reto diario</div>
        <div class="t3d-stats">
          <div class="t3d-stat"><b>${secs}s</b><span>Tiempo</span></div>
          <div class="t3d-stat"><b>${info.deaths}</b><span>Caídas</span></div>
        </div>
        <p class="t3d-sub">${sub}</p>
        <div class="t3d-actions">
          <button class="t3d-btn" id="t3d-again">Otra vez</button>
          <button class="t3d-btn ghost" id="t3d-menu">Menú</button>
        </div>
        <div class="t3d-hint">«Otra vez» te enfrenta a tu fantasma anterior.</div>
      </div>
    `);
    el.querySelector<HTMLButtonElement>('#t3d-again')!.addEventListener('click', () => {
      this.hide();
      actions.onReplay();
    });
    el.querySelector<HTMLButtonElement>('#t3d-menu')!.addEventListener('click', () => {
      this.hide();
      actions.onMenu();
    });
  }
}

/** Convert a 0xRRGGBB number into a CSS hex string. */
export function hexColor(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}
