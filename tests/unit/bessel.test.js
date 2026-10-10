import { test } from 'node:test';
import assert from 'node:assert/strict';
import { besselJ0, besselJ1, besselY0, besselY1, besselJ1Prime, besselY1Prime } from '../../js/bessel.js';
import { BESSEL_TABLE, besselJIntegral, besselYIntegral } from '../helpers/references.js';

test('J0, J1, Y0, Y1 match A&S Table 9.1 (10 digits) to 1e-9', () => {
  for (const [x, j0, j1, y0, y1] of BESSEL_TABLE) {
    for (const [fn, ref, name] of [[besselJ0, j0, 'J0'], [besselJ1, j1, 'J1'], [besselY0, y0, 'Y0'], [besselY1, y1, 'Y1']]) {
      assert.ok(Math.abs(fn(x) - ref) < 1e-9, `${name}(${x}): ${fn(x)} vs ${ref}`);
    }
  }
});

test('agree with integral representations on both sides of the series/asymptotic switch (x = 12)', () => {
  for (const x of [0.05, 0.3, 2.5, 7.9, 11.9, 12.1, 15, 25, 40]) {
    assert.ok(Math.abs(besselJ0(x) - besselJIntegral(0, x)) < 1e-9, `J0(${x})`);
    assert.ok(Math.abs(besselJ1(x) - besselJIntegral(1, x)) < 1e-9, `J1(${x})`);
    assert.ok(Math.abs(besselY0(x) - besselYIntegral(0, x)) < 1e-8, `Y0(${x})`);
    assert.ok(Math.abs(besselY1(x) - besselYIntegral(1, x)) < 1e-8, `Y1(${x})`);
  }
});

test('Wronskian J1 Y0 - J0 Y1 = 2/(pi x) holds to 1e-10 relative', () => {
  for (const x of [0.01, 0.7, 3, 9, 12, 13, 30, 100]) {
    const W = besselJ1(x) * besselY0(x) - besselJ0(x) * besselY1(x);
    assert.ok(Math.abs(W - 2 / (Math.PI * x)) * (Math.PI * x / 2) < 1e-10, `x=${x}: ${W}`);
  }
});

test('derivative identities match central differences', () => {
  for (const x of [0.4, 3.3, 10, 20]) {
    const h = 1e-5;
    const dJ = (besselJ1(x + h) - besselJ1(x - h)) / (2 * h);
    const dY = (besselY1(x + h) - besselY1(x - h)) / (2 * h);
    assert.ok(Math.abs(besselJ1Prime(x) - dJ) < 1e-8, `J1'(${x})`);
    assert.ok(Math.abs(besselY1Prime(x) - dY) < 1e-7 * Math.max(1, Math.abs(dY)), `Y1'(${x})`);
  }
});

test('rejects non-positive or non-finite arguments', () => {
  for (const x of [0, -1, NaN, Infinity]) assert.throws(() => besselY1(x), RangeError);
});
