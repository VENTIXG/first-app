// 3-D view of the platform: every body at its (x, y), drawn FIXED (consistent
// with the fixed-body analysis), on a water surface displaced by the computed
// elevation eta(x, t) of the active wave theory. Each body carries an arrow
// showing its computed instantaneous total force (interpolated from the solved
// one-period history). Nothing here is illustrative motion: bodies do not heave
// because no motion response is computed.
//
// three.js is loaded as an ES module from the CDN; main.js imports this file
// dynamically so a CDN failure degrades gracefully.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { surfaceElevation } from './waveTheory.js';
import { bodyRadius, bodyTopZ, sphereCenterZ } from './geometry.js';

const TROUGH_COLOR = new THREE.Color(0x081d38);
const CREST_COLOR = new THREE.Color(0xcdeeff);
const ARROW_COLOR = 0xffce33;

/** Linear interpolation of the total force at time t (mod T) from a one-period history. */
function interpForce(timeData, T, simTime) {
  const n = timeData.length;
  if (n < 2) return 0;
  const t = ((simTime % T) + T) % T;
  const idxF = t / (T / (n - 1));
  const idx = Math.min(n - 2, Math.max(0, Math.floor(idxF)));
  const frac = idxF - idx;
  return timeData[idx].total + (timeData[idx + 1].total - timeData[idx].total) * frac;
}

export function initViz3d(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 5000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cursor = 'grab';
  renderer.domElement.setAttribute('aria-label', '3-D view of the platform in waves');

  scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x1a2a3a, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  sun.position.set(60, 90, 40);
  scene.add(sun);

  const waterMat = new THREE.MeshStandardMaterial({
    vertexColors: true, transparent: true, opacity: 0.85, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide,
  });
  let water = null;
  let waterGeo = null;
  let planeSize = 0;

  function buildWater(size) {
    if (water) { scene.remove(water); waterGeo.dispose(); }
    const segs = Math.min(160, Math.max(60, Math.round(size / 2)));
    waterGeo = new THREE.PlaneGeometry(size, size, segs, segs);
    waterGeo.rotateX(-Math.PI / 2);
    waterGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(waterGeo.attributes.position.count * 3), 3));
    water = new THREE.Mesh(waterGeo, waterMat);
    scene.add(water);
    planeSize = size;
  }

  const hullMat = new THREE.MeshStandardMaterial({ color: 0xeb6834, roughness: 0.5 });
  let meshes = [];
  let shapeKey = '';
  let layoutKey = '';
  let centroidX = 0;
  let centroidY = 0;
  let forceData = new Map();

  const shapeSignature = (bodies) => bodies
    .map((b) => `${b.id}:${b.type}:${bodyRadius(b)}:${b.draft}:${b.type === 'cylinder' ? b.freeboard : ''}`).join('|');
  const layoutSignature = (bodies) => bodies.map((b) => `${b.x}:${b.y}:${bodyRadius(b)}:${b.draft}`).join('|');

  function rebuildBodies(bodies) {
    meshes.forEach((m) => { scene.remove(m.mesh); scene.remove(m.arrow); m.mesh.geometry.dispose(); });
    meshes = bodies.map((b) => {
      const R = bodyRadius(b);
      const geo = b.type === 'sphere'
        ? new THREE.SphereGeometry(R, 36, 24)
        : new THREE.CylinderGeometry(R, R, b.draft + b.freeboard, 40);
      const mesh = new THREE.Mesh(geo, hullMat);
      scene.add(mesh);
      const L = Math.max(R, 2);
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), L, ARROW_COLOR, L * 0.35, L * 0.22);
      arrow.visible = false;
      scene.add(arrow);
      return { id: b.id, mesh, arrow, body: b };
    });
  }

  function placeBodies(bodies) {
    meshes.forEach((m, i) => {
      const b = bodies[i];
      m.body = b;
      const yCentre = b.type === 'sphere' ? sphereCenterZ(b) : (b.freeboard - b.draft) / 2;
      m.mesh.position.set(b.x, yCentre, b.y); // fixed: no heave (not computed)
      m.arrow.position.set(b.x, Math.max(bodyTopZ(b), 0) + 1.5, b.y);
    });
  }

  const orbit = { yaw: 0.7, pitch: 0.34, dist: 120, dragging: false, px: 0, py: 0 };
  function placeCamera() {
    const cp = Math.cos(orbit.pitch), sp = Math.sin(orbit.pitch);
    camera.position.set(
      centroidX + orbit.dist * cp * Math.cos(orbit.yaw),
      orbit.dist * sp,
      centroidY + orbit.dist * cp * Math.sin(orbit.yaw),
    );
    camera.lookAt(centroidX, 0, centroidY);
  }

  function fitScene(bodies) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxR = 1;
    for (const b of bodies) {
      const R = bodyRadius(b);
      minX = Math.min(minX, b.x - R); maxX = Math.max(maxX, b.x + R);
      minY = Math.min(minY, b.y - R); maxY = Math.max(maxY, b.y + R);
      maxR = Math.max(maxR, R, b.draft);
    }
    centroidX = (minX + maxX) / 2;
    centroidY = (minY + maxY) / 2;
    const extent = Math.max(maxX - minX, maxY - minY, maxR * 2);
    const size = Math.min(800, Math.max(120, extent * 2.2));
    if (Math.abs(size - planeSize) > 1) buildWater(size);
    orbit.dist = Math.min(1200, Math.max(45, size * 0.9));
    placeCamera();
  }

  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', (e) => {
    orbit.dragging = true; orbit.px = e.clientX; orbit.py = e.clientY;
    dom.setPointerCapture(e.pointerId); dom.style.cursor = 'grabbing';
  });
  dom.addEventListener('pointermove', (e) => {
    if (!orbit.dragging) return;
    orbit.yaw += (e.clientX - orbit.px) * 0.008;
    orbit.pitch = Math.min(1.35, Math.max(0.05, orbit.pitch + (e.clientY - orbit.py) * 0.006));
    orbit.px = e.clientX; orbit.py = e.clientY;
    placeCamera();
  });
  dom.addEventListener('pointerup', (e) => {
    orbit.dragging = false; dom.releasePointerCapture(e.pointerId); dom.style.cursor = 'grab';
  });
  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.dist = Math.min(1500, Math.max(20, orbit.dist * (1 + e.deltaY * 0.001)));
    placeCamera();
  }, { passive: false });

  let wp = null;
  const clock = new THREE.Clock();
  let simTime = 0;
  let disposed = false;
  const tmpColor = new THREE.Color();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function animate() {
    if (disposed) return;
    requestAnimationFrame(animate);
    if (!reduceMotion) simTime += clock.getDelta();

    if (waterGeo) {
      const pos = waterGeo.attributes.position;
      const col = waterGeo.attributes.color;
      const amp = wp ? Math.max(wp.H / 2, 1e-6) : 1;
      for (let i = 0; i < pos.count; i++) {
        const eta = wp ? surfaceElevation(simTime, wp, centroidX + pos.getX(i)) : 0;
        pos.setY(i, eta);
        tmpColor.copy(TROUGH_COLOR).lerp(CREST_COLOR, Math.min(1, Math.max(0, (eta / amp) * 0.5 + 0.5)));
        col.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      waterGeo.computeVertexNormals();
    }

    for (const m of meshes) {
      const fd = forceData.get(m.body.id);
      if (wp && fd && fd.peakTotal > 0) {
        const R = bodyRadius(m.body);
        const F = interpForce(fd.timeData, wp.T, simTime);
        const len = Math.max(R * 0.6, Math.min(1, Math.abs(F) / fd.peakTotal) * R * 3);
        m.arrow.setDirection(new THREE.Vector3(F >= 0 ? 1 : -1, 0, 0));
        m.arrow.setLength(len, len * 0.35, len * 0.22);
        m.arrow.visible = true;
      } else {
        m.arrow.visible = false;
      }
    }
    renderer.render(scene, camera);
  }
  animate();

  new ResizeObserver(() => {
    if (container.clientWidth === 0) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }).observe(container);

  return {
    /**
     * @param waveParams solved wave (or null when the inputs are invalid)
     * @param bodies     body definitions (geometry, position)
     * @param bodyResults computed per-body force histories ([] when invalid)
     */
    update(waveParams, bodies, bodyResults = []) {
      wp = waveParams;
      forceData = new Map(bodyResults.map((b) => [b.id, { timeData: b.timeData, peakTotal: b.peakTotal }]));
      const shape = shapeSignature(bodies);
      if (shape !== shapeKey) { rebuildBodies(bodies); shapeKey = shape; }
      placeBodies(bodies);
      const layout = layoutSignature(bodies);
      if (layout !== layoutKey) { fitScene(bodies); layoutKey = layout; } // keep the user's zoom otherwise
    },
    dispose() { disposed = true; renderer.dispose(); },
  };
}
