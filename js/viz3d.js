// Real-time 3D digital twin: every body in the platform rendered at its own
// (x, y) coordinate, on an animated water surface whose geometry respects the
// travelling-wave phase eta(x,t) so the waves visibly pass through the bodies.
//
// three.js is loaded as an ES module from the CDN; main.js imports this file
// dynamically so a CDN failure degrades gracefully instead of breaking the app.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { surfaceElevation } from './waveTheory.js';
import { bodyRadius } from './state.js';

export function initViz3d(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    45, container.clientWidth / container.clientHeight, 0.1, 5000
  );
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cursor = 'grab';

  scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x1a2a3a, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  sun.position.set(60, 90, 40);
  scene.add(sun);

  // Water surface (rebuilt when the spanned extent changes)
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1c5cab, transparent: true, opacity: 0.82,
    roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide,
  });
  let water = null;
  let waterGeo = null;
  let planeSize = 0;

  function buildWater(size) {
    if (water) { scene.remove(water); waterGeo.dispose(); }
    const segs = Math.min(160, Math.max(60, Math.round(size / 2)));
    waterGeo = new THREE.PlaneGeometry(size, size, segs, segs);
    waterGeo.rotateX(-Math.PI / 2);
    water = new THREE.Mesh(waterGeo, waterMat);
    scene.add(water);
    planeSize = size;
  }

  // Bodies
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xeb6834, roughness: 0.5 });
  let meshes = [];      // { id, mesh, body }
  let bodySig = '';
  let centroidX = 0;
  let centroidY = 0;

  function signature(bodies) {
    return bodies.map((b) => `${b.id}:${b.type}:${bodyRadius(b)}:${b.draft}`).join('|');
  }

  function rebuildBodies(bodies) {
    meshes.forEach((m) => { scene.remove(m.mesh); m.mesh.geometry.dispose(); });
    meshes = bodies.map((b) => {
      const R = bodyRadius(b);
      let geo;
      if (b.type === 'sphere') {
        geo = new THREE.SphereGeometry(R, 36, 24);
      } else {
        const height = b.draft * 1.3; // include some freeboard
        geo = new THREE.CylinderGeometry(R, R, height, 40);
      }
      const mesh = new THREE.Mesh(geo, hullMat);
      scene.add(mesh);
      return { id: b.id, mesh, body: b };
    });
    bodySig = signature(bodies);
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

  // Orbit camera (drag to rotate, wheel to zoom) around the platform centroid
  const orbit = { yaw: 0.7, pitch: 0.34, dist: 120, dragging: false, px: 0, py: 0 };
  function placeCamera() {
    const cp = Math.cos(orbit.pitch), sp = Math.sin(orbit.pitch);
    camera.position.set(
      centroidX + orbit.dist * cp * Math.cos(orbit.yaw),
      orbit.dist * sp,
      centroidY + orbit.dist * cp * Math.sin(orbit.yaw)
    );
    camera.lookAt(centroidX, 0, centroidY);
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

  // Animation loop
  let wp = null;
  const clock = new THREE.Clock();
  let simTime = 0;
  let disposed = false;

  function animate() {
    if (disposed) return;
    requestAnimationFrame(animate);
    simTime += clock.getDelta();

    if (wp && waterGeo) {
      const pos = waterGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        // plane vertex world-x maps to physics-x (centroid + local offset)
        pos.setY(i, surfaceElevation(simTime, wp, centroidX + pos.getX(i)));
      }
      pos.needsUpdate = true;
      waterGeo.computeVertexNormals();

      for (const m of meshes) {
        const b = m.body;
        const R = bodyRadius(b);
        const heave = surfaceElevation(simTime, wp, b.x);
        const baseY = b.type === 'sphere' ? R - b.draft : (b.draft * 1.3) / 2 - b.draft;
        m.mesh.position.set(b.x, baseY + heave, b.y);
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
    /** Called on every recalculation with fresh wave params + body list. */
    update(waveParams, bodies) {
      wp = waveParams;
      if (signature(bodies) !== bodySig) {
        rebuildBodies(bodies);
        fitScene(bodies);
      } else {
        // positions may have moved without a structural change
        meshes.forEach((m, i) => { m.body = bodies[i]; });
        fitScene(bodies);
      }
    },
    dispose() { disposed = true; renderer.dispose(); },
  };
}
