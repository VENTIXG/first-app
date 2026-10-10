import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisInput, runAnalysis } from '../../../studio/src/core/analysis.ts';
import { addObjects, setAnalysis, updateShape } from '../../../studio/src/core/commands.ts';
import { createDefaultProject } from '../../../studio/src/core/project.ts';
import { computePlatform } from '../../../js/morison.js';
import { AppState } from '../../../js/state.js';

test('default scene gives the classic calculator default result exactly (same engine, same inputs)', () => {
  const classic = new AppState();
  const ref = computePlatform(classic.environment, classic.bodies);
  const r = runAnalysis(createDefaultProject());
  assert.equal(r.ok, true);
  assert.equal(r.global!.peakTotal, ref.global.peakTotal);
  assert.equal(r.global!.peakWind, ref.global.peakWind);
  assert.ok(Math.abs(r.global!.peakTotal / 1000 - 262.55) < 0.005);
  assert.equal(r.heave!.potentialResonance, true);
});

test('cylinder z-range maps to draft and freeboard; sphere centre to draft', () => {
  let p = createDefaultProject();
  p = updateShape(p, 'obj-column-1', { zBottom: -12.5, zTop: 3 });
  p = addObjects(p, [{
    id: 'buoy', name: 'Buoy', visible: true, analysis: true,
    shape: { kind: 'sphere', x: 0, y: 40, zCenter: 1, radius: 5 },
    source: { kind: 'parametric' },
  }]);
  const { bodies, links, issues } = analysisInput(p);
  assert.deepEqual(issues, []);
  assert.deepEqual(bodies[0], { id: 1, type: 'cylinder', x: 0, y: 0, diameter: 6, radius: 3, draft: 12.5, freeboard: 3 });
  assert.equal(bodies[2].type, 'sphere');
  assert.equal(bodies[2].draft, 4);
  assert.deepEqual(links.map((l) => l.objectId), ['obj-column-1', 'obj-column-2', 'buoy']);
});

test('geometry the engine cannot represent is reported per object and blocks results', () => {
  const dry = updateShape(createDefaultProject(), 'obj-column-1', { zBottom: 1, zTop: 5 });
  const r1 = runAnalysis(dry);
  assert.equal(r1.ok, false);
  assert.equal(r1.global, undefined);
  assert.deepEqual(r1.issues.map((i) => [i.code, i.objectId]), [['STUDIO_NOT_IN_WATER', 'obj-column-1']]);

  const sunk = updateShape(createDefaultProject(), 'obj-column-2', { zBottom: -30, zTop: -2 });
  assert.equal(runAnalysis(sunk).issues[0].code, 'STUDIO_FULLY_SUBMERGED');
});

test('engine errors are linked back to the scene object', () => {
  const deep = updateShape(createDefaultProject(), 'obj-column-2', { zBottom: -45 }); // depth 40 m
  const r = runAnalysis(deep);
  assert.equal(r.ok, false);
  const e = r.issues.find((i) => i.code === 'DRAFT_EXCEEDS_DEPTH');
  assert.equal(e?.objectId, 'obj-column-2');
});

test('objects not marked for analysis are ignored; none marked is explained', () => {
  let p = createDefaultProject();
  p = setAnalysis(setAnalysis(p, 'obj-column-1', false), 'obj-column-2', false);
  const r = runAnalysis(p);
  assert.equal(r.ok, false);
  assert.equal(r.issues[0].code, 'STUDIO_NOTHING_TO_ANALYSE');
});
