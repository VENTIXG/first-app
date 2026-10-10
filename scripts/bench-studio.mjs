// Studio import benchmark: `npm run bench:studio`.
// Times importRhino (parse + recognition fits + mesh conversion) on generated
// .3dm files. Wall-clock, single run after a warm-up; machine-dependent.

import { performance } from 'node:perf_hooks';
import rhino3dm from 'rhino3dm';
import { importRhino } from '../studio/src/core/rhinoImport.ts';
import { runAnalysis } from '../studio/src/core/analysis.ts';
import { addObjects } from '../studio/src/core/commands.ts';
import { createDefaultProject } from '../studio/src/core/project.ts';

const rhino = await rhino3dm();

function columns(n) {
  const doc = new rhino.File3dm();
  doc.settings().modelUnitSystem = rhino.UnitSystem.Meters;
  for (let i = 0; i < n; i++) {
    const c = new rhino.Cylinder(new rhino.Circle([(i % 10) * 30, Math.floor(i / 10) * 30, -20], 3), 35);
    doc.objects().add(c.toBrep(true, true), null);
  }
  return doc.toByteArray();
}

function gridMesh(cells) {
  const doc = new rhino.File3dm();
  doc.settings().modelUnitSystem = rhino.UnitSystem.Meters;
  const m = new rhino.Mesh();
  for (let j = 0; j <= cells; j++) for (let i = 0; i <= cells; i++) m.vertices().add(i, j, Math.sin(i / 7) * Math.cos(j / 9));
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const a = j * (cells + 1) + i;
    m.faces().addQuadFace(a, a + 1, a + cells + 2, a + cells + 1);
  }
  doc.objects().add(m, null);
  return doc.toByteArray();
}

function time(label, bytes, after) {
  importRhino(rhino, bytes, 'warmup.3dm');
  const t0 = performance.now();
  const r = importRhino(rhino, bytes, `${label}.3dm`);
  const ms = performance.now() - t0;
  const extra = after ? after(r) : '';
  console.log(`${label.padEnd(36)} ${(bytes.length / 1024).toFixed(0).padStart(7)} KB  ${ms.toFixed(1).padStart(8)} ms  ${r.objects.length} objects${extra}`);
}

console.log(`Node ${process.version} · ${process.platform}/${process.arch}`);
time('10 capped cylinders (Brep)', columns(10));
time('50 capped cylinders (Brep)', columns(50), (r) => {
  const p = addObjects({ ...createDefaultProject(), objects: [] }, r.objects.map((o) => ({ ...o, analysis: true })), r.meshes);
  const t0 = performance.now();
  const a = runAnalysis(p);
  return ` · analysis of all 50: ${(performance.now() - t0).toFixed(1)} ms (ok=${a.ok})`;
});
time('mesh 100×100 quads (20 k triangles)', gridMesh(100));
time('mesh 300×300 quads (180 k triangles)', gridMesh(300));
