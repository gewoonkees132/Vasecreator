// The Next and icon-first sweep (pattern studio D49, §8): no Next anywhere,
// shared icons that are decorative, and long-press labels that stay in sight.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { labelPlacement } from '../ui/press-label.js';
import { ICONS } from '../ui/icons.js';

const viewport = { width: 360 };
const box = (left, top, width = 44, height = 44) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('a long-press label sits above its button, centred on it', () => {
  const at = labelPlacement(box(150, 500), { width: 80, height: 30 }, viewport);
  assert.equal(at.below, false);
  assert.equal(at.left, 150 + 22 - 40);
  assert.equal(at.top, 500 - 30 - 8);
});

test('a long-press label goes below a button with no room above, so the finger never hides it', () => {
  // The top bar's undo on a phone: 8 px from the top of the window.
  const at = labelPlacement(box(250, 14), { width: 60, height: 30 }, viewport);
  assert.equal(at.below, true);
  assert.equal(at.top, 14 + 44 + 8);
});

test('a long-press label stays inside the window at either edge', () => {
  const left = labelPlacement(box(2, 400), { width: 160, height: 30 }, viewport);
  assert.equal(left.left, 8);
  const right = labelPlacement(box(314, 400), { width: 160, height: 30 }, viewport);
  assert.equal(right.left, 360 - 160 - 8);
  // Wider than the window: from the left margin (CSS ellipsises it).
  assert.equal(labelPlacement(box(150, 400), { width: 400, height: 30 }, viewport).left, 8);
});

test('the shared icons are decorative: the button carries the name', () => {
  assert.ok(Object.keys(ICONS).length > 0);
  for (const [name, svg] of Object.entries(ICONS)) {
    assert.match(svg, /^<svg [^>]*viewBox="0 0 24 24"/, name);
    assert.match(svg, /aria-hidden="true"/, name);
    assert.match(svg, /focusable="false"/, name);
    assert.match(svg, /<\/svg>$/, name);
  }
});

test('no Next is left: the step emblems move between steps (D49)', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir));
      else if (/\.(js|css|html)$/.test(entry.name)) files.push(new URL(entry.name, dir));
    }
  };
  walk(new URL('../ui/', import.meta.url));
  walk(new URL('../styles/', import.meta.url));
  files.push(new URL('../index.html', import.meta.url), new URL('../main.js', import.meta.url));
  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    for (const banned of [/step-next/, /dock-next/, /step-foot/, /frame\.next/, /['"`]Next[:'"`]/]) {
      assert.ok(!banned.test(code), `${file.pathname.split('/v2/')[1]} still has ${banned}`);
    }
  }
});
