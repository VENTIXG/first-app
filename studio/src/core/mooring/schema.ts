// Mooring part of the project document: type, validation on load, defaults.

import { MATERIALS, type LineType } from './library.ts';
import { DEFAULT_CRITERIA, type SafetyCriteria } from './safety.ts';
import type { Anchor, Fairlead, MooringLine, MooringSystem } from './system.ts';

export interface MooringProject {
  system: MooringSystem;
  /** Steady external load on the platform: [Fx N, Fy N, Mz N·m]. */
  external: [number, number, number];
  criteria: SafetyCriteria;
}

export const MOORING_LIMITS = Object.freeze({ lines: 64, anchors: 64, fairleads: 64, lineTypes: 32 });
const ANCHOR_TYPES = ['drag', 'suction', 'driven', 'gravity', 'plate'] as const;
const ID = /^[A-Za-z0-9._:-]{1,80}$/;

export class MooringSchemaError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function num(v: unknown, what: string, min = -Infinity, strictMin = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new MooringSchemaError(`${what} must be a finite number.`);
  if (strictMin ? !(v > min) : v < min) throw new MooringSchemaError(`${what} must be ${strictMin ? 'greater than' : 'at least'} ${min}.`);
  return v;
}
function text(v: unknown, what: string, max = 120): string {
  if (typeof v !== 'string' || v.length > max) throw new MooringSchemaError(`${what} must be text of at most ${max} characters.`);
  return v;
}
function ident(v: unknown, what: string): string {
  if (typeof v !== 'string' || !ID.test(v) || v === '__proto__' || v === 'constructor' || v === 'prototype') {
    throw new MooringSchemaError(`${what} is not a valid identifier.`);
  }
  return v;
}
function list<T>(v: unknown, what: string, max: number, f: (x: unknown, i: number) => T): T[] {
  if (!Array.isArray(v)) throw new MooringSchemaError(`${what} must be a list.`);
  if (v.length > max) throw new MooringSchemaError(`At most ${max} ${what}.`);
  const out = v.map(f);
  const ids = new Set<string>();
  for (const o of out as Array<{ id: string }>) {
    if (ids.has(o.id)) throw new MooringSchemaError(`Duplicate id "${o.id}" in ${what}.`);
    ids.add(o.id);
  }
  return out;
}

export function parseMooring(v: unknown): MooringProject {
  if (!isObj(v) || !isObj(v.system)) throw new MooringSchemaError('Mooring data is malformed.');
  const s = v.system;
  const lineTypes = list(s.lineTypes, 'line types', MOORING_LIMITS.lineTypes, (x, i): LineType => {
    if (!isObj(x)) throw new MooringSchemaError(`Line type ${i + 1} is malformed.`);
    return {
      id: ident(x.id, `Line type ${i + 1} id`), name: text(x.name, `Line type ${i + 1} name`),
      material: typeof x.material === 'string' && (x.material in MATERIALS || x.material === 'custom') ? x.material : 'custom',
      d: num(x.d, 'Diameter', 0, true), mass: num(x.mass, 'Mass per length', 0), w: num(x.w, 'Submerged weight', 0, true),
      EA: num(x.EA, 'EA', 0, true), MBL: num(x.MBL, 'MBL', 0, true), Cd: num(x.Cd, 'Cd', 0), Ca: num(x.Ca, 'Ca', 0),
      source: text(x.source, 'Source', 400),
    };
  });
  const anchors = list(s.anchors, 'anchors', MOORING_LIMITS.anchors, (x, i): Anchor => {
    if (!isObj(x)) throw new MooringSchemaError(`Anchor ${i + 1} is malformed.`);
    const type = ANCHOR_TYPES.includes(x.type as Anchor['type']) ? (x.type as Anchor['type']) : null;
    if (!type) throw new MooringSchemaError(`Anchor ${i + 1}: unknown anchor type.`);
    return { id: ident(x.id, `Anchor ${i + 1} id`), name: text(x.name, `Anchor ${i + 1} name`), x: num(x.x, 'x'), y: num(x.y, 'y'), z: num(x.z, 'z'), type };
  });
  const fairleads = list(s.fairleads, 'fairleads', MOORING_LIMITS.fairleads, (x, i): Fairlead => {
    if (!isObj(x)) throw new MooringSchemaError(`Fairlead ${i + 1} is malformed.`);
    return { id: ident(x.id, `Fairlead ${i + 1} id`), name: text(x.name, `Fairlead ${i + 1} name`), x: num(x.x, 'x'), y: num(x.y, 'y'), z: num(x.z, 'z') };
  });
  const ids = (arr: Array<{ id: string }>) => new Set(arr.map((a) => a.id));
  const [aIds, fIds, tIds] = [ids(anchors), ids(fairleads), ids(lineTypes)];
  const lines = list(s.lines, 'lines', MOORING_LIMITS.lines, (x, i): MooringLine => {
    if (!isObj(x)) throw new MooringSchemaError(`Line ${i + 1} is malformed.`);
    const l: MooringLine = {
      id: ident(x.id, `Line ${i + 1} id`), name: text(x.name, `Line ${i + 1} name`),
      anchorId: ident(x.anchorId, 'anchor'), fairleadId: ident(x.fairleadId, 'fairlead'), lineTypeId: ident(x.lineTypeId, 'line type'),
      length: num(x.length, 'Length', 0, true),
      ...(x.failed === true ? { failed: true } : {}),
    };
    if (!aIds.has(l.anchorId) || !fIds.has(l.fairleadId) || !tIds.has(l.lineTypeId)) {
      throw new MooringSchemaError(`Line ${i + 1} refers to a missing anchor, fairlead or line type.`);
    }
    return l;
  });
  const ext = Array.isArray(v.external) && v.external.length === 3 ? v.external : [0, 0, 0];
  const c = isObj(v.criteria) ? v.criteria : {};
  return {
    system: { depth: num(s.depth, 'Depth', 0, true), lineTypes, anchors, fairleads, lines },
    external: [num(ext[0], 'Fx'), num(ext[1], 'Fy'), num(ext[2], 'Mz')],
    criteria: {
      intactSF: c.intactSF === undefined ? DEFAULT_CRITERIA.intactSF : num(c.intactSF, 'Intact safety factor', 1),
      damagedSF: c.damagedSF === undefined ? DEFAULT_CRITERIA.damagedSF : num(c.damagedSF, 'Damaged safety factor', 1),
      ...(c.maxOffset === undefined || c.maxOffset === null ? {} : { maxOffset: num(c.maxOffset, 'Maximum offset', 0, true) }),
      source: c.source === undefined ? DEFAULT_CRITERIA.source : text(c.source, 'Criteria source', 300),
    },
  };
}

export function emptyMooring(depth: number): MooringProject {
  return {
    system: { depth, lineTypes: [], anchors: [], fairleads: [], lines: [] },
    external: [0, 0, 0],
    criteria: { ...DEFAULT_CRITERIA },
  };
}
