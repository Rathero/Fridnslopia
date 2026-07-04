import * as THREE from 'three';
import type { Course3D } from './course.js';
import { obstacleAABB } from './sim.js';

/**
 * Three.js renderer for the aerial (cenital) view. Angled top-down camera that
 * follows the runner down the course, with a directional shadow light, a
 * gradient sky, distance fog, and emissive accents. Pure presentation — it
 * never feeds the sim, so any smoothing here is safe.
 */
export class Renderer3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private course: Course3D;
  private player: THREE.Group;
  private body: THREE.Mesh;
  private playerLight: THREE.PointLight;
  private contact: THREE.Mesh;
  private movers: { mesh: THREE.Mesh; edge: THREE.LineSegments; baseX: number; o: any }[] = [];
  private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh;
  private trail: THREE.Mesh[] = [];
  private trailIdx = 0;
  private ghost!: THREE.Mesh;
  private finishGlow: THREE.Mesh[] = [];
  private lastY = 0;
  private squash = 0;
  private clock = 0;

  constructor(container: HTMLElement, course: Course3D) {
    this.course = course;
    const pal = course.palette;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(pal.fog);
    // Fog tuned so the course reads clearly up close and dissolves into the sky.
    this.scene.fog = new THREE.Fog(pal.fog, 30, 78);

    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 400);

    this.sky = this.buildSky(pal);
    this.scene.add(this.sky);

    // Lights.
    const hemi = new THREE.HemisphereLight(0xbfd8ff, pal.fog, 0.7);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.15);
    this.sun.position.set(-14, 26, -6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 90;
    const s = 28;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);
    // Cool fill from the opposite side to lift the shadows.
    const fill = new THREE.DirectionalLight(new THREE.Color(pal.accent), 0.35);
    fill.position.set(16, 12, -10);
    this.scene.add(fill);

    this.buildFloors();
    this.buildObstacles();
    this.buildFinish();

    // Player: a glowing faceted sphere with a face.
    this.player = new THREE.Group();
    this.body = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 3),
      new THREE.MeshStandardMaterial({
        color: pal.accent,
        emissive: pal.accent,
        emissiveIntensity: 0.55,
        roughness: 0.3,
        metalness: 0.15,
      }),
    );
    this.body.castShadow = true;
    this.player.add(this.body);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0f18, roughness: 0.4 });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), eyeMat);
    eye.position.set(0.28, 0.14, 0.42);
    this.player.add(eye);
    this.scene.add(this.player);

    this.playerLight = new THREE.PointLight(pal.accent, 9, 14, 2);
    this.scene.add(this.playerLight);

    // Soft contact shadow (a fake radial blob under the player).
    this.contact = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 32),
      new THREE.MeshBasicMaterial({
        map: this.blobTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.5,
        color: 0x000000,
      }),
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.scene.add(this.contact);

    // Ghost of a previous run (translucent).
    this.ghost = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 2),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.15,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    // Trail (a ring of fading quads reused round-robin).
    const trailMat = new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.35, depthWrite: false });
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), trailMat.clone());
      m.visible = false;
      this.trail.push(m);
      this.scene.add(m);
    }

    addEventListener('resize', () => this.onResize());
  }

  // --- construction helpers -------------------------------------------------

  private buildSky(pal: Course3D['palette']): THREE.Mesh {
    const top = new THREE.Color(pal.fog).lerp(new THREE.Color(pal.accent), 0.14).multiplyScalar(1.35);
    const bottom = new THREE.Color(pal.fog);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: top },
        bottomColor: { value: bottom },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying vec3 vDir;
        void main() {
          float h = clamp(normalize(vDir).y * 0.5 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, 0.6)), 1.0);
        }
      `,
    });
    return new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), mat);
  }

  /** A soft round falloff texture for the contact shadow / decals. */
  private blobTexture(): THREE.Texture {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  private mat(color: number, emissive = 0x000000, ei = 0, rough = 0.82, metal = 0.06) {
    return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: ei, roughness: rough, metalness: metal });
  }

  private buildFloors() {
    const pal = this.course.palette;
    this.course.floors.forEach((f, i) => {
      const geo = new THREE.BoxGeometry(f.w, f.h, f.d);
      const mesh = new THREE.Mesh(geo, this.mat(i % 2 ? pal.floor2 : pal.floor, 0x000000, 0, 0.9, 0.04));
      mesh.position.set(f.x, f.y, f.z);
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      const topY = f.y + f.h / 2;
      // Glowing leading edge for readability.
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(f.w, 0.12, 0.35),
        this.mat(pal.accent, pal.accent, 1.0),
      );
      edge.position.set(f.x, topY + 0.06, f.z - f.d / 2 + 0.2);
      this.scene.add(edge);

      // Faint centre lane marking for depth readability (only on wide slabs).
      if (f.w > 6 && f.d > 3) {
        const laneMat = new THREE.MeshBasicMaterial({
          color: pal.accent,
          transparent: true,
          opacity: 0.06,
          depthWrite: false,
        });
        for (const lx of [-2.5, 2.5]) {
          const lane = new THREE.Mesh(new THREE.PlaneGeometry(0.06, f.d - 0.4), laneMat);
          lane.rotation.x = -Math.PI / 2;
          lane.position.set(f.x + lx, topY + 0.02, f.z);
          this.scene.add(lane);
        }
      }
    });
  }

  private buildObstacles() {
    const pal = this.course.palette;
    for (const o of this.course.obstacles) {
      const geo = new THREE.BoxGeometry(o.w, o.h, o.d);
      const mesh = new THREE.Mesh(geo, this.mat(pal.obstacle, pal.obstacle, 0.55, 0.55, 0.2));
      mesh.position.set(o.x, o.y, o.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      // Bright emissive rim outline for readability.
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65 }),
      );
      edge.position.copy(mesh.position);
      this.scene.add(edge);

      if (o.kind === 'mover') this.movers.push({ mesh, edge, baseX: o.x, o });
    }
  }

  private buildFinish() {
    const pal = this.course.palette;
    const z = this.course.finishZ;
    const hw = this.course.halfWidth;

    for (const sx of [-hw, hw]) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.5, 6.4, 20),
        this.mat(0xffffff, pal.accent, 0.6, 0.4, 0.3),
      );
      pillar.position.set(sx, 3.2, z);
      pillar.castShadow = true;
      this.scene.add(pillar);
      this.finishGlow.push(pillar);
    }

    // Glowing arch banner across the top.
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(hw * 2, 1.3, 0.35),
      this.mat(pal.accent, pal.accent, 1.1),
    );
    banner.position.set(0, 6.1, z);
    this.scene.add(banner);
    this.finishGlow.push(banner);

    // Checkered goal strip on the floor.
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, 1.6),
      new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.03, z);
    this.scene.add(strip);

    // A soft light at the finish so it beckons through the fog.
    const goalLight = new THREE.PointLight(new THREE.Color(pal.accent), 10, 26, 2);
    goalLight.position.set(0, 4, z);
    this.scene.add(goalLight);
  }

  // --- per-frame updates ----------------------------------------------------

  updateDynamic(frame: number) {
    for (const m of this.movers) {
      const b = obstacleAABB(m.o, frame);
      m.mesh.position.x = m.baseX + b.dx;
      m.edge.position.x = m.baseX + b.dx;
    }
    // Gentle pulse on the finish so it feels alive.
    this.clock += 1;
    const pulse = 0.9 + 0.25 * Math.sin(this.clock * 0.06);
    for (const g of this.finishGlow) {
      const mat = g.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = pulse;
    }
  }

  updatePlayer(x: number, y: number, z: number, spin: number, vy = 0, grounded = false) {
    this.player.position.set(x, y, z);
    this.player.rotation.x = spin;
    this.playerLight.position.set(x, y + 1.2, z);

    // Squash-and-stretch (visual only, does not touch the sim). Landing after a
    // fast descent triggers a squash that eases back out; airborne = slight
    // stretch along the fall axis.
    const landed = grounded && this.lastY - y > 0.02 && vy <= 0.1;
    if (landed) this.squash = Math.min(0.45, this.squash + Math.abs(this.lastY - y) * 1.4);
    this.squash *= 0.82;
    const airStretch = !grounded ? Math.min(0.12, Math.abs(vy) * 0.012) : 0;
    const sy = 1 - this.squash + airStretch;
    const sxz = 1 + this.squash * 0.5 - airStretch * 0.5;
    this.body.scale.set(sxz, Math.max(0.5, sy), sxz);
    this.lastY = y;

    // Contact shadow: fades + shrinks as the player rises off the floor.
    const h = Math.max(0, y - 0.55);
    this.contact.position.set(x, 0.02, z);
    const cs = Math.max(0.4, 1 - h * 0.14);
    this.contact.scale.set(cs, cs, cs);
    (this.contact.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.5 - h * 0.06);

    // Trail.
    const t = this.trail[this.trailIdx % this.trail.length];
    t.position.set(x, y - 0.1, z);
    t.visible = true;
    this.trailIdx++;
    this.trail.forEach((m, i) => {
      const age = (this.trailIdx - i) % this.trail.length;
      (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.34 - age * 0.018);
    });

    // Aerial camera: high, tilted, tracking Z with slight lateral follow.
    const camX = x * 0.35;
    this.camera.position.set(camX, y + 17, z - 11.5);
    this.camera.lookAt(x * 0.5, 1.2, z + 7);

    // Keep the sky centred on the camera so it always surrounds us.
    this.sky.position.copy(this.camera.position);

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
