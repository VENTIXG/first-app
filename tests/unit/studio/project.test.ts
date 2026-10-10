import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProject, parseProject, serializeProject, ProjectError } from '../../../studio/src/core/project.ts';
import { DEFAULT_ENVIRONMENT } from '../../../js/state.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

test('default project round-trips through serialisation unchanged', () => {
  const p = createDefaultProject();
  assert.deepEqual(parseProject(serializeProject(p)), p);
  assert.deepEqual(p.environment, { ...DEFAULT_ENVIRONMENT });
});

test('unknown fields are dropped; missing environment keys take defaults', () => {
  const raw = clone(createDefaultProject()) as Record<string, any>;
  raw.extra = 1;
  raw.objects[0].extra = 'x';
  raw.objects[0].shape.extra = 2;
  delete raw.environment.H;
  const p = parseProject(raw);
  assert.equal('extra' in p, false);
  assert.equal('extra' in p.objects[0], false);
  assert.equal('extra' in p.objects[0].shape, false);
  assert.equal(p.environment.H, DEFAULT_ENVIRONMENT.H);
});

test('invalid project files are rejected with ProjectError, never half-loaded', () => {
  const bad: Array<[string, (r: Record<string, any>) => unknown]> = [
    ['not JSON', () => '{nope'],
    ['wrong format', (r) => ({ ...r, format: 'other' })],
    ['future schema', (r) => ({ ...r, schemaVersion: 3 })],
    ['mooring line to a missing anchor', (r) => ({ ...r, mooring: { system: { depth: 100, lineTypes: [], anchors: [], fairleads: [], lines: [{ id: 'L1', name: 'x', anchorId: 'A', fairleadId: 'F', lineTypeId: 't', length: 10 }] } } })],
    ['mooring negative length', (r) => ({ ...r, mooring: { system: { depth: 100, lineTypes: [], anchors: [], fairleads: [], lines: [], }, external: [0, 'x', 0] } })],
    ['duplicate id', (r) => { r.objects[1].id = r.objects[0].id; return r; }],
    ['prototype key as id', (r) => { r.objects[0].id = '__proto__'; return r; }],
    ['markup in id', (r) => { r.objects[0].id = '<img src=x>'; return r; }],
    ['top below bottom', (r) => { r.objects[0].shape.zTop = -30; return r; }],
    ['negative diameter', (r) => { r.objects[0].shape.diameter = -1; return r; }],
    ['NaN coordinate', (r) => { r.objects[0].shape.x = 'NaN'; return r; }],
    ['unknown shape', (r) => { r.objects[0].shape.kind = 'torus'; return r; }],
    ['bad environment enum', (r) => { r.environment.waveTheory = 'cnoidal'; return r; }],
    ['bad environment type', (r) => { r.environment.H = '4'; return r; }],
    ['missing mesh data', (r) => { r.objects[0].shape = { kind: 'mesh', meshId: 'mesh-1', dx: 0, dy: 0, dz: 0 }; r.objects[0].analysis = false; return r; }],
    ['analysed mesh', (r) => { r.meshes = { 'mesh-1': { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] } }; r.objects[0].shape = { kind: 'mesh', meshId: 'mesh-1', dx: 0, dy: 0, dz: 0 }; return r; }],
    ['face index out of range', (r) => { r.meshes = { 'mesh-1': { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 3] } }; return r; }],
    ['positions not triples', (r) => { r.meshes = { 'mesh-1': { positions: [0, 0], indices: [] } }; return r; }],
    ['visible not boolean', (r) => { r.objects[0].visible = 'yes'; return r; }],
  ];
  for (const [label, mutate] of bad) {
    const input = mutate(clone(createDefaultProject()) as Record<string, any>);
    assert.throws(() => parseProject(input), ProjectError, label);
  }
});

test('names are kept as plain text (markup is data, not code)', () => {
  const raw = clone(createDefaultProject()) as Record<string, any>;
  raw.objects[0].name = '<img src=x onerror=alert(1)>';
  assert.equal(parseProject(raw).objects[0].name, '<img src=x onerror=alert(1)>');
});

test('schema v1 files (before mooring) load as v2 without a mooring design', () => {
  const v1 = { ...clone(createDefaultProject()), schemaVersion: 1 } as Record<string, any>;
  delete v1.mooring;
  const p = parseProject(v1);
  assert.equal(p.schemaVersion, 2);
  assert.equal(p.mooring, undefined);
});
