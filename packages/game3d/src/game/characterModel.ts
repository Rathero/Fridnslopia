import * as THREE from 'three';
import type { Runner } from './character.js';
import type { ModelSkin } from './modelLoader.js';

const FIXED_DT = 1 / 60;
const TARGET_HEIGHT = 1.6; // world units the model is auto-scaled to
const FEET_Y = -0.55;      // where feet sit relative to the group origin (sim ball centre)

/**
 * Wraps a loaded GLB scene + its animation clips as a {@link Runner}: auto-fits
 * scale, orients it to face +Z, drops the feet onto the floor, and plays a run/
 * jump animation driven from the sim pose. Pure presentation — no sim contact.
 */
export class CharacterModel implements Runner {
  readonly group = new THREE.Group();
  private pivot = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions: Partial<Record<'run' | 'jump', THREE.AnimationAction>> = {};
  private current: THREE.AnimationAction | null = null;

  constructor(scene: THREE.Group, clips: THREE.AnimationClip[], skin: ModelSkin, opts: { ghost?: boolean } = {}) {
    this.group.add(this.pivot);
    this.pivot.add(scene);

    // Orient (some models face -Z; yaw corrects it).
    scene.rotation.y = skin.yaw ?? 0;

    // Auto-fit height, then centre X/Z and drop feet to FEET_Y.
    scene.updateWorldMatrix(true, true);
    let box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3(); box.getSize(size);
    const s = size.y > 1e-3 ? (TARGET_HEIGHT * (skin.scale ?? 1)) / size.y : 1;
    scene.scale.setScalar(s);
    scene.updateWorldMatrix(true, true);
    box = new THREE.Box3().setFromObject(scene);
    const centre = new THREE.Vector3(); box.getCenter(centre);
    scene.position.x -= centre.x;
    scene.position.z -= centre.z;
    scene.position.y += FEET_Y - box.min.y;

    // Materials: shadows for the player, translucent tint for ghosts.
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = !opts.ghost;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mm = m as THREE.MeshStandardMaterial;
        if (opts.ghost) { mm.transparent = true; mm.opacity = 0.4; mm.depthWrite = false; }
        if (skin.tint && mm.color) mm.color.setHex(skin.tint);
      }
    });

    // Animations: map semantic actions to clips by name (manifest override first,
    // then a fuzzy match), so a Meshy/Mixamo export "just works".
    this.mixer = new THREE.AnimationMixer(scene);
    const pick = (want: 'run' | 'jump' | 'idle', alts: string[]): THREE.AnimationClip | undefined => {
      const named = skin.clips?.[want as 'run' | 'jump'];
      let clip = named ? clips.find((c) => c.name === named) : undefined;
      if (!clip) clip = clips.find((c) => alts.some((a) => c.name.toLowerCase().includes(a)));
      return clip;
    };
    const run = pick('run', ['run', 'sprint', 'jog', 'walk']);
    const idle = pick('idle', ['idle', 'stand', 'breath']);
    const jump = pick('jump', ['jump', 'fall', 'air', 'flip']);
    const base = run || idle || clips[0];
    if (base) this.actions.run = this.mixer.clipAction(base);
    if (jump) this.actions.jump = this.mixer.clipAction(jump);
    if (this.actions.run) { this.current = this.actions.run; this.current.play(); }
  }

  setPose(_spin: number, grounded: boolean, lean: number, squash: number): void {
    const want = (!grounded && this.actions.jump) ? this.actions.jump : this.actions.run;
    if (want && want !== this.current) {
      this.current?.fadeOut(0.15);
      want.reset().fadeIn(0.15).play();
      this.current = want;
    }
    this.mixer.update(FIXED_DT);
    this.pivot.rotation.z = -lean * 0.3;
    const sy = 1 - squash, sxz = 1 + squash * 0.5;
    this.pivot.scale.set(sxz, Math.max(0.5, sy), sxz);
  }

  setVisible(v: boolean): void { this.group.visible = v; }

  dispose(): void {
    this.mixer.stopAllAction();
    this.group.removeFromParent();
  }
}
