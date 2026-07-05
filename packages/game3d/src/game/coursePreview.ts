import * as THREE from 'three';
import type { Course3D, TrapSlot3D } from '@trampa/shared';

/**
 * A compact, self-contained 3D preview of a course used for trap placement.
 * The old 2D minimap made it impossible to read *where* you were dropping a
 * trap (heights, walls, gaps). This renders the real geometry in 3D: you scrub
 * a chase camera along the track (slider or ◀▶), drag to orbit for depth, and
 * click a glowing pillar to place your trap there.
 *
 * Deliberately light: no bloom/shadows/post — it's a UI widget, not the game.
 */
export class CoursePreview3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raf = 0;
  private disposed = false;

  private course: Course3D;
  private canvas: HTMLCanvasElement;
  private onPick: (slot: TrapSlot3D) => void;

  private markers: { group: THREE.Group; ring: THREE.Mesh; slot: TrapSlot3D }[] = [];
  private raycaster = new THREE.Raycaster();
  private clock = 0;

  // Camera state.
  private targetZ: number;
  private yaw = 0;          // orbit angle (drag left/right)
  private locked = false;   // a trap was placed → freeze interaction
  private selected: TrapSlot3D | null = null;

  constructor(container: HTMLElement, course: Course3D, onPick: (slot: TrapSlot3D) => void) {
    this.course = course;
    this.onPick = onPick;

    const w = container.clientWidth || 360;
    const h = Math.round(w * 0.62);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = 'width:100%;border-radius:12px;display:block;cursor:grab;touch-action:none';
    container.appendChild(this.canvas);

    const pal = course.palette;
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(pal.fog, 22, 62);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 240);

    this.scene.add(new THREE.HemisphereLight(0xcfe2ff, pal.fog, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-10, 22, -4);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(new THREE.Color(pal.accent), 0.4);
    fill.position.set(12, 8, -8);
    this.scene.add(fill);

    this.buildFloors();
    this.buildObstacles();
    this.buildFinish();
    this.buildMarkers();

    // Start focused on the first trap slot (that's what the player cares about).
    const firstZ = course.trapSlots.length ? course.trapSlots[0].z : (course.startZ + course.finishZ) / 2;
    this.targetZ = firstZ;

    this.wire();
    this.loop();
  }

  private mat(color: number, emissive = 0x000000, ei = 0): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: ei, roughness: 0.85, metalness: 0.08 });
  }

  private buildFloors() {
    const pal = this.course.palette;
    this.course.floors.forEach((f, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(f.w, f.h, f.d), this.mat(i % 2 ? pal.floor2 : pal.floor));
      m.position.set(f.x, f.y, f.z);
      this.scene.add(m);
    });
  }

  private buildObstacles() {
    const pal = this.course.palette;
    for (const o of this.course.obstacles) {
      if (o.kind === 'spinner') {
        const L = o.amp ?? o.w / 2;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(L * 2, o.h, o.d), this.mat(pal.obstacle, pal.obstacle, 0.5));
        bar.position.set(o.x, o.y, o.z);
        bar.rotation.y = 0.6; // a static ¾ pose reads as "this spins"
        this.scene.add(bar);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(L - 0.12, L, 32),
          new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.2, side: THREE.DoubleSide }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(o.x, (o.y - o.h / 2) - 0.02, o.z);
        this.scene.add(ring);
        continue;
      }
      // walls, movers (shown at rest), crushers (shown up).
      const m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), this.mat(pal.obstacle, pal.obstacle, 0.35));
      m.position.set(o.x, o.y, o.z);
      this.scene.add(m);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(m.geometry),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
      );
      edge.position.copy(m.position);
      this.scene.add(edge);
    }
  }

  private buildFinish() {
    const pal = this.course.palette;
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(this.course.halfWidth * 2, 0.9, 0.3),
      this.mat(pal.accent, pal.accent, 1.0),
    );
    banner.position.set(0, 4.2, this.course.finishZ);
    this.scene.add(banner);
  }

  private buildMarkers() {
    for (const slot of this.course.trapSlots) {
      const group = new THREE.Group();
      group.position.set(slot.x, 0, slot.z);

      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 3.2, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x22ffcc, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
      );
      pillar.position.y = 1.6;
      group.add(pillar);

      const cap = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.55),
        new THREE.MeshStandardMaterial({ color: 0x22ffcc, emissive: 0x00ffaa, emissiveIntensity: 0.9, roughness: 0.3 }),
      );
      cap.position.y = 3.4;
      group.add(cap);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.7, 0.95, 28),
        new THREE.MeshBasicMaterial({ color: 0x22ffcc, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      group.add(ring);

      this.scene.add(group);
      this.markers.push({ group, ring, slot });
    }
  }

  // --- interaction ----------------------------------------------------------

  private wire() {
    let dragging = false;
    let moved = 0;
    let lastX = 0;

    const down = (e: PointerEvent) => {
      dragging = true; moved = 0; lastX = e.clientX;
      this.canvas.style.cursor = 'grabbing';
      this.canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX; lastX = e.clientX;
      moved += Math.abs(dx);
      this.yaw = Math.max(-0.9, Math.min(0.9, this.yaw - dx * 0.005));
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      this.canvas.style.cursor = 'grab';
      if (moved < 6) this.pick(e); // a tap, not a drag → try to select a slot
    };
    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
  }

  private pick(e: PointerEvent) {
    if (this.locked) return;
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    // Test against each marker group's children.
    for (const m of this.markers) {
      const hits = this.raycaster.intersectObject(m.group, true);
      if (hits.length) { this.select(m.slot); this.onPick(m.slot); return; }
    }
  }

  /** Move the camera to a given slot (used by ◀ ▶ / the slot list). */
  focusSlot(slot: TrapSlot3D) {
    this.targetZ = slot.z;
  }

  scrubTo(z: number) { this.targetZ = z; }

  /** Highlight the chosen slot + dim the rest, and freeze further picks. */
  select(slot: TrapSlot3D) {
    this.selected = slot;
    this.targetZ = slot.z;
  }

  lock() { this.locked = true; }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.clock += 1;

    // Chase camera: sit behind targetZ, look a little ahead, orbit by yaw.
    const back = 11, up = 7.5, ahead = 5;
    const cx = Math.sin(this.yaw) * 12;
    const cz = this.targetZ - back * Math.cos(this.yaw);
    this.camera.position.set(cx, up, cz);
    this.camera.lookAt(0, 1.2, this.targetZ + ahead);

    // Pulse markers; the selected one glows hot, others cool/dim.
    const pulse = 0.7 + 0.3 * Math.sin(this.clock * 0.08);
    for (const m of this.markers) {
      const isSel = this.selected === m.slot;
      const near = Math.abs(m.slot.z - this.targetZ) < 4;
      m.group.children.forEach((c) => {
        const mat = (c as THREE.Mesh).material as any;
        if (!mat) return;
        if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = (isSel ? 1.6 : 0.9) * pulse;
        if (mat.opacity !== undefined && mat.transparent) {
          const base = isSel ? 0.65 : near ? 0.5 : 0.24;
          mat.opacity = base * (0.7 + 0.3 * pulse);
          mat.color.setHex(isSel ? 0xff2f6e : this.locked ? 0x39507a : 0x22ffcc);
        } else if (mat.color) {
          mat.color.setHex(isSel ? 0xff2f6e : this.locked ? 0x6178a0 : 0x22ffcc);
          if (mat.emissive) mat.emissive.setHex(isSel ? 0xff1e5e : 0x00ffaa);
        }
      });
      m.ring.scale.setScalar(isSel ? 1.25 : 1);
    }

    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.renderer.dispose();
    this.canvas.remove();
  }

  /** The trap slots, in course order — handy for a companion ◀▶ / list UI. */
  get slots(): TrapSlot3D[] { return this.course.trapSlots; }
  get range(): { start: number; finish: number } {
    return { start: this.course.startZ, finish: this.course.finishZ };
  }
}
