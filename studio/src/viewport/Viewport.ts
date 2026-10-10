// three.js viewport for the studio scene. Graphics only: it draws the project
// and reports user intents (select, move) through callbacks; it never edits
// the project itself. World frame is z-up (Rhino and the engine use z-up):
// the still-water plane is z = 0, the seabed z = -h, waves travel in +x.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Project, SceneObject } from '../core/types.ts';
import { createFramePacer } from '../../../js/framePacer.js';

export interface ViewportCallbacks {
  onSelect(id: string | null): void;
  /** A gizmo drag finished: the object's new plan position (x, y for primitives; dx, dy for meshes). */
  onMove(id: string, x: number, y: number): void;
}

const COLORS = {
  background: 0x0f1720,
  water: 0x2a7fb8,
  seabed: 0x5a4a36,
  analysed: 0xe8743b,
  primitive: 0x9fb3c8,
  mesh: 0x8a96a3,
  selected: 0x3d6fa8,
  wave: 0xf2c94c,
};

interface Entry {
  mesh: THREE.Mesh;
  key: string;
}

export class Viewport {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000);
  private orbit: OrbitControls | null = null;
  private gizmo: TransformControls | null = null;
  private objects = new THREE.Group();
  private entries = new Map<string, Entry>();
  private water: THREE.Mesh;
  private seabed: THREE.Mesh;
  private grid: THREE.GridHelper | null = null;
  private gridSize = 0;
  private resize: ResizeObserver | null = null;
  private dragging = false;
  private down: { x: number; y: number } | null = null;
  private framed = false;
  readonly available: boolean;
  // Render on demand: a frame is drawn only when something changed (camera,
  // gizmo, scene, size), and paced when the graphics stack is slow.
  private needsRender = true;
  private frameRequested = false;
  private disposed = false;
  private pacer = createFramePacer();

  constructor(private container: HTMLElement, private cb: ViewportCallbacks) {
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(110, -150, 80);
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: COLORS.water, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.seabed = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: COLORS.seabed, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    );
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      this.renderer = null;
    }
    this.available = this.renderer !== null;
    if (!this.renderer) {
      const msg = document.createElement('p');
      msg.className = 'viewport-unavailable';
      msg.textContent = '3-D view unavailable: this browser could not create a WebGL context. Editing and analysis still work from the panels.';
      container.append(msg);
      return;
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.domElement.setAttribute('aria-label', '3-D scene: drag to orbit, scroll to zoom, click an object to select it');
    container.append(r.domElement);

    this.scene.background = new THREE.Color(COLORS.background);
    this.scene.add(new THREE.HemisphereLight(0xdfe9f3, 0x203040, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(60, -90, 140);
    this.scene.add(sun);
    this.scene.add(this.water, this.seabed, this.objects);
    const wave = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0.05), 20, COLORS.wave, 3, 2);
    wave.name = 'wave-direction';
    this.scene.add(wave);

    this.orbit = new OrbitControls(this.camera, r.domElement);
    this.orbit.enableDamping = true;
    this.orbit.target.set(30, 0, -5);
    this.orbit.addEventListener('change', this.requestRender);

    this.gizmo = new TransformControls(this.camera, r.domElement);
    this.gizmo.setMode('translate');
    this.gizmo.setSpace('world');
    this.gizmo.showZ = false; // plan moves only; elevations are edited numerically
    this.gizmo.addEventListener('change', this.requestRender);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      const dragging = Boolean((e as unknown as { value: boolean }).value);
      this.dragging = dragging;
      if (this.orbit) this.orbit.enabled = !dragging;
      if (!dragging) this.commitDrag();
    });
    this.scene.add(this.gizmo);

    r.domElement.addEventListener('pointerdown', this.onPointerDown);
    r.domElement.addEventListener('pointerup', this.onPointerUp);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
    this.fit();
    this.requestRender();
  }

  /** Schedule a redraw on the next animation frame (coalesced). */
  requestRender = (): void => {
    this.needsRender = true;
    if (this.frameRequested || this.disposed || !this.renderer) return;
    this.frameRequested = true;
    requestAnimationFrame(this.frame);
  };

  private frame = (now: number): void => {
    this.frameRequested = false;
    if (this.disposed || !this.renderer) return;
    // damping keeps the camera moving for a while after the pointer is released
    const moving = this.orbit?.update() ?? false;
    if (moving) this.needsRender = true;
    if (!this.needsRender) return;
    if (!this.pacer.shouldRender(now)) {
      this.requestRender(); // slow graphics: try again on a later frame
      return;
    }
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
    if (moving) this.requestRender();
  };

  /** Bring the drawing in line with the project and the selection. */
  update(project: Project, selectedId: string | null): void {
    if (!this.renderer) return;
    const seen = new Set<string>();
    for (const o of project.objects) {
      seen.add(o.id);
      const key = this.keyOf(o, project);
      const existing = this.entries.get(o.id);
      if (existing && existing.key === key) continue;
      if (existing) this.remove(o.id);
      const mesh = this.build(o, project);
      mesh.userData.id = o.id;
      mesh.name = o.id;
      this.objects.add(mesh);
      this.entries.set(o.id, { mesh, key });
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.remove(id);

    for (const [id, { mesh }] of this.entries) {
      (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(id === selectedId ? COLORS.selected : 0x000000);
    }
    const sel = selectedId ? this.entries.get(selectedId)?.mesh : undefined;
    if (sel && sel.visible && !this.dragging) this.gizmo?.attach(sel);
    else if (!this.dragging) this.gizmo?.detach();

    this.updateEnvironmentPlanes(project.environment.h);
    this.requestRender();
    if (!this.framed && this.entries.size) {
      this.frameAll();
      this.framed = true;
    }
  }

  /** Fit the camera to the visible objects. */
  frameAll(): void {
    const box = new THREE.Box3();
    for (const { mesh } of this.entries.values()) if (mesh.visible) box.expandByObject(mesh);
    if (box.isEmpty() || !this.orbit) return;
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 10);
    const dist = (1.25 * radius) / Math.sin((this.camera.fov * Math.PI) / 360); // 25 % margin
    this.orbit.target.copy(centre);
    this.camera.position.copy(centre).add(new THREE.Vector3(0.55, -0.75, 0.4).normalize().multiplyScalar(dist));
    this.camera.near = dist / 1000;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** Client (page) coordinates of a world point, for tests and overlays. */
  screenPoint(world: THREE.Vector3): { x: number; y: number } | null {
    if (!this.renderer) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const p = world.clone().project(this.camera);
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  /** Client coordinates of an object's centre (null if absent or hidden). */
  objectScreenPoint(id: string): { x: number; y: number } | null {
    const e = this.entries.get(id);
    if (!e || !e.mesh.visible) return null;
    const box = new THREE.Box3().setFromObject(e.mesh);
    return this.screenPoint(box.getCenter(new THREE.Vector3()));
  }

  /** Client coordinates of a translate-gizmo handle ('X', 'Y' or 'XY'), if the gizmo is shown. */
  gizmoHandlePoint(handle: 'X' | 'Y' | 'XY'): { x: number; y: number } | null {
    if (!this.gizmo?.object) return null;
    this.gizmo.updateMatrixWorld(true);
    // TransformControls (three r160) keeps invisible "picker" meshes per handle;
    // their world bounds are where a pointer grabs that handle.
    const root = this.gizmo.children.find((c) => c.type === 'TransformControlsGizmo') as
      (THREE.Object3D & { picker?: Record<string, THREE.Object3D> }) | undefined;
    const target = root?.picker?.translate?.children.find((c) => c.name === handle);
    if (!target) return null;
    const box = new THREE.Box3().setFromObject(target);
    return this.screenPoint(box.getCenter(new THREE.Vector3()));
  }

  dispose(): void {
    this.resize?.disconnect();
    if (!this.renderer) return;
    this.disposed = true;
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.gizmo?.detach();
    this.gizmo?.dispose();
    this.orbit?.dispose();
    for (const id of [...this.entries.keys()]) this.remove(id);
    for (const m of [this.water, this.seabed]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.grid?.geometry.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // -------------------------------------------------------------------------

  private keyOf(o: SceneObject, project: Project): string {
    const meshRef = o.shape.kind === 'mesh' ? project.meshes[o.shape.meshId]?.positions.length : 0;
    return JSON.stringify([o.shape, o.visible, o.analysis, meshRef]);
  }

  private build(o: SceneObject, project: Project): THREE.Mesh {
    const s = o.shape;
    let geometry: THREE.BufferGeometry;
    let color = o.analysis ? COLORS.analysed : COLORS.primitive;
    const position = new THREE.Vector3();
    if (s.kind === 'cylinder') {
      geometry = new THREE.CylinderGeometry(s.diameter / 2, s.diameter / 2, s.zTop - s.zBottom, 48);
      geometry.rotateX(Math.PI / 2); // three's cylinder axis is y; ours is z
      position.set(s.x, s.y, (s.zBottom + s.zTop) / 2);
    } else if (s.kind === 'sphere') {
      geometry = new THREE.SphereGeometry(s.radius, 48, 24);
      position.set(s.x, s.y, s.zCenter);
    } else {
      const data = project.meshes[s.meshId];
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data?.positions ?? [], 3));
      geometry.setIndex(data?.indices ?? []);
      geometry.computeVertexNormals();
      position.set(s.dx, s.dy, s.dz);
      color = COLORS.mesh;
    }
    const material = new THREE.MeshStandardMaterial({
      color, roughness: 0.6, metalness: 0.05,
      side: s.kind === 'mesh' ? THREE.DoubleSide : THREE.FrontSide, // imported meshes may have mixed winding
      flatShading: s.kind === 'mesh',
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.visible = o.visible;
    return mesh;
  }

  private remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (this.gizmo?.object === e.mesh) this.gizmo.detach();
    this.objects.remove(e.mesh);
    e.mesh.geometry.dispose();
    (e.mesh.material as THREE.Material).dispose();
    this.entries.delete(id);
  }

  private updateEnvironmentPlanes(depth: number): void {
    const box = new THREE.Box3();
    for (const { mesh } of this.entries.values()) box.expandByObject(mesh);
    const extent = box.isEmpty() ? 100 : Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.y), Math.abs(box.max.y));
    const size = Math.max(200, Math.ceil((2.5 * extent) / 50) * 50);
    this.water.scale.set(size, size, 1);
    this.water.position.set(0, 0, 0);
    this.seabed.scale.set(size, size, 1);
    this.seabed.position.set(0, 0, -depth);
    if (size !== this.gridSize) {
      if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); }
      this.grid = new THREE.GridHelper(size, size / 10, 0x5b7a99, 0x2c4157);
      this.grid.rotation.x = Math.PI / 2; // GridHelper lies in xz; ours is the xy water plane
      this.grid.position.z = 0.02;
      this.scene.add(this.grid);
      this.gridSize = size;
    }
  }

  private fit(): void {
    if (!this.renderer) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private commitDrag(): void {
    const mesh = this.gizmo?.object as THREE.Mesh | undefined;
    const id = mesh?.userData.id as string | undefined;
    if (!mesh || !id) return;
    this.cb.onMove(id, mesh.position.x, mesh.position.y);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent): void => {
    const d = this.down;
    this.down = null;
    if (!d || this.dragging || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || !this.renderer) return;
    // a gizmo handle under the pointer takes precedence over selection
    if (this.gizmo && (this.gizmo as unknown as { axis: string | null }).axis) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.objects.children.filter((c) => c.visible), false)[0];
    this.cb.onSelect((hit?.object.userData.id as string | undefined) ?? null);
  };
}
