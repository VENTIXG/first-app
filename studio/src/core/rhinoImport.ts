// Rhino .3dm import (rhino3dm.js / openNURBS). Produces plain scene objects
// in metres; never modifies the scene itself.
//
// What is handled:
//  - unit system: converted to metres; a file without units is refused until
//    the user states the units;
//  - layers (full path), object names, ids and visibility;
//  - Breps and Extrusions that are a closed capped circular cylinder or a
//    closed sphere: recognised by fitting the sampled surface and accepted only
//    when the fit reproduces the surface within tolerance. Vertical cylinders
//    and spheres become editable, analysable objects (analysis off until the
//    user includes them); inclined cylinders are tessellated for display only;
//  - Mesh objects and Breps/Extrusions carrying render meshes: display only;
//  - everything else is listed as skipped with the reason.
// rhino3dm cannot tessellate NURBS itself, so a Brep with no stored render
// mesh that is not a recognised primitive cannot be displayed.
//
// The rhino3dm module is passed in (browser and Node load it differently).
// Its enum values are embind objects compared by identity, which the
// published TypeScript declarations do not describe, hence `any` here.

import { cylinderMesh, fitCylinder, fitSphere } from './fit.ts';
import { newId } from './ids.ts';
import { LIMITS } from './project.ts';
import { metresPerUnit } from './units.ts';
import type { MeshData, SceneObject, Vec3 } from './types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rhino = any;

/** Axis within this angle of the z axis counts as vertical. */
export const VERTICAL_TOLERANCE_RAD = 1e-3;

export interface ImportOptions {
  /** Units to assume when the file declares none (required in that case). */
  assumeUnits?: string;
  /** Elevation of the still-water level in the model, in metres; subtracted from z. */
  swlElevation?: number;
  /** Mesh vertices already in the project (for the overall limit). */
  existingMeshVertices?: number;
}

export interface SkippedObject {
  name: string;
  layer: string;
  rhinoType: string;
  reason: string;
}

export interface RhinoImportResult {
  ok: boolean;
  /** Set when ok is false. */
  error?: { code: 'NOT_3DM' | 'UNITS_UNKNOWN' | 'TOO_LARGE'; message: string };
  fileName: string;
  unitSystem: string;
  metresPerUnit: number;
  objects: SceneObject[];
  meshes: Record<string, MeshData>;
  skipped: SkippedObject[];
  notes: string[];
}

function enumName(enumObj: Record<string, unknown>, value: unknown): string {
  for (const k of Object.keys(enumObj)) if (enumObj[k] === value) return k;
  return 'Unknown';
}

/** Sample a face over its parameter domain (n × m grid, optionally inset from the edges). */
function sampleFace(face: any, n: number, m: number, inset: boolean): { points: Vec3[]; normals: Vec3[] } {
  const [u0, u1] = face.domain(0);
  const [v0, v1] = face.domain(1);
  const points: Vec3[] = [];
  const normals: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const s = inset ? (i + 0.5) / n : i / (n - 1);
      const t = inset ? (j + 0.5) / m : j / (m - 1);
      const u = u0 + s * (u1 - u0);
      const v = v0 + t * (v1 - v0);
      points.push(face.pointAt(u, v) as Vec3);
      normals.push(face.normalAt(u, v) as Vec3);
    }
  }
  return { points, normals };
}

type Primitive =
  | { kind: 'cylinder'; base: Vec3; axis: Vec3; radius: number; height: number; residual: number }
  | { kind: 'sphere'; centre: Vec3; radius: number; residual: number };

/**
 * Recognise a closed capped circular cylinder (one cylindrical face + two
 * planar caps normal to the axis) or a closed sphere (one spherical face).
 * Coordinates are in file units. Returns null if the Brep is anything else
 * or the fit does not reproduce the surface within tolerance.
 */
function recognise(brep: any, tol: number, size: number): Primitive | null {
  if (!brep?.isSolid) return null;
  const faces = brep.faces();
  const count = faces.count;
  const accept = Math.max(tol, 1e-7 * size);
  if (count === 1) {
    const f = faces.get(0);
    if (!f.isSphere(tol)) return null;
    const { points } = sampleFace(f, 12, 8, true);
    const fit = fitSphere(points);
    return fit && fit.residual <= accept ? { kind: 'sphere', centre: fit.centre, radius: fit.radius, residual: fit.residual } : null;
  }
  if (count !== 3) return null;
  const list = [0, 1, 2].map((i) => faces.get(i));
  const lateral = list.filter((f) => f.isCylinder(tol));
  const caps = list.filter((f) => !f.isCylinder(tol) && f.isPlanar(tol));
  if (lateral.length !== 1 || caps.length !== 2) return null;
  const side = sampleFace(lateral[0], 16, 5, false);
  const capSamples = caps.map((c) => sampleFace(c, 3, 3, true));
  const fit = fitCylinder(side.points, side.normals, capSamples.flatMap((c) => c.points));
  if (!fit || fit.residual > accept) return null;
  // caps must be perpendicular to the axis and lie at the two ends
  for (const c of capSamples) {
    for (const n of c.normals) {
      const len = Math.hypot(n[0], n[1], n[2]);
      const along = Math.abs(n[0] * fit.axis[0] + n[1] * fit.axis[1] + n[2] * fit.axis[2]) / len;
      if (1 - along > 1e-6) return null;
    }
  }
  return { kind: 'cylinder', base: fit.base, axis: fit.axis, radius: fit.radius, height: fit.height, residual: fit.residual };
}

/** Read a rhino3dm Mesh into triangles (file units). */
function readMesh(mesh: any): MeshData {
  const v = mesh.vertices();
  const f = mesh.faces();
  const positions: number[] = [];
  for (let i = 0; i < v.count; i++) positions.push(...(v.get(i) as number[]));
  const indices: number[] = [];
  for (let i = 0; i < f.count; i++) {
    const [a, b, c, d] = f.get(i) as number[];
    indices.push(a, b, c);
    if (d !== c) indices.push(a, c, d);
  }
  return { positions, indices };
}

function appendMesh(into: MeshData, m: MeshData): void {
  const offset = into.positions.length / 3;
  into.positions.push(...m.positions);
  for (const i of m.indices) into.indices.push(i + offset);
}

/** Render meshes stored with a Brep or Extrusion, or null if any face lacks one. */
function storedRenderMesh(rhino: Rhino, geometry: any, isExtrusion: boolean): MeshData | null {
  if (isExtrusion) {
    const m = geometry.getMesh(rhino.MeshType.Any);
    return m ? readMesh(m) : null;
  }
  const faces = geometry.faces();
  const out: MeshData = { positions: [], indices: [] };
  for (let i = 0; i < faces.count; i++) {
    const m = faces.get(i).getMesh(rhino.MeshType.Any);
    if (!m) return null;
    appendMesh(out, readMesh(m));
  }
  return out.indices.length ? out : null;
}

/** Scale to metres and shift by the still-water elevation. */
function toMetres(m: MeshData, k: number, swl: number): MeshData {
  const positions = m.positions.map((p, i) => (i % 3 === 2 ? p * k - swl : p * k));
  return { positions, indices: m.indices };
}

/** Round imported lengths to 1 nm (far below CAD tolerances) so fit noise such as 2e-16 m reads as 0. */
const round = (x: number) => {
  const q = Math.abs(x) < 1e6 ? Math.round(x * 1e9) / 1e9 : x;
  return q === 0 ? 0 : Number(q.toPrecision(12));
};

export function importRhino(rhino: Rhino, bytes: Uint8Array, fileName: string, options: ImportOptions = {}): RhinoImportResult {
  const base: RhinoImportResult = {
    ok: false, fileName, unitSystem: 'Unknown', metresPerUnit: NaN, objects: [], meshes: {}, skipped: [], notes: [],
  };
  let doc: any;
  try {
    doc = rhino.File3dm.fromByteArray(bytes);
  } catch {
    doc = null;
  }
  if (!doc) return { ...base, error: { code: 'NOT_3DM', message: `${fileName} could not be read as a Rhino .3dm file.` } };

  try {
    const settings = doc.settings();
    const unitSystem = enumName(rhino.UnitSystem, settings.modelUnitSystem);
    let k = metresPerUnit(unitSystem);
    const notes: string[] = [];
    if (k === null) {
      const assumed = options.assumeUnits ? metresPerUnit(options.assumeUnits) : null;
      if (assumed === null) {
        return {
          ...base, unitSystem,
          error: { code: 'UNITS_UNKNOWN', message: `${fileName} does not state usable length units (${unitSystem}). Choose the units the model was drawn in.` },
        };
      }
      k = assumed;
      notes.push(`The file states no length units (${unitSystem}); ${options.assumeUnits} were assumed as requested.`);
    }
    const swl = options.swlElevation ?? 0;
    notes.push(swl === 0
      ? 'Rhino z = 0 is taken as the still-water level; x is the wave direction.'
      : `The still-water level is taken at model elevation ${swl} m; x is the wave direction.`);

    const tolFile = settings.modelAbsoluteTolerance > 0 ? settings.modelAbsoluteTolerance : 0;
    const layers = doc.layers();
    const layerName = (i: number) => {
      if (i < 0 || i >= layers.count) return '';
      const l = layers.get(i);
      return l.fullPath || l.name || '';
    };
    const layerVisible = (i: number) => (i < 0 || i >= layers.count ? true : layers.get(i).visible !== false);

    const objects: SceneObject[] = [];
    const meshes: Record<string, MeshData> = {};
    const skipped: SkippedObject[] = [];
    let meshVertices = options.existingMeshVertices ?? 0;
    const table = doc.objects();
    const OT = rhino.ObjectType;

    for (let i = 0; i < table.count; i++) {
      const entry = table.get(i);
      const g = entry.geometry();
      const attr = entry.attributes();
      const rhinoType = enumName(OT, g.objectType);
      const layer = layerName(attr.layerIndex);
      const name = (attr.name || `${rhinoType} ${i + 1}`).slice(0, LIMITS.nameLength);
      const visible = attr.visible !== false && layerVisible(attr.layerIndex);
      const sourceBase = { kind: 'rhino' as const, file: fileName.slice(0, 260), objectId: String(attr.id ?? ''), layer, rhinoType };
      const skip = (reason: string) => skipped.push({ name, layer, rhinoType, reason });

      const addMesh = (data: MeshData, note: string) => {
        const nv = data.positions.length / 3;
        if (meshVertices + nv > LIMITS.meshVerticesTotal) {
          skip(`mesh too large: the project limit is ${LIMITS.meshVerticesTotal.toLocaleString('en-US')} vertices`);
          return;
        }
        meshVertices += nv;
        const meshId = newId('mesh');
        meshes[meshId] = toMetres(data, k as number, swl);
        objects.push({
          id: newId('obj'), name, visible, analysis: false,
          shape: { kind: 'mesh', meshId, dx: 0, dy: 0, dz: 0 },
          source: { ...sourceBase, note },
        });
      };

      if (g.objectType === OT.Mesh) {
        addMesh(readMesh(g), 'mesh object: display only (not analysed)');
        continue;
      }
      if (g.objectType !== OT.Brep && g.objectType !== OT.Extrusion) {
        const reasons: Record<string, string> = {
          InstanceReference: 'block instances are not supported yet (explode the block in Rhino before exporting)',
          SubD: 'SubD objects are not supported (convert to a mesh or NURBS in Rhino)',
          Surface: 'open surface: not a closed solid',
          Curve: 'curves have no volume',
          Point: 'points have no volume',
          PointSet: 'points have no volume',
        };
        skip(reasons[rhinoType] ?? 'object type not supported for import');
        continue;
      }

      const isExtrusion = g.objectType === OT.Extrusion;
      const brep = isExtrusion ? g.toBrep(false) : g;
      const bb = g.getBoundingBox();
      const size = Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
      const tol = Math.max(tolFile, 1e-9 * size);
      const prim = recognise(brep, tol, size);
      const residualNote = (r: number) => `residual ${(r * (k as number)).toExponential(1)} m`;

      if (prim?.kind === 'sphere') {
        objects.push({
          id: newId('obj'), name, visible, analysis: false,
          shape: {
            kind: 'sphere', x: round(prim.centre[0] * k), y: round(prim.centre[1] * k),
            zCenter: round(prim.centre[2] * k - swl), radius: round(prim.radius * k),
          },
          source: { ...sourceBase, note: `recognised sphere (${residualNote(prim.residual)})` },
        });
        continue;
      }
      if (prim?.kind === 'cylinder') {
        const tilt = Math.acos(Math.min(1, Math.abs(prim.axis[2])));
        if (tilt <= VERTICAL_TOLERANCE_RAD) {
          // vertical within tolerance: plan position from the axis midpoint, vertical
          // extent from the axial length (any residual tilt is reported, not hidden)
          const mid = [0, 1, 2].map((c) => prim.base[c] + (prim.axis[c] * prim.height) / 2);
          const half = (prim.height * Math.cos(tilt) * k) / 2;
          const zMid = mid[2] * k - swl;
          const snapped = tilt > 1e-12 ? `; axis tilt ${((tilt * 180) / Math.PI).toExponential(2)}° snapped to vertical` : '';
          objects.push({
            id: newId('obj'), name, visible, analysis: false,
            shape: {
              kind: 'cylinder', x: round(mid[0] * k), y: round(mid[1] * k),
              diameter: round(2 * prim.radius * k), zBottom: round(zMid - half), zTop: round(zMid + half),
            },
            source: { ...sourceBase, note: `recognised vertical cylinder (${residualNote(prim.residual)}${snapped})` },
          });
        } else {
          const deg = (tilt * 180) / Math.PI;
          addMesh(
            cylinderMesh(prim.base, prim.axis, prim.radius, prim.height),
            `recognised cylinder inclined ${deg.toFixed(2)}° from vertical: display only (the analysis supports vertical members)`,
          );
        }
        continue;
      }
      const stored = storedRenderMesh(rhino, g, isExtrusion);
      if (stored) {
        addMesh(stored, `${rhinoType} shown from its stored render mesh: display only (not analysed)`);
      } else {
        skip(`not a recognised cylinder or sphere, and the file stores no render mesh for it (rhino3dm cannot mesh NURBS; save from Rhino with render meshes, or export a mesh)`);
      }
    }

    if (objects.length === 0 && skipped.length === 0) notes.push('The file contains no objects.');
    return {
      ok: true, fileName, unitSystem, metresPerUnit: k, objects, meshes, skipped, notes,
    };
  } finally {
    doc.delete?.();
  }
}
