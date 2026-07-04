import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Biome scenery props (Meshy / CC0). Listed in public/props/manifest.json,
 * loaded at boot, and placed flanking the track by the renderer according to
 * the course biome. Pure decoration — never touches the sim. Falls back to no
 * props (the current bare look) if the manifest / GLBs are absent.
 */
export interface PropSkin {
  id: string;
  name: string;
  file: string;
  biome: string;   // matched loosely against the course theme
  scale?: number;  // fine-tune size (1 = auto-fit)
}
interface LoadedProp { skin: PropSkin; scene: THREE.Group }

const all: LoadedProp[] = [];

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

export async function loadProps(): Promise<void> {
  let manifest: PropSkin[] = [];
  try {
    const r = await fetch('/props/manifest.json', { cache: 'no-cache' });
    if (!r.ok) return;
    manifest = await r.json();
    if (!Array.isArray(manifest)) return;
  } catch {
    return;
  }
  await Promise.all(
    manifest.map(async (s) => {
      if (!s?.file) return;
      try {
        const g = await getLoader().loadAsync('/props/' + s.file);
        all.push({ skin: s, scene: g.scene as THREE.Group });
      } catch (e) {
        console.warn('[props] failed', s.file, e);
      }
    }),
  );
}

export function hasProps(): boolean { return all.length > 0; }

/** Props whose biome matches the course theme; if none match, all of them. */
export function propsForBiome(theme: string): LoadedProp[] {
  const t = (theme || '').toLowerCase();
  const match = all.filter((p) => t.includes(p.skin.biome.toLowerCase()));
  return match.length ? match : all;
}

export function cloneProp(p: LoadedProp): { group: THREE.Group; scale?: number } {
  return { group: p.scene.clone(true) as THREE.Group, scale: p.skin.scale };
}
export type { LoadedProp };
