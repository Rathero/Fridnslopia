import * as THREE from 'three';
import type { Course3D } from './course.js';
import { obstacleAABB } from './sim.js';

/**
 * Three.js renderer for the aerial (cenital) view. Angled top-down camera that
 * follows the runner down the course, with a directional shadow light, fog for
 * depth, and emissive accents. Pure presentation — never feeds the sim.
 */
export class Renderer3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private course: Course3D;
  private player: THREE.Group;
  private playerLight: THREE.PointLight;
  private movers: { mesh: THREE.Mesh; baseX: number; o: any }[] = [];
  private sun: THREE.DirectionalLight;
  private trail: THREE.Mesh[] = [];
  private trailIdx = 0;
  private ghost!: THREE.Mesh;

  constructor(container: HTMLElement, course: Course3D) {
    this.course = course;
    const pal = course.palette;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(pal.fog);
    this.scene.fog = new THREE.Fog(pal.fog, 26, 64);

    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 300);

    // Lights.
    const hemi = new THREE.HemisphereLight(0xbfd8ff, pal.fog, 0.75);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.1);
    this.sun.position.set(-14, 26, -6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 90;
    const s = 26;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    this.buildFloors();
    this.buildObstacles();
    this.buildFinish();

    // Player: a glowing capsule-ish sphere with a face.
    this.player = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 3),
      new THREE.MeshStandardMaterial({
        color: pal.accent,
        emissive: pal.accent,
        emissiveIntensity: 0.5,
        roughness: 0.35,
        metalness: 0.1,
      }),
    );
    body.castShadow = true;
    this.player.add(body);
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x0a0f18 }),
    );
    eye.position.set(0.28, 0.14, 0.42);
    this.player.add(eye);
    this.scene.add(this.player);

    this.playerLight = new THREE.PointLight(pal.accent, 8, 12, 2);
    this.scene.add(this.playerLight);

    // Ghost of a previous run (translucent).
    this.ghost = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    // Trail (a ring of fading quads reused round-robin).
    const trailMat = new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.35, depthWrite: false });
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), trailMat.clone());
      m.visible = false;
      this.trail.push(m);
      this.scene.add(m);
    }

    addEventListener('resize', () => this.onResize());
  }

  private mat(color: number, emissive = 0x000000, ei = 0) {
    return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: ei, roughness: 0.85, metalness: 0.05 });
  }

  private buildFloors() {
    const pal = this.course.palette;
    this.course.floors.forEach((f, i) => {
      const geo = new THREE.BoxGeometry(f.w, f.h, f.d);
      const mesh = new THREE.Mesh(geo, this.mat(i % 2 ? pal.floor2 : pal.floor));
      mesh.position.set(f.x, f.y, f.z);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      // Glowing leading edge for readability.
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(f.w, 0.12, 0.35),
        this.mat(pal.accent, pal.accent, 0.9),
      );
      edge.position.set(f.x, f.h / 2 + 0.06 + (f.y), f.z - f.d / 2 + 0.2);
      this.scene.add(edge);
    });
  }

  private buildObstacles() {
    const pal = this.course.palette;
    for (const o of this.course.obstacles) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(o.w, o.h, o.d),
        this.mat(pal.obstacle, pal.obstacle, 0.35),
      );
      mesh.position.set(o.x, o.y, o.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      if (o.kind === 'mover') this.movers.push({ mesh, baseX: o.x, o });
    }
  }

  private buildFinish() {
    const pal = this.course.palette;
    const z = this.course.finishZ;
    for (const sx of [-this.course.halfWidth, this.course.halfWidth]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 6, 16), this.mat(0xffffff, pal.accent, 0.4));
      pillar.position.set(sx, 3, z);
      pillar.castShadow = true;
      this.scene.add(pillar);
    }
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(this.course.halfWidth * 2, 1.2, 0.3),
      this.mat(pal.accent, pal.accent, 0.8),
    );
    banner.position.set(0, 5.6, z);
    this.scene.add(banner);
  }

  updateDynamic(frame: number) {
    for (const m of this.movers) {
      const b = obstacleAABB(m.o, frame);
      m.mesh.position.x = m.baseX + b.dx;
    }
  }

  updatePlayer(x: number, y: number, z: number, spin: number, alpha = 0) {
    this.player.position.set(x, y, z);
    this.player.rotation.x = spin;
    this.playerLight.position.set(x, y + 1.2, z);

    // Trail.
    const t = this.trail[this.trailIdx % this.trail.length];
    t.position.set(x, y - 0.1, z);
    t.visible = true;
    this.trailIdx++;
    this.trail.forEach((m, i) => {
      const age = (this.trailIdx - i) % this.trail.length;
      (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.32 - age * 0.02);
    });

    // Aerial camera: high, tilted, tracking Z with slight lateral follow.
    const camX = x * 0.35;
    this.camera.position.set(camX, y + 17, z - 11.5);
    this.camera.lookAt(x * 0.5, 1.2, z + 7);

    // Keep the shadow frustum near the player.
    this.sun.position.set(x - 14, y + 26, z - 6);
    this.sun.target.position.set(x, 0, z + 4);
    this.sun.target.updateMatrixWorld();
  }

  setGhost(x: number, y: number, z: number, visible: boolean) {
    this.ghost.visible = visible;
    if (visible) this.ghost.position.set(x, y, z);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
