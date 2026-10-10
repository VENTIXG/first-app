// Mooring safety study: intact condition and every single-line failure under
// the same steady environmental load (quasi-static).
//
// Safety factor = MBL / maximum line tension. The default criteria are the
// quasi-static ULS factors of API RP 2SK (3rd ed., 2005): 2.00 intact and 1.43
// with one line damaged. They are a configurable preliminary screening value,
// not a substitute for the standard edition and analysis type that apply to a
// project (dynamic analyses use different factors). Anchors are checked only
// for uplift at the anchor (drag anchors are not intended to resist it).

import { solveEquilibrium, solveLines, type EquilibriumResult, type MooringSystem } from './system.ts';

export interface SafetyCriteria {
  intactSF: number;
  damagedSF: number;
  /** Optional maximum horizontal offset [m] (e.g. from riser limits); not checked when absent. */
  maxOffset?: number;
  source: string;
}

export const DEFAULT_CRITERIA: SafetyCriteria = Object.freeze({
  intactSF: 2.0,
  damagedSF: 1.43,
  source: 'API RP 2SK 3rd ed. (2005), quasi-static analysis — screening default, verify against the governing standard',
}) as SafetyCriteria;

export interface LineCheck {
  lineId: string;
  name: string;
  tension: number;
  MBL: number;
  safetyFactor: number;
  utilisation: number;
  anchorUplift: number;
  regime: string;
}

export interface CaseResult {
  id: string;
  label: string;
  failedLineId: string | null;
  criterion: number;
  equilibrium: EquilibriumResult;
  offset: number;
  lines: LineCheck[];
  minSF: number;
  criticalLineId: string | null;
  pass: boolean;
  messages: string[];
}

export function lineChecks(sys: MooringSystem, eq: EquilibriumResult): LineCheck[] {
  const types = new Map(sys.lineTypes.map((t) => [t.id, t]));
  const anchors = new Map(sys.anchors.map((a) => [a.id, a]));
  return eq.lines.filter((l) => l.ok && l.cat).map((l) => {
    const line = sys.lines.find((x) => x.id === l.lineId)!;
    const t = types.get(line.lineTypeId)!;
    const tension = Math.max(l.cat!.TF, l.cat!.TA);
    return {
      lineId: line.id, name: line.name, tension, MBL: t.MBL,
      safetyFactor: tension > 0 ? t.MBL / tension : Infinity,
      utilisation: tension / t.MBL,
      anchorUplift: anchors.get(line.anchorId)?.type === 'drag' ? l.cat!.VA : 0,
      regime: l.cat!.regime,
    };
  });
}

export function runSafetyStudy(sys: MooringSystem, external: [number, number, number], criteria: SafetyCriteria = DEFAULT_CRITERIA): CaseResult[] {
  const active = sys.lines.filter((l) => !l.failed);
  const cases: Array<{ id: string; label: string; failed: string | null }> = [
    { id: 'intact', label: 'Intact', failed: null },
    ...active.map((l) => ({ id: `fail-${l.id}`, label: `${l.name} failed`, failed: l.id })),
  ];
  // horizontal direction of each line at the neutral position (anchor -> fairlead)
  const neutral = new Map(solveLines(sys, [0, 0, 0, 0, 0, 0]).map((l) => [l.lineId, [l.fairlead[0] - l.anchor[0], l.fairlead[1] - l.anchor[1]]]));
  let start: [number, number, number, number, number, number] | undefined;
  return cases.map((c) => {
    const s: MooringSystem = { ...sys, lines: sys.lines.map((l) => (l.id === c.failed ? { ...l, failed: true } : l)) };
    const eq = solveEquilibrium(s, { external, pose: start });
    if (c.failed === null && eq.ok) start = eq.pose;
    const criterion = c.failed ? criteria.damagedSF : criteria.intactSF;
    const lines = lineChecks(s, eq);
    const messages: string[] = [];
    if (!eq.ok) messages.push(eq.message ?? 'No equilibrium.');
    let minSF = Infinity, critical: string | null = null;
    for (const l of lines) {
      if (l.safetyFactor < minSF) { minSF = l.safetyFactor; critical = l.lineId; }
      if (l.anchorUplift > 0) messages.push(`${l.name}: uplift ${(l.anchorUplift / 1000).toFixed(0)} kN at a drag anchor.`);
      if (l.regime === 'slack') messages.push(`${l.name} is slack (no horizontal tension).`);
    }
    if (eq.ok && minSF < criterion) {
      messages.push(`Minimum safety factor ${minSF.toFixed(2)} is below the criterion ${criterion.toFixed(2)}.`);
    }
    // Station keeping is lost if the platform drifted past an anchor: either the
    // line's horizontal direction reversed, or (along the load direction) the
    // fairlead crossed the anchor of a line that was not perpendicular to the load.
    const fh = Math.hypot(external[0], external[1]);
    const u = fh > 0 ? [external[0] / fh, external[1] / fh] : null;
    const reversed = eq.lines.filter((l) => {
      const n = neutral.get(l.lineId);
      if (!n) return false;
      const dx = l.fairlead[0] - l.anchor[0], dy = l.fairlead[1] - l.anchor[1];
      if (dx * n[0] + dy * n[1] < 0) return true;
      if (!u) return false;
      const c0 = n[0] * u[0] + n[1] * u[1], c1 = dx * u[0] + dy * u[1];
      return Math.abs(c0) > 0.1 * Math.hypot(n[0], n[1]) && c0 * c1 < 0;
    }).map((l) => sys.lines.find((x) => x.id === l.lineId)?.name ?? l.lineId);
    if (eq.ok && reversed.length) {
      messages.push(`Station keeping lost: the platform drifted past the anchor of ${reversed.join(', ')}.`);
    }
    const offset = Math.hypot(eq.pose[0], eq.pose[1]);
    const offsetFail = criteria.maxOffset !== undefined && offset > criteria.maxOffset;
    if (eq.ok && offsetFail) messages.push(`Offset ${offset.toFixed(1)} m exceeds the limit ${criteria.maxOffset} m.`);
    return {
      id: c.id, label: c.label, failedLineId: c.failed, criterion, equilibrium: eq,
      offset, lines, minSF, criticalLineId: critical,
      pass: eq.ok && minSF >= criterion && !lines.some((l) => l.anchorUplift > 0) && reversed.length === 0 && !offsetFail,
      messages,
    };
  });
}
