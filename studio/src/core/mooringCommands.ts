// Pure edits of the project's mooring design. Every result is re-validated with
// the mooring schema, so an edit that would produce an invalid document throws
// CommandError and is never committed.

import { CommandError } from './commands.ts';
import { MATERIALS, lineTypeFromMaterial, type LineType } from './mooring/library.ts';
import { DEFAULT_CRITERIA, type SafetyCriteria } from './mooring/safety.ts';
import { MooringSchemaError, parseMooring, type MooringProject } from './mooring/schema.ts';
import { circularLayout, lengthForPretension, type Anchor, type Fairlead, type MooringLine } from './mooring/system.ts';
import type { Project } from './types.ts';

function validated(project: Project, next: MooringProject): Project {
  let m: MooringProject;
  try {
    m = parseMooring(JSON.parse(JSON.stringify(next)));
  } catch (err) {
    if (err instanceof MooringSchemaError) throw new CommandError(err.message);
    throw err;
  }
  if (project.mooring && JSON.stringify(project.mooring) === JSON.stringify(m)) return project;
  return { ...project, mooring: m };
}

function current(project: Project): MooringProject {
  if (!project.mooring) throw new CommandError('The project has no mooring design yet.');
  return project.mooring;
}

export interface SpreadParams {
  count: number;
  anchorRadius: number;
  fairleadRadius: number;
  fairleadZ: number;
  headingDeg: number;
  material: string;
  diameter: number;
  pretension: number;
}

export const DEFAULT_SPREAD: SpreadParams = Object.freeze({
  count: 3, anchorRadius: 450, fairleadRadius: 34, fairleadZ: -15, headingDeg: 180,
  material: 'chain', diameter: 0.12, pretension: 1.2e6,
}) as SpreadParams;

/**
 * Replace the mooring with a symmetric spread: n identical lines, anchors on
 * the seabed (z = -h) and line lengths that give the requested fairlead
 * pretension at the neutral position. Load case and criteria are kept.
 */
export function generateSpread(project: Project, p: SpreadParams): Project {
  const h = project.environment.h;
  if (!Number.isInteger(p.count) || p.count < 1 || p.count > 24) throw new CommandError('Number of lines must be a whole number from 1 to 24.');
  if (!(p.material in MATERIALS)) throw new CommandError('Unknown line material.');
  if (!(p.diameter > 0 && p.diameter <= 0.5)) throw new CommandError('Nominal diameter must be between 0 and 0.5 m.');
  if (!(p.anchorRadius > p.fairleadRadius) || !(p.fairleadRadius >= 0)) throw new CommandError('The anchor radius must exceed the fairlead radius.');
  if (!(p.fairleadZ > -h && p.fairleadZ <= 0)) throw new CommandError(`The fairlead must be between the seabed (−${h} m) and the water surface.`);
  if (!(p.pretension > 0) || !Number.isFinite(p.headingDeg)) throw new CommandError('Pretension must be greater than zero.');
  const t = lineTypeFromMaterial(p.material, p.diameter, project.environment.rho);
  const L = lengthForPretension(p.anchorRadius - p.fairleadRadius, h + p.fairleadZ, t, p.pretension);
  if (!L.ok) throw new CommandError(L.message);
  const { anchors, fairleads } = circularLayout(p.count, p.anchorRadius, p.fairleadRadius, p.fairleadZ, h, p.headingDeg);
  const round = (v: number) => Number(v.toFixed(6));
  const prev = project.mooring;
  return validated(project, {
    system: {
      depth: h,
      lineTypes: [t],
      anchors: anchors.map((a) => ({ ...a, x: round(a.x), y: round(a.y) })),
      fairleads: fairleads.map((f) => ({ ...f, x: round(f.x), y: round(f.y) })),
      lines: anchors.map((a, i) => ({
        id: `L${i + 1}`, name: `Line ${i + 1}`, anchorId: a.id, fairleadId: fairleads[i].id, lineTypeId: t.id,
        length: Number(L.length.toFixed(3)),
      })),
    },
    external: prev?.external ?? [0, 0, 0],
    criteria: prev?.criteria ?? { ...DEFAULT_CRITERIA },
  });
}

export function removeMooring(project: Project): Project {
  if (!project.mooring) return project;
  const { mooring: _drop, ...rest } = project;
  return rest;
}

export function updateLine(project: Project, id: string, patch: Partial<Pick<MooringLine, 'name' | 'length' | 'failed' | 'lineTypeId'>>): Project {
  const m = current(project);
  if (!m.system.lines.some((l) => l.id === id)) throw new CommandError('The line no longer exists.');
  const lines = m.system.lines.map((l) => {
    if (l.id !== id) return l;
    const next: MooringLine = { ...l, ...patch };
    if (!next.failed) delete next.failed;
    return next;
  });
  return validated(project, { ...m, system: { ...m.system, lines } });
}

export function updateAnchor(project: Project, id: string, patch: Partial<Omit<Anchor, 'id'>>): Project {
  const m = current(project);
  if (!m.system.anchors.some((a) => a.id === id)) throw new CommandError('The anchor no longer exists.');
  return validated(project, { ...m, system: { ...m.system, anchors: m.system.anchors.map((a) => (a.id === id ? { ...a, ...patch } : a)) } });
}

export function updateFairlead(project: Project, id: string, patch: Partial<Omit<Fairlead, 'id'>>): Project {
  const m = current(project);
  if (!m.system.fairleads.some((f) => f.id === id)) throw new CommandError('The fairlead no longer exists.');
  return validated(project, { ...m, system: { ...m.system, fairleads: m.system.fairleads.map((f) => (f.id === id ? { ...f, ...patch } : f)) } });
}

/** Replace a line type's properties (all lines using it change). */
export function updateLineType(project: Project, id: string, patch: Partial<Omit<LineType, 'id'>>): Project {
  const m = current(project);
  if (!m.system.lineTypes.some((t) => t.id === id)) throw new CommandError('The line type no longer exists.');
  const physical = ['d', 'mass', 'w', 'EA', 'MBL'] as const;
  const lineTypes = m.system.lineTypes.map((t) => {
    if (t.id !== id) return t;
    const next = { ...t, ...patch };
    if (physical.some((k) => next[k] !== t[k]) && patch.source === undefined) {
      // edited properties are no longer the library estimate
      next.material = 'custom';
      next.source = 'User-defined values';
    }
    return next;
  });
  return validated(project, { ...m, system: { ...m.system, lineTypes } });
}

export function setMooringLoad(project: Project, external: [number, number, number]): Project {
  const m = current(project);
  return validated(project, { ...m, external });
}

export function setCriteria(project: Project, patch: Partial<Omit<SafetyCriteria, 'maxOffset'>> & { maxOffset?: number | null }): Project {
  const m = current(project);
  const c: Omit<SafetyCriteria, 'maxOffset'> & { maxOffset?: number | null } = { ...m.criteria, ...patch };
  if (c.maxOffset === null) delete c.maxOffset;
  if (!(c.intactSF >= 1) || !(c.damagedSF >= 1)) throw new CommandError('Safety factors must be at least 1.');
  return validated(project, { ...m, criteria: c as SafetyCriteria });
}

const freeId = (prefix: string, taken: Set<string>) => {
  let i = 1;
  while (taken.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
};

/**
 * Add a line at a heading [deg from +x]: a new drag anchor and fairlead at the
 * same radii and elevations as the first existing line, with its length and
 * line type (so the new line has the same neutral pretension).
 */
export function addLine(project: Project, headingDeg: number): Project {
  const m = current(project);
  const s = m.system;
  const ref = s.lines[0];
  if (!ref) throw new CommandError('Generate a spread first: a new line copies the first line.');
  if (!Number.isFinite(headingDeg)) throw new CommandError('Heading must be a finite number.');
  const a0 = s.anchors.find((a) => a.id === ref.anchorId)!;
  const f0 = s.fairleads.find((f) => f.id === ref.fairleadId)!;
  const rA = Math.hypot(a0.x, a0.y), rF = Math.hypot(f0.x, f0.y);
  const th = (headingDeg * Math.PI) / 180;
  const round = (v: number) => Number(v.toFixed(6));
  const aId = freeId('A', new Set(s.anchors.map((a) => a.id)));
  const fId = freeId('F', new Set(s.fairleads.map((f) => f.id)));
  const lId = freeId('L', new Set(s.lines.map((l) => l.id)));
  const n = lId.slice(1);
  return validated(project, {
    ...m,
    system: {
      ...s,
      anchors: [...s.anchors, { id: aId, name: `Anchor ${aId.slice(1)}`, x: round(rA * Math.cos(th)), y: round(rA * Math.sin(th)), z: a0.z, type: a0.type }],
      fairleads: [...s.fairleads, { id: fId, name: `Fairlead ${fId.slice(1)}`, x: round(rF * Math.cos(th)), y: round(rF * Math.sin(th)), z: f0.z }],
      lines: [...s.lines, { id: lId, name: `Line ${n}`, anchorId: aId, fairleadId: fId, lineTypeId: ref.lineTypeId, length: ref.length }],
    },
  });
}

/** Remove a line and any anchor or fairlead that no other line uses. */
export function removeLine(project: Project, id: string): Project {
  const m = current(project);
  const s = m.system;
  if (!s.lines.some((l) => l.id === id)) throw new CommandError('The line no longer exists.');
  const lines = s.lines.filter((l) => l.id !== id);
  const usedA = new Set(lines.map((l) => l.anchorId)), usedF = new Set(lines.map((l) => l.fairleadId));
  return validated(project, {
    ...m,
    system: { ...s, lines, anchors: s.anchors.filter((a) => usedA.has(a.id)), fairleads: s.fairleads.filter((f) => usedF.has(f.id)) },
  });
}
