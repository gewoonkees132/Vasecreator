import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { clamp, dcos, dsin, frac, lerp, smoothstep } from '../core/math.js';

test('dsin and dcos agree with Math.sin and Math.cos to within rounding', () => {
  for (let i = -6000; i <= 6000; i++) {
    const x = i * 0.01 + 0.0037;
    assert.ok(Math.abs(dsin(x) - Math.sin(x)) <= 1e-15, `sin(${x})`);
    assert.ok(Math.abs(dcos(x) - Math.cos(x)) <= 1e-15, `cos(${x})`);
  }
  for (const x of [123.456, -987.654, 31415.9265, 99999.5]) {
    assert.ok(Math.abs(dsin(x) - Math.sin(x)) <= 1e-12, `sin(${x})`);
    assert.ok(Math.abs(dcos(x) - Math.cos(x)) <= 1e-12, `cos(${x})`);
  }
});

test('dsin and dcos keep exact values and symmetry', () => {
  assert.equal(dsin(0), 0);
  assert.equal(dcos(0), 1);
  for (const x of [0.3, 1.2, 2.9, 7.7, 41.3]) {
    assert.equal(dsin(-x), -dsin(x));
    assert.equal(dcos(-x), dcos(x));
    assert.ok(Math.abs(dsin(x) ** 2 + dcos(x) ** 2 - 1) <= 4e-16);
  }
});

test('dsin and dcos refuse angles they cannot reduce exactly', () => {
  for (const x of [1e6, -1e6, Infinity, NaN]) {
    assert.throws(() => dsin(x), RangeError);
    assert.throws(() => dcos(x), RangeError);
  }
});

test('helpers', () => {
  assert.equal(frac(2.25), 0.25);
  assert.equal(frac(-0.25), 0.75);
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(lerp(2, 4, 0.5), 3);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(smoothstep(1, 0, 0.25), smoothstep(0, 1, 0.75));
  assert.equal(smoothstep(0, 1, -3), 0);
});

test('core code avoids engine-dependent maths', () => {
  const banned = /Math\.(sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot|random)\b|\*\*/;
  const dir = new URL('../core/', import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const code = readFileSync(new URL(name, dir), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, banned, `core/${name}`);
  }
});
