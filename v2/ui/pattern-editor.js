// The 2D editor (D45, D46, docs/design/v2-pattern-studio.md §6): one editor
// for both kinds of surface detail. It edits one tile of a bitmap, shown in
// full colour with its repeats dimmed around it, at the cells' true
// proportions:
//   the Pattern     crisp, one cell per point around by one layer up
//   Detailed morph  a coarse grid (up to 16 a side) drawn soft at mm scale,
//                   with Sharp, Soft or Round edges (D53)
//
// It never covers the pot. It stands in for the step frame while it is open:
// on a phone it takes the lower part of the screen (the dock, the sheet and
// the step bar give way) and the pot stays live above it; on desktop it is a
// wide panel in the left column, beside the pot (main.js fits the pot into
// what is left).
//
// Tools (§6): paint Out, Flat or In; select a row, a column, a diagonal
// either way (desktop also a rectangle) and Set or Invert it; desktop also
// shifts a row or column round and mirrors the tile; add or remove a row or
// column, Double rows; quick fills from the current row. A tap or a
// selection in one of the dimmed repeats is the tile's own cell, and a
// diagonal runs on through the repeats (core/bitmap.js).
//
// Every edit is live on the pot (D20): it goes into the design with
// store.change in the 'editor' group, and Done commits once, so a session
// is one history step ("Edited pattern"). Inside a session the top bar's
// undo and redo, and Ctrl+Z, step through the editor's own history
// (ctx.editorHistory). A drawing back where it started puts the design back
// as it was, so a session that changed nothing adds no step.

import { h, segmented } from './controls.js';
import { attachPressLabel } from './press-label.js';
import {
  CELL_STATES, gridOf, recipeOf, sameGrid, selectionMask, wholeTile, paintCell, setCells, invertCells,
  shiftRow, shiftColumn, shiftTile, mirrorTile, insertRow, removeRow, insertColumn, removeColumn,
  doubleRows, quickFill, fillSize, lineCells, wrapCell, cellIndex,
} from '../core/bitmap.js';
import { evaluatePattern } from '../core/patterns.js';
import { drawingDefaults } from '../core/layer-pattern.js';
import { footprintAt } from './sections/shape.js';
import {
  EDITOR_MAX, OWN_PATTERN_DEFAULTS, editorStart, writeEditorDrawing, editableEntry, targetDrawingId,
  detailTileFor, readoutOf,
} from './pattern-actions.js';

const PHONE_QUERY = '(max-width: 760px)';
const UNDO_LIMIT = 200;
const GROUP = 'editor';

// The three tones (D46), the swatches' whites and greys (ui/swatch.js).
const TONE = { 1: 252, 0: 212, '-1': 158 };
const STATE_NAME = { 1: 'Out', 0: 'Flat', '-1': 'In' };
const STATE_KEY = { 1: '1', 0: '2', '-1': '3' };
const KIND_NAME = {
  paint: 'Paint', row: 'Row', column: 'Column', diagUp: 'Diagonal ↗', diagDown: 'Diagonal ↘', rect: 'Rectangle',
};
const FILL_NAME = { stripes: 'Stripes', brick: 'Brick', diagonal: 'Diagonal', checker: 'Checker' };
/** Which groups of tools each phone tab shows. Desktop shows them all. */
const TABS = {
  draw: { name: 'Draw', groups: ['draw'] },
  select: { name: 'Select', groups: ['tool', 'apply'] },
  tile: { name: 'Tile', groups: ['tile'] },
  fill: { name: 'Fill', groups: ['fill'] },
  edges: { name: 'Edges', groups: ['edges'] },
};

// ---------- Geometry (pure, tested) ----------

/**
 * Where the tile and its repeats sit in a canvas of width × height CSS px:
 * the tile in the middle at the cells' true proportions (aspect = cell
 * height ÷ cell width), with room round it for the repeats. Cells never
 * grow past maxCellW × maxCellH, so a small tile shows more repeats.
 * View cells are counted from the tile's bottom-left cell: vc to the right,
 * vr upwards (row 0 of a drawing is its bottom row, the first layer).
 * @returns {{ width: number, height: number, columns: number, rows: number, cw: number, ch: number,
 *   ox: number, oy: number, tw: number, th: number, c0: number, c1: number, r0: number, r1: number }}
 *   ox, oy: the tile's top-left corner; c0…c1, r0…r1: the view cells in sight
 */
export function gridView(width, height, columns, rows, aspect, { fill = 0.8, maxCellW = 80, maxCellH = 56 } = {}) {
  const a = aspect > 0 ? aspect : 1;
  let cw = Math.min((width * fill) / columns, (height * fill) / (rows * a));
  cw = Math.max(Math.min(cw, maxCellW, maxCellH / a), 1e-3);
  const ch = cw * a;
  const tw = cw * columns;
  const th = ch * rows;
  const ox = (width - tw) / 2;
  const oy = (height - th) / 2;
  return {
    width, height, columns, rows, cw, ch, ox, oy, tw, th,
    c0: Math.floor(-ox / cw), c1: Math.ceil((width - ox) / cw) - 1,
    r0: Math.floor(rows - (height - oy) / ch), r1: Math.ceil(rows + oy / ch) - 1,
  };
}

/** The view cell under a point (CSS px in the canvas), and the tile cell it stands for. */
export function hitCell(view, x, y) {
  const vc = Math.floor((x - view.ox) / view.cw);
  const vr = view.rows - 1 - Math.floor((y - view.oy) / view.ch);
  const c = ((vc % view.columns) + view.columns) % view.columns;
  const r = ((vr % view.rows) + view.rows) % view.rows;
  return { vc, vr, c, r };
}

/** A view cell's box in CSS px. */
export function cellBox(view, vc, vr) {
  return { x: view.ox + vc * view.cw, y: view.oy + (view.rows - 1 - vr) * view.ch, w: view.cw, h: view.ch };
}

/** The core selection a selection tool makes through a tile cell. */
export function lineThrough(kind, c, r) {
  if (kind === 'row') return { kind: 'row', r };
  if (kind === 'column') return { kind: 'column', c };
  if (kind === 'diagUp') return { kind: 'diagonal', c, r, dir: 1 };
  if (kind === 'diagDown') return { kind: 'diagonal', c, r, dir: -1 };
  return { kind: 'cell', c, r };
}

/** Whether a selection is the kind a selection tool makes. */
export function sameKind(sel, kind) {
  if (!sel) return false;
  if (kind === 'diagUp') return sel.kind === 'diagonal' && sel.dir > 0;
  if (kind === 'diagDown') return sel.kind === 'diagonal' && sel.dir < 0;
  return sel.kind === kind;
}

/** How a selection reads in a message: rows count from the bottom, columns from the left, from 1. */
export function describeSelection(sel) {
  if (!sel) return 'the whole tile';
  if (sel.kind === 'row') return `row ${sel.r + 1}`;
  if (sel.kind === 'column') return `column ${sel.c + 1}`;
  if (sel.kind === 'diagonal') return `the ${sel.dir > 0 ? '↗' : '↘'} diagonal`;
  if (sel.kind === 'cell') return `row ${sel.r + 1}, column ${sel.c + 1}`;
  const w = Math.abs(sel.c1 - sel.c0) + 1;
  const hh = Math.abs(sel.r1 - sel.r0) + 1;
  return w === 1 && hh === 1 ? 'one cell' : `${w} × ${hh} cells`;
}

// ---------- Icons (inline, drawn in-house, 20 × 20) ----------

const svg = (body) => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
// A 3 × 3 grid with some cells filled ([column, row] from the top left).
const gridIcon = (cells, extra = '') => svg(
  `${cells.map(([c, r]) => `<rect x="${3 + c * 14 / 3}" y="${3 + r * 14 / 3}" width="${14 / 3}" height="${14 / 3}" fill="currentColor" stroke="none" opacity=".85"/>`).join('')}`
  + '<rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M7.67 3v14M12.33 3v14M3 7.67h14M3 12.33h14" stroke-width="1" opacity=".55"/>'
  + extra,
);
// A 4 × 4 preview of a quick fill (rows of 0/1 from the top).
const fillIcon = (rows) => svg(
  `${rows.flatMap((row, r) => [...row].map((v, c) => (v === '1' ? `<rect x="${3 + c * 3.5}" y="${3 + r * 3.5}" width="3.5" height="3.5" fill="currentColor" stroke="none"/>` : ''))).join('')}`
  + '<rect x="3" y="3" width="14" height="14" rx="1.5"/>',
);
const ICON = {
  done: svg('<path d="M4.5 10.5l3.5 3.5 7.5-8" stroke-width="2.2"/>'),
  paint: svg('<path d="M12.8 3.6l3.6 3.6-8.6 8.6H4.2v-3.6z"/><path d="M11 5.4l3.6 3.6"/>'),
  row: gridIcon([[0, 1], [1, 1], [2, 1]]),
  column: gridIcon([[1, 0], [1, 1], [1, 2]]),
  diagUp: gridIcon([[0, 2], [1, 1], [2, 0]]),
  diagDown: gridIcon([[0, 0], [1, 1], [2, 2]]),
  rect: svg('<rect x="3.5" y="4.5" width="13" height="11" rx="1" stroke-dasharray="2.4 2"/><rect x="2" y="3" width="3" height="3" fill="currentColor" stroke="none"/><rect x="15" y="14" width="3" height="3" fill="currentColor" stroke="none"/>'),
  set: svg('<path d="M4 9.5l5.5-5.5 6 6-5.5 5.5z"/><path d="M4 9.5h11.5"/><path d="M16.8 13.2c.8 1.2 1.2 2 1.2 2.6a1.2 1.2 0 0 1-2.4 0c0-.6.4-1.4 1.2-2.6z" fill="currentColor"/>'),
  invert: svg('<circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor"/>'),
  left: svg('<path d="M16 10H4.5M8.5 6l-4 4 4 4"/>'),
  right: svg('<path d="M4 10h11.5M11.5 6l4 4-4 4"/>'),
  up: svg('<path d="M10 16V4.5M6 8.5l4-4 4 4"/>'),
  down: svg('<path d="M10 4v11.5M6 11.5l4 4 4-4"/>'),
  mirrorX: svg('<path d="M10 2.5v15" stroke-dasharray="2 2"/><path d="M7.5 5.5L3 14h4.5z" fill="currentColor"/><path d="M12.5 5.5L17 14h-4.5z"/>'),
  mirrorY: svg('<path d="M2.5 10h15" stroke-dasharray="2 2"/><path d="M5.5 7.5L14 3v4.5z" fill="currentColor"/><path d="M5.5 12.5L14 17v-4.5z"/>'),
  addRow: svg('<rect x="3" y="3" width="14" height="8" rx="1.2"/><path d="M3 7h14" opacity=".55"/><path d="M10 13v5M7.5 15.5h5" stroke-width="1.9"/>'),
  removeRow: svg('<rect x="3" y="3" width="14" height="8" rx="1.2"/><path d="M3 7h14" opacity=".55"/><path d="M7.5 15.5h5" stroke-width="1.9"/>'),
  addColumn: svg('<rect x="3" y="3" width="8" height="14" rx="1.2"/><path d="M7 3v14" opacity=".55"/><path d="M13 10h5M15.5 7.5v5" stroke-width="1.9"/>'),
  removeColumn: svg('<rect x="3" y="3" width="8" height="14" rx="1.2"/><path d="M7 3v14" opacity=".55"/><path d="M13 10h5" stroke-width="1.9"/>'),
  doubleRows: svg('<path d="M3 4.5h6M3 8h6M3 12h6M3 15.5h6" stroke-width="1.7"/><path d="M12 6l5 8M17 6l-5 8" stroke-width="1.5"/>'),
  stripes: fillIcon(['1010', '1010', '1010', '1010']),
  brick: fillIcon(['1100', '0110', '1100', '0110']),
  diagonal: fillIcon(['1000', '0100', '0010', '0001']),
  checker: fillIcon(['1010', '0101', '1010', '0101']),
};
const stateIcon = (v) => {
  const t = TONE[v];
  const glyph = v > 0 ? '<path d="M10 6.5v7M6.5 10h7" stroke="rgb(18,47,45)" stroke-width="1.8"/>'
    : v < 0 ? '<path d="M6.5 10h7" stroke="#fff" stroke-width="1.8"/>' : '';
  return svg(`<rect x="2.5" y="2.5" width="15" height="15" rx="3.5" fill="rgb(${t},${t},${t})" stroke="rgba(18,47,45,.45)" stroke-width="1"/>${glyph}`);
};

// ---------- The editor ----------

let session = null;

/** The open session's handle (undo, redo, close, …), or null. Also ctx.editorHistory while open. */
export function editorSession() {
  return session;
}

/**
 * Opens the editor on a target (ui/pattern-actions.js openEditor).
 * @param {object} ctx  main.js's ctx
 * @param {{ kind: 'pattern' } | { kind: 'detail', slot: 'a' | 'b' }} target
 * @param {{ mode?: 'make' | 'edit', saved?: object[], returnFocus?: HTMLElement | null }} [opts]
 */
export function openPatternEditor(ctx, target, { mode = 'edit', saved = [], returnFocus = document.activeElement } = {}) {
  session?.close();
  session = createSession(ctx, target, mode, saved, returnFocus);
  return session;
}

function createSession(ctx, target, mode, saved, returnFocus) {
  const { store, library } = ctx;
  const host = document.getElementById('editor') ?? document.body.appendChild(h('aside', { id: 'editor' }));
  const phoneMedia = matchMedia(PHONE_QUERY);
  const isDetail = target.kind === 'detail';
  const max = EDITOR_MAX[target.kind];
  const start = editorStart(store.state.design, library, target, mode, saved);
  const openedGrid = gridOf(start.recipe);
  const openedEdges = start.recipe.edges;

  // ---- The drawing and the editor's own history ----
  let grid = openedGrid;
  let edges = openedEdges;
  let undoStack = [];
  let redoStack = [];
  let paintState = 1;
  let deskKind = 'paint';        // desktop: what a tap on the grid does
  let selectKind = 'row';        // the phone's Select tab
  let tab = 'draw';              // the phone's tab
  let cursor = { c: 0, r: 0 };   // the current cell (rows and fills start from its row)
  let selection = null;
  let drag = null;
  let view = null;
  let closed = false;

  // ---- The store side ----
  // The design as it was: put back when the drawing returns to where it
  // started, until something else changes the design.
  let original = store.state.design;
  let mine = original;           // the design object the editor last wrote or saw
  const keyOf = (d) => {
    const r = editableEntry(d, library, target, saved)?.recipe;
    return `${targetDrawingId(d, target)}|${r ? `${r.columns}x${r.rows}:${r.cells}:${r.edges ?? ''}` : ''}`;
  };
  let basis = keyOf(original);   // what the target shows unless someone else changed it
  let pushed = false;            // the editor has a gesture open in the store
  let writing = false;
  let pushFrame = 0;

  const atStart = () => sameGrid(grid, openedGrid) && edges === openedEdges;

  function push() {
    cancelAnimationFrame(pushFrame);
    pushFrame = 0;
    if (closed) return;
    const back = original && atStart();
    if (back && !pushed) return;
    writing = true;
    try {
      if (back) {
        const o = original;
        store.change(start.label, (d) => replaceDesign(d, o), { group: GROUP });
      } else {
        const recipe = recipeOf(grid, edges);
        store.change(start.label, (d) => writeEditorDrawing(d, start, recipe), { group: GROUP });
      }
    } finally {
      writing = false;
    }
    pushed = true;
    mine = store.state.design;
    basis = keyOf(mine);
  }
  const schedulePush = () => { if (!pushFrame) pushFrame = requestAnimationFrame(push); };

  // ---- DOM ----
  const detachers = [];
  const title = h('h2', { class: 'ed-title', id: 'ed-title' });
  const sizeText = h('span', { class: 'ed-size' });
  const sub = h('p', { class: 'ed-sub' });
  const doneBtn = button('done', 'Done', () => close(), { cls: 'ed-done', title: 'Done (Esc)' });
  const head = h('div', { class: 'ed-head' }, [h('div', { class: 'ed-titles' }, [h('div', { class: 'ed-title-row' }, [title, sizeText]), sub]), doneBtn]);

  const canvas = h('canvas', { class: 'ed-canvas', tabIndex: 0, role: 'application', 'aria-roledescription': 'drawing grid', 'aria-describedby': 'ed-status' });
  const stage = h('div', { class: 'ed-stage' }, [canvas]);
  const status = h('p', { class: 'ed-status', id: 'ed-status', role: 'status', 'aria-live': 'polite' });

  function button(icon, label, onClick, { cls = '', title: tip = label } = {}) {
    const b = h('button', { type: 'button', class: `ed-btn ${cls}`, 'aria-label': label, title: tip });
    b.innerHTML = typeof icon === 'string' && ICON[icon] ? ICON[icon] : icon;
    b.addEventListener('click', onClick);
    detachers.push(attachPressLabel(b));
    return b;
  }
  function group(id, name, children, { desk = false, extra = null } = {}) {
    const el = h('div', { class: 'ed-group', role: 'group', 'aria-label': name }, [
      h('span', { class: 'ed-group-title', 'aria-hidden': 'true', text: name }),
      h('div', { class: 'ed-row' }, children),
      extra,
    ]);
    el.dataset.group = id;
    if (desk) el.dataset.desk = '';
    return el;
  }
  const radio = (b, on) => {
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
  };

  // Draw: the state paint and Set use.
  const stateBtns = new Map(CELL_STATES.map((v) => {
    const b = button(stateIcon(v), `Draw ${STATE_NAME[v].toLowerCase()}`, () => setPaintState(v), { cls: 'ed-state', title: `${STATE_NAME[v]} (${STATE_KEY[v]})` });
    radio(b, v === paintState);
    return [v, b];
  }));
  const drawGroup = group('draw', 'Draw', [...stateBtns.values()]);
  drawGroup.querySelector('.ed-row').setAttribute('role', 'radiogroup');
  drawGroup.querySelector('.ed-row').setAttribute('aria-label', 'Draw with');

  // Tool: what a tap on the grid does (desktop); the phone's Select tab picks the line.
  const kindBtns = new Map(Object.keys(KIND_NAME).map((k) => {
    const label = k === 'paint' ? 'Paint cells' : k === 'rect' ? 'Select a rectangle' : `Select a ${KIND_NAME[k].toLowerCase()}`;
    const b = button(k, label, () => setKind(k), { title: k === 'paint' ? 'Paint cells (P)' : k === 'row' ? 'Select a row (R)' : k === 'column' ? 'Select a column (C)' : label });
    if (k === 'paint' || k === 'rect') b.dataset.desk = '';
    return [k, b];
  }));
  const toolGroup = group('tool', 'Tool', [...kindBtns.values()]);
  toolGroup.querySelector('.ed-row').setAttribute('role', 'radiogroup');
  toolGroup.querySelector('.ed-row').setAttribute('aria-label', 'Tool');

  // Apply to the selection (or the whole tile).
  const setBtn = button('set', 'Set', () => act('set'), { cls: 'ed-set' });
  const invertBtn = button('invert', 'Invert', () => act('invert'));
  const applyGroup = group('apply', 'Selection', [setBtn, invertBtn]);

  // Transform (desktop): shift a row or column round, or the tile; mirror.
  const moveGroup = group('move', 'Move', [
    button('left', 'Shift left', () => act('shift', -1, 0)),
    button('right', 'Shift right', () => act('shift', 1, 0)),
    button('up', 'Shift up', () => act('shift', 0, 1)),
    button('down', 'Shift down', () => act('shift', 0, -1)),
    button('mirrorX', 'Mirror left to right', () => act('mirror', 'leftRight')),
    button('mirrorY', 'Mirror top to bottom', () => act('mirror', 'upDown')),
  ], { desk: true });
  const shiftBtns = [...moveGroup.querySelectorAll('.ed-btn')].slice(0, 4);

  // Tile size.
  const tileBtns = {
    addRow: button('addRow', 'Add a row', () => act('addRow')),
    removeRow: button('removeRow', 'Remove a row', () => act('removeRow')),
    addColumn: button('addColumn', 'Add a column', () => act('addColumn')),
    removeColumn: button('removeColumn', 'Remove a column', () => act('removeColumn')),
    doubleRows: button('doubleRows', 'Double rows', () => act('doubleRows')),
  };
  const tileGroup = group('tile', 'Tile', Object.values(tileBtns));

  // Quick fills from the current row.
  const fillBtns = Object.fromEntries(Object.keys(FILL_NAME).map((k) => [k, button(k, `${FILL_NAME[k]} from the current row`, () => act('fill', k))]));
  const fillGroup = group('fill', 'Quick fills', Object.values(fillBtns));
  const fillTitle = fillGroup.querySelector('.ed-group-title');

  // Edges (a Detailed morph grid, D53): a value, so text.
  const edgesCtl = isDetail
    ? segmented({
      label: 'Edges', hideLabel: true,
      options: [{ value: 'sharp', label: 'Sharp' }, { value: 'soft', label: 'Soft' }, { value: 'round', label: 'Round' }],
      value: edges ?? 'soft',
      onChange: (v) => apply(grid, `Edges: ${v}`, v),
    })
    : null;
  const edgesGroup = isDetail ? group('edges', 'Edges', [edgesCtl.el]) : null;

  const groups = [drawGroup, toolGroup, applyGroup, moveGroup, tileGroup, fillGroup, edgesGroup].filter(Boolean);
  const tools = h('div', { class: 'ed-tools' }, groups);

  // Phone tabs.
  const tabIds = Object.keys(TABS).filter((t) => t !== 'edges' || isDetail);
  const tabBtns = new Map(tabIds.map((t) => {
    const b = h('button', { type: 'button', class: 'ed-tab', role: 'tab', id: `ed-tab-${t}`, text: TABS[t].name });
    b.addEventListener('click', () => setTab(t));
    return [t, b];
  }));
  const tabRow = h('div', { class: 'ed-tabs', role: 'tablist', 'aria-label': 'Editor tools' }, [...tabBtns.values()]);
  tabRow.addEventListener('keydown', (e) => {
    const list = [...tabBtns.values()];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowRight: list[(i + 1) % list.length], ArrowLeft: list[(i + list.length - 1) % list.length] }[e.key];
    if (!to) return;
    e.preventDefault();
    to.focus();
    to.click();
  });

  host.className = `editor editor--${target.kind}`;
  host.setAttribute('aria-labelledby', title.id);
  host.replaceChildren(head, stage, tools, tabRow, status);
  host.hidden = false;
  document.documentElement.classList.add('is-editing');

  // ---- Behaviour ----

  const phone = () => phoneMedia.matches;
  /** What a tap on the grid does now. */
  function tool() {
    if (!phone()) return deskKind;
    if (tab === 'draw') return 'paint';
    if (tab === 'select') return selectKind;
    return 'cursor';
  }

  function say(text) {
    status.textContent = text;
  }

  function setPaintState(v) {
    paintState = v;
    if (!phone() && deskKind !== 'paint' && !selection) deskKind = 'paint';
    update();
  }

  function setKind(k) {
    const line = k !== 'paint' && k !== 'rect';
    if (phone() && !line) return;
    const wasActive = phone() ? selectKind === k : deskKind === k;
    if (phone()) selectKind = k;
    else {
      deskKind = k;
      if (line) selectKind = k;
    }
    if (line) {
      // Picking a line selects it through the current cell straight away;
      // picking it again lets go, so Set and Invert act on the whole tile.
      if (wasActive && sameKind(selection, k)) {
        selection = null;
        say('Nothing selected: Set and Invert act on the whole tile');
      } else {
        selection = lineThrough(k, cursor.c, cursor.r);
        say(`Selected ${describeSelection(selection)}`);
      }
    }
    update();
  }

  function setTab(t) {
    tab = t;
    update();
  }

  /** Takes a new drawing as one step of the editor's history. */
  function apply(next, message, nextEdges = edges) {
    if (!next || (next === grid && nextEdges === edges)) return false;
    record();
    const resized = next.columns !== grid.columns || next.rows !== grid.rows;
    grid = next;
    edges = nextEdges;
    if (resized) selection = null;
    clampCursor();
    push();
    say(message);
    update();
    return true;
  }

  function record(entry = { grid, edges }) {
    undoStack.push(entry);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
  }

  function restore(entry, message) {
    const resized = entry.grid.columns !== grid.columns || entry.grid.rows !== grid.rows;
    grid = entry.grid;
    edges = entry.edges;
    if (resized) selection = null;
    clampCursor();
    push();
    say(message);
    update();
  }

  function undo() {
    if (closed || !undoStack.length) return;
    redoStack.push({ grid, edges });
    restore(undoStack.pop(), 'Undone');
  }

  function redo() {
    if (closed || !redoStack.length) return;
    undoStack.push({ grid, edges });
    restore(redoStack.pop(), 'Redone');
  }

  function clampCursor() {
    cursor = { c: Math.min(cursor.c, grid.columns - 1), r: Math.min(cursor.r, grid.rows - 1) };
  }

  const maskOf = () => (selection ? selectionMask(grid, selection) : wholeTile(grid));

  function act(name, a, b) {
    if (closed) return;
    const C = grid.columns;
    const R = grid.rows;
    const what = describeSelection(selection);
    switch (name) {
      case 'set':
        apply(setCells(grid, maskOf(), paintState), `Set ${what} to ${STATE_NAME[paintState].toLowerCase()}`);
        break;
      case 'invert':
        apply(invertCells(grid, maskOf()), `Inverted ${what}`);
        break;
      case 'shift': {
        // A selected row turns round sideways, a selected column up and
        // down; anything else moves the whole tile.
        const dir = a > 0 ? 'right' : a < 0 ? 'left' : b > 0 ? 'up' : 'down';
        if (a && selection?.kind === 'row') apply(shiftRow(grid, selection.r, a), `Shifted row ${selection.r + 1} ${dir}`);
        else if (b && selection?.kind === 'column') apply(shiftColumn(grid, selection.c, b), `Shifted column ${selection.c + 1} ${dir}`);
        else {
          if (apply(shiftTile(grid, a, b), `Shifted the tile ${dir}`)) {
            cursor = { c: (cursor.c + a + C) % C, r: (cursor.r + b + R) % R };
            update();
          }
        }
        break;
      }
      case 'mirror':
        apply(mirrorTile(grid, a), a === 'upDown' ? 'Mirrored top to bottom' : 'Mirrored left to right');
        break;
      case 'addRow':
        if (apply(insertRow(grid, cursor.r + 1, cursor.r, max), `Added a row: a copy of row ${cursor.r + 1}`)) {
          cursor = { ...cursor, r: cursor.r + 1 };
          update();
        }
        break;
      case 'removeRow':
        apply(removeRow(grid, cursor.r), `Removed row ${cursor.r + 1}`);
        break;
      case 'addColumn':
        if (apply(insertColumn(grid, cursor.c + 1, cursor.c, max), `Added a column: a copy of column ${cursor.c + 1}`)) {
          cursor = { ...cursor, c: cursor.c + 1 };
          update();
        }
        break;
      case 'removeColumn':
        apply(removeColumn(grid, cursor.c), `Removed column ${cursor.c + 1}`);
        break;
      case 'doubleRows':
        if (apply(doubleRows(grid, max), `Doubled the rows: ${R * 2} rows`)) {
          cursor = { ...cursor, r: Math.min(cursor.r * 2, grid.rows - 1) };
          update();
        }
        break;
      case 'fill': {
        const row = cursor.r;
        if (apply(quickFill(grid, row, a, max), `${FILL_NAME[a]} from row ${row + 1}`)) {
          cursor = { c: Math.min(cursor.c, grid.columns - 1), r: 0 };
          update();
        }
        break;
      }
      default:
    }
  }

  // ---- The grid: pointer and keys ----

  function pointAt(e) {
    const r = canvas.getBoundingClientRect();
    return hitCell(view, e.clientX - r.left, e.clientY - r.top);
  }

  function paintCells(cells) {
    let next = grid;
    for (const p of cells) next = paintCell(next, p.vc ?? p.c, p.vr ?? p.r, paintState);
    if (next === grid) return;
    if (!drag.recorded) {
      record(drag.before);
      drag.recorded = true;
    }
    grid = next;
    schedulePush();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!view || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(e.pointerId);
    const hit = pointAt(e);
    const t = tool();
    drag = { id: e.pointerId, tool: t, start: hit, last: hit, before: { grid, edges }, recorded: false };
    cursor = { c: hit.c, r: hit.r };
    if (t === 'paint') {
      selection = null;
      paintCells([hit]);
    } else if (t === 'rect') {
      selection = { kind: 'rect', c0: hit.vc, r0: hit.vr, c1: hit.vc, r1: hit.vr };
    } else if (t !== 'cursor') {
      selection = lineThrough(t, hit.c, hit.r);
    }
    render();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const hit = pointAt(e);
    if (hit.vc === drag.last.vc && hit.vr === drag.last.vr) return;
    if (drag.tool === 'paint') {
      paintCells(lineCells({ c: drag.last.vc, r: drag.last.vr }, { c: hit.vc, r: hit.vr }).map((p) => ({ vc: p.c, vr: p.r })));
    } else if (drag.tool === 'rect') {
      selection = { kind: 'rect', c0: drag.start.vc, r0: drag.start.vr, c1: hit.vc, r1: hit.vr };
    } else if (drag.tool !== 'cursor') {
      selection = lineThrough(drag.tool, hit.c, hit.r);
    }
    cursor = { c: hit.c, r: hit.r };
    drag.last = hit;
    render();
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (d.recorded) {
      push();
      say(`Drew ${STATE_NAME[paintState].toLowerCase()}`);
    } else if (d.tool !== 'paint' && d.tool !== 'cursor') {
      say(`Selected ${describeSelection(selection)}`);
    }
    update();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('keydown', (e) => {
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (moves[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const [dc, dr] = moves[e.key];
      const t = tool();
      if (e.shiftKey && t === 'rect' && selection?.kind === 'rect') {
        selection = { ...selection, c1: selection.c1 + dc, r1: selection.r1 + dr };
      } else {
        cursor = wrapCell(grid, cursor.c + dc, cursor.r + dr);
        if (t !== 'paint' && t !== 'rect' && t !== 'cursor' && selection) selection = lineThrough(t, cursor.c, cursor.r);
      }
      say(`Row ${cursor.r + 1}, column ${cursor.c + 1}: ${STATE_NAME[grid.cells[cellIndex(grid, cursor.c, cursor.r)]].toLowerCase()}`);
      render();
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const t = tool();
      if (t === 'paint') apply(paintCell(grid, cursor.c, cursor.r, paintState), `Row ${cursor.r + 1}, column ${cursor.c + 1}: ${STATE_NAME[paintState].toLowerCase()}`);
      else if (t === 'rect') { selection = { kind: 'rect', c0: cursor.c, r0: cursor.r, c1: cursor.c, r1: cursor.r }; update(); }
      else if (t !== 'cursor') { selection = lineThrough(t, cursor.c, cursor.r); say(`Selected ${describeSelection(selection)}`); update(); }
    }
  });

  // Keys anywhere in the editor: the states, Set, Invert, the tools, Esc.
  // The host outlives the session, so this comes off again on close.
  const onHostKey = (e) => {
    if (closed || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    const state = { 1: 1, 2: 0, 3: -1 }[k];
    if (state !== undefined) { e.preventDefault(); setPaintState(state); return; }
    if (k === 'i') { e.preventDefault(); act('invert'); return; }
    if (k === 's') { e.preventDefault(); act('set'); return; }
    const kind = { p: 'paint', r: 'row', c: 'column' }[k];
    if (kind && !phone()) { e.preventDefault(); setKind(kind); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (selection) { selection = null; say('Nothing selected: Set and Invert act on the whole tile'); update(); } else close();
    }
  };
  host.addEventListener('keydown', onHostKey);

  // Undo and redo step through the editor's own history while it is open.
  const onWindowKey = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); } else if ((k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey)) { e.preventDefault(); redo(); }
  };
  addEventListener('keydown', onWindowKey, true);

  // ---- Rendering ----

  /** One cell's size on the wall, in mm: true proportions (§6). */
  function cellMm() {
    const d = store.state.design;
    const lh = d.layers.layerHeightMm;
    if (!isDetail) {
      const r = d.pattern ? readoutOf(d, library) : null;
      return { w: r ? r.spacingMinMm : drawingDefaults(d, OWN_PATTERN_DEFAULTS).density.spacingMm, h: lh };
    }
    const t = detailTileFor(start.base, grid.columns, grid.rows, lh);
    return { w: footprintAt(d).perimeterMm / t.repeats / grid.columns, h: t.tileHeightMm / grid.rows };
  }

  let tileImg = null;
  let tileKey = '';
  function tileImage() {
    const key = `${grid.columns}x${grid.rows}:${recipeOf(grid).cells}:${edges ?? ''}`;
    if (key === tileKey) return tileImg;
    tileKey = key;
    const C = grid.columns;
    const R = grid.rows;
    // The Pattern crisp, one pixel a cell; a Detailed morph grid soft, as it prints (D45).
    const k = isDetail ? Math.max(4, Math.min(16, Math.floor(256 / Math.max(C, R)))) : 1;
    const img = document.createElement('canvas');
    img.width = C * k;
    img.height = R * k;
    const g = img.getContext('2d');
    const data = g.createImageData(C * k, R * k);
    const recipe = isDetail ? recipeOf(grid, edges) : null;
    for (let py = 0; py < R * k; py++) {
      for (let px = 0; px < C * k; px++) {
        let t;
        if (isDetail) {
          const v = evaluatePattern(recipe, (px + 0.5) / (C * k), (R * k - py - 0.5) / (R * k));
          t = v >= 0 ? TONE[0] + v * (TONE[1] - TONE[0]) : TONE[0] + v * (TONE[0] - TONE[-1]);
        } else {
          t = TONE[grid.cells[(R - 1 - py) * C + px]];
        }
        const i = (py * C * k + px) * 4;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = t;
        data.data[i + 3] = 255;
      }
    }
    g.putImageData(data, 0, 0);
    tileImg = img;
    return img;
  }

  function render() {
    if (closed) return;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    if (W < 8 || H < 8) return;
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    const pw = Math.round(W * dpr);
    const ph = Math.round(H * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const mm = cellMm();
    view = gridView(W, H, grid.columns, grid.rows, mm.h / mm.w);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const snap = (v) => Math.round(v * dpr) / dpr;
    const { ox, oy, tw, th, cw, ch, c0, c1, r0, r1, columns: C, rows: R } = view;
    g.fillStyle = 'rgb(200,200,200)';
    g.fillRect(0, 0, W, H);

    // The tile and its repeats.
    const img = tileImage();
    g.imageSmoothingEnabled = isDetail;
    g.imageSmoothingQuality = 'high';
    for (let j = Math.floor(r0 / R); j <= Math.floor(r1 / R); j++) {
      for (let i = Math.floor(c0 / C); i <= Math.floor(c1 / C); i++) {
        const x = snap(ox + i * tw);
        const y = snap(oy - j * th);
        g.drawImage(img, x, y, snap(ox + (i + 1) * tw) - x, snap(oy - (j - 1) * th) - y);
      }
    }

    // Layers and points: the gaps between rows are the layers.
    const line = 1 / dpr;
    if (ch >= 4) {
      g.fillStyle = isDetail ? 'rgba(18,47,45,.16)' : 'rgba(18,47,45,.34)';
      for (let vr = r0; vr <= r1 + 1; vr++) g.fillRect(0, snap(oy + (R - vr) * ch), W, line);
    }
    if (cw >= 4) {
      g.fillStyle = isDetail ? 'rgba(18,47,45,.16)' : 'rgba(18,47,45,.1)';
      for (let vc = c0; vc <= c1 + 1; vc++) g.fillRect(snap(ox + vc * cw), 0, line, H);
    }

    // The repeats dimmed round the tile: towards a mid grey, so out, flat
    // and in keep their order there and none passes for another.
    g.fillStyle = 'rgba(198,201,201,.56)';
    const tx = snap(ox);
    const ty = snap(oy);
    const tr = snap(ox + tw);
    const tb = snap(oy + th);
    g.fillRect(0, 0, W, ty);
    g.fillRect(0, tb, W, H - tb);
    g.fillRect(0, ty, tx, tb - ty);
    g.fillRect(tr, ty, W - tr, tb - ty);

    // Out and in marks on cells big enough to hold one, so the states never rest on tone alone.
    if (cw >= 16 && ch >= 14) {
      const s = Math.min(cw, ch) * 0.22;
      g.lineWidth = 1.5;
      g.lineCap = 'round';
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          const v = grid.cells[r * C + c];
          if (!v) continue;
          const b = cellBox(view, c, r);
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          g.strokeStyle = v > 0 ? 'rgba(18,47,45,.38)' : 'rgba(255,255,255,.85)';
          g.beginPath();
          g.moveTo(cx - s, cy);
          g.lineTo(cx + s, cy);
          if (v > 0) { g.moveTo(cx, cy - s); g.lineTo(cx, cy + s); }
          g.stroke();
        }
      }
    }

    // The current row or column for the tile and fill tools.
    const t = tool();
    if (t === 'cursor') {
      g.fillStyle = 'rgba(26,47,48,.12)';
      const row = cellBox(view, 0, cursor.r);
      g.fillRect(tx, snap(row.y), tr - tx, snap(row.y + ch) - snap(row.y));
      if (tab === 'tile') {
        const col = cellBox(view, cursor.c, 0);
        g.fillRect(snap(col.x), ty, snap(col.x + cw) - snap(col.x), tb - ty);
      }
    }

    // The selection, in the tile and in every repeat.
    if (selection) {
      const mask = selectionMask(grid, selection);
      for (let vr = r0; vr <= r1; vr++) {
        for (let vc = c0; vc <= c1; vc++) {
          if (!mask[cellIndex(grid, vc, vr)]) continue;
          const inTile = vc >= 0 && vc < C && vr >= 0 && vr < R;
          const b = cellBox(view, vc, vr);
          g.fillStyle = inTile ? 'rgba(63,166,106,.5)' : 'rgba(63,166,106,.3)';
          g.fillRect(snap(b.x), snap(b.y), snap(b.x + b.w) - snap(b.x), snap(b.y + b.h) - snap(b.y));
        }
      }
    }

    // The tile's outline, then the current cell.
    g.lineWidth = 2;
    g.strokeStyle = 'rgb(26,47,48)';
    g.strokeRect(tx - 1, ty - 1, tr - tx + 2, tb - ty + 2);
    const cb = cellBox(view, cursor.c, cursor.r);
    g.lineWidth = Math.max(1.5, Math.min(2.5, Math.min(cw, ch) / 8));
    g.strokeStyle = document.activeElement === canvas || t === 'cursor' ? 'rgb(26,47,48)' : 'rgba(26,47,48,.55)';
    const inset = g.lineWidth / 2;
    g.strokeRect(snap(cb.x) + inset, snap(cb.y) + inset, Math.max(1, snap(cb.x + cw) - snap(cb.x) - 2 * inset), Math.max(1, snap(cb.y + ch) - snap(cb.y) - 2 * inset));
  }

  const fmt = (v) => (Math.round(v * 10) / 10).toFixed(1);

  /** Everything but the grid: titles, which buttons are on, what Set and Invert act on. */
  function update() {
    if (closed) return;
    const C = grid.columns;
    const R = grid.rows;
    const ph = phone();
    host.classList.toggle('editor--phone', ph);
    const d = store.state.design;
    title.textContent = isDetail ? `Detailed morph ${target.slot.toUpperCase()}` : 'Pattern';
    sizeText.textContent = `${C} × ${R}`;
    sizeText.setAttribute('aria-label', `${C} columns by ${R} rows`);
    const mm = cellMm();
    sub.textContent = isDetail
      ? `One cell is ${fmt(mm.w)} × ${fmt(mm.h)} mm of wall, drawn soft. ${start.name}.`
      : `Each row prints as one layer and each cell as one point, ${fmt(mm.w)} mm apart. ${start.name}.`;
    canvas.setAttribute('aria-label', `${title.textContent} grid, ${C} by ${R}. Arrow keys move, Space ${tool() === 'paint' ? 'draws' : 'selects'}.`);

    for (const [v, b] of stateBtns) b.setAttribute('aria-checked', String(v === paintState));
    const t = tool();
    for (const [k, b] of kindBtns) {
      const on = ph ? k === selectKind : k === deskKind;
      b.setAttribute('aria-checked', String(on));
      radio(b, on);
    }

    const what = describeSelection(selection);
    const stateWord = STATE_NAME[paintState].toLowerCase();
    setBtn.setAttribute('aria-label', `Set ${what} to ${stateWord}`);
    setBtn.title = `Set ${what} to ${stateWord} (S)`;
    setBtn.style.setProperty('--ed-tone', `rgb(${TONE[paintState]},${TONE[paintState]},${TONE[paintState]})`);
    invertBtn.setAttribute('aria-label', `Invert ${what}`);
    invertBtn.title = `Invert ${what}: out and in swap, flat stays (I)`;
    const shiftWhat = (axis) => (axis === 'x' && selection?.kind === 'row' ? `row ${selection.r + 1}` : axis === 'y' && selection?.kind === 'column' ? `column ${selection.c + 1}` : 'the tile');
    ['left', 'right', 'up', 'down'].forEach((dir, i) => {
      const label = `Shift ${shiftWhat(i < 2 ? 'x' : 'y')} ${dir}`;
      shiftBtns[i].setAttribute('aria-label', label);
      shiftBtns[i].title = label;
    });

    tileBtns.addRow.disabled = R >= max;
    tileBtns.removeRow.disabled = R <= 1;
    tileBtns.addColumn.disabled = C >= max;
    tileBtns.removeColumn.disabled = C <= 1;
    tileBtns.doubleRows.disabled = R * 2 > max;
    tileBtns.addRow.setAttribute('aria-label', `Add a row: a copy of row ${cursor.r + 1}`);
    tileBtns.removeRow.setAttribute('aria-label', `Remove row ${cursor.r + 1}`);
    tileBtns.addColumn.setAttribute('aria-label', `Add a column: a copy of column ${cursor.c + 1}`);
    tileBtns.removeColumn.setAttribute('aria-label', `Remove column ${cursor.c + 1}`);
    for (const b of Object.values(tileBtns)) b.title = b.getAttribute('aria-label');
    for (const [k, b] of Object.entries(fillBtns)) {
      const size = fillSize(C, k);
      b.disabled = size.columns > max || size.rows > max;
      b.setAttribute('aria-label', `${FILL_NAME[k]} from row ${cursor.r + 1}`);
      b.title = b.getAttribute('aria-label');
    }
    fillTitle.textContent = `Quick fills from row ${cursor.r + 1}`;
    if (edgesCtl) edgesCtl.set(edges ?? 'soft');

    // The phone shows one tab's tools; desktop all of them.
    const shown = new Set(TABS[tab]?.groups ?? []);
    for (const gEl of groups) gEl.classList.toggle('is-tab', !ph || shown.has(gEl.dataset.group));
    for (const [id, b] of tabBtns) {
      b.setAttribute('aria-selected', String(id === tab));
      b.tabIndex = id === tab ? 0 : -1;
    }
    d && render();
  }

  // ---- Lifecycle ----

  const ro = new ResizeObserver(() => render());
  ro.observe(stage);
  const onMedia = () => update();
  phoneMedia.addEventListener('change', onMedia);
  canvas.addEventListener('focus', () => render());
  canvas.addEventListener('blur', () => render());

  // Someone else changed the design (the size card, a restore, opening a
  // design). The store has already ended the editor's gesture. If the
  // target still shows what the editor last left there, carry on (a later
  // edit is a step of its own); otherwise the drawing was replaced, so close.
  const unsubscribe = store.subscribe((st, what) => {
    if (closed) return;
    if (what.has('design') && !writing && st.design !== mine) {
      const still = keyOf(st.design) === basis;
      mine = st.design;
      original = null;
      pushed = false;
      if (!still) {
        close({ commit: false });
        return;
      }
      update();
    }
  });

  function close({ commit = true } = {}) {
    if (closed) return;
    if (pushFrame) push();
    closed = true;
    if (commit && pushed) store.commit();
    unsubscribe();
    ro.disconnect();
    phoneMedia.removeEventListener('change', onMedia);
    removeEventListener('keydown', onWindowKey, true);
    host.removeEventListener('keydown', onHostKey);
    for (const off of detachers) off();
    edgesCtl?.destroy();
    host.hidden = true;
    host.replaceChildren();
    document.documentElement.classList.remove('is-editing');
    if (ctx.editorHistory === api) ctx.editorHistory = null;
    if (session === api) session = null;
    store.setView({ editor: null });
    if (returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus?.({ preventScroll: true }));
  }

  const api = {
    target,
    get id() { return start.id; },
    get grid() { return grid; },
    get selection() { return selection; },
    /** The grid's geometry as last drawn (gridView), for scripted checks. */
    get view() { return view; },
    undo,
    redo,
    canUndo: () => !closed && undoStack.length > 0,
    canRedo: () => !closed && redoStack.length > 0,
    close: () => close(),
    /** For scripted checks: an action by name, as the buttons run them. */
    act,
    setPaintState,
    setKind,
    setTab,
    select(sel) { selection = sel; update(); },
    setCursor(c, r) { cursor = wrapCell(grid, c, r); update(); },
  };
  ctx.editorHistory = api;
  store.setView({ editor: target.kind });
  update();
  requestAnimationFrame(() => {
    render();
    canvas.focus({ preventScroll: true });
  });
  return api;
}

// The design back as it was: the draft's fields replaced in place (store.change edits a draft).
function replaceDesign(draft, design) {
  for (const k of Object.keys(draft)) delete draft[k];
  Object.assign(draft, structuredClone(design));
}
