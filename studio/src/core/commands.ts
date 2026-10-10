// Pure project edits. Each returns a new Project (or the same one when nothing
// changes) and throws CommandError for an invalid edit, so the caller never
// commits an impossible state.

import { parseEnvironment } from '../../../js/state.js';
import { LIMITS } from './project.ts';
import type { Environment, MeshData, Project, SceneObject, Shape } from './types.ts';

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

const finite = (v: number, what: string) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new CommandError(`${what} must be a finite number.`);
};

/** Throws CommandError if the shape is geometrically impossible. */
export function checkShape(shape: Shape): void {
  switch (shape.kind) {
    case 'cylinder':
      for (const k of ['x', 'y', 'diameter', 'zBottom', 'zTop'] as const) finite(shape[k], k);
      if (!(shape.diameter > 0)) throw new CommandError('Diameter must be greater than zero.');
      if (!(shape.zTop > shape.zBottom)) throw new CommandError('The top must be above the bottom.');
      return;
    case 'sphere':
      for (const k of ['x', 'y', 'zCenter', 'radius'] as const) finite(shape[k], k);
      if (!(shape.radius > 0)) throw new CommandError('Radius must be greater than zero.');
      return;
    case 'mesh':
      for (const k of ['dx', 'dy', 'dz'] as const) finite(shape[k], k);
      return;
  }
}

function find(project: Project, id: string): SceneObject {
  const obj = project.objects.find((o) => o.id === id);
  if (!obj) throw new CommandError('The object no longer exists.');
  return obj;
}

function replaceObject(project: Project, next: SceneObject): Project {
  return { ...project, objects: project.objects.map((o) => (o.id === next.id ? next : o)) };
}

export function addObjects(project: Project, objects: SceneObject[], meshes: Record<string, MeshData> = {}): Project {
  if (objects.length === 0) return project;
  if (project.objects.length + objects.length > LIMITS.objects) {
    throw new CommandError(`A project holds at most ${LIMITS.objects} objects.`);
  }
  const ids = new Set(project.objects.map((o) => o.id));
  for (const o of objects) {
    if (ids.has(o.id)) throw new CommandError('Duplicate object id.');
    ids.add(o.id);
    checkShape(o.shape);
    if (o.shape.kind === 'mesh' && !Object.hasOwn(meshes, o.shape.meshId) && !Object.hasOwn(project.meshes, o.shape.meshId)) {
      throw new CommandError('Mesh data missing for an imported object.');
    }
    if (o.analysis && o.shape.kind === 'mesh') throw new CommandError('Meshes cannot be analysed.');
  }
  return {
    ...project,
    objects: [...project.objects, ...objects],
    meshes: Object.keys(meshes).length ? { ...project.meshes, ...meshes } : project.meshes,
  };
}

export function removeObjects(project: Project, ids: string[]): Project {
  const drop = new Set(ids);
  const objects = project.objects.filter((o) => !drop.has(o.id));
  if (objects.length === project.objects.length) return project;
  // drop mesh data no remaining object refers to
  const used = new Set(objects.flatMap((o) => (o.shape.kind === 'mesh' ? [o.shape.meshId] : [])));
  const meshes: Record<string, MeshData> = {};
  for (const [id, m] of Object.entries(project.meshes)) if (used.has(id)) meshes[id] = m;
  return { ...project, objects, meshes };
}

/** Change shape fields (not the kind). Fields equal to the current values are a no-op. */
export function updateShape(project: Project, id: string, patch: Record<string, number>): Project {
  const obj = find(project, id);
  const shape = { ...obj.shape } as Record<string, unknown>;
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'kind' || k === 'meshId' || !(k in shape)) throw new CommandError(`"${k}" cannot be edited here.`);
    if (shape[k] !== v) {
      shape[k] = v;
      changed = true;
    }
  }
  if (!changed) return project;
  checkShape(shape as unknown as Shape);
  return replaceObject(project, { ...obj, shape: shape as unknown as Shape });
}

/** Move in plan (x, y). Meshes move by their displacement. */
export function moveObject(project: Project, id: string, x: number, y: number): Project {
  const obj = find(project, id);
  return obj.shape.kind === 'mesh'
    ? updateShape(project, id, { dx: x, dy: y })
    : updateShape(project, id, { x, y });
}

export function renameObject(project: Project, id: string, name: string): Project {
  const obj = find(project, id);
  if (typeof name !== 'string' || name.length > LIMITS.nameLength) {
    throw new CommandError(`Names are limited to ${LIMITS.nameLength} characters.`);
  }
  return obj.name === name ? project : replaceObject(project, { ...obj, name });
}

export function setVisible(project: Project, id: string, visible: boolean): Project {
  const obj = find(project, id);
  return obj.visible === visible ? project : replaceObject(project, { ...obj, visible });
}

export function setAnalysis(project: Project, id: string, analysis: boolean): Project {
  const obj = find(project, id);
  if (analysis && obj.shape.kind === 'mesh') {
    throw new CommandError('Imported meshes are display-only: only cylinders and spheres can be analysed.');
  }
  return obj.analysis === analysis ? project : replaceObject(project, { ...obj, analysis });
}

export function duplicateObject(project: Project, id: string, newId: string, offset: [number, number]): Project {
  const obj = find(project, id);
  const shape = { ...obj.shape };
  if (shape.kind === 'mesh') {
    shape.dx += offset[0];
    shape.dy += offset[1];
  } else {
    shape.x += offset[0];
    shape.y += offset[1];
  }
  return addObjects(project, [{ ...obj, id: newId, name: `${obj.name} copy`.slice(0, LIMITS.nameLength), shape }]);
}

/** Change environment fields; types are checked, physical ranges are left to the engine's validation. */
export function setEnvironment(project: Project, patch: Partial<Environment>): Project {
  const merged = { ...project.environment, ...patch };
  let environment: Environment;
  try {
    environment = parseEnvironment(merged) as Environment;
  } catch (err) {
    throw new CommandError((err as Error).message);
  }
  const same = Object.keys(environment).every((k) => environment[k as keyof Environment] === project.environment[k as keyof Environment]);
  return same ? project : { ...project, environment };
}

export function renameProject(project: Project, name: string): Project {
  if (typeof name !== 'string' || name.length > LIMITS.nameLength) throw new CommandError('Project name is too long.');
  return project.name === name ? project : { ...project, name };
}
