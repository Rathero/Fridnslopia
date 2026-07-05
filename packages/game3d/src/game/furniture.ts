import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * "Map furniture" real models (Meshy): traps, moving hazards, walls, and a
 * tileable floor texture. Each category is listed in its own
 * public/<dir>/manifest.json and loaded at boot. Everything is OPTIONAL — if a
 * manifest or GLB is missing, the renderer keeps its procedural look, so the
 * game never depends on these assets.
 */
interface FurnitureItem {
  id: string;
  file: string;
  type?: string;   // traps: spike|glue|bounce
  kind?: string;   // hazards: crusher|spinner
  name?: string;
}
interface Loaded { item: FurnitureItem; scene: THREE.Group; size: THREE.Vector3 }

const registries: Record<string, Loaded[]> = { traps: [], hazards: [], walls: [], floors: [] };
let floorTex: THREE.Texture | null = null;

let loader: GLTFLoader | null = null;
function getLoader(): GLTFLoader {
  if (loader) return loader;
  loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

async function loadCategory(dir: string): Promise<void> {
  let manifest: FurnitureItem[] = [];
  try {
    const r = await fetch(`/${dir}/manifest.json`, { cache: 'no-cache' });
    if (!r.ok) return;
    manifest = await r.json();
    if (!Array.isArray(manifest)) return;
  } catch {
    return;
  }
  await Promise.all(
    manifest.map(async (item) => {
      if (!item?.file) return;
      try {
        const g = await getLoader().loadAsync(`/${dir}/${item.file}`);
        const scene = g.scene as THREE.Group;
        const box = new THREE.Box3().setFromObject(scene);
        const size = new THREE.Vector3();
        box.getSize(size);
        registries[dir].push({ item, scene, size });
      } catch (e) {
        console.warn(`[${dir}] failed`, item.file, e);
      }
    }),
  );
}

export async function loadFurniture(): Promise<void> {
  await Promise.all([loadCategory('traps'), loadCategory('hazards'), loadCategory('walls'), loadCategory('floors')]);
  extractFloorTexture();
}

/** Pull the albedo map off the first floor GLB and make it tile. */
function extractFloorTexture() {
  const f = registries.floors[0];
  if (!f) return;
  f.scene.traverse((o) => {
    if (floorTex) return;
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    const map = m && (m as any).map as THREE.Texture | undefined;
    if (map && map.image) {
      const t = map.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.needsUpdate = true;
      floorTex = t;
    }
  });
}

export function hasFurniture(): boolean {
  return registries.traps.length + registries.hazards.length + registries.walls.length > 0 || !!floorTex;
}

/** Clone a model + its measured size, scaled uniformly to a target height. */
function pick(list: Loaded[], key?: (l: Loaded) => boolean): { group: THREE.Group; size: THREE.Vector3 } | null {
  const found = key ? list.find(key) : list[0];
  const l = found ?? list[0];
  if (!l) return null;
  return { group: l.scene.clone(true) as THREE.Group, size: l.size.clone() };
}

export function trapModel(type: string) {
  return pick(registries.traps, (l) => l.item.type === type);
}
export function hazardModel(kind: string) {
  return pick(registries.hazards, (l) => l.item.kind === kind);
}
/** A wall style chosen deterministically per obstacle index (stable per course). */
export function wallModel(idx = 0) {
  if (!registries.walls.length) return null;
  const l = registries.walls[idx % registries.walls.length];
  return { group: l.scene.clone(true) as THREE.Group, size: l.size.clone() };
}
export function floorTexture(): THREE.Texture | null { return floorTex; }

/** Scale + centre a furniture group to fill a target box (w,h,d), sitting on the
 *  ground. `mode` 'fill' stretches per-axis; 'fit' keeps proportions (uses max). */
export function fitGroup(
  group: THREE.Group, size: THREE.Vector3, w: number, h: number, d: number, mode: 'fill' | 'fit' = 'fit',
) {
  const sx = w / Math.max(1e-3, size.x);
  const sy = h / Math.max(1e-3, size.y);
  const sz = d / Math.max(1e-3, size.z);
  if (mode === 'fill') group.scale.set(sx, sy, sz);
  else group.scale.setScalar(Math.min(sx, sy, sz));
}
