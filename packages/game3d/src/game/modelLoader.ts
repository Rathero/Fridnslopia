import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * A character-model entry in `public/models/manifest.json`. Drop a GLB (from
 * Meshy, a CC0 pack, whatever) into `public/models/`, add one of these, and it
 * becomes a playable character — falling back to the procedural character if
 * the file is missing or fails to load. Nothing here touches the sim.
 */
export interface ModelSkin {
  id: string;            // unique id; if it matches a procedural skin id it overrides it
  name: string;          // shown in the store
  file: string;          // filename inside public/models/
  emoji?: string;        // store row icon
  tint?: number;         // optional hex colour multiply
  scale?: number;        // fine-tune size (1 = auto-fit to standard height)
  yaw?: number;          // radians, if the model faces the wrong way (use 3.14159 to flip)
  clips?: Partial<Record<'idle' | 'run' | 'jump', string>>; // exact clip names, if auto-match misses
}

interface Loaded { skin: ModelSkin; scene: THREE.Group; animations: THREE.AnimationClip[] }

const registry = new Map<string, Loaded>();

export function hasModel(id: string): boolean { return registry.has(id); }
export function modelSkins(): ModelSkin[] { return [...registry.values()].map((l) => l.skin); }

let loader: GLTFLoader | null = null;
function getLoader(): GLTFLoader {
  if (loader) return loader;
  loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/'); // decoder files served same-origin from public/draco
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/**
 * Load every model listed in the manifest, in parallel. Best-effort: a missing
 * manifest or a broken GLB is skipped silently so the game always runs on the
 * procedural fallback. Call once at boot.
 */
export async function loadCharacterModels(): Promise<void> {
  let manifest: ModelSkin[] = [];
  try {
    const res = await fetch('/models/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return;
    manifest = await res.json();
    if (!Array.isArray(manifest)) return;
  } catch {
    return; // no manifest → no models, procedural characters everywhere
  }
  await Promise.all(
    manifest.map(async (skin) => {
      if (!skin?.id || !skin?.file) return;
      try {
        const gltf = await getLoader().loadAsync('/models/' + skin.file);
        registry.set(skin.id, { skin, scene: gltf.scene as THREE.Group, animations: gltf.animations });
      } catch (e) {
        console.warn('[models] failed to load', skin.file, e);
      }
    }),
  );
}

/** A fresh, independently-animatable copy of a loaded model (skeleton included). */
export function instantiateModel(
  id: string,
): { scene: THREE.Group; animations: THREE.AnimationClip[]; skin: ModelSkin } | null {
  const l = registry.get(id);
  if (!l) return null;
  return { scene: skeletonClone(l.scene) as THREE.Group, animations: l.animations, skin: l.skin };
}
