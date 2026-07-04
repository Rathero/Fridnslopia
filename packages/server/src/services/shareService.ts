import type { DailyConfig } from '@trampa/shared';

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

/**
 * Build a shareable result card as a self-contained SVG (OG-image sized). This
 * is the viral hook for the GLOBAL daily challenge: post your time, tag a
 * friend, "¿me superas?". No external assets — themed from the course palette.
 */
export function buildShareCard(input: {
  config: DailyConfig;
  playDate: string;
  handle?: string;
  timeMs?: number | null;
  rank?: number | null;
  players?: number | null;
}): string {
  const pal = input.config.palette;
  const theme = esc(input.config.theme);
  const flavor = esc(input.config.flavorText ?? '');
  const timeStr = input.timeMs != null ? `${(input.timeMs / 1000).toFixed(2)}s` : '—';
  const who = esc(input.handle ?? '');
  const rankLine =
    input.rank != null && input.players != null ? `#${input.rank} de ${input.players}` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${pal.bg}"/>
      <stop offset="1" stop-color="#05060c"/>
    </linearGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${pal.accent}"/>
      <stop offset="1" stop-color="${pal.platform}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="10" fill="url(#acc)"/>
  <text x="70" y="130" font-family="Arial, sans-serif" font-size="54" font-weight="800" fill="${pal.accent}" letter-spacing="4">TRAMPA</text>
  <text x="70" y="185" font-family="Arial, sans-serif" font-size="28" fill="#9fb3d8">Reto diario · ${esc(input.playDate)} · ${theme}</text>
  <text x="70" y="360" font-family="Arial, sans-serif" font-size="150" font-weight="900" fill="#ffffff">${timeStr}</text>
  ${who ? `<text x="70" y="420" font-family="Arial, sans-serif" font-size="40" font-weight="700" fill="${pal.accent}">${who}${rankLine ? '  ·  ' + rankLine : ''}</text>` : ''}
  <text x="70" y="520" font-family="Arial, sans-serif" font-size="30" fill="#8ea3c8">${flavor}</text>
  <text x="70" y="575" font-family="Arial, sans-serif" font-size="40" font-weight="800" fill="${pal.accent}">¿me superas? 🔥</text>
</svg>`;
}
