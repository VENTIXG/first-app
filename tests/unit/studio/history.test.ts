import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commit, createHistory, HISTORY_LIMIT, redo, redoLabel, undo, undoLabel } from '../../../studio/src/core/history.ts';
import { moveObject, renameObject } from '../../../studio/src/core/commands.ts';
import { createDefaultProject } from '../../../studio/src/core/project.ts';

test('undo and redo walk the edit sequence exactly', () => {
  const p0 = createDefaultProject();
  let h = createHistory(p0);
  const p1 = moveObject(p0, 'obj-column-1', 5, 0);
  h = commit(h, 'Move Column 1', p1);
  const p2 = renameObject(p1, 'obj-column-2', 'Aft');
  h = commit(h, 'Rename', p2);
  assert.equal(undoLabel(h), 'Rename');
  h = undo(h);
  assert.equal(h.present, p1);
  assert.equal(redoLabel(h), 'Rename');
  h = undo(h);
  assert.equal(h.present, p0);
  assert.equal(undo(h), h, 'undo at the start is a no-op');
  h = redo(redo(h));
  assert.equal(h.present, p2);
  assert.equal(redo(h), h, 'redo at the end is a no-op');
});

test('a new edit after undo discards the redo branch', () => {
  const p0 = createDefaultProject();
  let h = commit(createHistory(p0), 'a', moveObject(p0, 'obj-column-1', 1, 0));
  h = undo(h);
  h = commit(h, 'b', moveObject(p0, 'obj-column-1', 2, 0));
  assert.equal(h.future.length, 0);
  assert.equal(h.past.length, 1);
});

test('no-op edits add no history entry', () => {
  const p0 = createDefaultProject();
  const h = createHistory(p0);
  assert.equal(commit(h, 'nothing', moveObject(p0, 'obj-column-1', 0, 0)), h);
});

test('history is bounded', () => {
  let p = createDefaultProject();
  let h = createHistory(p);
  for (let i = 1; i <= HISTORY_LIMIT + 25; i++) {
    p = moveObject(p, 'obj-column-1', i, 0);
    h = commit(h, `move ${i}`, p);
  }
  assert.equal(h.past.length, HISTORY_LIMIT);
});

test('edits share unchanged objects between states (cheap undo)', () => {
  const p0 = createDefaultProject();
  const p1 = moveObject(p0, 'obj-column-1', 7, 0);
  assert.equal(p1.objects[1], p0.objects[1]);
  assert.notEqual(p1.objects[0], p0.objects[0]);
  assert.equal(p1.meshes, p0.meshes);
});
