// Example project: a three-column floating platform in 100 m of water with a
// three-line chain spread mooring. Line lengths are computed for a fairlead
// pretension of 1.2 MN with the platform at its neutral position; the line
// properties are generic MoorPy estimates (see mooring/library.ts).

import { createDefaultProject } from './project.ts';
import { lineTypeFromMaterial } from './mooring/library.ts';
import { DEFAULT_CRITERIA } from './mooring/safety.ts';
import { circularLayout, lengthForPretension } from './mooring/system.ts';
import type { Project, SceneObject } from './types.ts';

export const EXAMPLE = Object.freeze({
  depth: 100,
  columnRadius: 30,
  columnDiameter: 8,
  anchorRadius: 450,
  fairleadZ: -15,
  pretension: 1.2e6,
  chainDiameter: 0.12,
});

export function createExampleProject(): Project {
  const base = createDefaultProject();
  const E = EXAMPLE;
  const objects: SceneObject[] = [0, 1, 2].map((i) => {
    const a = (Math.PI / 180) * (180 + 120 * i);
    return {
      id: `obj-col-${i + 1}`, name: `Column ${i + 1}`, visible: true, analysis: true,
      shape: {
        kind: 'cylinder', x: Number((E.columnRadius * Math.cos(a)).toFixed(6)), y: Number((E.columnRadius * Math.sin(a)).toFixed(6)),
        diameter: E.columnDiameter, zBottom: -20, zTop: 12,
      },
      source: { kind: 'parametric' },
    };
  });
  const t = lineTypeFromMaterial('chain', E.chainDiameter, base.environment.rho);
  const fairleadRadius = E.columnRadius + E.columnDiameter / 2;
  const { anchors, fairleads } = circularLayout(3, E.anchorRadius, fairleadRadius, E.fairleadZ, E.depth, 180);
  const XF = E.anchorRadius - fairleadRadius, ZF = E.depth + E.fairleadZ;
  const L = lengthForPretension(XF, ZF, t, E.pretension);
  if (!L.ok) throw new Error(`Example mooring: ${L.message}`);
  const length = Number(L.length.toFixed(3));
  return {
    ...base,
    name: 'Example: 3-column platform with chain spread mooring',
    environment: { ...base.environment, h: E.depth, H: 6, T: 10 },
    objects,
    mooring: {
      system: {
        depth: E.depth,
        lineTypes: [t],
        anchors, fairleads,
        lines: [0, 1, 2].map((i) => ({
          id: `L${i + 1}`, name: `Line ${i + 1}`, anchorId: anchors[i].id, fairleadId: fairleads[i].id, lineTypeId: t.id, length,
        })),
      },
      external: [0, 0, 0],
      criteria: { ...DEFAULT_CRITERIA },
    },
  };
}
