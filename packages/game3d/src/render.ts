import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Course3D, PlacedTrap3D } from '@trampa/shared';
import { obstacleAABB } from '@trampa/shared';
import { makeRunner, type Runner } from './game/runners.js';
import { SKINS, equippedSkin, type Skin } from './cosmetics.js';

const FIXED_DT = 1 / 60;

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
  private character: Runner;
  private playerLight: THREE.PointLight;
  private contact: THREE.Mesh;
  private movers: { mesh: THREE.Mesh; edge: THREE.LineSegments; baseX: number; o: any }[] = [];
  private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh;
  private trail: THREE.Mesh[] = [];
  private trailIdx = 0;
  private ghostChars: Runner[] = [];
  private lastX = 0;
  private container: HTMLElement;
  private placedTraps: PlacedTrap3D[] = [];
  private finishGlow: THREE.Mesh[] = [];
  private trapFx: THREE.Mesh[] = [];
  private lastY = 0;
  private squash = 0;
  private clock = 0;
  private shake = 0;
  private fov = 52;
  private speedNorm = 0;
  private fxFlash: HTMLDivElement;
  private fxSpeed: HTMLDivElement;
  private streaks: THREE.Mesh[] = [];
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private particles: THREE.Mesh[] = [];
  private pdata: { vx: number; vy: number; vz: number; life: number; max: number }[] = [];
  private pIdx = 0;

  constructor(container: HTMLElement, course: Course3D, placedTraps: PlacedTrap3D[] = []) {
    this.course = course;
    this.container = container;
    this.placedTraps = placedTraps;
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
    this.buildTraps();

    // Player: a loaded 3D model if the equipped skin has one, else procedural.
    this.character = makeRunner(equippedSkin());
    this.player = this.character.group;
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

    // Ghosts of friends' runs: translucent characters, colour-coded, reused
    // round-robin. Each cycles a skin archetype so they read as distinct people.
    const GHOST_COLORS = [0xff6b9d, 0xffd23c, 0x6bffb0, 0x6b9dff, 0xd26bff];
    for (let i = 0; i < 5; i++) {
      const base = SKINS[(i + 1) % SKINS.length];
      const ghostSkin: Skin = { ...base, body: GHOST_COLORS[i], accent: GHOST_COLORS[i] };
      const c = makeRunner(ghostSkin, true);
      c.setVisible(false);
      this.ghostChars.push(c);
      this.scene.add(c.group);
    }

    // Trail (a ring of fading quads reused round-robin).
    const trailMat = new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.35, depthWrite: false });
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), trailMat.clone());
      m.visible = false;
      this.trail.push(m);
      this.scene.add(m);
    }

    // Speed streaks: thin bright rods that flick past at high velocity. Pure
    // presentation, placed each frame around the player, faded by speed.
    const streakMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 3.2), streakMat.clone());
      m.visible = false;
      this.streaks.push(m);
      this.scene.add(m);
    }

    // Particle pool (jump poof, landing dust, death burst). Additive sparks.
    const pgeo = new THREE.SphereGeometry(0.12, 6, 6);
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(
        pgeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.visible = false;
      this.particles.push(m);
      this.pdata.push({ vx: 0, vy: 0, vz: 0, life: 0, max: 1 });
      this.scene.add(m);
    }

    // DOM FX overlays (below the UI card at z-index 10). Cheap and reliable.
    this.fxSpeed = this.makeOverlay(
      `radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, ${cssColor(pal.accent)} 130%)`,
    );
    this.fxFlash = this.makeOverlay('radial-gradient(ellipse at center, rgba(255,40,60,0.55) 0%, rgba(255,0,30,0.85) 120%)');

    // Post-processing: bloom makes the emissive neon actually glow.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.75, // strength
      0.6, // radius
      0.72, // threshold — only bright/emissive pixels bloom
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => this.onResize());
  }

  /** Emit a burst of `n` sparks from a point with a spread and colour. */
  burst(x: number, y: number, z: number, n: number, color: number, spread: number, up = 1) {
    for (let k = 0; k < n; k++) {
      const m = this.particles[this.pIdx % this.particles.length];
      const d = this.pdata[this.pIdx % this.particles.length];
      this.pIdx++;
      m.visible = true;
      m.position.set(x, y, z);
      (m.material as THREE.MeshBasicMaterial).color.setHex(color);
      // Deterministic-free jitter (renderer only): trig hash on index + clock.
      const a = (k * 2.399963 + this.clock * 0.13) % (Math.PI * 2);
      const r = spread * (0.4 + 0.6 * Math.abs(Math.sin(k * 12.9898)));
      d.vx = Math.cos(a) * r;
      d.vz = Math.sin(a) * r;
      d.vy = up * (1.5 + 2.5 * Math.abs(Math.cos(k * 4.1)));
      d.max = d.life = 26 + (k % 10);
      const s = 0.5 + Math.abs(Math.sin(k)) * 0.7;
      m.scale.setScalar(s);
    }
  }

  burstJump(x: number, y: number, z: number) { this.burst(x, y - 0.3, z, 8, 0xbfe9ff, 3.2, 0.4); }
  burstLand(x: number, y: number, z: number) { this.burst(x, y - 0.4, z, 10, 0xffffff, 4.0, 0.5); }

  private makeOverlay(background: string): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;inset:0;z-index:5;pointer-events:none;opacity:0;transition:none;mix-blend-mode:screen;';
    el.style.background = background;
    document.body.appendChild(el);
    return el;
  }

  /** Trigger a hit reaction (death): screen shake + red flash + spark burst. */
  hit() {
    this.shake = Math.max(this.shake, 0.7);
    this.fxFlash.style.opacity = '1';
    const p = this.player.position;
    this.burst(p.x, p.y, p.z, 22, 0xff5a4a, 6.5, 1.1);
    this.burst(p.x, p.y, p.z, 10, 0xffd23c, 5.0, 1.3);
  }

  /** Advance the spark particles (called each rendered frame). */
  private updateParticles() {
    for (let i = 0; i < this.particles.length; i++) {
      const d = this.pdata[i];
      if (d.life <= 0) continue;
      const m = this.particles[i];
      d.life--;
      d.vy -= 0.5; // gravity
      m.position.x += d.vx * FIXED_DT;
      m.position.y += d.vy * FIXED_DT;
      m.position.z += d.vz * FIXED_DT;
      const t = d.life / d.max;
      (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t);
      if (d.life <= 0) m.visible = false;
    }
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
      // Telegraph: a mover sweeps fastest at the centre of its arc. Flash the
      // rim brighter + toward warning-red so you can read the danger early.
      if (m.o.amp && m.o.period) {
        const vel = Math.abs(Math.cos((2 * Math.PI * (frame + (m.o.phase ?? 0))) / m.o.period));
        const em = m.mesh.material as THREE.MeshStandardMaterial;
        em.emissiveIntensity = 0.55 + vel * 1.2;
        const edgeMat = m.edge.material as THREE.LineBasicMaterial;
        edgeMat.opacity = 0.4 + vel * 0.55;
        edgeMat.color.setRGB(1, 1 - vel * 0.75, 1 - vel * 0.75);
      }
    }
    // Gentle pulse on the finish so it feels alive.
    this.clock += 1;
    const pulse = 0.9 + 0.25 * Math.sin(this.clock * 0.06);
    for (const g of this.finishGlow) {
      const mat = g.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = pulse;
    }
    // Traps pulse + rings breathe so they telegraph the danger.
    const tp = 0.6 + 0.4 * Math.sin(this.clock * 0.13);
    for (const fx of this.trapFx) {
      if (fx.geometry.type === 'OctahedronGeometry') {
        (fx.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + tp;
        fx.rotation.y += 0.04;
      } else {
        (fx.material as THREE.MeshBasicMaterial).opacity = 0.3 + tp * 0.4;
      }
    }
  }

  updatePlayer(x: number, y: number, z: number, spin: number, vy = 0, grounded = false, speed = 10.5) {
    this.player.position.set(x, y - 0.2, z);
    this.playerLight.position.set(x, y + 1.2, z);

    // Speed → 0..1 (10.5 base .. ~16 top) drives FOV, streaks and the vignette.
    const target = Math.max(0, Math.min(1, (speed - 10.5) / 5.5));
    this.speedNorm += (target - this.speedNorm) * 0.08;

    // Squash-and-stretch on landing (visual only, does not touch the sim).
    const landed = grounded && this.lastY - y > 0.02 && vy <= 0.1;
    if (landed) {
      const impact = Math.abs(this.lastY - y);
      this.squash = Math.min(0.45, this.squash + impact * 1.4);
      if (impact > 0.3) {
        this.shake = Math.max(this.shake, Math.min(0.28, impact * 0.35));
        this.burstLand(x, y, z);
      }
    }
    this.squash *= 0.82;
    // Lean into lateral movement; pose the running character.
    const lean = Math.max(-1, Math.min(1, (x - this.lastX) * 3));
    this.character.setPose(spin, grounded, lean, this.squash);
    this.lastX = x;
    this.lastY = y;

    // Contact shadow: fades + shrinks as the player rises off the floor.
    const h = Math.max(0, y - 0.55);
    this.contact.position.set(x, 0.02, z);
    const cs = Math.max(0.4, 1 - h * 0.14);
    this.contact.scale.set(cs, cs, cs);
    (this.contact.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.5 - h * 0.06);

    // Trail (grows brighter with speed).
    const t = this.trail[this.trailIdx % this.trail.length];
    t.position.set(x, y - 0.1, z);
    t.visible = true;
    this.trailIdx++;
    const trailPeak = 0.34 + this.speedNorm * 0.4;
    this.trail.forEach((m, i) => {
      const age = (this.trailIdx - i) % this.trail.length;
      (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, trailPeak - age * 0.02);
    });

    // Speed streaks flick past the runner, denser/brighter the faster you go.
    const streakOn = this.speedNorm > 0.12;
    this.streaks.forEach((m, i) => {
      if (!streakOn) { m.visible = false; return; }
      m.visible = true;
      const seed = (i * 12.9898 + this.clock * 0.13) % (Math.PI * 2);
      const side = i % 2 ? 1 : -1;
      const lane = side * (2.4 + ((i * 1.7) % 4));
      const zoff = ((this.clock * 0.9 + i * 3.1) % 24) - 4; // scrolls toward camera
      m.position.set(x + lane, 0.6 + ((i * 0.9) % 4), z + 10 - zoff);
      (m.material as THREE.MeshBasicMaterial).opacity =
        this.speedNorm * (0.18 + 0.14 * Math.sin(seed));
    });

    // Aerial camera: high, tilted, tracking Z with slight lateral follow. FOV
    // widens with speed for a rush; a decaying shake kicks on death/hard land.
    this.fov += ((52 + this.speedNorm * 11) - this.fov) * 0.08;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    const sh = this.shake;
    const shakeX = sh > 0 ? Math.sin(this.clock * 1.7) * sh : 0;
    const shakeY = sh > 0 ? Math.cos(this.clock * 2.3) * sh * 0.8 : 0;
    this.shake *= 0.85;
    const camX = x * 0.35;
    this.camera.position.set(camX + shakeX, y + 17 + shakeY, z - 11.5);
    this.camera.lookAt(x * 0.5 + shakeX, 1.2, z + 7);

    // DOM FX: speed vignette tracks speed; red flash decays after a hit.
    this.fxSpeed.style.opacity = String(this.speedNorm * 0.5);
    const cur = parseFloat(this.fxFlash.style.opacity || '0');
    if (cur > 0.01) this.fxFlash.style.opacity = String(cur * 0.86);
    else this.fxFlash.style.opacity = '0';

    // Keep the sky centred on the camera so it always surrounds us.
    this.sky.position.copy(this.camera.position);

    // Keep the shadow frustum near the player.
    this.sun.position.set(x - 14, y + 26, z - 6);
    this.sun.target.position.set(x, 0, z + 4);
    this.sun.target.updateMatrixWorld();
  }

  private buildTraps() {
    for (const t of this.placedTraps) {
      const color = t.trapType === 'spike' ? 0xff2266 : t.trapType === 'bounce' ? 0xffcc00 : 0x22ffcc;
      const m = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.7, 0),
        this.mat(color, color, 0.9, 0.4, 0.2),
      );
      m.position.set(t.slotX, 0.9, t.slotZ);
      m.castShadow = true;
      this.scene.add(m);
      this.trapFx.push(m);

      // Ground warning ring so the trap telegraphs from far away.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.95, 1.4, 28),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(t.slotX, 0.06, t.slotZ);
      this.scene.add(ring);
      this.trapFx.push(ring);
    }
  }

  /** Position + animate the ghost characters from an array of {x,y,z}. */
  setGhosts(positions: ({ x: number; y: number; z: number } | null)[]) {
    this.ghostChars.forEach((c, i) => {
      const p = positions[i];
      if (p) {
        c.setVisible(true);
        c.group.position.set(p.x, p.y - 0.2, p.z);
        // Run cadence from distance travelled; airborne if lifted off the floor.
        c.setPose(p.z * 1.4, p.y < 0.95, 0, 0);
      } else {
        c.setVisible(false);
      }
    });
  }

  dispose() {
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.composer.dispose();
    this.character.dispose();
    for (const c of this.ghostChars) c.dispose();
    this.fxSpeed.remove();
    this.fxFlash.remove();
  }

  render() {
    this.updateParticles();
    this.composer.render();
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.bloom.setSize(window.innerWidth, window.innerHeight);
  }
}

/** A THREE palette hex int (or CSS string) → a `#rrggbb` string for CSS. */
function cssColor(c: number | string): string {
  if (typeof c === 'string') return c;
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
}
