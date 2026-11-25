// Handles on the pot (mobile stage M7, M8; pattern studio D41):
//
//   detail   Shape: a dark bracket beside the wall from the Detailed morph's
//            From to its To (form.detail), with a handle at each end, dragged
//            up and down. It sits on the screen-left side, clear of the
//            profile handles on the right.
//   pattern  the Pattern step: the same bracket in blue for the Pattern's own
//            From / To (design.pattern), on the screen-right side.
//   seam     the Layers & seam step: a grip at the top of the seam line,
//            dragged around the pot to turn the seam angle.
//
// Like render/handles.js these are DOM elements over the canvas (focusable,
// 44 px touch targets), re-placed after every render. Raw values go out; the
// caller applies them to the design and calls update() again. One finger on
// the empty canvas still turns the pot: only the handles take pointer events.

import * as THREE from 'three';

const STYLE_ID = 'vc-gizmos-style';
const SVG_NS = 'http://www.w3.org/2000/svg';
const GAP_MM = 6;

const CSS = `
.vc-gz-root { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.vc-gz-root[hidden] { display: none; }
.vc-gz-svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.vc-gz-bracket { fill: none; stroke: rgb(26,47,48); stroke-width: 2px; stroke-dasharray: 5 4; stroke-linecap: round; stroke-linejoin: round; opacity: .8; }
.vc-gz-tick { fill: none; stroke: rgb(26,47,48); stroke-width: 2px; stroke-linecap: round; opacity: .8; }
.vc-gz-handle { position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 4px; height: 24px; padding: 0 9px 0 7px;
  border-radius: 12px; background: rgb(26,47,48); color: #fff; box-shadow: 0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,.25);
  font: 600 11px/1 'Inter', system-ui, sans-serif; white-space: nowrap; pointer-events: auto; cursor: ns-resize; touch-action: none;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; outline: none;
  will-change: transform; transition: background-color .12s ease, opacity .12s ease; }
.vc-gz-handle[hidden] { display: none; }
.vc-gz-handle::after { content: ''; position: absolute; inset: -10px -6px; }
.vc-gz-handle svg { width: 10px; height: 10px; flex: none; }
.vc-gz-handle:hover, .vc-gz-handle.is-dragging { background: rgb(44,76,78); }
.vc-gz-handle:focus-visible { box-shadow: 0 0 0 2px #fff, 0 0 0 4.5px #3fa66a, 0 2px 6px rgba(0,0,0,.25); }
.vc-gz-handle.is-dragging { box-shadow: 0 0 0 2px #fff, 0 0 0 4.5px #3fa66a, 0 4px 10px rgba(0,0,0,.3); }
.vc-gz-seam { cursor: ew-resize; }
.vc-gz-root.is-pattern .vc-gz-bracket, .vc-gz-root.is-pattern .vc-gz-tick { stroke: rgb(37,99,170); opacity: .9; }
.vc-gz-root.is-pattern .vc-gz-from, .vc-gz-root.is-pattern .vc-gz-to { background: rgb(37,99,170); }
.vc-gz-root.is-pattern .vc-gz-from:hover, .vc-gz-root.is-pattern .vc-gz-to:hover,
.vc-gz-root.is-pattern .vc-gz-from.is-dragging, .vc-gz-root.is-pattern .vc-gz-to.is-dragging { background: rgb(28,80,142); }
.vc-gz-seam.is-behind:not(.is-dragging) { opacity: .55; }
@media (pointer: coarse) {
  .vc-gz-handle { height: 30px; padding: 0 12px 0 10px; border-radius: 15px; font-size: 13px; }
  .vc-gz-handle::after { inset: -8px -6px; }
}
`;

const ARROWS_V = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1L2.2 4h5.6zM5 9L2.2 6h5.6z" fill="currentColor"/></svg>';
const ARROWS_H = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5l3-2.8v5.6zM9 5L6 2.2v5.6z" fill="currentColor"/></svg>';

let styleUsers = 0;

/**
 * @param {import('./beads.js').BeadRenderer} renderer
 * @param {HTMLElement} overlayEl  the overlay over the canvas (shared with handles.js)
 * @param {{ onRange?(target: 'detail' | 'pattern', which: 'from' | 'to', zMm: number): void, onSeam?(angleDeg: number): void, onCommit?(): void }} callbacks
 * @returns {{ setMode(mode: 'detail' | 'pattern' | 'seam' | null): void, update(design: object, result: object | null): void, dispose(): void }}
 */
export function createGizmos(renderer, overlayEl, { onRange, onSeam, onCommit } = {}) {
  injectStyle();
  const root = document.createElement('div');
  root.className = 'vc-gz-root';
  root.hidden = true;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'vc-gz-svg');
  svg.setAttribute('aria-hidden', 'true');
  const bracket = document.createElementNS(SVG_NS, 'polyline');
  bracket.setAttribute('class', 'vc-gz-bracket');
  const ticks = document.createElementNS(SVG_NS, 'path');
  ticks.setAttribute('class', 'vc-gz-tick');
  svg.append(bracket, ticks);
  root.append(svg);
  overlayEl.append(root);

  let mode = null;
  let design = null;
  let result = null;
  /** The drag in progress: the handle being dragged and its start. */
  let drag = null;
  // While a handle is dragged it follows the pointer until the caller's update lands.
  const live = { from: null, to: null, seam: null };

  const s = new THREE.Vector3(1, 0, 0);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const flat = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const proj = { x: 0, y: 0, behind: false };
  let offset = { x: 0, y: 0 };

  // ---------- Handles ----------

  function makeHandle(cls, text, icon, label) {
    const el = document.createElement('div');
    el.className = `vc-gz-handle ${cls}`;
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', label);
    el.innerHTML = icon;
    el.append(document.createTextNode(text));
    root.append(el);
    return el;
  }
  const fromEl = makeHandle('vc-gz-from', 'From', ARROWS_V, 'Starts at');
  const toEl = makeHandle('vc-gz-to', 'To', ARROWS_V, 'Ends at');
  const seamEl = makeHandle('vc-gz-seam', 'Seam', ARROWS_H, 'Seam angle');
  for (const el of [fromEl, toEl]) {
    el.setAttribute('aria-orientation', 'vertical');
    el.setAttribute('aria-description', 'Arrow keys move it by 1 mm, with Shift by 10 mm.');
  }
  seamEl.setAttribute('aria-description', 'Arrow keys turn it by 1°, with Shift by 15°.');

  function updatePlane() {
    const cam = renderer.camera;
    cam.updateMatrixWorld();
    s.setFromMatrixColumn(cam.matrixWorld, 0);
    s.z = 0;
    if (s.lengthSq() < 1e-10) s.set(1, 0, 0);
    s.normalize();
    plane.normal.set(-s.y, s.x, 0);
    plane.constant = 0;
  }

  /** z on the facing plane under a client position, or null. */
  function zAt(clientX, clientY) {
    renderer.rayFromClient(clientX, clientY, ray);
    return ray.intersectPlane(plane, hit) ? hit.z : null;
  }

  /** The angle (degrees) around the axis under a client position, on the plane at height z, or null. */
  function angleAt(clientX, clientY, z, reach) {
    renderer.rayFromClient(clientX, clientY, ray);
    flat.constant = -z;
    if (!ray.intersectPlane(flat, hit)) return null;
    // A grazing view hits the plane far away, where the angle jumps about.
    if (Math.hypot(hit.x, hit.y) > reach) return null;
    return THREE.MathUtils.radToDeg(Math.atan2(hit.y, hit.x));
  }

  function toScreen(x, y, z) {
    renderer.worldToCanvas(tmp.set(x, y, z), proj);
    return { x: proj.x + offset.x, y: proj.y + offset.y, behind: proj.behind };
  }

  // ---------- The pattern range ----------

  /** The profile radius at z, from the preview's profile line. */
  function radiusAt(z) {
    const line = result?.profileLine;
    if (!line || line.length < 4) return 0;
    if (z <= line[1]) return line[0];
    for (let i = 2; i + 1 < line.length; i += 2) {
      const z1 = line[i + 1];
      if (z <= z1) {
        const z0 = line[i - 1];
        const t = z1 > z0 ? (z - z0) / (z1 - z0) : 0;
        return line[i - 2] + (line[i] - line[i - 2]) * t;
      }
    }
    return line[line.length - 2];
  }

  /** How far out the wall reaches on the facing side, per mm of profile radius. */
  function silhouetteFactor() {
    const plan = design.form.plan;
    const ratio = plan.depthRatio ?? 1;
    if (plan.footprint === 'rectangle') {
      // A twisted rectangle turns its corners towards you somewhere up the wall.
      return design.form.twist?.degrees ? Math.hypot(1, ratio) : Math.abs(s.x) + ratio * Math.abs(s.y);
    }
    return Math.hypot(s.x, ratio * s.y);
  }

  const isRange = () => mode === 'detail' || mode === 'pattern';
  /** The range the bracket edits: the Detailed morph's or the Pattern's. */
  const rangeOf = () => (mode === 'pattern' ? design.pattern : design.form.detail);

  function rangeValues() {
    const r = rangeOf();
    return { from: live.from ?? r.fromMm, to: live.to ?? r.toMm };
  }

  function layoutRange() {
    const { from, to } = rangeValues();
    const k = silhouetteFactor();
    const sf = design.form.detail;
    const outward = Math.max(sf.a?.depthMm ?? 0, sf.b?.depthMm ?? 0) + (design.form.morph?.map ? (design.form.morph.strengthMm ?? 0) : 0)
      + (design.pattern?.depthMm ?? 0) + design.layers.beadWidthMm / 2 + GAP_MM;
    // The Detailed morph's on the screen-left side, the Pattern's on the right.
    const side = mode === 'pattern' ? 1 : -1;
    const at = (z) => {
      const r = (radiusAt(z) * k + outward) * side;
      return toScreen(s.x * r, s.y * r, z);
    };
    let pts = '';
    const n = Math.max(2, Math.ceil((to - from) / 3));
    for (let i = 0; i <= n; i++) {
      const p = at(from + ((to - from) * i) / n);
      if (!p.behind) pts += `${p.x.toFixed(1)},${p.y.toFixed(1)} `;
    }
    bracket.setAttribute('points', pts);
    const pf = at(from);
    const pt = at(to);
    // Short ticks towards the pot at both ends.
    const tick = side > 0 ? 'h-8' : 'h8';
    ticks.setAttribute('d', `M${pf.x.toFixed(1)},${pf.y.toFixed(1)}${tick}M${pt.x.toFixed(1)},${pt.y.toFixed(1)}${tick}`);
    const how = side > 0 ? 'right' : 'left';
    place(fromEl, pf, how);
    place(toEl, pt, how);
    label(fromEl, from, 'mm');
    label(toEl, to, 'mm');
  }

  // ---------- The seam grip ----------

  function seamTop() {
    const line = result?.seamLine;
    if (!line || line.length < 3) return null;
    const i = line.length - 3;
    const x = line[i], y = line[i + 1];
    const len = Math.hypot(x, y) || 1;
    const push = design.layers.beadWidthMm / 2 + GAP_MM;
    return { x: x + (x / len) * push, y: y + (y / len) * push, z: line[i + 2], r: len };
  }

  function layoutSeam() {
    const top = seamTop();
    if (!top) { seamEl.hidden = true; return; }
    const p = toScreen(top.x, top.y, top.z);
    seamEl.hidden = p.behind;
    place(seamEl, p, 'above');
    // Facing away from the camera: on the far side of the pot.
    const cam = renderer.camera.position;
    const toCam = Math.atan2(cam.y, cam.x);
    const at = Math.atan2(top.y, top.x);
    seamEl.classList.toggle('is-behind', Math.cos(at - toCam) < 0);
    label(seamEl, live.seam ?? design.layers.seam.angleDeg, '°');
  }

  // Handles stay inside the free region the pot is fitted in, so they never
  // slide under the panels or the history column; where the pot fills the
  // region (a phone), a handle moves in over the pot's edge instead.
  function place(el, p, how) {
    el.hidden = p.behind;
    const w = el.offsetWidth || 50;
    const hgt = el.offsetHeight || 24;
    // right: beside the point, away from the pot; left: the same on the other side; above: over it.
    let x = how === 'right' ? p.x + 4 : how === 'left' ? p.x - w - 4 : p.x - w / 2;
    let y = how === 'above' ? p.y - hgt - 8 : p.y - hgt / 2;
    const reg = renderer.region;
    if (reg) {
      const left = reg.x + offset.x;
      const top = reg.y + offset.y;
      x = Math.max(left, Math.min(x, left + reg.width - w));
      y = Math.max(top, Math.min(y, top + reg.height - hgt));
    }
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  function label(el, v, unit) {
    const r = Math.round(v);
    if (el.getAttribute('aria-valuenow') === String(r)) return;
    el.setAttribute('aria-valuenow', String(r));
    el.setAttribute('aria-valuetext', `${r}${unit === '°' ? '°' : ` ${unit}`}`);
  }

  function layout() {
    if (!mode || !design || !result) return;
    updatePlane();
    const cr = renderer.canvas.getBoundingClientRect();
    const or = overlayEl.getBoundingClientRect();
    offset = { x: cr.left - or.left, y: cr.top - or.top };
    if (isRange()) layoutRange();
    else if (mode === 'seam') layoutSeam();
  }

  // ---------- Dragging ----------

  function startDrag(el, e, kind) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    el.focus({ preventScroll: true });
    updatePlane();
    el.setPointerCapture(e.pointerId);
    renderer.controls.enabled = false;
    el.classList.add('is-dragging');
    if (kind === 'seam') {
      const top = seamTop();
      const reach = Math.max(50, (top?.r ?? 100) * 20);
      drag = { kind, el, id: e.pointerId, z: top?.z ?? 0, reach, start: angleAt(e.clientX, e.clientY, top?.z ?? 0, reach), angle: design.layers.seam.angleDeg, moved: false };
    } else {
      const z = zAt(e.clientX, e.clientY);
      const value = rangeValues()[kind];
      drag = { kind, el, id: e.pointerId, dz: z == null ? 0 : value - z, moved: false };
    }
  }

  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.kind === 'seam') {
      const a = angleAt(e.clientX, e.clientY, drag.z, drag.reach);
      if (a == null) return;
      if (drag.start == null) { drag.start = a; return; }
      let delta = a - drag.start;
      delta -= 360 * Math.round(delta / 360);
      // Unwrap as it goes round, so a full turn keeps adding up.
      drag.angle += delta;
      drag.start = a;
      drag.moved = true;
      const v = ((Math.round(drag.angle) % 360) + 360) % 360;
      live.seam = v;
      onSeam?.(v);
    } else {
      const z = zAt(e.clientX, e.clientY);
      if (z == null) return;
      const v = z + drag.dz;
      drag.moved = true;
      live[drag.kind] = clampRange(drag.kind, v);
      onRange?.(mode, drag.kind, live[drag.kind]);
    }
    layout();
  }

  function clampRange(kind, v) {
    const sf = rangeOf();
    const step = design.layers.layerHeightMm;
    const lo = kind === 'from' ? 0 : (live.from ?? sf.fromMm) + step;
    const hi = kind === 'from' ? (live.to ?? sf.toMm) - step : design.form.height;
    return Math.round(Math.min(hi, Math.max(lo, v)) * 2) / 2;
  }

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { el, moved } = drag;
    drag = null;
    el.classList.remove('is-dragging');
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    renderer.controls.enabled = true;
    live.from = live.to = live.seam = null;
    if (moved) onCommit?.();
    layout();
  }

  for (const [el, kind] of [[fromEl, 'from'], [toEl, 'to'], [seamEl, 'seam']]) {
    el.addEventListener('pointerdown', (e) => startDrag(el, e, kind));
    el.addEventListener('pointermove', moveDrag);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('lostpointercapture', endDrag);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('keydown', (e) => {
      const big = e.shiftKey;
      if (kind === 'seam') {
        const n = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (!n) return;
        e.preventDefault();
        const v = (((Math.round(design.layers.seam.angleDeg + n * (big ? 15 : 1))) % 360) + 360) % 360;
        onSeam?.(v);
        onCommit?.();
        return;
      }
      const n = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (!n) return;
      e.preventDefault();
      const v = clampRange(kind, rangeValues()[kind] + n * (big ? 10 : 1));
      onRange?.(mode, kind, v);
      onCommit?.();
    });
  }

  const unsubscribe = renderer.onAfterRender(layout);

  function show() {
    const on = !!mode && !!design && !!result && (!isRange() || !!rangeOf());
    root.hidden = !on;
    const range = on && isRange();
    root.classList.toggle('is-pattern', mode === 'pattern');
    const what = mode === 'pattern' ? 'Pattern' : 'Detailed morph';
    fromEl.setAttribute('aria-label', `${what} starts at`);
    toEl.setAttribute('aria-label', `${what} ends at`);
    fromEl.hidden = toEl.hidden = !range;
    bracket.style.display = ticks.style.display = range ? '' : 'none';
    seamEl.hidden = !(on && mode === 'seam');
    if (on) layout();
  }

  return {
    /** 'detail' (Shape, with a Detailed morph), 'pattern' (Pattern, with a Pattern), 'seam' (Layers & seam) or null. */
    setMode(next) {
      if (next === mode) return;
      if (drag) endDrag({ pointerId: drag.id });
      mode = next;
      show();
    },
    /** The design and the preview it belongs to. */
    update(nextDesign, nextResult) {
      design = nextDesign;
      result = nextResult;
      show();
    },
    dispose() {
      unsubscribe();
      root.remove();
      renderer.controls.enabled = true;
      if (--styleUsers === 0) document.getElementById(STYLE_ID)?.remove();
    },
  };
}

function injectStyle() {
  styleUsers++;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}
