// Project document: defaults, validation on load, serialisation.
// A project read from disk is untrusted input: every field is type- and
// range-checked, unknown fields are dropped, and any violation throws
// ProjectError so a bad file can never half-load.

import { DEFAULT_ENVIRONMENT, parseEnvironment } from '../../../js/state.js';
import {
  PROJECT_FORMAT, PROJECT_SCHEMA_VERSION,
  type Environment, type MeshData, type ObjectSource, type Project, type SceneObject, type Shape,
} from './types.ts';

export const LIMITS = Object.freeze({
  objects: 500,
  nameLength: 200,
  idLength: 120,
  meshVerticesTotal: 3_000_000,
});

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

/** Default scene: the classic calculator's default platform (two D 6 m columns). */
export function createDefaultProject(): Project {
  const column = (id: string, name: string, x: number): SceneObject => ({
    id,
    name,
    visible: true,
    analysis: true,
    shape: { kind: 'cylinder', x, y: 0, diameter: 6, zBottom: -20, zTop: 15 },
    source: { kind: 'parametric' },
  });
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: 'Untitled project',
    environment: { ...DEFAULT_ENVIRONMENT } as Environment,
    objects: [column('obj-column-1', 'Column 1', 0), column('obj-column-2', 'Column 2', 60)],
    meshes: {},
  };
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project);
}

const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

/** Identifiers are restricted to a safe charset (no "__proto__"-style keys, no markup). */
function ident(v: unknown, what: string): string {
  const s = str(v, what, LIMITS.idLength);
  if (!ID_PATTERN.test(s) || s === '__proto__' || s === 'constructor' || s === 'prototype') {
    throw new ProjectError(`${what} contains characters that are not allowed.`);
  }
  return s;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function str(v: unknown, what: string, max: number, allowEmpty = false): string {
  if (typeof v !== 'string') throw new ProjectError(`${what} must be text.`);
  if (!allowEmpty && v.length === 0) throw new ProjectError(`${what} must not be empty.`);
  if (v.length > max) throw new ProjectError(`${what} is longer than ${max} characters.`);
  return v;
}

function num(v: unknown, what: string): number {
  if (!isNum(v)) throw new ProjectError(`${what} must be a finite number.`);
  return v;
}

function positive(v: unknown, what: string): number {
  const n = num(v, what);
  if (!(n > 0)) throw new ProjectError(`${what} must be greater than zero.`);
  return n;
}

function parseShape(v: unknown, where: string, meshes: Record<string, MeshData>): Shape {
  if (!isObj(v)) throw new ProjectError(`${where}: shape is missing.`);
  switch (v.kind) {
    case 'cylinder': {
      const zBottom = num(v.zBottom, `${where}: zBottom`);
      const zTop = num(v.zTop, `${where}: zTop`);
      if (!(zTop > zBottom)) throw new ProjectError(`${where}: zTop must be above zBottom.`);
      return {
        kind: 'cylinder', x: num(v.x, `${where}: x`), y: num(v.y, `${where}: y`),
        diameter: positive(v.diameter, `${where}: diameter`), zBottom, zTop,
      };
    }
    case 'sphere':
      return {
        kind: 'sphere', x: num(v.x, `${where}: x`), y: num(v.y, `${where}: y`),
        zCenter: num(v.zCenter, `${where}: zCenter`), radius: positive(v.radius, `${where}: radius`),
      };
    case 'mesh': {
      const meshId = ident(v.meshId, `${where}: meshId`);
      if (!Object.hasOwn(meshes, meshId)) throw new ProjectError(`${where}: mesh data "${meshId}" is missing.`);
      return {
        kind: 'mesh', meshId, dx: num(v.dx, `${where}: dx`), dy: num(v.dy, `${where}: dy`), dz: num(v.dz, `${where}: dz`),
      };
    }
    default:
      throw new ProjectError(`${where}: unknown shape type.`);
  }
}

function parseSource(v: unknown, where: string): ObjectSource {
  if (!isObj(v) || v.kind === 'parametric') return { kind: 'parametric' };
  if (v.kind !== 'rhino') throw new ProjectError(`${where}: unknown source type.`);
  return {
    kind: 'rhino',
    file: str(v.file, `${where}: source file`, 260, true),
    objectId: str(v.objectId, `${where}: source object id`, LIMITS.idLength, true),
    layer: str(v.layer, `${where}: source layer`, 1000, true),
    rhinoType: str(v.rhinoType, `${where}: source type`, 40, true),
    note: str(v.note, `${where}: source note`, 400, true),
  };
}

function parseMesh(v: unknown, where: string): MeshData {
  if (!isObj(v) || !Array.isArray(v.positions) || !Array.isArray(v.indices)) {
    throw new ProjectError(`${where}: positions and indices are required.`);
  }
  const { positions, indices } = v as { positions: unknown[]; indices: unknown[] };
  if (positions.length % 3 !== 0 || indices.length % 3 !== 0) {
    throw new ProjectError(`${where}: positions and indices must come in triples.`);
  }
  const nv = positions.length / 3;
  for (const p of positions) if (!isNum(p)) throw new ProjectError(`${where}: non-numeric vertex coordinate.`);
  for (const i of indices) {
    if (!Number.isInteger(i) || (i as number) < 0 || (i as number) >= nv) throw new ProjectError(`${where}: face index out of range.`);
  }
  return { positions: positions as number[], indices: indices as number[] };
}

/** Parse and validate a project from JSON text or an already-parsed value. */
export function parseProject(input: unknown): Project {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new ProjectError('The file is not valid JSON.');
    }
  }
  if (!isObj(data) || data.format !== PROJECT_FORMAT) throw new ProjectError('Not an Offshore Studio project file.');
  if (data.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new ProjectError(`Unsupported project schema version ${String(data.schemaVersion)}.`);
  }

  let environment: Environment;
  try {
    environment = parseEnvironment(data.environment) as Environment;
  } catch (err) {
    throw new ProjectError(`Environment: ${(err as Error).message}`);
  }

  const meshes: Record<string, MeshData> = {};
  if (data.meshes !== undefined) {
    if (!isObj(data.meshes)) throw new ProjectError('meshes must be an object.');
    let vertices = 0;
    for (const [id, m] of Object.entries(data.meshes)) {
      ident(id, 'Mesh id');
      meshes[id] = parseMesh(m, `Mesh ${id}`);
      vertices += meshes[id].positions.length / 3;
      if (vertices > LIMITS.meshVerticesTotal) throw new ProjectError(`More than ${LIMITS.meshVerticesTotal} mesh vertices.`);
    }
  }

  if (!Array.isArray(data.objects)) throw new ProjectError('objects must be a list.');
  if (data.objects.length > LIMITS.objects) throw new ProjectError(`More than ${LIMITS.objects} objects.`);
  const ids = new Set<string>();
  const objects = data.objects.map((o: unknown, i: number): SceneObject => {
    const where = `Object ${i + 1}`;
    if (!isObj(o)) throw new ProjectError(`${where} is not an object.`);
    const id = ident(o.id, `${where}: id`);
    if (ids.has(id)) throw new ProjectError(`${where}: duplicate id.`);
    ids.add(id);
    const shape = parseShape(o.shape, where, meshes);
    if (typeof o.visible !== 'boolean' || typeof o.analysis !== 'boolean') {
      throw new ProjectError(`${where}: visible and analysis must be true/false.`);
    }
    if (o.analysis && shape.kind === 'mesh') throw new ProjectError(`${where}: meshes cannot be analysed.`);
    return {
      id,
      name: str(o.name, `${where}: name`, LIMITS.nameLength, true),
      visible: o.visible,
      analysis: o.analysis,
      shape,
      source: parseSource(o.source, where),
    };
  });

  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: str(data.name ?? 'Untitled project', 'Project name', LIMITS.nameLength, true),
    environment,
    objects,
    meshes,
  };
}
