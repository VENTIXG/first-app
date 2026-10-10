import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandError } from '../../../studio/src/core/commands.ts';
import { createDefaultProject, parseProject, serializeProject } from '../../../studio/src/core/project.ts';
import {
  addLine, DEFAULT_SPREAD, generateSpread, removeLine, removeMooring, setCriteria, setMooringLoad, updateAnchor, updateLine, updateLineType,
} from '../../../studio/src/core/mooringCommands.ts';
import { runMooringAnalysis } from '../../../studio/src/core/mooring/run.ts';

const spread = () => generateSpread({ ...createDefaultProject(), environment: { ...createDefaultProject().environment, h: 100 } }, DEFAULT_SPREAD);

test('generateSpread builds a valid, saveable design with the requested neutral pretension', () => {
  const p = spread();
  const m = p.mooring!;
  assert.equal(m.system.lines.length, 3);
  assert.ok(m.system.anchors.every((a) => a.z === -100));
  assert.deepEqual(parseProject(serializeProject(p)), p);
  const r = runMooringAnalysis(m, 100)!;
  assert.equal(r.ok, true, r.status);
  for (const l of r.lines) assert.ok(Math.abs(l.TF - DEFAULT_SPREAD.pretension) / DEFAULT_SPREAD.pretension < 1e-4);
});

test('impossible spreads are refused with CommandError', () => {
  const base = createDefaultProject();
  for (const bad of [
    { count: 0 }, { count: 2.5 }, { anchorRadius: 10, fairleadRadius: 20 }, { fairleadZ: 5 }, { fairleadZ: -base.environment.h - 1 },
    { material: 'cheese' }, { diameter: -0.1 }, { pretension: 0 },
  ]) {
    assert.throws(() => generateSpread(base, { ...DEFAULT_SPREAD, ...bad }), CommandError, JSON.stringify(bad));
  }
});

test('line, anchor and line-type edits are validated; unchanged edits are a no-op', () => {
  const p = spread();
  assert.equal(updateLine(p, 'L1', { length: p.mooring!.system.lines[0].length }), p);
  assert.throws(() => updateLine(p, 'L1', { length: -5 }), CommandError);
  assert.throws(() => updateLine(p, 'nope', { length: 5 }), CommandError);
  assert.throws(() => updateLine(p, 'L1', { lineTypeId: 'missing' }), CommandError);
  const failed = updateLine(p, 'L2', { failed: true });
  assert.equal(failed.mooring!.system.lines[1].failed, true);
  assert.equal('failed' in updateLine(failed, 'L2', { failed: false }).mooring!.system.lines[1], false);
  assert.throws(() => updateAnchor(p, 'A1', { type: 'magic' as never }), CommandError);
  const t = p.mooring!.system.lineTypes[0];
  const edited = updateLineType(p, t.id, { MBL: 2 * t.MBL }).mooring!.system.lineTypes[0];
  assert.equal(edited.material, 'custom');
  assert.equal(edited.source, 'User-defined values');
  assert.throws(() => updateLineType(p, t.id, { EA: 0 }), CommandError);
});

test('add and remove lines keep anchors and fairleads consistent', () => {
  const p = addLine(spread(), 45);
  const s = p.mooring!.system;
  assert.equal(s.lines.length, 4);
  assert.equal(s.anchors.length, 4);
  const added = s.lines[3];
  assert.equal(added.length, s.lines[0].length);
  const a = s.anchors.find((x) => x.id === added.anchorId)!;
  assert.ok(Math.abs(Math.atan2(a.y, a.x) - Math.PI / 4) < 1e-9);
  const q = removeLine(p, added.id).mooring!.system;
  assert.equal(q.lines.length, 3);
  assert.equal(q.anchors.length, 3);
  assert.equal(q.fairleads.length, 3);
  assert.equal(removeMooring(p).mooring, undefined);
});

test('load case and criteria edits', () => {
  const p = setMooringLoad(spread(), [1e5, 0, 0]);
  assert.deepEqual(p.mooring!.external, [1e5, 0, 0]);
  assert.throws(() => setMooringLoad(p, [Number.NaN, 0, 0]), CommandError);
  assert.equal(setCriteria(p, { maxOffset: 20 }).mooring!.criteria.maxOffset, 20);
  assert.equal('maxOffset' in setCriteria(setCriteria(p, { maxOffset: 20 }), { maxOffset: null }).mooring!.criteria, false);
  assert.throws(() => setCriteria(p, { intactSF: 0.5 }), CommandError);
});
