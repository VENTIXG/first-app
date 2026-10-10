// Least-squares fits used to recover analytic primitives from sampled
// surface points and normals, plus tessellation helpers for display.
//
// Fits work on centred, scaled coordinates (well conditioned for model
// coordinates in millimetres) and report the maximum geometric residual so a
// caller can accept a fit only when it reproduces the surface within tolerance.

import type { MeshData, Vec3 } from './types.ts';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / norm(a));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Solve A x = b (small dense system) by Gaussian elimination with partial pivoting. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Eigen-decomposition of a symmetric 3×3 matrix (cyclic Jacobi). Eigenvectors are the columns of V. */
export function symmetricEigen3(S: number[][]): { values: number[]; vectors: Vec3[] } {
  const A = S.map((r) => [...r]);
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = A[0][1] ** 2 + A[0][2] ** 2 + A[1][2] ** 2;
    if (off < 1e-30) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq;
        A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk;
        A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq;
        V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return {
    values: [A[0][0], A[1][1], A[2][2]],
    vectors: [0, 1, 2].map((j) => [V[0][j], V[1][j], V[2][j]] as Vec3),
  };
}

function centroid(points: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of points) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return scale(c, 1 / points.length);
}

export interface CylinderFit {
  /** Unit axis, oriented so that its z component is >= 0. */
  axis: Vec3;
  /** Point on the axis at the lowest axial extent of the samples. */
  base: Vec3;
  radius: number;
  height: number;
  /** max | distance(point, axis) - radius | over the samples. */
  residual: number;
}

/**
 * Fit a circular cylinder to points on its lateral surface and the surface
 * normals there. The axis is the direction least represented in the normals
 * (smallest eigenvalue of sum n nᵀ); the radius and centre come from an
 * algebraic circle fit in the plane normal to the axis. `extentPoints`
 * (e.g. cap samples) extend the axial range.
 */
export function fitCylinder(points: Vec3[], normals: Vec3[], extentPoints: Vec3[] = []): CylinderFit | null {
  if (points.length < 6 || normals.length !== points.length) return null;
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const n0 of normals) {
    const n = unit(n0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += n[i] * n[j];
  }
  const { values, vectors } = symmetricEigen3(S);
  let k = 0;
  for (let i = 1; i < 3; i++) if (values[i] < values[k]) k = i;
  let axis = unit(vectors[k]);
  if (axis[2] < 0 || (axis[2] === 0 && (axis[0] < 0 || (axis[0] === 0 && axis[1] < 0)))) axis = scale(axis, -1);

  // orthonormal frame (e1, e2) perpendicular to the axis
  const helper: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(cross(axis, helper));
  const e2 = cross(axis, e1);
  const c0 = centroid(points);
  const local = points.map((p) => { const d = sub(p, c0); return [dot(d, e1), dot(d, e2)]; });
  const L = Math.max(...local.map(([u, v]) => Math.hypot(u, v))) || 1;

  // Kåsa fit on scaled coordinates: u² + v² + D u + E v + F = 0
  const N = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const rhs = [0, 0, 0];
  for (const [u0, v0] of local) {
    const u = u0 / L, v = v0 / L;
    const row = [u, v, 1];
    const w = -(u * u + v * v);
    for (let i = 0; i < 3; i++) {
      rhs[i] += row[i] * w;
      for (let j = 0; j < 3; j++) N[i][j] += row[i] * row[j];
    }
  }
  const sol = solveLinear(N, rhs);
  if (!sol) return null;
  const cu = (-sol[0] / 2) * L, cv = (-sol[1] / 2) * L;
  const r2 = (cu * cu + cv * cv) / (L * L) - sol[2];
  if (!(r2 > 0)) return null;
  const radius = Math.sqrt(r2) * L;
  const centre = add(c0, add(scale(e1, cu), scale(e2, cv)));

  let residual = 0;
  for (const p of points) {
    const d = sub(p, centre);
    const radial = sub(d, scale(axis, dot(d, axis)));
    residual = Math.max(residual, Math.abs(norm(radial) - radius));
  }
  let tMin = Infinity, tMax = -Infinity;
  for (const p of [...points, ...extentPoints]) {
    const t = dot(sub(p, centre), axis);
    tMin = Math.min(tMin, t);
    tMax = Math.max(tMax, t);
  }
  return { axis, base: add(centre, scale(axis, tMin)), radius, height: tMax - tMin, residual };
}

export interface SphereFit {
  centre: Vec3;
  radius: number;
  /** max | distance(point, centre) - radius |. */
  residual: number;
}

/** Algebraic sphere fit |p|² = 2 c·p + d on centred, scaled coordinates. */
export function fitSphere(points: Vec3[]): SphereFit | null {
  if (points.length < 4) return null;
  const c0 = centroid(points);
  const L = Math.max(...points.map((p) => norm(sub(p, c0)))) || 1;
  const N = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const rhs = [0, 0, 0, 0];
  for (const p of points) {
    const q = scale(sub(p, c0), 1 / L);
    const row = [2 * q[0], 2 * q[1], 2 * q[2], 1];
    const w = dot(q, q);
    for (let i = 0; i < 4; i++) {
      rhs[i] += row[i] * w;
      for (let j = 0; j < 4; j++) N[i][j] += row[i] * row[j];
    }
  }
  const sol = solveLinear(N, rhs);
  if (!sol) return null;
  const cq: Vec3 = [sol[0], sol[1], sol[2]];
  const r2 = sol[3] + dot(cq, cq);
  if (!(r2 > 0)) return null;
  const centre = add(c0, scale(cq, L));
  const radius = Math.sqrt(r2) * L;
  let residual = 0;
  for (const p of points) residual = Math.max(residual, Math.abs(norm(sub(p, centre)) - radius));
  return { centre, radius, residual };
}

/** Closed triangle mesh of a capped cylinder along an arbitrary axis (display only). */
export function cylinderMesh(base: Vec3, axis: Vec3, radius: number, height: number, segments = 48): MeshData {
  const a = unit(axis);
  const helper: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(cross(a, helper));
  const e2 = cross(a, e1);
  const top = add(base, scale(a, height));
  const positions: number[] = [];
  const indices: number[] = [];
  for (const c of [base, top]) {
    for (let i = 0; i < segments; i++) {
      const ang = (2 * Math.PI * i) / segments;
      const p = add(c, add(scale(e1, radius * Math.cos(ang)), scale(e2, radius * Math.sin(ang))));
      positions.push(...p);
    }
  }
  positions.push(...base, ...top);
  const cb = 2 * segments, ct = 2 * segments + 1;
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    indices.push(i, j, segments + j, i, segments + j, segments + i); // side
    indices.push(cb, j, i); // bottom cap (outward = -axis)
    indices.push(ct, segments + i, segments + j); // top cap
  }
  return { positions, indices };
}
