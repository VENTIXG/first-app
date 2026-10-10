// Studio data model. Pure data: no three.js, no DOM.
//
// Coordinates are SI (metres) in a right-handed, z-up frame: z = 0 is the
// still-water level, x is the wave propagation direction. This is also the
// Rhino world frame, so imported geometry is used without an axis swap.

import type { DEFAULT_ENVIRONMENT } from '../../../js/state.js';
import type { MooringProject } from './mooring/schema.ts';

export type Vec3 = [number, number, number];

type Widen<T> = T extends boolean ? boolean : T extends number ? number : T extends string ? string : T;
export type Environment = { -readonly [K in keyof typeof DEFAULT_ENVIRONMENT]: Widen<(typeof DEFAULT_ENVIRONMENT)[K]> };

/** Vertical circular cylinder between two elevations. */
export interface CylinderShape {
  kind: 'cylinder';
  x: number;
  y: number;
  diameter: number;
  zBottom: number;
  zTop: number;
}

/** Sphere. */
export interface SphereShape {
  kind: 'sphere';
  x: number;
  y: number;
  zCenter: number;
  radius: number;
}

/** Triangle mesh stored in Project.meshes, displaced by (dx, dy, dz). */
export interface MeshShape {
  kind: 'mesh';
  meshId: string;
  dx: number;
  dy: number;
  dz: number;
}

export type Shape = CylinderShape | SphereShape | MeshShape;
export type AnalysableShape = CylinderShape | SphereShape;

export interface ParametricSource {
  kind: 'parametric';
}

/** Provenance of an object imported from a Rhino file. */
export interface RhinoSource {
  kind: 'rhino';
  file: string;
  objectId: string;
  layer: string;
  rhinoType: string;
  /** How the shape was obtained, e.g. "fitted cylinder, residual 2e-9 m". */
  note: string;
}

export type ObjectSource = ParametricSource | RhinoSource;

export interface SceneObject {
  id: string;
  name: string;
  visible: boolean;
  /** Included in the load analysis (cylinders and spheres only). */
  analysis: boolean;
  shape: Shape;
  source: ObjectSource;
}

/** Triangle mesh in metres (z up). */
export interface MeshData {
  positions: number[];
  indices: number[];
}

export const PROJECT_FORMAT = 'offshore-studio/project';
/** v2 adds the optional mooring design; v1 files are migrated on load (no mooring). */
export const PROJECT_SCHEMA_VERSION = 2;

export interface Project {
  format: typeof PROJECT_FORMAT;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  name: string;
  environment: Environment;
  objects: SceneObject[];
  meshes: Record<string, MeshData>;
  /** Mooring design (absent until the user creates one). */
  mooring?: MooringProject;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  objectId?: string;
}
