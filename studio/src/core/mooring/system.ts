// Quasi-static multi-line mooring analysis of a rigid platform.
//
// Frame: global x, y horizontal, z up, z = 0 at the still-water level. The
// platform pose is (X, Y, Z, roll, pitch, yaw) of its reference point; fairlead
// positions are given in the body frame relative to that point. Each line is
// solved as an elastic catenary in the vertical plane through its anchor and
// fairlead (catenary.ts). Its pull on the platform acts at the fairlead:
// horizontal HF towards the anchor, vertical VF downwards.
//
// Equilibrium is solved in surge, sway and yaw for a given steady external
// load; heave, roll and pitch are held at the given pose (no hydrostatic or
// inertial coupling here). This is a quasi-static analysis: no line dynamics,
// no wave-frequency motion, no dynamic tension amplification.

import { solveCatenary, type CatenaryResult } from './catenary.ts';
import type { LineType } from './library.ts';

export type Vec3 = [number, number, number];

export interface Anchor {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Elevation of the anchor (seabed), negative below SWL [m]. */
  z: number;
  type: 'drag' | 'suction' | 'driven' | 'gravity' | 'plate';
}

export interface Fairlead {
  id: string;
  name: string;
  /** Body-frame coordinates relative to the platform reference point [m]. */
  x: number;
  y: number;
  z: number;
}

export interface MooringLine {
  id: string;
  name: string;
  anchorId: string;
  fairleadId: string;
  lineTypeId: string;
  /** Unstretched length [m]. */
  length: number;
  /** Excluded from the analysis (e.g. a failed line). */
  failed?: boolean;
}

export interface MooringSystem {
  /** Water depth at the site [m], for drawing and checks. */
  depth: number;
  lineTypes: LineType[];
  anchors: Anchor[];
  fairleads: Fairlead[];
  lines: MooringLine[];
}

/** Platform pose: translations [m] and rotations roll, pitch, yaw [rad]. */
export type Pose = [number, number, number, number, number, number];

export interface LineState {
  lineId: string;
  ok: boolean;
  message?: string;
  fairlead: Vec3;
  anchor: Vec3;
  XF: number;
  ZF: number;
  cat?: CatenaryResult;
  /** Force of the line on the platform at the fairlead [N]. */
  force: Vec3;
  utilisation?: number;
}

/** Rotation matrix R = Rz(yaw) Ry(pitch) Rx(roll). */
export function rotation(roll: number, pitch: number, yaw: number): number[][] {
  const [cr, sr, cp, sp, cy, sy] = [Math.cos(roll), Math.sin(roll), Math.cos(pitch), Math.sin(pitch), Math.cos(yaw), Math.sin(yaw)];
  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
}

export function fairleadPosition(f: Fairlead, pose: Pose): Vec3 {
  const R = rotation(pose[3], pose[4], pose[5]);
  const r = [f.x, f.y, f.z];
  return [0, 1, 2].map((i) => pose[i] + R[i][0] * r[0] + R[i][1] * r[1] + R[i][2] * r[2]) as Vec3;
}

export function solveLines(sys: MooringSystem, pose: Pose): LineState[] {
  const anchors = new Map(sys.anchors.map((a) => [a.id, a]));
  const fairleads = new Map(sys.fairleads.map((f) => [f.id, f]));
  const types = new Map(sys.lineTypes.map((t) => [t.id, t]));
  return sys.lines.filter((l) => !l.failed).map((l) => {
    const a = anchors.get(l.anchorId);
    const f = fairleads.get(l.fairleadId);
    const t = types.get(l.lineTypeId);
    const empty = { lineId: l.id, fairlead: [0, 0, 0] as Vec3, anchor: [0, 0, 0] as Vec3, XF: 0, ZF: 0, force: [0, 0, 0] as Vec3 };
    if (!a || !f || !t) return { ...empty, ok: false, message: `${l.name}: anchor, fairlead or line type is missing.` };
    const P = fairleadPosition(f, pose);
    const A: Vec3 = [a.x, a.y, a.z];
    const dx = P[0] - A[0], dy = P[1] - A[1];
    const XF = Math.hypot(dx, dy);
    const ZF = P[2] - A[2];
    const cat = solveCatenary(XF, ZF, { L: l.length, EA: t.EA, w: t.w });
    if (!cat.ok) return { ...empty, fairlead: P, anchor: A, XF, ZF, ok: false, message: `${l.name}: ${cat.message}` };
    const ex = XF > 0 ? dx / XF : 0, ey = XF > 0 ? dy / XF : 0;
    const force: Vec3 = [-cat.HF * ex, -cat.HF * ey, -cat.VF];
    return { lineId: l.id, ok: true, fairlead: P, anchor: A, XF, ZF, cat, force, utilisation: cat.TF / t.MBL };
  });
}

/** Total mooring load on the platform: [Fx, Fy, Fz, Mx, My, Mz] about the reference point. */
export function mooringLoad(states: LineState[], pose: Pose): [number, number, number, number, number, number] {
  const out: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  for (const s of states) {
    if (!s.ok) continue;
    const r = [s.fairlead[0] - pose[0], s.fairlead[1] - pose[1], s.fairlead[2] - pose[2]];
    const F = s.force;
    out[0] += F[0]; out[1] += F[1]; out[2] += F[2];
    out[3] += r[1] * F[2] - r[2] * F[1];
    out[4] += r[2] * F[0] - r[0] * F[2];
    out[5] += r[0] * F[1] - r[1] * F[0];
  }
  return out;
}

export interface EquilibriumOptions {
  /** Steady external load on the platform: [Fx, Fy, Mz] in N, N, N·m. */
  external?: [number, number, number];
  /** Start / held pose. */
  pose?: Pose;
  tol?: number;
  maxIter?: number;
}

export interface EquilibriumResult {
  ok: boolean;
  message?: string;
  pose: Pose;
  lines: LineState[];
  load: [number, number, number, number, number, number];
  iterations: number;
  /** Residual of the surge/sway/yaw balance: [N, N, N·m]. */
  residual: [number, number, number];
  /** Lines whose fairlead tension exceeds their MBL at the balance found. */
  brokenLines?: string[];
}

function balance(sys: MooringSystem, pose: Pose, ext: [number, number, number]) {
  const lines = solveLines(sys, pose);
  const bad = lines.find((l) => !l.ok);
  const load = mooringLoad(lines, pose);
  return { lines, load, bad, r: [load[0] + ext[0], load[1] + ext[1], load[5] + ext[2]] as [number, number, number] };
}

/** Newton iteration on (X, Y, yaw) with a finite-difference Jacobian and backtracking. */
export function solveEquilibrium(sys: MooringSystem, opts: EquilibriumOptions = {}): EquilibriumResult {
  const ext = opts.external ?? [0, 0, 0];
  let pose: Pose = [...(opts.pose ?? [0, 0, 0, 0, 0, 0])] as Pose;
  const tol = opts.tol ?? 1e-6;
  const maxIter = opts.maxIter ?? 100;
  const active = sys.lines.filter((l) => !l.failed);
  if (active.length === 0) {
    return { ok: false, message: 'No intact mooring line: the platform is not restrained.', pose, lines: [], load: [0, 0, 0, 0, 0, 0], iterations: 0, residual: [0, 0, 0] };
  }
  const lever = Math.max(1, ...sys.fairleads.map((f) => Math.hypot(f.x, f.y)));
  let cur = balance(sys, pose, ext);
  if (cur.bad) return { ok: false, message: cur.bad.message, pose, lines: cur.lines, load: cur.load, iterations: 0, residual: cur.r };
  const scale = Math.max(1, Math.hypot(ext[0], ext[1]), ...cur.lines.map((l) => l.cat?.HF ?? 0));
  const norm = (r: [number, number, number]) => Math.hypot(r[0] / scale, r[1] / scale, r[2] / (scale * lever));
  const steps = [0.01, 0.01, 1e-4];
  const dofs = [0, 1, 5];
  let iter = 0;
  for (; iter < maxIter; iter++) {
    if (norm(cur.r) < tol) break;
    // Jacobian dR/d(X, Y, yaw), central differences
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let j = 0; j < 3; j++) {
      const p1 = [...pose] as Pose, p2 = [...pose] as Pose;
      p1[dofs[j]] += steps[j];
      p2[dofs[j]] -= steps[j];
      const b1 = balance(sys, p1, ext), b2 = balance(sys, p2, ext);
      if (b1.bad || b2.bad) {
        return { ok: false, message: (b1.bad ?? b2.bad)!.message, pose, lines: cur.lines, load: cur.load, iterations: iter, residual: cur.r };
      }
      for (let i = 0; i < 3; i++) J[i][j] = (b1.r[i] - b2.r[i]) / (2 * steps[j]);
    }
    const dx = solve3(J, cur.r.map((v) => -v));
    if (!dx) break;
    // limit the step (10% of the anchor spread per iteration) and backtrack on the residual norm
    const maxStep = 0.1 * Math.max(10, ...sys.anchors.map((a) => Math.hypot(a.x - pose[0], a.y - pose[1])));
    let f = Math.min(1, maxStep / Math.max(Math.hypot(dx[0], dx[1]), 1e-12), 0.2 / Math.max(Math.abs(dx[2]), 1e-12));
    const n0 = norm(cur.r);
    let accepted = false;
    for (let k = 0; k < 30; k++) {
      const trial = [...pose] as Pose;
      trial[0] += f * dx[0]; trial[1] += f * dx[1]; trial[5] += f * dx[2];
      const b = balance(sys, trial, ext);
      if (!b.bad && norm(b.r) < n0) { pose = trial; cur = b; accepted = true; break; }
      f /= 2;
    }
    if (!accepted) break;
  }
  const converged = norm(cur.r) < tol;
  // a balance that needs a line beyond its breaking load is not a physical equilibrium
  const types = new Map(sys.lineTypes.map((t) => [t.id, t]));
  const broken = cur.lines.filter((l) => {
    const line = sys.lines.find((x) => x.id === l.lineId);
    const t = line ? types.get(line.lineTypeId) : undefined;
    return l.cat && t && l.cat.TF > t.MBL;
  });
  const names = broken.map((l) => sys.lines.find((x) => x.id === l.lineId)?.name ?? l.lineId);
  const ok = converged && broken.length === 0;
  const message = !converged
    ? `Equilibrium not found (scaled residual ${norm(cur.r).toExponential(2)} after ${iter} iterations). The load may exceed what the mooring can resist.`
    : broken.length
      ? `No physical equilibrium: ${names.join(', ')} would exceed the minimum breaking load.`
      : undefined;
  return { ok, message, pose, lines: cur.lines, load: cur.load, iterations: iter, residual: cur.r, brokenLines: broken.map((l) => l.lineId) };
}

function solve3(A: number[][], b: number[]): number[] | null {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < 3; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = M[r][3];
    for (let k = r + 1; k < 3; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * 6×6 mooring stiffness K_ij = -dF_i/dx_j at a pose (central differences on
 * the platform pose; forces and moments about the reference point).
 */
export function stiffness(sys: MooringSystem, pose: Pose, dTrans = 0.01, dRot = 1e-4): number[][] | null {
  const K = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let j = 0; j < 6; j++) {
    const h = j < 3 ? dTrans : dRot;
    const p1 = [...pose] as Pose, p2 = [...pose] as Pose;
    p1[j] += h; p2[j] -= h;
    const s1 = solveLines(sys, p1), s2 = solveLines(sys, p2);
    if (s1.some((l) => !l.ok) || s2.some((l) => !l.ok)) return null;
    const f1 = mooringLoad(s1, p1), f2 = mooringLoad(s2, p2);
    for (let i = 0; i < 6; i++) K[i][j] = -(f1[i] - f2[i]) / (2 * h);
  }
  return K;
}

/** Unstretched length that gives a target fairlead tension for a line spanning (XF, ZF). */
export function lengthForPretension(XF: number, ZF: number, t: Pick<LineType, 'EA' | 'w'>, target: number): { ok: true; length: number } | { ok: false; message: string } {
  const chord = Math.hypot(XF, ZF);
  const tension = (L: number) => {
    const c = solveCatenary(XF, ZF, { L, EA: t.EA, w: t.w });
    return c.ok ? c.TF : NaN;
  };
  // tension decreases with length; bracket between a stretched chord and a long, mostly grounded line
  let lo = chord * 0.98, hi = XF + ZF * 3;
  let tlo = tension(lo), thi = tension(hi);
  if (!(tlo >= target)) return { ok: false, message: 'Target pretension is higher than the line can reach without being shorter than 98 % of the chord.' };
  if (!(thi <= target)) return { ok: false, message: `Target pretension is below the minimum for this geometry (about ${(thi / 1000).toFixed(0)} kN, mostly the suspended weight).` };
  for (let i = 0; i < 200 && hi - lo > 1e-9 * chord; i++) {
    const mid = 0.5 * (lo + hi);
    const tm = tension(mid);
    if (!Number.isFinite(tm)) return { ok: false, message: 'Catenary did not converge while searching for the length.' };
    if (tm > target) { lo = mid; tlo = tm; } else { hi = mid; thi = tm; }
  }
  return { ok: true, length: 0.5 * (lo + hi) };
}

/** Symmetric spread layout: n lines, anchors on a circle, fairleads on a smaller circle. */
export function circularLayout(n: number, anchorRadius: number, fairleadRadius: number, fairleadZ: number, depth: number, headingDeg = 0) {
  const anchors: Anchor[] = [];
  const fairleads: Fairlead[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((headingDeg + (360 * i) / n) * Math.PI) / 180;
    anchors.push({ id: `A${i + 1}`, name: `Anchor ${i + 1}`, x: anchorRadius * Math.cos(a), y: anchorRadius * Math.sin(a), z: -depth, type: 'drag' });
    fairleads.push({ id: `F${i + 1}`, name: `Fairlead ${i + 1}`, x: fairleadRadius * Math.cos(a), y: fairleadRadius * Math.sin(a), z: fairleadZ });
  }
  return { anchors, fairleads };
}
