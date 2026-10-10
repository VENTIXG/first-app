// Scene -> load analysis. Converts the objects marked for analysis into the
// engine's body description and runs the Phase 1 engine (js/morison.js)
// unchanged, so the studio and the classic calculator give identical results
// for the same inputs.

import { computePlatform, ENGINE_VERSION } from '../../../js/morison.js';
import { MAX_BODIES } from '../../../js/validation.js';
import type { Issue, Project } from './types.ts';

export interface EngineBody {
  id: number;
  type: 'cylinder' | 'sphere';
  x: number;
  y: number;
  diameter: number;
  radius: number;
  draft: number;
  freeboard: number;
}

export interface BodyLink {
  bodyId: number;
  objectId: string;
  name: string;
}

export interface AnalysisInput {
  bodies: EngineBody[];
  links: BodyLink[];
  issues: Issue[];
}

/**
 * Map analysis objects to engine bodies. A cylinder from zBottom to zTop has
 * draft -zBottom and freeboard zTop; a sphere of radius R centred at zc has
 * draft R - zc. Geometry the engine cannot represent is reported here.
 */
export function analysisInput(project: Project): AnalysisInput {
  const bodies: EngineBody[] = [];
  const links: BodyLink[] = [];
  const issues: Issue[] = [];
  for (const o of project.objects) {
    if (!o.analysis) continue;
    const s = o.shape;
    if (s.kind === 'mesh') continue; // rejected by the project model; defensive
    if (s.kind === 'cylinder') {
      if (s.zBottom >= 0) {
        issues.push({ severity: 'error', code: 'STUDIO_NOT_IN_WATER', objectId: o.id,
          message: `${o.name}: the bottom (z = ${s.zBottom} m) is not below the still-water level.` });
        continue;
      }
      if (s.zTop < 0) {
        issues.push({ severity: 'error', code: 'STUDIO_FULLY_SUBMERGED', objectId: o.id,
          message: `${o.name}: the top (z = ${s.zTop} m) is below the still-water level. Only surface-piercing cylinders are supported.` });
        continue;
      }
    } else if (s.zCenter - s.radius >= 0) {
      issues.push({ severity: 'error', code: 'STUDIO_NOT_IN_WATER', objectId: o.id,
        message: `${o.name}: the sphere is entirely above the still-water level.` });
      continue;
    }
    const id = bodies.length + 1;
    bodies.push(s.kind === 'cylinder'
      ? { id, type: 'cylinder', x: s.x, y: s.y, diameter: s.diameter, radius: s.diameter / 2, draft: -s.zBottom, freeboard: s.zTop }
      : { id, type: 'sphere', x: s.x, y: s.y, diameter: 2 * s.radius, radius: s.radius, draft: s.radius - s.zCenter, freeboard: 0 });
    links.push({ bodyId: id, objectId: o.id, name: o.name });
  }
  if (bodies.length > MAX_BODIES) {
    issues.push({ severity: 'error', code: 'STUDIO_TOO_MANY_BODIES',
      message: `${bodies.length} objects are marked for analysis; the engine accepts at most ${MAX_BODIES}.` });
  }
  return { bodies, links, issues };
}

export interface AnalysisSummary {
  ok: boolean;
  engineVersion: string;
  links: BodyLink[];
  issues: Issue[];
  /** Present only when ok. Forces in N. */
  global?: { peakTotal: number; peakDrag: number; peakInertia: number; peakWind: number; rms: number };
  bodies?: { bodyId: number; peakTotal: number; rms: number; Dlambda: number; KC: number; mfApplied: boolean }[];
  wavelength?: number;
  heave?: { applicable: boolean; Tn3: number | null; bandLow: number | null; bandHigh: number | null; potentialResonance: boolean; status: string } | null;
}

type EngineIssue = { severity: Issue['severity']; code: string; message: string; bodyId?: number; bodyIds?: number[] };

/** Run the engine on the project. The result is plain data (safe to post from a worker). */
export function runAnalysis(project: Project): AnalysisSummary {
  const input = analysisInput(project);
  const base = { engineVersion: ENGINE_VERSION as string, links: input.links };
  if (input.bodies.length === 0 && input.issues.length === 0) {
    return { ...base, ok: false, issues: [{ severity: 'info', code: 'STUDIO_NOTHING_TO_ANALYSE',
      message: 'No object is marked for analysis.' }] };
  }
  if (input.issues.some((i) => i.severity === 'error') || input.bodies.length === 0) {
    return { ...base, ok: false, issues: input.issues };
  }
  const r = computePlatform(project.environment, input.bodies);
  const objectOf = (bodyId?: number) => input.links.find((l) => l.bodyId === bodyId)?.objectId;
  const engineIssues: Issue[] = [...r.errors, ...r.warnings, ...r.infos].map((i: EngineIssue) => ({
    severity: i.severity, code: i.code, message: i.message, objectId: objectOf(i.bodyId ?? i.bodyIds?.[0]),
  }));
  const issues = [...input.issues, ...engineIssues];
  if (!r.ok || !('global' in r)) return { ...base, ok: false, issues };
  return {
    ...base,
    ok: true,
    issues,
    global: {
      peakTotal: r.global.peakTotal, peakDrag: r.global.peakDrag, peakInertia: r.global.peakInertia,
      peakWind: r.global.peakWind, rms: r.global.rms,
    },
    bodies: r.bodies.map((b: { id: number; peakTotal: number; rms: number; Dlambda: number; KC: number; mfApplied: boolean }) => ({
      bodyId: b.id, peakTotal: b.peakTotal, rms: b.rms, Dlambda: b.Dlambda, KC: b.KC, mfApplied: b.mfApplied,
    })),
    wavelength: r.wavelength,
    heave: r.heave ? {
      applicable: Boolean(r.heave.applicable), Tn3: r.heave.Tn3, bandLow: r.heave.bandLow, bandHigh: r.heave.bandHigh,
      potentialResonance: r.heave.potentialResonance, status: r.heave.status,
    } : null,
  };
}
