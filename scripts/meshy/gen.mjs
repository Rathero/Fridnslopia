import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { EXAMPLES, FINAL } from './jobs.mjs';

/**
 * Generate TRAMPA characters + props via the Meshy API and wire them into the
 * game. Characters: text-to-3d (lowpoly, A-pose) → refine → auto-rig + running
 * animation → GLB. Props: text-to-3d → refine → GLB.
 *
 * Usage: MESHY_KEY=... node scripts/meshy/gen.mjs [examples|final]
 */

const KEY = process.env.MESHY_KEY;
if (!KEY) { console.error('Set MESHY_KEY'); process.exit(1); }
const BATCH = (process.argv[2] || 'examples').toLowerCase();
const JOBS = BATCH === 'final' ? FINAL : EXAMPLES;

const BASE = 'https://api.meshy.ai';
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const MODELS_DIR = new URL('../../packages/game3d/public/models/', import.meta.url);
const PROPS_DIR = new URL('../../packages/game3d/public/props/', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`POST ${path} ${r.status}: ${t}`);
  return JSON.parse(t);
}
async function get(path) {
  const r = await fetch(BASE + path, { headers: H });
  const t = await r.text();
  if (!r.ok) throw new Error(`GET ${path} ${r.status}: ${t}`);
  return JSON.parse(t);
}
async function poll(path, label, timeoutMs = 8 * 60 * 1000) {
  const start = Date.now();
  let last = -1;
  for (;;) {
    const d = await get(path);
    const st = d.status;
    if (d.progress !== last) { process.stdout.write(`\r  [${label}] ${st} ${d.progress ?? 0}%   `); last = d.progress; }
    if (st === 'SUCCEEDED') { console.log(`\r  [${label}] SUCCEEDED (credits: ${d.consumed_credits ?? '?'})     `); return d; }
    if (st === 'FAILED' || st === 'CANCELED') throw new Error(`${label} ${st}: ${JSON.stringify(d.task_error ?? d)}`);
    if (Date.now() - start > timeoutMs) throw new Error(`${label} timed out`);
    await sleep(5000);
  }
}
async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}
// Deep-scan an object for glb URLs, preferring running > walking > rigged.
function findGlb(obj) {
  const urls = [];
  const walk = (o, ctx) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && v.includes('.glb')) urls.push({ url: v, ctx: (ctx + ' ' + k).toLowerCase() });
      else if (typeof v === 'object') walk(v, ctx + ' ' + k);
    }
  };
  walk(obj, '');
  const score = (u) => (/run/.test(u.ctx) ? 3 : /walk/.test(u.ctx) ? 2 : /rigged|character/.test(u.ctx) ? 1 : 0);
  urls.sort((a, b) => score(b) - score(a));
  return urls[0]?.url ?? null;
}

async function makeModel(prompt) {
  console.log('  text-to-3d preview…');
  const prev = await post('/openapi/v2/text-to-3d', {
    mode: 'preview', prompt, ai_model: 'latest', model_type: 'lowpoly',
    pose_mode: 'a-pose', topology: 'triangle', target_polycount: 12000,
    target_formats: ['glb'], auto_size: true, origin_at: 'bottom',
  });
  const previewId = prev.result;
  await poll(`/openapi/v2/text-to-3d/${previewId}`, 'preview');
  console.log('  refine (textures)…');
  const ref = await post('/openapi/v2/text-to-3d', {
    mode: 'refine', preview_task_id: previewId, enable_pbr: false, target_formats: ['glb'],
  });
  const refineId = ref.result;
  const refined = await poll(`/openapi/v2/text-to-3d/${refineId}`, 'refine');
  return { refineId, glb: refined.model_urls?.glb };
}

async function rig(inputTaskId) {
  console.log('  auto-rig + running animation…');
  const rg = await post('/openapi/v1/rigging', { input_task_id: inputTaskId, height_meters: 1.6 });
  const id = rg.result ?? rg.id;
  const done = await poll(`/openapi/v1/rigging/${id}`, 'rigging');
  const url = findGlb(done);
  if (!url) throw new Error('no rigged GLB url in ' + JSON.stringify(done).slice(0, 400));
  return url;
}

async function run() {
  await mkdir(MODELS_DIR, { recursive: true });
  await mkdir(PROPS_DIR, { recursive: true });
  const manifestPath = new URL('manifest.json', MODELS_DIR);
  const propsManifestPath = new URL('manifest.json', PROPS_DIR);
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : [];
  const propsManifest = existsSync(propsManifestPath) ? JSON.parse(await readFile(propsManifestPath, 'utf8')) : [];

  console.log(`\n=== CHARACTERS (${JOBS.characters.length}) ===`);
  for (const c of JOBS.characters) {
    console.log(`\n▶ ${c.name} (${c.id})`);
    try {
      const { refineId } = await makeModel(c.prompt);
      let glbUrl;
      try { glbUrl = await rig(refineId); }
      catch (e) { console.warn('  rig failed, using static model:', e.message); glbUrl = (await get(`/openapi/v2/text-to-3d/${refineId}`)).model_urls?.glb; }
      const file = `${c.id}.glb`;
      const bytes = await download(glbUrl, new URL(file, MODELS_DIR));
      console.log(`  saved ${file} (${(bytes / 1024).toFixed(0)} KB)`);
      const entry = { id: c.id, name: c.name, file, emoji: c.emoji, scale: 1, yaw: 0 };
      const i = manifest.findIndex((m) => m.id === c.id);
      if (i >= 0) manifest[i] = entry; else manifest.push(entry);
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    } catch (e) { console.error(`  ✗ ${c.id} failed:`, e.message); }
  }

  console.log(`\n=== PROPS (${JOBS.props.length}) ===`);
  for (const p of JOBS.props) {
    console.log(`\n▶ ${p.name} (${p.id})`);
    try {
      const { glb } = await makeModel(p.prompt);
      const file = `${p.id}.glb`;
      const bytes = await download(glb, new URL(file, PROPS_DIR));
      console.log(`  saved ${file} (${(bytes / 1024).toFixed(0)} KB)`);
      const entry = { id: p.id, name: p.name, file, biome: p.biome };
      const i = propsManifest.findIndex((m) => m.id === p.id);
      if (i >= 0) propsManifest[i] = entry; else propsManifest.push(entry);
      await writeFile(propsManifestPath, JSON.stringify(propsManifest, null, 2));
    } catch (e) { console.error(`  ✗ ${p.id} failed:`, e.message); }
  }

  console.log('\n✅ Done. Models in public/models, props in public/props.');
}
run().catch((e) => { console.error(e); process.exit(1); });
