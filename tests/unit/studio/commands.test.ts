import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addObjects, CommandError, duplicateObject, moveObject, removeObjects, setAnalysis, setEnvironment, updateShape,
} from '../../../studio/src/core/commands.ts';
import { createDefaultProject } from '../../../studio/src/core/project.ts';
import type { SceneObject } from '../../../studio/src/core/types.ts';

const meshObject = (id: string, meshId: string): SceneObject => ({
  id, name: id, visible: true, analysis: false,
  shape: { kind: 'mesh', meshId, dx: 0, dy: 0, dz: 0 },
  source: { kind: 'parametric' },
});
const tri = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };

test('impossible shapes are refused', () => {
  const p = createDefaultProject();
  assert.throws(() => updateShape(p, 'obj-column-1', { diameter: 0 }), CommandError);
  assert.throws(() => updateShape(p, 'obj-column-1', { zTop: -25 }), CommandError);
  assert.throws(() => updateShape(p, 'obj-column-1', { x: Number.NaN }), CommandError);
  assert.throws(() => updateShape(p, 'obj-column-1', { kind: 1 } as never), CommandError);
  assert.throws(() => updateShape(p, 'missing', { x: 1 }), CommandError);
});

test('move, duplicate and remove; mesh data is dropped with its last object', () => {
  let p = createDefaultProject();
  p = moveObject(p, 'obj-column-2', 80, 5);
  const s = p.objects[1].shape;
  assert.ok(s.kind === 'cylinder' && s.x === 80 && s.y === 5);

  p = addObjects(p, [meshObject('m1', 'mesh-a'), meshObject('m2', 'mesh-a')], { 'mesh-a': tri });
  p = moveObject(p, 'm1', 3, 4);
  const ms = p.objects.find((o) => o.id === 'm1')!.shape;
  assert.ok(ms.kind === 'mesh' && ms.dx === 3 && ms.dy === 4);

  p = duplicateObject(p, 'obj-column-1', 'copy-1', [10, 0]);
  const copy = p.objects.find((o) => o.id === 'copy-1')!;
  assert.ok(copy.shape.kind === 'cylinder' && copy.shape.x === 10);
  assert.equal(copy.name, 'Column 1 copy');

  p = removeObjects(p, ['m1']);
  assert.ok('mesh-a' in p.meshes, 'still referenced by m2');
  p = removeObjects(p, ['m2']);
  assert.equal('mesh-a' in p.meshes, false);
});

test('meshes cannot be marked for analysis', () => {
  const p = addObjects(createDefaultProject(), [meshObject('m1', 'mesh-a')], { 'mesh-a': tri });
  assert.throws(() => setAnalysis(p, 'm1', true), CommandError);
  assert.throws(() => addObjects(p, [{ ...meshObject('m2', 'mesh-a'), analysis: true }]), CommandError);
});

test('duplicate ids and missing mesh data are refused on add', () => {
  const p = createDefaultProject();
  assert.throws(() => addObjects(p, [{ ...p.objects[0] }]), CommandError);
  assert.throws(() => addObjects(p, [meshObject('m1', 'nowhere')]), CommandError);
});

test('environment edits are type-checked', () => {
  const p = createDefaultProject();
  assert.equal(setEnvironment(p, { H: 4 }), p, 'same value is a no-op');
  assert.equal(setEnvironment(p, { H: 5 }).environment.H, 5);
  assert.throws(() => setEnvironment(p, { waveTheory: 'cnoidal' } as never), CommandError);
  assert.throws(() => setEnvironment(p, { H: '5' } as never), CommandError);
});
