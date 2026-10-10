import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importRhino } from '../../../studio/src/core/rhinoImport.ts';
import { addObjects } from '../../../studio/src/core/commands.ts';
import { createDefaultProject, LIMITS, parseProject, serializeProject } from '../../../studio/src/core/project.ts';
import { runAnalysis } from '../../../studio/src/core/analysis.ts';
import { loadRhino, referenceModel, singleColumn } from '../../helpers/rhinoFixtures.mjs';
import type { CylinderShape, MeshData, SceneObject, SphereShape } from '../../../studio/src/core/types.ts';

const rhino = await loadRhino();
const byName = (objects: SceneObject[], name: string) => {
  const o = objects.find((x) => x.name === name);
  assert.ok(o, `object ${name} imported`);
  return o;
};
const close = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('reference model (mm): units, layers, recognised primitives, meshes and skipped objects', async () => {
  const r = importRhino(rhino, await referenceModel(), 'reference.3dm');
  assert.equal(r.ok, true);
  assert.equal(r.unitSystem, 'Millimeters');
  assert.equal(r.metresPerUnit, 1e-3);

  for (const name of ['Column A', 'Column B']) {
    const o = byName(r.objects, name);
    assert.equal(o.shape.kind, 'cylinder');
    const s = o.shape as CylinderShape;
    close(s.diameter, 6, 1e-9, `${name} D`);
    close(s.zBottom, -20, 1e-9, `${name} zBottom`);
    close(s.zTop, 15, 1e-9, `${name} zTop`);
    close(s.y, 0, 1e-9, `${name} y`);
    assert.equal(o.analysis, false, 'imported objects are not analysed until the user includes them');
    assert.equal(o.source.kind === 'rhino' && o.source.layer, 'Platform::Columns');
    assert.match(o.source.kind === 'rhino' ? o.source.note : '', /recognised vertical cylinder/);
  }
  close((byName(r.objects, 'Column A').shape as CylinderShape).x, 0, 1e-9, 'Column A x');
  close((byName(r.objects, 'Column B').shape as CylinderShape).x, 60, 1e-9, 'Column B x (Extrusion)');
  assert.equal(byName(r.objects, 'Column B').source.kind === 'rhino' && byName(r.objects, 'Column B').source.rhinoType, 'Extrusion');

  const buoy = byName(r.objects, 'Buoy').shape as SphereShape;
  assert.equal(buoy.kind, 'sphere');
  close(buoy.radius, 5, 1e-9, 'buoy R');
  close(buoy.y, 40, 1e-9, 'buoy y');
  close(buoy.zCenter, 0, 1e-9, 'buoy z');

  const brace = byName(r.objects, 'Brace');
  assert.equal(brace.shape.kind, 'mesh');
  assert.match(brace.source.kind === 'rhino' ? brace.source.note : '', /inclined 30\.00° from vertical: display only/);

  const deck = byName(r.objects, 'Deck');
  assert.equal(deck.shape.kind, 'mesh');
  assert.match(deck.source.kind === 'rhino' ? deck.source.note : '', /stored render mesh/);
  const deckMesh = r.meshes[(deck.shape as { meshId: string }).meshId];
  const zs = deckMesh.positions.filter((_, i) => i % 3 === 2);
  close(Math.min(...zs), 16, 1e-9, 'deck bottom in metres');
  close(Math.max(...zs), 18, 1e-9, 'deck top in metres');

  const hull = byName(r.objects, 'Hull mesh');
  const hullMesh = r.meshes[(hull.shape as { meshId: string }).meshId];
  assert.equal(hullMesh.indices.length, 12);
  close(Math.max(...hullMesh.positions), 1, 1e-12, 'mesh scaled to metres');

  const hidden = byName(r.objects, 'Hidden column');
  assert.equal(hidden.visible, false, 'object on a hidden layer is imported hidden');

  const skipped = Object.fromEntries(r.skipped.map((s) => [s.name, s.reason]));
  assert.match(skipped.Tube, /not a recognised cylinder or sphere, and the file stores no render mesh/);
  assert.match(skipped.Centreline, /curves have no volume/);
  assert.equal(r.objects.length + r.skipped.length, 9, 'every object is either imported or listed');
});

test('a file without units is refused until units are stated', async () => {
  const bytes = await singleColumn({ units: 'None' });
  const refused = importRhino(rhino, bytes, 'nounits.3dm');
  assert.equal(refused.ok, false);
  assert.equal(refused.error?.code, 'UNITS_UNKNOWN');
  assert.equal(refused.objects.length, 0);
  const ok = importRhino(rhino, bytes, 'nounits.3dm', { assumeUnits: 'Meters' });
  assert.equal(ok.ok, true);
  assert.match(ok.notes.join(' '), /Meters were assumed/);
});

test('feet are converted exactly; the still-water elevation shifts z', async () => {
  const bytes = await singleColumn({ units: 'Feet', diameter: 20, zBottom: 100, zTop: 200 });
  const r = importRhino(rhino, bytes, 'feet.3dm', { swlElevation: 45.72 }); // 150 ft
  const s = r.objects[0].shape as CylinderShape;
  close(s.diameter, 6.096, 1e-12, 'D');
  close(s.zBottom, 30.48 - 45.72, 1e-9, 'zBottom');
  close(s.zTop, 60.96 - 45.72, 1e-9, 'zTop');
});

test('vertical tolerance: 0.5 mrad tilt is snapped and reported; 2 mrad is display-only', () => {
  const build = (tilt: number) => {
    const doc = new rhino.File3dm();
    doc.settings().modelUnitSystem = rhino.UnitSystem.Meters;
    const brep = new rhino.Cylinder(new rhino.Circle([0, 0, 0], 3), 35).toBrep(true, true);
    brep.transform(rhino.Transform.rotation(tilt, [0, 1, 0], [0, 0, 0]));
    brep.transform(rhino.Transform.translationXYZ(10, 0, -20));
    doc.objects().add(brep, null);
    return importRhino(rhino, doc.toByteArray(), 'tilt.3dm');
  };
  const small = build(5e-4).objects[0];
  assert.equal(small.shape.kind, 'cylinder');
  assert.match(small.source.kind === 'rhino' ? small.source.note : '', /snapped to vertical/);
  const s = small.shape as CylinderShape;
  close(s.x, 10 + 17.5 * Math.sin(5e-4), 1e-9, 'x at the axis midpoint');
  close(s.zTop - s.zBottom, 35 * Math.cos(5e-4), 1e-9, 'vertical extent');
  assert.equal(build(2e-3).objects[0].shape.kind, 'mesh');
});

test('bytes that are not a .3dm file are rejected', () => {
  const r = importRhino(rhino, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'junk.3dm');
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, 'NOT_3DM');
});

test('the project mesh-vertex limit is enforced per import', async () => {
  const r = importRhino(rhino, await referenceModel(), 'reference.3dm', { existingMeshVertices: LIMITS.meshVerticesTotal - 3 });
  assert.ok(r.skipped.some((s) => /mesh too large/.test(s.reason)));
});

test('imported columns analyse to the same result as the same parametric columns', async () => {
  const r = importRhino(rhino, await referenceModel(), 'reference.3dm');
  const cols = ['Column A', 'Column B'].map((n) => ({ ...byName(r.objects, n), analysis: true }));
  const imported = { ...createDefaultProject(), objects: [] as SceneObject[] };
  const withCols = addObjects(imported, cols, r.meshes as Record<string, MeshData>);
  const a = runAnalysis(withCols);
  const b = runAnalysis(createDefaultProject());
  assert.equal(a.ok, true);
  close(a.global!.peakTotal, b.global!.peakTotal, 1e-9 * b.global!.peakTotal, 'peak');
});

test('a project holding imported geometry round-trips through save/load', async () => {
  const r = importRhino(rhino, await referenceModel(), 'reference.3dm');
  const p = addObjects(createDefaultProject(), r.objects, r.meshes);
  assert.deepEqual(parseProject(serializeProject(p)), p);
});
