import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cylinderMesh, fitCylinder, fitSphere, symmetricEigen3 } from '../../../studio/src/core/fit.ts';
import type { MeshData, Vec3 } from '../../../studio/src/core/types.ts';

// deterministic pseudo-random numbers
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 2 ** 32; };
}
const unit = (v: Vec3): Vec3 => { const n = Math.hypot(...v); return [v[0] / n, v[1] / n, v[2] / n]; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

test('symmetric 3×3 eigen-decomposition: A v = λ v and orthonormal vectors', () => {
  const r = rng(7);
  for (let k = 0; k < 50; k++) {
    const a = [[r(), r(), r()], [0, r(), r()], [0, 0, r()]].map((row) => row.map((x) => 10 * x - 5));
    const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i <= j ? a[i][j] : a[j][i])));
    const { values, vectors } = symmetricEigen3(A);
    vectors.forEach((v, j) => {
      const Av = [0, 1, 2].map((i) => A[i][0] * v[0] + A[i][1] * v[1] + A[i][2] * v[2]);
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(Av[i] - values[j] * v[i]) < 1e-10);
      assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-12);
    });
    assert.ok(Math.abs(vectors[0][0] * vectors[1][0] + vectors[0][1] * vectors[1][1] + vectors[0][2] * vectors[1][2]) < 1e-12);
  }
});

/** Exact samples of a cylinder surface (points and outward normals). */
function cylinderSamples(base: Vec3, axis: Vec3, R: number, h: number) {
  const a = unit(axis);
  const e1 = unit(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const e2 = cross(a, e1);
  const points: Vec3[] = [];
  const normals: Vec3[] = [];
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 5; j++) {
      const ang = (2 * Math.PI * i) / 16;
      const n: Vec3 = [0, 1, 2].map((k) => Math.cos(ang) * e1[k] + Math.sin(ang) * e2[k]) as Vec3;
      const t = (h * j) / 4;
      points.push([0, 1, 2].map((k) => base[k] + R * n[k] + t * a[k]) as Vec3);
      normals.push(n);
    }
  }
  return { points, normals };
}

test('cylinder fit recovers axis, radius, base and height (model coordinates in mm)', () => {
  const r = rng(11);
  for (let k = 0; k < 40; k++) {
    const axis = unit([r() - 0.5, r() - 0.5, r() + 0.2]);
    const base: Vec3 = [1e5 * (r() - 0.5), 1e5 * (r() - 0.5), -2e4 * r()];
    const R = 100 + 5000 * r();
    const h = 1000 + 40000 * r();
    const { points, normals } = cylinderSamples(base, axis, R, h);
    const fit = fitCylinder(points, normals)!;
    assert.ok(fit, 'fit exists');
    const scale = Math.max(R, h, 1e5);
    assert.ok(Math.abs(fit.radius - R) / R < 1e-9, `radius ${fit.radius} vs ${R}`);
    assert.ok(Math.abs(fit.height - h) / h < 1e-9, `height ${fit.height} vs ${h}`);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(fit.axis[i] - axis[i]) < 1e-9, 'axis');
      assert.ok(Math.abs(fit.base[i] - base[i]) / scale < 1e-9, 'base');
    }
    assert.ok(fit.residual / R < 1e-9);
  }
});

test('cylinder fit residual exposes a surface that is not a cylinder', () => {
  const { points, normals } = cylinderSamples([0, 0, 0], [0, 0, 1], 3, 10);
  points.forEach((p, i) => { if (i % 2) p[0] += 0.05; });
  assert.ok(fitCylinder(points, normals)!.residual > 0.01);
});

test('sphere fit recovers centre and radius; residual exposes an ellipsoid', () => {
  const r = rng(3);
  for (let k = 0; k < 40; k++) {
    const c: Vec3 = [1e5 * (r() - 0.5), 1e5 * (r() - 0.5), 1e4 * (r() - 0.5)];
    const R = 10 + 1e4 * r();
    const pts: Vec3[] = [];
    for (let i = 0; i < 12; i++) for (let j = 0; j < 8; j++) {
      const th = (Math.PI * (j + 0.5)) / 8, ph = (2 * Math.PI * i) / 12;
      pts.push([c[0] + R * Math.sin(th) * Math.cos(ph), c[1] + R * Math.sin(th) * Math.sin(ph), c[2] + R * Math.cos(th)]);
    }
    const fit = fitSphere(pts)!;
    assert.ok(Math.abs(fit.radius - R) / R < 1e-9);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(fit.centre[i] - c[i]) / Math.max(R, 1e5) < 1e-9);
    assert.ok(fit.residual / R < 1e-9);
    const squashed = pts.map((p) => [p[0], p[1], c[2] + 0.9 * (p[2] - c[2])] as Vec3);
    assert.ok(fitSphere(squashed)!.residual / R > 1e-2);
  }
});

/** Signed volume of a closed triangle mesh (divergence theorem). */
function meshVolume({ positions: P, indices: I }: MeshData) {
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]].map((i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

test('display cylinder mesh is closed, outward-oriented, with the inscribed-prism volume', () => {
  const n = 48, R = 2, h = 7;
  const m = cylinderMesh([3, -1, 4], unit([1, 1, 2]), R, h, n);
  const edges = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = m.indices[t + e], b = m.indices[t + ((e + 1) % 3)];
      edges.set(`${a},${b}`, (edges.get(`${a},${b}`) ?? 0) + 1);
    }
  }
  for (const [key, count] of edges) {
    const [a, b] = key.split(',');
    assert.equal(count, 1, 'each directed edge once');
    assert.equal(edges.get(`${b},${a}`), 1, 'and its reverse once (closed, consistently oriented)');
  }
  const exact = (n / 2) * R * R * Math.sin((2 * Math.PI) / n) * h;
  assert.ok(Math.abs(meshVolume(m) - exact) / exact < 1e-12);
});
