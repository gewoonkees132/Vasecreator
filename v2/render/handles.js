// Profile handles drawn on the pot (design §9.1, C17).
//
// The profile lives in the vertical plane through the pot's axis that turns
// to face the camera, drawn on the screen-right side of the axis, so a point
// can be dragged from any viewing angle. Handles are DOM elements (focusable,
// big touch targets) and the curve is SVG, both inside the overlay element
// and re-projected after every render. Raw drag values go out; the caller
// applies the editing rules (moveKnot) and calls update() again.

import * as THREE from 'three';

const STYLE_ID = 'vc-profile-handles-style';
const LONG_PRESS_MS = 500;
const TAP_SLOP_PX = 6;
const DRAG_SLOP_PX = 3;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Injected once: the stylesheets belong to the UI, these rules only to this overlay.
const CSS = `
.vc-ph-root { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.vc-ph-root[hidden] { display: none; }
.vc-ph-svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.vc-ph-curve { fill: none; stroke: rgba(18,47,45,.55); stroke-width: 1.5px; stroke-linejoin: round; stroke-linecap: round; }
.vc-ph-hit { fill: none; stroke: transparent; stroke-width: 12px; stroke-linejoin: round; pointer-events: stroke; cursor: copy; touch-action: none; }
.vc-ph-handle { position: absolute; left: 0; top: 0; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
  pointer-events: auto; cursor: grab; touch-action: none; outline: none; -webkit-tap-highlight-color: transparent;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; will-change: transform; }
.vc-ph-handle[hidden] { display: none; }
.vc-ph-handle::before { content: ''; position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px;
  border-radius: 50%; background: rgb(18,47,45); box-shadow: 0 0 0 2px #fff, 0 1px 4px rgba(0,0,0,.35);
  transition: transform .12s ease, box-shadow .12s ease; }
.vc-ph-handle:hover::before { transform: scale(1.15); }
.vc-ph-handle.is-selected::before { box-shadow: 0 0 0 2px #fff, 0 0 0 4.5px #3fa66a, 0 1px 4px rgba(0,0,0,.35); }
.vc-ph-handle:focus-visible::before { box-shadow: 0 0 0 2px #fff, 0 0 0 4.5px #3fa66a, 0 0 0 8px rgba(63,166,106,.35); }
.vc-ph-handle.is-corner::before { width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 2px; transform: rotate(45deg); }
.vc-ph-handle.is-corner:hover::before { transform: rotate(45deg) scale(1.15); }
.vc-ph-handle.is-corner.is-dragging::before { transform: rotate(45deg) scale(1.2); }
.vc-ph-handle.is-dragging { cursor: grabbing; }
.vc-ph-handle.is-dragging::before { transform: scale(1.2); }
.vc-ph-remove { position: absolute; left: 0; top: 0; height: 36px; min-width: 44px; padding: 0 14px; margin-top: -18px;
  pointer-events: auto; border: 0; border-radius: 8px; background: rgb(18,47,45); color: #fff; cursor: pointer;
  font: 600 13px/1 'Inter', system-ui, sans-serif; box-shadow: 0 4px 8px rgba(0,0,0,.18); }
.vc-ph-remove[hidden] { display: none; }
@media (pointer: coarse) {
  .vc-ph-handle { width: 44px; height: 44px; margin: -22px 0 0 -22px; }
  .vc-ph-handle::before { width: 16px; height: 16px; margin: -8px 0 0 -8px; }
  .vc-ph-remove { height: 44px; margin-top: -22px; font-size: 15px; }
}
`;

let styleUsers = 0;

/**
 * @typedef {object} ProfileHandleCallbacks
 * @property {(index: number, value: { z: number, r: number }) => void} [onDrag] raw value while dragging or nudging
 * @property {() => void} [onCommit] the gesture ended (pointer up, or after each key nudge)
 * @property {(value: { z: number, r: number }) => void} [onAdd] the profile line was clicked or tapped there
 * @property {(index: number) => void} [onRemove] Delete/Backspace, or Remove after a long-press
 * @property {(index: number) => void} [onSelect] a handle was focused, clicked or touched
 */

/**
 * Draws draggable profile points and the profile curve over the 3D view.
 *
 * The overlay element must cover the canvas; it is set to
 * `pointer-events: none` so the view still orbits, and only the handles and
 * the line's hit stroke take pointer events.
 *
 * @param {import('./beads.js').BeadRenderer} renderer
 * @param {HTMLElement} overlayEl
 * @param {ProfileHandleCallbacks} callbacks
 * @returns {{ update(design: object, profileLine: Float32Array | null): void, setSelected(index: number | null): void,
 *   setVisible(visible: boolean): void, dispose(): void }}
 */
export function createProfileHandles(renderer, overlayEl, callbacks = {}) {
  const { onDrag, onCommit, onAdd, onRemove, onSelect } = callbacks;
  injectStyle();
  overlayEl.style.pointerEvents = 'none';

  const root = document.createElement('div');
  root.className = 'vc-ph-root';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'vc-ph-svg');
  svg.setAttribute('aria-hidden', 'true');
  const curve = document.createElementNS(SVG_NS, 'polyline');
  curve.setAttribute('class', 'vc-ph-curve');
  const hit = document.createElementNS(SVG_NS, 'polyline');
  hit.setAttribute('class', 'vc-ph-hit');
  svg.append(curve, hit);
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'vc-ph-remove';
  removeBtn.textContent = 'Remove';
  removeBtn.hidden = true;
  root.append(svg, removeBtn);
  overlayEl.append(root);

  /** @type {{ z: number, r: number }[]} */
  let knots = [];
  let line = null;
  let selected = -1;
  let visible = true;
  let removeIndex = -1;
  /** @type {HTMLElement[]} */
  const els = [];

  // The facing plane, refreshed on every layout: s = screen-right direction
  // in XY, n = horizontal plane normal.
  const s = new THREE.Vector3(1, 0, 0);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ray = new THREE.Ray();
  const hitPoint = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const proj = { x: 0, y: 0, behind: false };
  let offset = { x: 0, y: 0 };

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

  /** (z, r) on the facing plane under a client position, or null. */
  function profileAt(clientX, clientY) {
    renderer.rayFromClient(clientX, clientY, ray);
    if (!ray.intersectPlane(plane, hitPoint)) return null;
    return { z: hitPoint.z, r: hitPoint.x * s.x + hitPoint.y * s.y };
  }

  function toScreen(r, z) {
    renderer.worldToCanvas(tmp.set(s.x * r, s.y * r, z), proj);
    return proj;
  }

  function layout() {
    if (!visible) return;
    updatePlane();
    const cr = renderer.canvas.getBoundingClientRect();
    const or = overlayEl.getBoundingClientRect();
    offset = { x: cr.left - or.left, y: cr.top - or.top };
    for (let i = 0; i < els.length; i++) {
      const k = knots[i];
      const p = toScreen(k.r, k.z);
      els[i].hidden = p.behind;
      els[i].style.transform = `translate(${(p.x + offset.x).toFixed(1)}px, ${(p.y + offset.y).toFixed(1)}px)`;
      if (i === removeIndex) placeRemove(p.x + offset.x, p.y + offset.y);
    }
    let pts = '';
    if (line && line.length >= 4) {
      for (let i = 0; i + 1 < line.length; i += 2) {
        const p = toScreen(line[i], line[i + 1]);
        if (!p.behind) pts += `${(p.x + offset.x).toFixed(1)},${(p.y + offset.y).toFixed(1)} `;
      }
    }
    curve.setAttribute('points', pts);
    hit.setAttribute('points', pts);
  }

  function placeRemove(x, y) {
    removeBtn.style.transform = `translate(${(x + 28).toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  function showRemove(index) {
    if (index <= 0 || index >= knots.length - 1) return;   // the bottom and top points stay
    removeIndex = index;
    removeBtn.hidden = false;
    layout();
  }

  function hideRemove() {
    removeIndex = -1;
    removeBtn.hidden = true;
  }

  function label(i) {
    const k = knots[i];
    const el = els[i];
    el.setAttribute('aria-label', `Profile point ${i + 1}`);
    el.setAttribute('aria-valuetext', `${fmt(k.z)} mm high, ${fmt(k.r)} mm radius`);
    el.setAttribute('aria-valuenow', String(Math.round(k.z)));
  }

  function makeHandle(index) {
    const el = document.createElement('div');
    el.className = 'vc-ph-handle';
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-orientation', 'vertical');
    el.setAttribute('aria-description', 'Arrow keys move it by 1 mm, with Shift by 10 mm. Delete removes it.');
    el.dataset.index = String(index);
    let pointerFocus = false;
    let drag = null;
    let pressTimer = 0;

    const idx = () => Number(el.dataset.index);

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      hideRemove();
      const i = idx();
      pointerFocus = true;
      el.focus({ preventScroll: true });
      pointerFocus = false;
      onSelect?.(i);
      updatePlane();
      const at = profileAt(e.clientX, e.clientY);
      const k = knots[i];
      drag = {
        id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, longPressed: false,
        // Keep the grab offset so the point doesn't jump under the pointer.
        dz: at ? k.z - at.z : 0, dr: at ? k.r - at.r : 0,
      };
      el.setPointerCapture(e.pointerId);
      renderer.controls.enabled = false;
      if (e.pointerType !== 'mouse') {
        pressTimer = setTimeout(() => {
          if (drag && !drag.moved) {
            drag.longPressed = true;
            showRemove(i);
          }
        }, LONG_PRESS_MS);
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved) {
        if (drag.longPressed || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_SLOP_PX) return;
        drag.moved = true;
        clearTimeout(pressTimer);
        el.classList.add('is-dragging');
      }
      const at = profileAt(e.clientX, e.clientY);
      if (!at) return;
      const value = { z: at.z + drag.dz, r: at.r + drag.dr };
      const i = idx();
      knots[i] = value;     // follow the pointer until the caller's update() lands
      onDrag?.(i, value);
      layout();
    });

    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      clearTimeout(pressTimer);
      const wasDrag = drag.moved;
      drag = null;
      el.classList.remove('is-dragging');
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
      renderer.controls.enabled = true;
      if (wasDrag || e.type === 'pointerup') onCommit?.();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);

    el.addEventListener('contextmenu', (e) => {
      // A long-press on touch would open the browser menu; right-click offers Remove too.
      e.preventDefault();
      showRemove(idx());
    });

    el.addEventListener('focus', () => {
      if (!pointerFocus) onSelect?.(idx());
    });

    el.addEventListener('keydown', (e) => {
      const i = idx();
      const step = e.shiftKey ? 10 : 1;
      let dz = 0, dr = 0;
      switch (e.key) {
        case 'ArrowUp': dz = step; break;
        case 'ArrowDown': dz = -step; break;
        case 'ArrowRight': dr = step; break;
        case 'ArrowLeft': dr = -step; break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          onRemove?.(i);
          return;
        case 'Enter':
        case ' ':
          e.preventDefault();
          onSelect?.(i);
          return;
        case 'Escape':
          hideRemove();
          return;
        default:
          return;
      }
      e.preventDefault();
      const k = knots[i];
      const value = { z: k.z + dz, r: k.r + dr };
      knots[i] = value;     // so fast key repeats add up before update() lands
      onDrag?.(i, value);
      onCommit?.();
      layout();
    });

    return el;
  }

  // Click or tap on the line (not a drag) adds a point there.
  let linePress = null;
  hit.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.stopPropagation();
    hideRemove();
    linePress = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  hit.addEventListener('pointerup', (e) => {
    const p = linePress;
    linePress = null;
    if (!p || p.id !== e.pointerId || Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP_PX) return;
    updatePlane();
    const at = profileAt(e.clientX, e.clientY);
    if (at) onAdd?.(at);
  });

  removeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  removeBtn.addEventListener('click', () => {
    const i = removeIndex;
    hideRemove();
    if (i >= 0) onRemove?.(i);
  });

  const onDocPointerDown = (e) => {
    if (removeIndex >= 0 && e.target !== removeBtn && !els.includes(e.target)) hideRemove();
  };
  document.addEventListener('pointerdown', onDocPointerDown, true);

  const unsubscribe = renderer.onAfterRender(layout);

  return {
    /**
     * New design or profile curve: re-labels and re-places the handles.
     * @param {{ form?: { profile?: { knots?: { z: number, r: number }[] } } }} design
     * @param {Float32Array | null} profileLine r,z pairs
     */
    update(design, profileLine) {
      const ks = design?.form?.profile?.knots || [];
      if (ks.length !== knots.length) hideRemove();
      knots = ks.map((k) => ({ z: +k.z || 0, r: +k.r || 0 }));
      // A diamond marks a corner in the curve: every inner point of an
      // Angular curve, and a sharp point on a Smooth or Gentle one.
      const angular = design?.form?.profile?.interp === 'linear';
      const corner = ks.map((k, i) => i > 0 && i < ks.length - 1 && (angular || k.sharp === true));
      line = profileLine || null;
      const focusedIndex = els.indexOf(document.activeElement);
      while (els.length > knots.length) els.pop().remove();
      while (els.length < knots.length) {
        const el = makeHandle(els.length);
        els.push(el);
        root.insertBefore(el, removeBtn);
      }
      for (let i = 0; i < els.length; i++) {
        label(i);
        els[i].classList.toggle('is-selected', i === selected);
        els[i].classList.toggle('is-corner', corner[i]);
      }
      // A removed last point took the focus with it; hand it to its neighbour.
      if (focusedIndex >= els.length && els.length) els[els.length - 1].focus({ preventScroll: true });
      layout();
    },

    /** @param {number | null} index the ringed handle, or null / -1 for none */
    setSelected(index) {
      selected = index == null ? -1 : index;
      els.forEach((el, i) => el.classList.toggle('is-selected', i === selected));
    },

    /** @param {boolean} on false hides everything (Prepare print) */
    setVisible(on) {
      visible = !!on;
      root.hidden = !visible;
      if (!visible) hideRemove();
      else layout();
    },

    dispose() {
      unsubscribe();
      document.removeEventListener('pointerdown', onDocPointerDown, true);
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

/** Whole millimetres where it's whole, else one decimal. */
function fmt(v) {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
