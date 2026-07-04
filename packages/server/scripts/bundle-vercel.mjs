// Bundle the server (Express app + @trampa/shared + Rapier WASM, all inlined)
// into a single self-contained Vercel serverless function. This avoids relying
// on Vercel resolving the npm workspace or the WASM at build time.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(here, '..');
const outDir = resolve(serverDir, 'vercel-out');
const apiDir = resolve(outDir, 'api');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(apiDir, { recursive: true });

await build({
  entryPoints: [resolve(serverDir, 'src/vercel-entry.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: resolve(apiDir, 'index.js'),
  // pg optionally requires these; they're not used (pure-JS pg) — keep them out.
  external: ['pg-native', 'cloudflare:sockets'],
  logLevel: 'info',
  banner: { js: '/* trampa api bundle */' },
});

// Route every path to the single function; Express does the internal routing.
writeFileSync(
  resolve(outDir, 'vercel.json'),
  JSON.stringify({ rewrites: [{ source: '/(.*)', destination: '/api' }] }, null, 2),
);
writeFileSync(
  resolve(outDir, 'package.json'),
  JSON.stringify({ private: true, name: 'trampa-api', engines: { node: '20.x' } }, null, 2),
);
writeFileSync(resolve(outDir, '.vercelignore'), 'node_modules\n');

console.log('[bundle-vercel] wrote', outDir);
