import { readdir, stat, rename, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

/**
 * Compress every large raw Meshy GLB in the public asset dirs with gltf-transform
 * (Draco geometry + WebP textures @1024). Skips already-small (already-compressed)
 * files. ~8 MB -> ~400 KB. Run after scripts/meshy/gen.mjs.
 */
const ROOT = new URL('../../packages/game3d/public/', import.meta.url);
const DIRS = ['models', 'props', 'traps', 'hazards', 'walls', 'floors'];
const THRESHOLD = 900 * 1024; // only compress files bigger than this

for (const d of DIRS) {
  let files;
  try { files = await readdir(new URL(`${d}/`, ROOT)); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith('.glb')) continue;
    const p = new URL(`${d}/${f}`, ROOT);
    const { size } = await stat(p);
    if (size <= THRESHOLD) { console.log(`skip ${d}/${f} (${(size/1024).toFixed(0)}KB, already small)`); continue; }
    const out = new URL(`${d}/${f}.opt.glb`, ROOT);
    process.stdout.write(`opt ${d}/${f} (${(size/1024/1024).toFixed(1)}MB) … `);
    try {
      await run('npx', ['--no-install', 'gltf-transform', 'optimize', p.pathname, out.pathname,
        '--compress', 'draco', '--texture-compress', 'webp', '--texture-size', '1024'], { timeout: 180000 });
      const { size: ns } = await stat(out);
      await unlink(p); await rename(out, p);
      console.log(`-> ${(ns/1024).toFixed(0)}KB`);
    } catch (e) {
      console.log('FAILED:', e.message.slice(0, 120));
      try { await unlink(out); } catch {}
    }
  }
}
console.log('done.');
