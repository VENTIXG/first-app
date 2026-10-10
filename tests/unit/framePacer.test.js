import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFramePacer } from '../../js/framePacer.js';

/** Simulate `seconds` of animation frames: a rendered frame lasts renderMs, a skipped one 16.7 ms. */
function simulate(renderMs, seconds = 10) {
  const pacer = createFramePacer();
  let t = 0;
  let renders = 0;
  while (t < seconds * 1000) {
    const rendered = pacer.shouldRender(t);
    if (rendered) renders += 1;
    t += rendered ? renderMs : 16.7;
  }
  return { renders, renderTime: renders * renderMs, total: t, throttled: pacer.throttled };
}

test('with a fast GPU every frame renders (no throttling)', () => {
  const r = simulate(16.7);
  assert.equal(r.throttled, false);
  assert.ok(r.renders > 590, `${r.renders} renders in 10 s`);
});

test('with slow software rendering at least half of the time stays free for the page', () => {
  const r = simulate(90);
  assert.equal(r.throttled, true);
  assert.ok(r.renderTime / r.total < 0.55, `render share ${(r.renderTime / r.total).toFixed(2)}`);
  assert.ok(r.renders > 40, 'still animates (several frames per second)');
});

test('pauses between on-demand renders are not mistaken for slow frames', () => {
  const pacer = createFramePacer();
  assert.equal(pacer.shouldRender(0), true);
  assert.equal(pacer.shouldRender(5000), true); // 5 s later: an idle gap, not a 5 s frame
  assert.equal(pacer.throttled, false);
});
