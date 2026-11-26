// Painting on the pot (D85–D87, docs/design/v2-paint-brush.md): the pointer
// handling of Paint mode. A press that starts on the pot paints; one that
// starts beside it, a second finger, the wheel and the other mouse buttons
// turn, zoom and move the view as always (OrbitControls).
//
// The listeners sit on the canvas' parent in the capture phase, so they hear
// a press before OrbitControls does and can keep a painting press from it.
// When a second finger lands during a stroke, the stroke is taken back and
// the first finger is handed to OrbitControls as if it had just come down,
// so the two fingers turn and zoom (as in the 2D editor, D57).
//
// The brush maths is core/paint.js; this module finds the spot on the wall
// (renderer.pickWall) and feeds the stroke once a frame.

import { brushRadii, createStroke, maxBrushMm } from '../core/paint.js';

/**
 * @param {import('./beads.js').BeadRenderer} renderer
 * @param {{
 *   active(): boolean,
 *   brush(): { stroke: string, more: boolean, sizeMm: number, soft: number, strength: number },
 *   wall(): { before: Uint8Array | null, heightMm: number, perimeterAt(v: number): number },
 *   onStroke(cells: Uint8Array): void,
 *   onEnd(): void,
 *   onCancel(before: Uint8Array | null): void,
 * }} hooks  active: Paint mode is on and set to Paint; onStroke: the overlay
 *   while the pointer is down, at most once a frame; onEnd: the pointer
 *   lifted; onCancel: the stroke is taken back, to the overlay it began with
 * @returns {{ painting: boolean, refresh(): void, dispose(): void }}
 */
export function createPaintInput(renderer, hooks) {
  const canvas = renderer.canvas;
  const host = canvas.parentElement || canvas;
  /** @type {null | { id: number, s: ReturnType<typeof createStroke>, before: Uint8Array | null, x: number, y: number, hit: object | null }} */
  let stroke = null;
  let frame = 0;
  let hover = null;
  const touches = new Set();

  function showMark(hit) {
    const brush = hooks.brush();
    if (!hit || !hooks.active() || brush.stroke === 'fade') {
      renderer.setBrushMark(null);
      return;
    }
    const wall = hooks.wall();
    const size = Math.min(brush.sizeMm, maxBrushMm(wall.heightMm));
    const { ru, rv } = brushRadii(size, wall.perimeterAt(hit.v), wall.heightMm);
    renderer.setBrushMark({ u: hit.u, v: hit.v, ru, rv, band: brush.stroke === 'around' });
  }

  function flush() {
    frame = 0;
    if (stroke) hooks.onStroke(stroke.s.cells());
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(flush); };

  function release() {
    const s = stroke;
    stroke = null;
    cancelAnimationFrame(frame);
    frame = 0;
    try { if (s) canvas.releasePointerCapture(s.id); } catch { /* already gone */ }
    return s;
  }

  // Takes the stroke back; `handOver` gives its finger to OrbitControls.
  function takeBack(handOver) {
    const s = release();
    if (!s) return;
    hooks.onCancel(s.before);
    renderer.setBrushMark(null);
    if (handOver) {
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: s.id, pointerType: 'touch', isPrimary: true, clientX: s.x, clientY: s.y,
        button: 0, buttons: 1, bubbles: true, cancelable: true,
      }));
    }
  }

  function onDown(e) {
    if (!e.isTrusted || e.target !== canvas) return;
    if (e.pointerType === 'touch') touches.add(e.pointerId);
    if (stroke) {
      if (e.pointerId !== stroke.id) takeBack(e.pointerType === 'touch');
      return;
    }
    if (!hooks.active()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch' && touches.size > 1) return;
    // With a modifier the left button moves the view (OrbitControls).
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const hit = renderer.pickWall(e.clientX, e.clientY);
    if (!hit) return;
    e.stopPropagation();
    e.preventDefault();
    const wall = hooks.wall();
    stroke = { id: e.pointerId, s: createStroke(hooks.brush(), wall), before: wall.before, x: e.clientX, y: e.clientY, hit };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    stroke.s.to(hit.u, hit.v);
    showMark(hit);
    schedule();
  }

  function onMove(e) {
    if (!stroke) {
      if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
      hover = e.target === canvas && hooks.active() ? { x: e.clientX, y: e.clientY } : null;
      showMark(hover ? renderer.pickWall(hover.x, hover.y) : null);
      return;
    }
    if (e.pointerId !== stroke.id) return;
    e.stopPropagation();
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      const hit = renderer.pickWall(ev.clientX, ev.clientY);
      if (hit) {
        stroke.s.to(hit.u, hit.v);
        stroke.hit = hit;
      } else {
        stroke.s.lift();
      }
    }
    stroke.x = e.clientX;
    stroke.y = e.clientY;
    showMark(stroke.hit);
    schedule();
  }

  function onUp(e) {
    touches.delete(e.pointerId);
    if (!stroke || e.pointerId !== stroke.id) return;
    e.stopPropagation();
    const s = release();
    hooks.onStroke(s.s.cells());
    hooks.onEnd();
    if (e.pointerType !== 'mouse') renderer.setBrushMark(null);
  }

  function onCancel(e) {
    touches.delete(e.pointerId);
    if (stroke && e.pointerId === stroke.id) takeBack(false);
  }

  function onLeave() {
    hover = null;
    if (!stroke) renderer.setBrushMark(null);
  }

  host.addEventListener('pointerdown', onDown, true);
  host.addEventListener('pointermove', onMove, true);
  host.addEventListener('pointerup', onUp, true);
  host.addEventListener('pointercancel', onCancel, true);
  canvas.addEventListener('pointerleave', onLeave);

  return {
    get painting() { return !!stroke; },
    /** The mode or the brush changed: redraw the brush mark, or take a stroke back when painting stopped. */
    refresh() {
      if (stroke && !hooks.active()) takeBack(false);
      if (!stroke) showMark(hover && hooks.active() ? renderer.pickWall(hover.x, hover.y) : null);
    },
    dispose() {
      takeBack(false);
      host.removeEventListener('pointerdown', onDown, true);
      host.removeEventListener('pointermove', onMove, true);
      host.removeEventListener('pointerup', onUp, true);
      host.removeEventListener('pointercancel', onCancel, true);
      canvas.removeEventListener('pointerleave', onLeave);
    },
  };
}
