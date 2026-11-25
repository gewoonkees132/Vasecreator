// Pattern editor (design §9.2, D24): one row of cells laid out over a tile
// for the selected Detailed morph slot. Cells (out, middle, in), layout,
// edges and row height, with a live tile preview and a live pot: every edit
// is a store.change inside one gesture, so Apply adds a single history step
// and Cancel puts the design back as it was.
//
// Since the pattern studio's slice 1 it writes a `bitmap` recipe through the
// quick fills (core/patterns.js fillBitmap); the `motif` kind is gone (D45).
// This is a stopgap: slice 3 replaces it with the 2D editor (D46).

import { h, segmented } from './controls.js';
import { drawSwatch, beadGrid } from './swatch.js';
import { FILL_LAYOUTS, bitmapValues, fillBitmap, validateRecipe } from '../core/patterns.js';
import { LIMITS } from '../core/design.js';
import { savePattern } from '../store/assets.js';
import { footprintAt } from './sections/shape.js';

const MIN_CELLS = 2;
const MAX_CELLS = 8;
const MAX_ROW_LAYERS = 60;
const PREVIEW_PX = 168;
const DEFAULT_MOTIF = { cells: [1, -1, 1], layout: 'brick', edges: 'soft' };
// A new slot made by the editor (slot B was off).
const NEW_SLOT = { depthMm: 1.5, repeats: 8 };

const CELL_LABEL = { 1: 'out', 0: 'middle', '-1': 'in' };
const NEXT_CELL = { 1: 0, 0: -1, '-1': 1 };
const LAYOUT_LABEL = { stripes: 'Stripes', diagonal: 'Diagonal', brick: 'Brick', checker: 'Checker' };

/** A new id for one of your own patterns: 'user:' + 8 hex characters. */
export function newPatternId() {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return `user:${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** Rows of cells per tile: brick and checker alternate two rows, a diagonal steps once per cell. */
export function rowsPerTile(layout, cells) {
  return layout === 'brick' || layout === 'checker' ? 2 : layout === 'diagonal' ? cells : 1;
}

/**
 * The row and layout a bitmap was filled from, so the editor can open it
 * again: the first quick fill that gives exactly its cells, or null.
 * @param {object} recipe
 * @returns {{ cells: number[], layout: string, edges: string } | null}
 */
export function motifOf(recipe) {
  if (recipe?.kind !== 'bitmap') return null;
  const values = [...bitmapValues(recipe)];
  const row = values.slice(0, recipe.columns);
  const halves = row.filter((_, c) => c % 2 === 0);
  const candidates = [row, halves];
  for (const layout of ['stripes', 'checker', 'brick', 'diagonal']) {
    for (const cells of candidates) {
      if (cells.length < MIN_CELLS || cells.length > MAX_CELLS) continue;
      const fill = fillBitmap(cells, layout);
      if (fill.columns === recipe.columns && fill.rows === recipe.rows && fill.cells === recipe.cells) {
        return { cells, layout, edges: recipe.edges ?? 'soft' };
      }
    }
  }
  return null;
}

function tileHeightFor(layout, cells, rowLayers, layerHeightMm) {
  const min = LIMITS.tileHeightMm?.min ?? 0;
  const max = LIMITS.tileHeightMm?.max ?? Infinity;
  let layers = rowsPerTile(layout, cells) * rowLayers;
  layers = Math.max(layers, Math.ceil(min / layerHeightMm - 1e-9));
  layers = Math.min(layers, Math.max(1, Math.floor(max / layerHeightMm + 1e-9)));
  return Math.round(layers * layerHeightMm * 1000) / 1000;
}

let dialog = null;
let session = null;

function trapFocus(e) {
  if (e.key !== 'Tab' || !dialog) return;
  const focusable = [...dialog.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((n) => !n.disabled && !n.hidden && n.offsetParent !== null && n.tabIndex >= 0);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Opens the editor for a slot.
 * @param {object} ctx app context (store, library)
 * @param {{ slot: 'a' | 'b', findRecipe(id: string): { recipe: object, name: string } | null, onSaved?: () => void }} opts
 */
export function openPatternEditor(ctx, { slot: slotKey, findRecipe, onSaved }) {
  const { store } = ctx;
  if (session) session.close(false);
  if (!dialog) {
    dialog = h('dialog', { class: 'pattern-editor', 'aria-labelledby': 'pe-title' });
    dialog.addEventListener('keydown', trapFocus);
    document.body.append(dialog);
  }

  const start = store.state.design;
  const before = {
    detail: structuredClone(start.form.detail),
    hadAssets: Object.hasOwn(start, 'assets'),
    assets: structuredClone(start.assets ?? {}),
  };
  const slot0 = start.form.detail[slotKey];
  const found = slot0 && findRecipe(slot0.pattern);
  const opened = motifOf(found?.recipe);
  const fromMotif = !!opened;
  const recipe = structuredClone(opened ?? DEFAULT_MOTIF);
  /** The bitmap the cells, layout and edges make. */
  const bitmap = () => fillBitmap(recipe.cells, recipe.layout, recipe.edges);
  // Editing one of your own patterns keeps its id, so saving updates it.
  const id = fromMotif && String(slot0.pattern).startsWith('user:') ? slot0.pattern : newPatternId();
  let name = fromMotif && String(slot0.pattern).startsWith('user:') ? found.name : fromMotif ? `${found.name} (mine)` : 'My pattern';
  const lh = start.layers.layerHeightMm;
  let rowLayers = slot0
    ? Math.max(1, Math.min(MAX_ROW_LAYERS, Math.round(slot0.tileHeightMm / lh / rowsPerTile(recipe.layout, recipe.cells.length))))
    : 10;
  const S = slotKey.toUpperCase();
  const label = () => `Pattern ${S}: ${name}`;

  // ---- Live edit: the recipe goes into design.assets and the slot points at it.
  const push = () => {
    const made = bitmap();
    validateRecipe(made);
    store.change(label(), (d) => {
      d.assets ??= {};
      d.assets[id] = { kind: 'recipe', name, recipe: made };
      let s = d.form.detail[slotKey];
      if (!s) {
        s = d.form.detail[slotKey] = { pattern: id, ...NEW_SLOT, tileHeightMm: 0 };
        if (slotKey === 'b') d.form.detail.blend = { ...d.form.detail.blend, shape: 'fadesUp', amount: 1 };
      }
      if (!(s.depthMm > 0)) s.depthMm = NEW_SLOT.depthMm;
      s.pattern = id;
      s.tileHeightMm = tileHeightFor(recipe.layout, recipe.cells.length, rowLayers, d.layers.layerHeightMm);
    });
    drawPreview();
    updateRowHint();
  };

  // ---- Cells
  const cellsRow = h('div', { class: 'pe-cells', role: 'group', 'aria-labelledby': 'pe-cells-label' });
  const addBtn = h('button', { type: 'button', class: 'pe-cell-btn', 'aria-label': 'Add a cell', title: 'Add a cell', text: '+' });
  const removeBtn = h('button', { type: 'button', class: 'pe-cell-btn', 'aria-label': 'Remove the last cell', title: 'Remove the last cell', text: '−' });
  addBtn.addEventListener('click', () => {
    if (recipe.cells.length >= MAX_CELLS) return;
    recipe.cells.push(recipe.cells.length % 2 ? -1 : 1);
    renderCells();
    push();
  });
  removeBtn.addEventListener('click', () => {
    if (recipe.cells.length <= MIN_CELLS) return;
    recipe.cells.pop();
    renderCells();
    push();
  });
  const renderCells = () => {
    const chips = recipe.cells.map((v, i) => {
      const key = v > 0.5 ? 1 : v < -0.5 ? -1 : 0;
      const b = h('button', {
        type: 'button',
        class: `pe-cell pe-cell--${CELL_LABEL[key]}`,
        'aria-label': `Cell ${i + 1} of ${recipe.cells.length}: ${CELL_LABEL[key]}. Tap to change.`,
        text: CELL_LABEL[key],
      });
      b.addEventListener('click', () => {
        recipe.cells[i] = NEXT_CELL[key];
        renderCells();
        cellsRow.querySelectorAll('.pe-cell')[i]?.focus();
        push();
      });
      return b;
    });
    cellsRow.replaceChildren(...chips, removeBtn, addBtn);
    addBtn.disabled = recipe.cells.length >= MAX_CELLS;
    removeBtn.disabled = recipe.cells.length <= MIN_CELLS;
    cellsCount.textContent = `${recipe.cells.length} cells per repeat`;
  };
  const cellsCount = h('span', { class: 'pe-count' });

  // ---- Layout, edges, row height
  const layout = segmented({
    label: 'Layout',
    options: FILL_LAYOUTS.map((v) => ({ value: v, label: LAYOUT_LABEL[v] ?? v })),
    value: recipe.layout,
    onChange: (v) => {
      recipe.layout = v;
      updateRowHint();
      push();
    },
  });
  const edges = segmented({
    label: 'Edges',
    options: [{ value: 'sharp', label: 'Sharp' }, { value: 'soft', label: 'Soft' }, { value: 'round', label: 'Round' }],
    value: recipe.edges,
    onChange: (v) => {
      recipe.edges = v;
      push();
    },
  });
  const rowInput = h('input', {
    type: 'number', id: 'pe-row', class: 'pe-row-input', min: 1, max: MAX_ROW_LAYERS, step: 1, value: String(rowLayers), inputMode: 'numeric',
  });
  const rowStep = (delta) => {
    rowLayers = Math.max(1, Math.min(MAX_ROW_LAYERS, rowLayers + delta));
    rowInput.value = String(rowLayers);
    updateRowHint();
    push();
  };
  const rowMinus = h('button', { type: 'button', class: 'pe-step', 'aria-label': 'Fewer layers per row', text: '−' });
  const rowPlus = h('button', { type: 'button', class: 'pe-step', 'aria-label': 'More layers per row', text: '+' });
  rowMinus.addEventListener('click', () => rowStep(-1));
  rowPlus.addEventListener('click', () => rowStep(1));
  rowInput.addEventListener('change', () => {
    const v = Math.round(Number(String(rowInput.value).replace(',', '.')));
    rowStep(Number.isFinite(v) ? v - rowLayers : 0);
  });
  const rowHint = h('p', { class: 'pe-hint', id: 'pe-row-hint' });
  rowInput.setAttribute('aria-describedby', rowHint.id);
  const updateRowHint = () => {
    const d = store.state.design;
    const tile = tileHeightFor(recipe.layout, recipe.cells.length, rowLayers, d.layers.layerHeightMm);
    const rows = rowsPerTile(recipe.layout, recipe.cells.length);
    rowHint.textContent = rows > 1
      ? `${LAYOUT_LABEL[recipe.layout]} repeats every ${rows} rows, so one tile is ${round1(tile)} mm high.`
      : `${LAYOUT_LABEL[recipe.layout]} uses one row per tile, so one tile is ${round1(tile)} mm high.`;
    rowMinus.disabled = rowLayers <= 1;
    rowPlus.disabled = rowLayers >= MAX_ROW_LAYERS;
  };

  // ---- Preview
  const preview = h('canvas', { class: 'pe-preview', width: 1, height: 1, role: 'img', 'aria-label': 'Preview of the pattern, 2 by 2 tiles' });
  const drawPreview = () => {
    const d = store.state.design;
    const s = d.form.detail[slotKey] ?? { repeats: NEW_SLOT.repeats };
    const fp = footprintAt(d);
    const tile = tileHeightFor(recipe.layout, recipe.cells.length, rowLayers, d.layers.layerHeightMm);
    const g = beadGrid({ repeats: s.repeats, tileHeightMm: tile }, fp.perimeterMm, d.layers);
    drawSwatch(preview, bitmap(), { size: PREVIEW_PX, columns: g.columns, rows: g.rows, tiles: 2 });
  };

  // ---- Name, save, apply
  const nameInput = h('input', { type: 'text', id: 'pe-name', class: 'pe-name', value: name, maxLength: 40, autocomplete: 'off' });
  nameInput.addEventListener('input', () => {
    name = nameInput.value.trim() || 'My pattern';
    push();
  });
  const status = h('p', { class: 'pe-status', role: 'status' });
  const saveBtn = h('button', { type: 'button', class: 'btn', text: 'Save to My patterns' });
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const saved = await savePattern({ id, name, recipe: bitmap() });
      if (!saved) throw new Error('not stored');
      status.textContent = `Saved “${name}” to My patterns.`;
      onSaved?.();
    } catch (err) {
      console.warn('Pattern not saved', err);
      status.textContent = 'Couldn’t save it in this browser.';
    } finally {
      saveBtn.disabled = false;
    }
  });
  const cancelBtn = h('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancel' });
  const applyBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Apply' });
  cancelBtn.addEventListener('click', () => close(false));
  applyBtn.addEventListener('click', () => close(true));

  const field = (labelText, forId, control, extra) => h('div', { class: 'pe-field' }, [
    h('label', { class: 'pe-label', for: forId, text: labelText }), control, extra,
  ]);

  dialog.replaceChildren(
    h('div', { class: 'pe-body' }, [
      h('header', { class: 'pe-head' }, [
        h('h2', { id: 'pe-title', text: `Edit pattern ${S}` }),
        h('p', { class: 'pe-sub', text: 'Build a repeat from cells that push the wall out, leave it, or pull it in. The pot updates as you go.' }),
      ]),
      h('div', { class: 'pe-grid' }, [
        h('div', { class: 'pe-preview-box' }, [preview, h('span', { class: 'pe-hint', text: '2 × 2 tiles, one square per bead' })]),
        h('div', { class: 'pe-controls' }, [
          h('div', { class: 'pe-field' }, [
            h('div', { class: 'pe-label-row' }, [h('span', { class: 'pe-label', id: 'pe-cells-label', text: 'Cells' }), cellsCount]),
            cellsRow,
            h('p', { class: 'pe-hint', text: 'Tap a cell to switch it: out → middle → in.' }),
          ]),
          layout.el,
          edges.el,
          field('Row height', 'pe-row', h('div', { class: 'pe-row' }, [rowMinus, rowInput, h('span', { class: 'pe-unit', text: 'layers' }), rowPlus]), rowHint),
          field('Name', 'pe-name', nameInput),
        ]),
      ]),
      status,
      h('div', { class: 'dialog-actions pe-actions' }, [saveBtn, h('span', { class: 'pe-spacer' }), cancelBtn, applyBtn]),
    ]),
  );

  const onCancel = (e) => {
    // Esc: undo the live edits, like Cancel.
    e.preventDefault();
    close(false);
  };
  dialog.addEventListener('cancel', onCancel);

  function close(apply) {
    if (!session || session.close !== close) return;
    session = null;
    dialog.removeEventListener('cancel', onCancel);
    if (apply) {
      push();
      store.commit();
    } else {
      store.change(label(), (d) => {
        d.form.detail = structuredClone(before.detail);
        if (before.hadAssets) d.assets = structuredClone(before.assets);
        else delete d.assets;
      });
      store.commit();
    }
    if (dialog.open) dialog.close();
    opts.returnFocus?.focus?.();
  }
  const opts = { returnFocus: document.activeElement };
  session = { close };

  renderCells();
  updateRowHint();
  dialog.showModal();
  push();
  cellsRow.querySelector('.pe-cell')?.focus();
  return { close };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
