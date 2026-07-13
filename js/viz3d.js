// Real-time 3D visualization: floating cylinder + animated water surface.
// three.js is loaded as an ES module from the CDN; main.js imports this file
// dynamically so a CDN failure degrades gracefully instead of breaking the app.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { surfaceElevation } from './waveTheory.js';

const PLANE_SIZE = 120; // rendered patch of sea surface [m]
const PLANE_SEGS = 96;

export function initViz3d(container) {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    45, container.clientWidth / container.clientHeight, 0.1, 2000
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cursor = 'grab';

  scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x1a2a3a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(60, 80, 40);
  scene.add(sun);

  // Water surface (y-up; plane rotated into the xz plane)
  const waterGeo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, PLANE_SEGS, PLANE_SEGS);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(
    waterGeo,
    new THREE.MeshStandardMaterial({
      color: 0x1c5cab, transparent: true, opacity: 0.82,
      roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide,
    })
  );
  scene.add(water);

  // Cylinder (rebuilt when dimensions change)
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xeb6834, roughness: 0.5 });
  let cylinder = null;
  let dims = { D: 2, d: 3, L: 10 };

  function rebuildCylinder() {
    if (cylinder) {
      scene.remove(cylinder);
      cylinder.geometry.dispose();
    }
    const geo = new THREE.CylinderGeometry(dims.D / 2, dims.D / 2, dims.L, 48);
    cylinder = new THREE.Mesh(geo, hullMat);
    cylinder.position.y = dims.L / 2 - dims.d; // draft below still water level
    scene.add(cylinder);
  }
  rebuildCylinder();

  // Manual orbit control (drag to rotate, wheel to zoom)
  const orbit = { yaw: 0.7, pitch: 0.32, dist: 48, dragging: false, px: 0, py: 0 };
  function placeCamera() {
    const cp = Math.cos(orbit.pitch), sp = Math.sin(orbit.pitch);
    camera.position.set(
      orbit.dist * cp * Math.cos(orbit.yaw),
      orbit.dist * sp,
      orbit.dist * cp * Math.sin(orbit.yaw)
    );
    camera.lookAt(0, 0, 0);
  }
  placeCamera();

  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', (e) => {
    orbit.dragging = true;
    orbit.px = e.clientX;
    orbit.py = e.clientY;
    dom.setPointerCapture(e.pointerId);
    dom.style.cursor = 'grabbing';
  });
  dom.addEventListener('pointermove', (e) => {
    if (!orbit.dragging) return;
    orbit.yaw += (e.clientX - orbit.px) * 0.008;
    orbit.pitch = Math.min(1.35, Math.max(0.05, orbit.pitch + (e.clientY - orbit.py) * 0.006));
    orbit.px = e.clientX;
    orbit.py = e.clientY;
    placeCamera();
  });
  dom.addEventListener('pointerup', (e) => {
    orbit.dragging = false;
    dom.releasePointerCapture(e.pointerId);
    dom.style.cursor = 'grab';
  });
  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.dist = Math.min(400, Math.max(20, orbit.dist * (1 + e.deltaY * 0.001)));
    placeCamera();
  }, { passive: false });

  // Animation loop — the surface follows the active wave parameters
  let wp = null;
  const clock = new THREE.Clock();
  let simTime = 0;
  let disposed = false;
  const positions = waterGeo.attributes.position;

  function animate() {
    if (disposed) return;
    requestAnimationFrame(animate);
    simTime += clock.getDelta();

    if (wp) {
      for (let i = 0; i < positions.count; i++) {
        positions.setY(i, surfaceElevation(simTime, wp, positions.getX(i)));
      }
      positions.needsUpdate = true;
      waterGeo.computeVertexNormals();
      // Cylinder rides the surface heave at its own position (x = 0)
      cylinder.position.y = dims.L / 2 - dims.d + surfaceElevation(simTime, wp, 0);
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
    /** Called on every recalculation with fresh wave params + cylinder dims. */
    update(waveParams, params) {
      wp = waveParams;
      if (params.D !== dims.D || params.d !== dims.d || params.L !== dims.L) {
        dims = { D: params.D, d: params.d, L: params.L };
        rebuildCylinder();
      }
    },
    dispose() {
      disposed = true;
      renderer.dispose();
    },
  };
}
