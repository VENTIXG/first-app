// Runs the complete quasi-static mooring study for a project and returns plain
// data (safe to post from a worker): equilibrium, line results with shapes in
// global coordinates, safety cases, stiffness and tension-offset curves.

import { catenaryShape } from './catenary.ts';
import { runSafetyStudy, lineChecks, type CaseResult } from './safety.ts';
import { solveEquilibrium, solveLines, stiffness, type MooringSystem, type Pose, type Vec3 } from './system.ts';
import type { MooringProject } from './schema.ts';

export type MooringIssue = { severity: 'error' | 'warning' | 'info'; code: string; message: string; itemId?: string };

export interface MooringLineResult {
  id: string;
  name: string;
  regime: string;
  TF: number;
  TA: number;
  HF: number;
  VF: number;
  VA: number;
  grounded: number;
  touchdownX: number;
  fairleadAngleDeg: number;
  MBL: number;
  safetyFactor: number;
  utilisation: number;
  /** Points from anchor to fairlead in global coordinates. */
  shape: Vec3[];
  /** Tension at each shape point [N] (for colouring). */
  tensions: number[];
}

export interface MooringSummary {
  ok: boolean;
  status: string;
  issues: MooringIssue[];
  pose: Pose | null;
  offset: number | null;
  lines: MooringLineResult[];
  stiffness: number[][] | null;
  cases: Array<Pick<CaseResult, 'id' | 'label' | 'failedLineId' | 'criterion' | 'offset' | 'minSF' | 'criticalLineId' | 'pass' | 'messages'> & { ok: boolean; pose: Pose }>;
  sweep: { direction: [number, number]; offsets: number[]; tensions: Record<string, number[]> } | null;
  method: string;
}

export const MOORING_METHOD = 'Quasi-static: elastic catenary per line with frictionless seabed contact (Jonkman 2007); '
  + 'equilibrium in surge, sway and yaw under a steady load with heave, roll and pitch held; no line dynamics.';

function validate(m: MooringProject, depth: number): MooringIssue[] {
  const s = m.system;
  const out: MooringIssue[] = [];
  if (s.lines.length === 0) out.push({ severity: 'info', code: 'MOORING_EMPTY', message: 'No mooring lines yet. Generate a spread layout or add anchors, fairleads and lines.' });
  for (const a of s.anchors) {
    if (a.z > 0) out.push({ severity: 'error', code: 'ANCHOR_ABOVE_SWL', itemId: a.id, message: `${a.name} is above the water surface.` });
    else if (Math.abs(a.z + depth) > 0.5) {
      out.push({ severity: 'warning', code: 'ANCHOR_OFF_SEABED', itemId: a.id, message: `${a.name} is at z = ${a.z} m but the water depth is ${depth} m (local bathymetry assumed).` });
    }
  }
  for (const l of s.lines) {
    const a = s.anchors.find((x) => x.id === l.anchorId);
    const f = s.fairleads.find((x) => x.id === l.fairleadId);
    if (a && f && f.z <= a.z) out.push({ severity: 'error', code: 'FAIRLEAD_BELOW_ANCHOR', itemId: l.id, message: `${l.name}: the fairlead must be above the anchor.` });
  }
  for (const t of s.lineTypes) {
    if (t.source.startsWith('MoorPy')) {
      out.push({ severity: 'info', code: 'GENERIC_PROPERTIES', itemId: t.id, message: `${t.name}: generic property estimates (MoorPy scaling), not manufacturer data.` });
    }
  }
  return out;
}

function lineResults(sys: MooringSystem, pose: Pose): MooringLineResult[] {
  const states = solveLines(sys, pose);
  const types = new Map(sys.lineTypes.map((t) => [t.id, t]));
  return states.filter((s) => s.ok && s.cat).map((s) => {
    const line = sys.lines.find((l) => l.id === s.lineId)!;
    const t = types.get(line.lineTypeId)!;
    const c = s.cat!;
    const props = { L: line.length, EA: t.EA, w: t.w };
    const pts2 = catenaryShape(c, props, 64);
    const dx = s.fairlead[0] - s.anchor[0], dy = s.fairlead[1] - s.anchor[1];
    const len = Math.hypot(dx, dy) || 1;
    const ex = dx / len, ey = dy / len;
    const shape = pts2.map(([x, z]) => [s.anchor[0] + ex * x, s.anchor[1] + ey * x, s.anchor[2] + z] as Vec3);
    // tension along the line: T = sqrt(H^2 + V(s)^2), V rising by w per unit suspended length
    const tensions = pts2.map((_, i) => {
      const sArc = (line.length * i) / (pts2.length - 1);
      const susp = Math.max(0, sArc - c.LB);
      const V = c.regime === 'slack' ? (i === pts2.length - 1 ? c.VF : 0) : (c.LB > 0 ? 0 : c.VA) + t.w * susp;
      return Math.hypot(c.HF, V);
    });
    const tension = Math.max(c.TF, c.TA);
    return {
      id: line.id, name: line.name, regime: c.regime, TF: c.TF, TA: c.TA, HF: c.HF, VF: c.VF, VA: c.VA,
      grounded: c.LB, touchdownX: c.touchdownX, fairleadAngleDeg: (Math.atan2(c.VF, c.HF) * 180) / Math.PI,
      MBL: t.MBL, safetyFactor: tension > 0 ? t.MBL / tension : Infinity, utilisation: tension / t.MBL, shape, tensions,
    };
  });
}

export function runMooringAnalysis(m: MooringProject | undefined, depth: number): MooringSummary | null {
  if (!m) return null;
  const issues = validate(m, depth);
  const base = { pose: null, offset: null, lines: [], stiffness: null, cases: [], sweep: null, method: MOORING_METHOD };
  if (issues.some((i) => i.severity === 'error') || m.system.lines.filter((l) => !l.failed).length === 0) {
    return { ...base, ok: false, status: issues.some((i) => i.severity === 'error') ? 'Fix the errors to run the mooring analysis.' : 'Nothing to analyse.', issues };
  }
  const sys = m.system;
  const eq = solveEquilibrium(sys, { external: m.external });
  if (!eq.ok) {
    issues.push({ severity: 'error', code: 'NO_EQUILIBRIUM', message: eq.message ?? 'No equilibrium.' });
    return { ...base, ok: false, status: 'No physical equilibrium was found.', issues };
  }
  const lines = lineResults(sys, eq.pose);
  const checks = lineChecks(sys, eq);
  for (const c of checks) if (c.anchorUplift > 0) issues.push({ severity: 'warning', code: 'ANCHOR_UPLIFT', itemId: c.lineId, message: `${c.name}: ${(c.anchorUplift / 1000).toFixed(0)} kN uplift at a drag anchor.` });
  for (const l of lines) if (l.regime === 'slack') issues.push({ severity: 'warning', code: 'LINE_SLACK', itemId: l.id, message: `${l.name} is slack: it carries no horizontal load.` });
  const cases = runSafetyStudy(sys, m.external, m.criteria).map((c) => ({
    id: c.id, label: c.label, failedLineId: c.failedLineId, criterion: c.criterion, offset: c.offset, minSF: c.minSF,
    criticalLineId: c.criticalLineId, pass: c.pass, messages: c.messages, ok: c.equilibrium.ok, pose: c.equilibrium.pose,
  }));
  for (const c of cases) if (!c.pass) issues.push({ severity: 'warning', code: 'SAFETY_CASE', message: `${c.label}: ${c.messages.join(' ') || 'criterion not met.'}` });

  // tension vs offset along the load direction (or surge if unloaded), ±range around equilibrium
  const fx = m.external[0], fy = m.external[1];
  const n = Math.hypot(fx, fy);
  const dir: [number, number] = n > 0 ? [fx / n, fy / n] : [1, 0];
  const reach = Math.max(5, 0.1 * depth);
  const offsets: number[] = [];
  const tensions: Record<string, number[]> = Object.fromEntries(sys.lines.filter((l) => !l.failed).map((l) => [l.id, []]));
  let sweepOk = true;
  for (let i = 0; i <= 24; i++) {
    const d = -reach + (2 * reach * i) / 24;
    const pose: Pose = [eq.pose[0] + dir[0] * d, eq.pose[1] + dir[1] * d, eq.pose[2], eq.pose[3], eq.pose[4], eq.pose[5]];
    const st = solveLines(sys, pose);
    if (st.some((s) => !s.ok)) { sweepOk = false; break; }
    offsets.push(eq.pose[0] * dir[0] + eq.pose[1] * dir[1] + d); // offset along the load direction
    for (const s of st) tensions[s.lineId].push(Math.max(s.cat!.TF, s.cat!.TA));
  }

  const failing = cases.filter((c) => !c.pass);
  const governing = (failing.length ? failing : cases).reduce((a, c) => (c.minSF < a.minSF ? c : a));
  return {
    ok: true,
    status: failing.length === 0
      ? `All safety cases meet the criteria (lowest safety factor ${governing.minSF.toFixed(2)}, ${governing.label}).`
      : `${failing.length} case(s) do not meet the criteria: ${failing.map((c) => c.label).join(', ')}.`,
    issues, pose: eq.pose, offset: Math.hypot(eq.pose[0], eq.pose[1]), lines,
    stiffness: stiffness(sys, eq.pose), cases,
    sweep: sweepOk ? { direction: dir, offsets, tensions } : null,
    method: MOORING_METHOD,
  };
}
