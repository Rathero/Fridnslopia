/** Injects the overlay stylesheet once. Kept in JS so the client is asset-free. */
export function injectStyles() {
  if (document.getElementById('trampa-styles')) return;
  const css = `
  #ui {
    position: fixed; inset: 0; z-index: 10;
    display: flex; align-items: center; justify-content: center;
    color: #e8ecff; font-family: system-ui, sans-serif;
    background: radial-gradient(circle at 50% 0%, #10203a 0%, #06070d 70%);
    -webkit-tap-highlight-color: transparent;
  }
  #ui.hidden { display: none; }
  .card {
    width: min(440px, 92vw); max-height: 92vh; overflow-y: auto;
    background: rgba(14,20,36,0.96); border: 1px solid #24304e;
    border-radius: 18px; padding: 22px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  .title { font-size: 40px; font-weight: 800; letter-spacing: 2px; color: #38e1ff;
    text-align: center; margin: 4px 0 2px; }
  .subtitle { text-align: center; color: #8fa3c8; font-size: 13px; margin-bottom: 18px; }
  h2 { font-size: 20px; margin: 4px 0 14px; }
  .btn {
    display: block; width: 100%; box-sizing: border-box; margin: 8px 0; padding: 14px;
    border: none; border-radius: 12px; font-size: 16px; font-weight: 700;
    background: #38e1ff; color: #06121a; cursor: pointer;
  }
  .btn:active { transform: translateY(1px); }
  .btn.secondary { background: #223052; color: #cfe0ff; }
  .btn.ghost { background: transparent; border: 1px solid #33436a; color: #a9bde0; font-weight: 600; }
  .row { display: flex; gap: 8px; }
  .row .btn { margin: 8px 0; }
  input, select {
    width: 100%; box-sizing: border-box; padding: 12px; margin: 6px 0 12px;
    border-radius: 10px; border: 1px solid #2c3a5c; background: #0d1526; color: #e8ecff;
    font-size: 15px;
  }
  label { font-size: 13px; color: #93a6cc; }
  .members { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
  .chip { background: #1a2440; border: 1px solid #2c3a5c; border-radius: 999px; padding: 5px 10px; font-size: 12px; }
  .streak { font-size: 28px; font-weight: 800; color: #ffd23c; text-align: center; }
  .big-time { font-size: 52px; font-weight: 800; text-align: center; color: #38e1ff; margin: 6px 0; }
  .muted { color: #8093b5; font-size: 13px; }
  .lb { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .lb td { padding: 7px 6px; border-bottom: 1px solid #1c2740; font-size: 14px; }
  .lb td.rank { color: #8fa3c8; width: 28px; }
  .lb td.time { text-align: right; color: #cfe0ff; font-variant-numeric: tabular-nums; }
  .lb tr.me td { color: #38e1ff; font-weight: 700; }
  .err { color: #ff6b6b; font-size: 13px; min-height: 18px; margin: 4px 0; }
  .ok { color: #6bffab; font-size: 13px; min-height: 18px; margin: 4px 0; }
  .skin { display: flex; align-items: center; gap: 12px; padding: 10px; border: 1px solid #24304e;
    border-radius: 12px; margin: 8px 0; }
  .swatch { width: 34px; height: 34px; border-radius: 50%; flex: none; }
  .skin .grow { flex: 1; }
  .trapmap { width: 100%; background: #0a1120; border-radius: 10px; margin: 10px 0; display: block; }
  .center { text-align: center; }
  .space { height: 8px; }
  `;
  const style = document.createElement('style');
  style.id = 'trampa-styles';
  style.textContent = css;
  document.head.appendChild(style);
}
