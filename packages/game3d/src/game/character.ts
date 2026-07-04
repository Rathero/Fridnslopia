import * as THREE from 'three';
import type { Skin } from '../cosmetics.js';

/**
 * A procedural little runner character built entirely from Three.js primitives
 * — no external model files, so it ships in the static bundle and passes the
 * strict CSP. The body archetype + head accessory come from the equipped skin,
 * so the store meaningfully changes who you are. Animated legs/arms + a lean
 * give it life; it's viewed from the angled aerial camera.
 *
 * Local space: origin sits at the sim's ball centre (~0.75 above the floor),
 * feet reach down to ~-0.55, the character faces +Z (the run direction).
 */
export class Character {
  readonly group = new THREE.Group();
  private bodyPivot = new THREE.Group();
  private body!: THREE.Mesh;
  private legL!: THREE.Object3D;
  private legR!: THREE.Object3D;
  private armL!: THREE.Object3D;
  private armR!: THREE.Object3D;
  private accent: number;
  private ghost: boolean;
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];

  constructor(skin: Skin, opts: { ghost?: boolean } = {}) {
    this.accent = skin.accent;
    this.ghost = !!opts.ghost;
    this.group.add(this.bodyPivot);
    this.build(skin);
  }

  // ---- material helpers ----
  private mat(color: number, emissive = 0x000000, ei = 0, rough = 0.45, metal = 0.15) {
    const m = new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity: ei, roughness: rough, metalness: metal,
      transparent: this.ghost, opacity: this.ghost ? 0.4 : 1, depthWrite: !this.ghost,
    });
    this.mats.push(m);
    return m;
  }
  private geo<T extends THREE.BufferGeometry>(g: T): T { this.geos.push(g); return g; }
  private mesh(g: THREE.BufferGeometry, m: THREE.Material, shadow = true) {
    const me = new THREE.Mesh(g, m);
    if (shadow && !this.ghost) { me.castShadow = true; }
    return me;
  }

  private build(skin: Skin) {
    const bodyMat = this.mat(skin.body, skin.body, this.ghost ? 0.2 : 0.35, 0.4, 0.2);
    const darkMat = this.mat(0x0a0f18, 0x000000, 0, 0.5);
    const accentMat = this.mat(skin.accent, skin.accent, this.ghost ? 0.4 : 0.9, 0.3, 0.4);
    const whiteMat = this.mat(0xffffff, 0xffffff, 0.2, 0.3);

    // --- body archetype ---
    let bodyGeo: THREE.BufferGeometry;
    let headY = 0.78;
    if (skin.shape === 'bot') {
      bodyGeo = this.geo(new THREE.BoxGeometry(0.9, 1.05, 0.75));
      (bodyGeo as THREE.BoxGeometry).translate(0, 0.28, 0);
      headY = 0.86;
    } else if (skin.shape === 'blob') {
      bodyGeo = this.geo(new THREE.SphereGeometry(0.62, 20, 16));
      (bodyGeo as THREE.SphereGeometry).scale(1, 0.95, 0.92);
      (bodyGeo as THREE.SphereGeometry).translate(0, 0.18, 0);
      headY = 0.62;
    } else {
      // bean: a tall rounded capsule
      bodyGeo = this.geo(new THREE.CapsuleGeometry(0.46, 0.5, 6, 16));
      (bodyGeo as THREE.CapsuleGeometry).translate(0, 0.35, 0);
      headY = 0.82;
    }
    this.body = this.mesh(bodyGeo, bodyMat);
    this.bodyPivot.add(this.body);

    // Belly accent stripe (a thin emissive ring around the front).
    const stripe = this.mesh(this.geo(new THREE.TorusGeometry(0.42, 0.055, 8, 24)), accentMat, false);
    stripe.rotation.x = Math.PI / 2;
    stripe.position.y = 0.2;
    this.body.add(stripe);

    // --- face: eyes (whites + dark pupils) on the +Z front ---
    const eye = (dx: number) => {
      const g = new THREE.Group();
      const white = this.mesh(this.geo(new THREE.SphereGeometry(0.15, 12, 12)), whiteMat, false);
      white.scale.set(1, 1.15, 0.6);
      const pupil = this.mesh(this.geo(new THREE.SphereGeometry(0.075, 10, 10)), darkMat, false);
      pupil.position.z = 0.1;
      g.add(white, pupil);
      g.position.set(dx, headY - 0.06, 0.42);
      return g;
    };
    this.body.add(eye(-0.19), eye(0.19));

    // A little smile (a thin dark torus arc, opening upward = ∪).
    const mouth = this.mesh(this.geo(new THREE.TorusGeometry(0.12, 0.028, 8, 16, Math.PI)), darkMat, false);
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, headY - 0.3, 0.45);
    this.body.add(mouth);

    // --- limbs (pivot at the top so they swing from the hip/shoulder) ---
    const limb = (color: THREE.Material, len: number, r: number) => {
      const pivot = new THREE.Group();
      const g = this.geo(new THREE.CapsuleGeometry(r, len, 4, 8));
      (g as THREE.CapsuleGeometry).translate(0, -len / 2 - r, 0);
      pivot.add(this.mesh(g, color, false));
      return pivot;
    };
    this.legL = limb(darkMat, 0.28, 0.14); this.legL.position.set(-0.22, -0.02, 0);
    this.legR = limb(darkMat, 0.28, 0.14); this.legR.position.set(0.22, -0.02, 0);
    this.armL = limb(bodyMat, 0.24, 0.11); this.armL.position.set(-0.5, 0.55, 0);
    this.armR = limb(bodyMat, 0.24, 0.11); this.armR.position.set(0.5, 0.55, 0);
    // Little accent feet/hands.
    for (const [pivot, yr] of [[this.legL, -0.42], [this.legR, -0.42]] as const) {
      const foot = this.mesh(this.geo(new THREE.SphereGeometry(0.16, 10, 8)), accentMat, false);
      foot.scale.set(1, 0.7, 1.3); foot.position.set(0, yr, 0.06); pivot.add(foot);
    }
    this.bodyPivot.add(this.legL, this.legR, this.armL, this.armR);

    // --- accessory on top ---
    this.buildAccessory(skin, headY, accentMat, bodyMat, darkMat);
  }

  private buildAccessory(skin: Skin, headY: number, accentMat: THREE.Material, bodyMat: THREE.Material, darkMat: THREE.Material) {
    const top = headY + 0.42;
    const add = (m: THREE.Object3D) => this.body.add(m);
    switch (skin.accessory) {
      case 'cap': {
        const cap = this.mesh(this.geo(new THREE.SphereGeometry(0.44, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)), accentMat);
        cap.position.y = top - 0.32;
        const brim = this.mesh(this.geo(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16)), accentMat, false);
        brim.position.set(0, top - 0.34, 0.4);
        add(cap); add(brim);
        break;
      }
      case 'crown': {
        const band = this.mesh(this.geo(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 20)), accentMat);
        band.position.y = top - 0.18;
        add(band);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const spike = this.mesh(this.geo(new THREE.ConeGeometry(0.07, 0.22, 8)), accentMat, false);
          spike.position.set(Math.cos(a) * 0.32, top - 0.02, Math.sin(a) * 0.32);
          add(spike);
        }
        break;
      }
      case 'horns': {
        for (const s of [-1, 1]) {
          const horn = this.mesh(this.geo(new THREE.ConeGeometry(0.1, 0.34, 10)), accentMat);
          horn.position.set(s * 0.28, top - 0.2, -0.05);
          horn.rotation.z = -s * 0.5;
          add(horn);
        }
        break;
      }
      case 'antenna': {
        const stalk = this.mesh(this.geo(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8)), darkMat, false);
        stalk.position.y = top - 0.05;
        const ball = this.mesh(this.geo(new THREE.SphereGeometry(0.12, 12, 12)), accentMat, false);
        ball.position.y = top + 0.2;
        add(stalk); add(ball);
        break;
      }
      case 'halo': {
        const halo = this.mesh(this.geo(new THREE.TorusGeometry(0.3, 0.05, 10, 28)), accentMat, false);
        halo.rotation.x = Math.PI / 2;
        halo.position.y = top + 0.12;
        add(halo);
        break;
      }
      case 'mohawk': {
        for (let i = 0; i < 5; i++) {
          const h = 0.16 + Math.sin((i / 4) * Math.PI) * 0.22;
          const fin = this.mesh(this.geo(new THREE.ConeGeometry(0.08, h, 6)), accentMat, false);
          fin.position.set(0, top - 0.3 + h / 2, -0.28 + i * 0.14);
          add(fin);
        }
        break;
      }
      case 'headphones': {
        const band = this.mesh(this.geo(new THREE.TorusGeometry(0.4, 0.05, 8, 20, Math.PI)), darkMat, false);
        band.position.y = top - 0.24; band.rotation.z = Math.PI / 2; band.rotation.y = Math.PI / 2;
        add(band);
        for (const s of [-1, 1]) {
          const cup = this.mesh(this.geo(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 14)), accentMat, false);
          cup.rotation.z = Math.PI / 2; cup.position.set(s * 0.42, headY - 0.02, 0);
          add(cup);
        }
        break;
      }
      case 'visor': {
        const visor = this.mesh(this.geo(new THREE.BoxGeometry(0.7, 0.18, 0.12)), accentMat, false);
        visor.position.set(0, headY - 0.04, 0.4);
        add(visor);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Pose the character for this frame. `spin` is the sim's accumulated roll (a
   * distance-proportional run phase), `lean` is lateral velocity (-1..1-ish),
   * `squash` the landing squash (0..~0.45). Presentation only.
   */
  setPose(spin: number, grounded: boolean, lean: number, squash: number) {
    const phase = spin * 1.15;
    if (grounded) {
      const sw = 0.7;
      this.legL.rotation.x = Math.sin(phase) * sw;
      this.legR.rotation.x = Math.sin(phase + Math.PI) * sw;
      this.armL.rotation.x = Math.sin(phase + Math.PI) * 0.5;
      this.armR.rotation.x = Math.sin(phase) * 0.5;
    } else {
      // Airborne tuck: legs forward, arms up.
      this.legL.rotation.x = this.legR.rotation.x = 0.7;
      this.armL.rotation.x = this.armR.rotation.x = -1.1;
    }
    // Lean into turns + a subtle forward pitch while running.
    this.bodyPivot.rotation.z = -lean * 0.35;
    this.bodyPivot.rotation.x = grounded ? 0.12 + Math.abs(Math.sin(phase)) * 0.03 : -0.1;
    // Squash & stretch on the body only.
    const sy = 1 - squash, sxz = 1 + squash * 0.5;
    this.body.scale.set(sxz, Math.max(0.5, sy), sxz);
    this.group.rotation.z += (0 - this.group.rotation.z) * 0.2; // keep group upright
  }

  setVisible(v: boolean) { this.group.visible = v; }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.group.removeFromParent();
  }
}
