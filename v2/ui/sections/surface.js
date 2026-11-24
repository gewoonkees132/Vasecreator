// Pattern section (design §9.2, C7, C8, C16, C18; "Surface" before issue #1,
// and still the design's `surface` key): two pattern slots, the swatch grid
// that fills the selected slot, per-slot settings, and the shared range and
// blend, as the parts Swatch, Depth, Repeats, From / to and Blend of the
// Pattern step. Phase 2 (D24): "My patterns" (your own recipes and images)
// after the library, + Image, and Edit pattern… for the motif generator.

import { numberField, slider, segmented, h } from '../controls.js';
import { drawSwatch, drawRasterSwatch, beadGrid } from '../swatch.js';
import { PLAIN } from '../../core/patterns.js';
import { LIMITS, snapTileHeight } from '../../core/design.js';
import { footprintAt, limit } from './shape.js';
import { listPatterns, deletePattern, onPatternsChanged, loadImage, cachedImage } from '../../store/assets.js';
import { printableResolution } from '../../core/raster.js';

// The editor and the image decoder load on first use.
const lazy = (path) => {
  let p = null;
  return () => (p ??= import(path).catch((err) => { p = null; throw err; }));
};
const loadEditor = lazy('../pattern-editor.js');
const loadImages = lazy('../image-swatch.js');
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
// Starting values for your own recipe on a flat slot.
const USER_SLOT = { depthMm: 1.5, repeats: 8, tileHeightMm: 20 };
const IMAGE_REPEATS = 4;

const SLOT_SUB = { a: 'main pattern', b: 'blends in' };
const BLEND_LABELS = { even: 'even', fadesUp: 'fades up', middle: 'middle' };
const GRID_SWATCH = 52;
const SLOT_SWATCH = 34;
// Neutral values for a slot made from Plain, where there is nothing to keep.
const PLAIN_SLOT = { depthMm: 0, repeats: 1 };

// A pattern by id: Plain, the design's own assets (`user:` recipes and
// `img:` images), the library, then "My patterns" saved in this browser.
function findEntry(library, id, assets, saved) {
  if (id === PLAIN.id) return PLAIN;
  const a = assets?.[id];
  if (a?.kind === 'recipe' && a.recipe) return { id, name: a.name || 'My pattern', recipe: a.recipe, own: true };
  if (a?.kind === 'image') return { id, name: a.name || 'Image', image: a, own: true };
  return library.patterns.find((p) => p.id === id) ?? saved?.find((p) => p.id === id) ?? null;
}

// Whether the design draws with an asset (a slot or the morph map uses it).
function usesAsset(d, id) {
  return d.surface?.a?.pattern === id || d.surface?.b?.pattern === id || d.form?.morph?.map === id;
}

// "Prints at ≈ 39 × 100 beads per tile".
function resolutionText(slot, perimeterMm, layers) {
  let r = null;
  try { r = printableResolution(slot, perimeterMm, layers); } catch { r = null; }
  if (typeof r === 'string') return r;
  const g = beadGrid(slot, perimeterMm, layers);
  const across = Math.round(r?.around ?? r?.columns ?? r?.[0] ?? g.columns);
  const up = Math.round(r?.rows ?? r?.up ?? r?.[1] ?? g.rows);
  return `Prints at ≈ ${across} × ${up} beads per tile`;
}

// 'lib:out-in-out@1' → 'Out in out', for a summary without the library at hand.
function prettyId(id) {
  const s = String(id).replace(/^lib:/, '').replace(/@\d+$/, '').replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Whole layers, and never under the core's minimum tile height (the core
// would clamp it on the next load and the design would quietly change).
const TILE_MIN = LIMITS.tileHeightMm?.min ?? 0;
const TILE_MAX = LIMITS.tileHeightMm?.max ?? Infinity;
function snapToLayers(mm, layerHeightMm) {
  let n = Math.max(1, Math.ceil(TILE_MIN / layerHeightMm - 1e-9), Math.round(mm / layerHeightMm));
  n = Math.min(n, Math.max(1, Math.floor(TILE_MAX / layerHeightMm + 1e-9)));
  return Math.round(n * layerHeightMm * 1000) / 1000;
}

// A slot with a texture: set, and not Plain.
const textured = (slot) => !!slot && slot.pattern !== PLAIN.id;

const section = {
  id: 'surface',
  title: 'Pattern',

  summary(design, ctx) {
    const lib = ctx?.library;
    const name = (slot) => (lib && findEntry(lib, slot.pattern, design.assets)?.name) || prettyId(slot.pattern);
    const s = design.surface;
    if (!s.b) return s.a.pattern === PLAIN.id ? 'plain' : `${name(s.a)} · ${s.a.depthMm} mm`;
    return `${name(s.a)} → ${name(s.b)} · ${BLEND_LABELS[s.blend.shape] ?? s.blend.shape}`;
  },

  /**
   * The Pattern step's parts that apply now (C34), the same rules that hide
   * the controls below: Depth and Repeats with a pattern in the chosen slot,
   * From / to with a pattern in either slot, Blend once slot B is set.
   * @param {{ design: object, view: object }} state
   * @returns {string[]}
   */
  applies(state) {
    const s = state.design.surface;
    const out = ['swatch'];
    if (textured(s[state.view.slot === 'b' ? 'b' : 'a'])) out.push('depth', 'repeats');
    if (textured(s.a) || textured(s.b)) out.push('range');
    if (s.b) out.push('blend');
    return out;
  },

  mount(el, ctx) {
    const { store, library } = ctx;
    const commit = () => store.commit();
    const slotOf = () => (store.state.view.slot === 'b' ? 'b' : 'a');
    const S = () => slotOf().toUpperCase();

    // Slot cards and swap.
    const slotCards = {};
    const makeSlotCard = (s) => {
      const canvas = h('canvas', { class: 'slot-swatch', width: 1, height: 1, 'aria-hidden': 'true' });
      const name = h('span', { class: 'slot-name' });
      const btn = h('button', { type: 'button', class: 'slot-card' }, [
        h('span', { class: 'slot-thumb' }, [canvas, h('span', { class: 'slot-letter', 'aria-hidden': 'true', text: s.toUpperCase() })]),
        h('span', { class: 'slot-text' }, [name, h('span', { class: 'slot-sub', text: SLOT_SUB[s] })]),
      ]);
      btn.addEventListener('click', () => store.setView({ slot: s }));
      slotCards[s] = { btn, canvas, name, drawn: '' };
      return btn;
    };
    const swap = h('button', { type: 'button', class: 'icon-btn swap-btn', 'aria-label': 'Swap A and B', title: 'Swap A and B', text: '⇅' });
    swap.addEventListener('click', () => {
      if (!store.state.design.surface.b) return;
      store.apply('Swap A and B', (d) => {
        const t = d.surface.a;
        d.surface.a = d.surface.b;
        d.surface.b = t;
      });
    });
    const slots = h('div', { class: 'slot-row' }, [makeSlotCard('a'), swap, makeSlotCard('b')]);

    // Swatch grid: None (slot B only), the library, Plain.
    const gridLabel = h('div', { class: 'grid-label', id: `grid-label-${Math.random().toString(36).slice(2, 8)}` });
    const grid = h('div', { class: 'swatch-grid', role: 'group', 'aria-labelledby': gridLabel.id });
    const tiles = [];
    const addTile = (id, name, recipe) => {
      const canvas = recipe ? h('canvas', { class: 'swatch-canvas', width: 1, height: 1, 'aria-hidden': 'true' }) : h('span', { class: 'swatch-none', 'aria-hidden': 'true' });
      const btn = h('button', { type: 'button', class: 'swatch', title: name }, [canvas, h('span', { class: 'swatch-name', text: name })]);
      btn.addEventListener('click', () => pick(id));
      grid.append(btn);
      tiles.push({ id, name, recipe, btn, canvas, drawn: '' });
    };
    addTile(null, 'None', null);
    for (const p of library.patterns) addTile(p.id, p.name, p.recipe);
    addTile(PLAIN.id, PLAIN.name, PLAIN.recipe);

    const entryOf = (id, d = store.state.design) => findEntry(library, id, d.assets, saved);
    const pick = (id) => {
      const s = slotOf();
      const entry = id && entryOf(id);
      if (id && !entry) return;
      // An image the engine may not have yet (main.js also sends referenced ones).
      if (entry?.image) ensureImage(entry.image.hash);
      store.apply(`Pattern ${S()}: ${id ? entry.name : 'None'}`, (d) => {
        const surf = d.surface;
        if (!id) {
          surf.b = null;
          return;
        }
        if (entry.own || String(id).startsWith('user:')) {
          // Your own patterns travel inside the design (recipes are tiny; images are a reference).
          d.assets ??= {};
          d.assets[id] = entry.image ? { ...entry.image } : { kind: 'recipe', name: entry.name, recipe: structuredClone(entry.recipe) };
        }
        if (entry.image) {
          placeImage(d, s, id, entry.image);
          return;
        }
        const defaults = entry.defaults ?? (String(id).startsWith('user:') ? USER_SLOT : PLAIN_SLOT);
        const lh = d.layers.layerHeightMm;
        const cur = surf[s];
        if (!cur) {
          // Pattern rows line up with beads only at whole layers (C7).
          const tile = snapToLayers(defaults.tileHeightMm ?? surf.a.tileHeightMm, lh);
          surf[s] = { pattern: id, depthMm: defaults.depthMm ?? 0, repeats: defaults.repeats ?? 1, tileHeightMm: tile };
          if (s === 'b') surf.blend = { ...surf.blend, shape: 'fadesUp', amount: 1 };
          return;
        }
        // Switching texture keeps depth, repeats and tile height, except from
        // Plain (or a flat slot), which has nothing worth keeping.
        const flat = cur.pattern === PLAIN.id || !(cur.depthMm > 0);
        cur.pattern = id;
        if (flat && defaults !== PLAIN_SLOT) {
          Object.assign(cur, defaults);
          cur.tileHeightMm = snapToLayers(cur.tileHeightMm, lh);
        }
      });
    };

    // An image slot: keep the depth, 4 repeats around, and a tile as high as one
    // repeat is wide times the image's aspect, in whole layers.
    const placeImage = (d, s, id, asset) => {
      const surf = d.surface;
      const lh = d.layers.layerHeightMm;
      let cur = surf[s];
      if (!cur) {
        cur = surf[s] = { pattern: id, depthMm: USER_SLOT.depthMm, repeats: IMAGE_REPEATS, tileHeightMm: 0 };
        if (s === 'b') surf.blend = { ...surf.blend, shape: 'fadesUp', amount: 1 };
      }
      const wasImage = String(cur.pattern).startsWith('img:');
      if (!(cur.depthMm > 0) || cur.pattern === PLAIN.id) cur.depthMm = USER_SLOT.depthMm;
      if (!wasImage) cur.repeats = IMAGE_REPEATS;
      cur.pattern = id;
      const cellMm = footprintAt(d).perimeterMm / Math.max(1, cur.repeats);
      cur.tileHeightMm = snapToLayers(cellMm * (asset.height / Math.max(1, asset.width)), lh);
    };
    const ensureImage = (hash) => {
      Promise.resolve(loadImage(hash))
        .then((r) => r && ctx.engine?.setImage?.(hash, r))
        .catch((err) => console.warn('Image not sent to the preview', err));
    };

    // My patterns: saved in this browser, plus your own assets in this design.
    let saved = [];
    const refreshSaved = () =>
      Promise.resolve(listPatterns())
        .then((list) => {
          saved = Array.isArray(list) ? list : [];
          update(store.state);
        })
        .catch((err) => console.warn('My patterns not loaded', err));
    const mineLabel = h('div', { class: 'grid-label', id: `mine-label-${Math.random().toString(36).slice(2, 8)}`, text: 'My patterns' });
    const mineGrid = h('div', { class: 'swatch-grid mine-grid', role: 'group', 'aria-labelledby': mineLabel.id });
    let mineTiles = [];
    let mineKey = null;
    const fileInput = h('input', { type: 'file', accept: IMAGE_ACCEPT, class: 'visually-hidden image-file', tabIndex: -1, 'aria-hidden': 'true' });
    const imageBtn = h('button', { type: 'button', class: 'swatch swatch-action', title: 'Use an image as a pattern', 'aria-label': 'Add an image as a pattern' }, [
      h('span', { class: 'swatch-add', 'aria-hidden': 'true', text: '+' }),
      h('span', { class: 'swatch-name', text: 'Image' }),
    ]);
    const editBtn = h('button', { type: 'button', class: 'btn edit-pattern-btn', text: 'Edit pattern…' });
    const imageMsg = h('p', { class: 'panel-note image-msg', role: 'alert', hidden: true });
    const actions = h('div', { class: 'pattern-actions' }, [editBtn]);

    // Deleting one of My patterns, after a confirmation under the grid. The
    // design keeps its own copy when it uses the pattern, so the pot never
    // changes; an unused copy goes too, so the swatch leaves the grid.
    const confirmText = h('p', { class: 'mine-confirm-text', id: `mine-confirm-${Math.random().toString(36).slice(2, 8)}` });
    const confirmCancel = h('button', { type: 'button', class: 'btn', text: 'Cancel' });
    const confirmDelete = h('button', { type: 'button', class: 'btn btn-danger', text: 'Delete' });
    const confirmBox = h('div', { class: 'mine-confirm', role: 'group', 'aria-labelledby': confirmText.id, hidden: true }, [
      confirmText,
      h('div', { class: 'mine-confirm-actions' }, [confirmCancel, confirmDelete]),
    ]);
    let pendingDelete = null;
    const closeConfirm = (refocus) => {
      const p = pendingDelete;
      pendingDelete = null;
      confirmBox.hidden = true;
      if (refocus && p?.from?.isConnected) p.from.focus();
    };
    const askDelete = (entry, from) => {
      showImageMsg('');
      pendingDelete = { id: entry.id, name: entry.name, from };
      const used = usesAsset(store.state.design, entry.id);
      confirmText.textContent = `Delete “${entry.name}” from My patterns?${used ? ' This design keeps its own copy, so the pot doesn’t change.' : ''}`;
      confirmBox.hidden = false;
      confirmCancel.focus();
    };
    confirmCancel.addEventListener('click', () => closeConfirm(true));
    confirmBox.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeConfirm(true);
      }
    });
    confirmDelete.addEventListener('click', async () => {
      const p = pendingDelete;
      if (!p) return;
      closeConfirm(false);
      try {
        await deletePattern(p.id);
      } catch (err) {
        console.warn('Pattern not deleted', err);
        showImageMsg('That pattern couldn’t be deleted. Try again.');
        return;
      }
      const d = store.state.design;
      const used = usesAsset(d, p.id);
      if (!used && d.assets?.[p.id]) store.apply(`Delete pattern ${p.name}`, (dd) => { delete dd.assets[p.id]; });
      await refreshSaved();
      showImageMsg(used ? `“${p.name}” is no longer in My patterns. This design keeps its own copy.` : '');
      imageBtn.focus();
    });

    const showImageMsg = (text) => {
      imageMsg.textContent = text;
      imageMsg.hidden = !text;
    };
    imageBtn.addEventListener('click', () => {
      showImageMsg('');
      loadImages().catch(() => {}); // warm up while the picker is open
      fileInput.value = '';
      fileInput.click();
    });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const s = slotOf();
      imageBtn.disabled = true;
      imageBtn.setAttribute('aria-busy', 'true');
      showImageMsg('Reading the image…');
      try {
        const m = await loadImages();
        const problem = m.fileProblem(file);
        if (problem) throw new Error(problem);
        const { id, asset } = await m.importImage(ctx, file);
        showImageMsg('');
        store.apply(`Pattern ${s.toUpperCase()}: ${asset.name}`, (d) => {
          d.assets ??= {};
          d.assets[id] = asset;
          placeImage(d, s, id, asset);
        });
      } catch (err) {
        // Plain Errors carry a message for the person; anything else is unexpected.
        const plain = err?.constructor === Error && err.message;
        if (!plain) console.warn('Image not used', err);
        showImageMsg(plain ? err.message : 'That image couldn’t be used. Try a PNG, JPEG or WebP file.');
      } finally {
        imageBtn.disabled = false;
        imageBtn.removeAttribute('aria-busy');
      }
    });
    editBtn.addEventListener('click', () => {
      showImageMsg('');
      loadEditor()
        .then((m) => m.openPatternEditor(ctx, { slot: slotOf(), findRecipe: (id) => entryOf(id), onSaved: refreshSaved }))
        .catch((err) => {
          console.warn('Pattern editor not loaded', err);
          showImageMsg('The pattern editor didn’t load. Reload the page to try again.');
        });
    });

    const mineEntries = (d) => {
      const out = new Map();
      for (const p of saved) out.set(p.id, { id: p.id, name: p.name, recipe: p.recipe });
      for (const id of Object.keys(d.assets ?? {})) {
        const e = findEntry(library, id, d.assets);
        if (e?.own) out.set(id, e);
      }
      return [...out.values()];
    };
    // Draws a recipe or image swatch on this pot's bead grid; redraws only when
    // the pattern or the grid changed. Images draw once their pixels are in.
    const drawEntry = (target, entry, slot, fp, layers, size) => {
      if (!entry) return;
      if (entry.image) {
        const a = entry.image;
        const sl = slot ?? { repeats: IMAGE_REPEATS, tileHeightMm: (fp.perimeterMm / IMAGE_REPEATS) * (a.height / Math.max(1, a.width)) };
        const g = beadGrid(sl, fp.perimeterMm, layers);
        const raster = cachedImage(a.hash);
        const key = `${entry.id}|${Math.round(g.columns)}|${Math.round(g.rows)}|${raster ? 1 : 0}`;
        if (key === target.drawn) return;
        target.drawn = key;
        if (raster) drawRasterSwatch(target.canvas, raster, { id: entry.id, size, columns: g.columns, rows: g.rows });
        else {
          drawSwatch(target.canvas, PLAIN.recipe, { id: PLAIN.id, size });
          Promise.resolve(loadImage(a.hash)).then((r) => { if (r) update(store.state); }, () => {});
        }
        return;
      }
      const g = beadGrid(slot ?? entry.defaults ?? USER_SLOT, fp.perimeterMm, layers);
      // Library recipes cache by id; your own can change under the same id.
      const own = entry.own || String(entry.id).startsWith('user:');
      const key = `${entry.id}|${own ? JSON.stringify(entry.recipe) : ''}|${Math.round(g.columns)}|${Math.round(g.rows)}`;
      if (key === target.drawn) return;
      target.drawn = key;
      drawSwatch(target.canvas, entry.recipe, { id: own ? undefined : entry.id, size, columns: g.columns, rows: g.rows });
    };
    const renderMine = (d, fp, layers, slot) => {
      const list = mineEntries(d);
      const savedIds = new Set(saved.map((p) => p.id));
      const key = list.map((e) => `${e.id}|${e.name}|${savedIds.has(e.id) ? 1 : 0}`).join(';');
      if (key !== mineKey) {
        mineKey = key;
        mineTiles = list.map((e) => {
          const canvas = h('canvas', { class: 'swatch-canvas', width: 1, height: 1, 'aria-hidden': 'true' });
          const btn = h('button', { type: 'button', class: 'swatch', title: e.name }, [canvas, h('span', { class: 'swatch-name', text: e.name })]);
          btn.addEventListener('click', () => pick(e.id));
          // Saved in this browser: a corner button deletes it (after a confirmation).
          if (!savedIds.has(e.id)) return { id: e.id, el: btn, btn, canvas, drawn: '' };
          const del = h('button', { type: 'button', class: 'swatch-del', title: 'Delete from My patterns', 'aria-label': `Delete ${e.name} from My patterns` }, [
            h('span', { class: 'swatch-del-dot', 'aria-hidden': 'true', text: '×' }),
          ]);
          del.addEventListener('click', () => askDelete(e, del));
          return { id: e.id, el: h('div', { class: 'swatch-item' }, [btn, del]), btn, canvas, drawn: '' };
        });
        mineGrid.replaceChildren(...mineTiles.map((t) => t.el), imageBtn);
        if (pendingDelete && !savedIds.has(pendingDelete.id)) closeConfirm(false);
      }
      for (const t of mineTiles) {
        const e = list.find((x) => x.id === t.id);
        const on = !!slot && slot.pattern === t.id;
        t.btn.setAttribute('aria-pressed', String(on));
        drawEntry(t, e, on ? slot : null, fp, layers, GRID_SWATCH);
      }
    };

    // Per-slot settings. Each reads the selected slot when it fires.
    const editSlot = (label, fn) => (v) => store.change(`${label} ${S()}`, (d) => {
      const slot = d.surface[slotOf()];
      if (slot) fn(slot, v, d);
    });
    const depthLim = limit(['depthMm', 'surface.depthMm', 'patternDepth'], { min: 0, max: 8, step: 0.1 });
    const depth = slider({
      label: 'Depth', unit: 'mm', ...depthLim, snap: 0.5, decimals: 1, value: 0,
      onInput: editSlot('Depth', (slot, v) => { slot.depthMm = v; }),
      onCommit: commit,
    });
    const repeats = numberField({
      label: 'Repeats around', unit: '×', ...limit(['repeats', 'surface.repeats'], { min: 1, max: 200 }), step: 1, decimals: 0, value: 1, info: '',
      onInput: editSlot('Repeats', (slot, v) => { slot.repeats = Math.max(1, Math.round(v)); }),
      onCommit: commit,
    });
    const tileHeight = numberField({
      label: 'Tile height', unit: 'mm', ...limit(['tileHeightMm', 'surface.tileHeightMm'], { min: 1, max: 400 }), step: 1.5, decimals: 2, value: 20,
      // Rows of the pattern line up with beads only at whole layers, live and
      // at the end of the gesture (which also puts the snapped value in the field).
      onInput: editSlot('Tile height', (slot, v, d) => { slot.tileHeightMm = snapToLayers(v, d.layers.layerHeightMm); }),
      onCommit: (v) => {
        const lh = store.state.design.layers.layerHeightMm;
        store.change(`Tile height ${S()}`, (d) => {
          const slot = d.surface[slotOf()];
          if (slot) slot.tileHeightMm = snapToLayers(v, lh);
        });
        store.commit();
      },
    });
    const emptyNote = h('p', { class: 'panel-note', text: 'B is off. Pick a pattern above to blend it in.' });
    const plainNote = h('p', { class: 'panel-note', text: 'Plain leaves the surface smooth.' });
    const resNote = h('p', { class: 'panel-note res-note', hidden: true });
    const slotBox = h('div', { class: 'slot-settings' }, [depth.el, repeats.el, tileHeight.el, resNote]);

    // Shared range and blend.
    const rangeLim = limit(['fromMm', 'surface.fromMm'], { min: 0, max: 600, step: 1 });
    const from = numberField({
      label: 'From', unit: 'mm', compact: true, ...rangeLim, decimals: 1, value: 0,
      onInput: (v) => store.change('From', (d) => { d.surface.fromMm = Math.min(v, d.surface.toMm - 1); }),
      onCommit: commit,
    });
    const to = numberField({
      label: 'To', unit: 'mm', compact: true, ...rangeLim, decimals: 1, value: 0,
      onInput: (v) => store.change('To', (d) => { d.surface.toMm = Math.max(v, d.surface.fromMm + 1); }),
      onCommit: commit,
    });
    const rangeRow = h('div', { class: 'nf range-row' }, [
      h('span', { class: 'nf-label', text: 'From / to' }),
      h('div', { class: 'range-fields' }, [from.el, h('span', { class: 'range-dash', 'aria-hidden': 'true', text: '–' }), to.el]),
    ]);
    const blend = segmented({
      label: 'Blend',
      options: [{ value: 'even', label: 'Even' }, { value: 'fadesUp', label: 'Fades up' }, { value: 'middle', label: 'Middle' }],
      value: 'fadesUp',
      onChange: (v) => store.apply('Blend', (d) => {
        if (!d.surface.blend) d.surface.blend = { shape: v, amount: 1 };
        d.surface.blend.shape = v;
        // Even at full amount is all B; start at half so the first click shows a mix.
        if (v === 'even' && d.surface.blend.amount === 1) d.surface.blend.amount = 0.5;
      }),
    });
    const amount = slider({
      label: 'Amount', unit: '×', min: 0, max: 1, step: 0.01, snap: 0.05, decimals: 2, value: 1, info: '',
      onInput: (v) => store.change('Amount', (d) => { d.surface.blend.amount = v; }),
      onCommit: commit,
    });
    const blendBox = h('div', { class: 'blend-settings' }, [blend.el, amount.el]);

    // The library and My patterns share one strip: on desktop it stacks as two
    // grids, on a phone it is one row that scrolls sideways (C35).
    const strip = h('div', { class: 'swatch-strip' }, [grid, mineLabel, mineGrid]);

    // The Pattern step's parts (ui/steps.js). The slot cards belong to every
    // part that edits the chosen slot, so on a phone they stay in sight (C34).
    slots.dataset.part = 'swatch depth repeats';
    for (const e of [gridLabel, strip, confirmBox, imageMsg, actions, emptyNote, plainNote]) e.dataset.part = 'swatch';
    slotBox.dataset.part = 'depth repeats';
    depth.el.dataset.part = 'depth';
    for (const e of [repeats.el, tileHeight.el, resNote]) e.dataset.part = 'repeats';
    rangeRow.dataset.part = 'range';
    blendBox.dataset.part = 'blend';
    el.append(slots, gridLabel, strip, confirmBox, fileInput, imageMsg, actions, emptyNote, plainNote, slotBox, rangeRow, blendBox);

    const update = (state) => {
      const d = state.design;
      const surf = d.surface;
      const s = state.view.slot === 'b' ? 'b' : 'a';
      const slot = surf[s];
      const fp = footprintAt(d);
      const layers = d.layers;

      for (const k of ['a', 'b']) {
        const card = slotCards[k];
        const sl = surf[k];
        const entry = sl && findEntry(library, sl.pattern, d.assets, saved);
        card.name.textContent = sl ? entry?.name ?? sl.pattern : 'None';
        card.btn.setAttribute('aria-pressed', String(k === s));
        card.btn.setAttribute('aria-label', `Slot ${k.toUpperCase()}, ${SLOT_SUB[k]}: ${sl ? entry?.name ?? sl.pattern : 'none'}`);
        card.canvas.hidden = !sl;
        card.btn.classList.toggle('is-none', !sl);
        if (sl && entry) drawEntry(card, { ...entry, id: sl.pattern }, sl, fp, layers, SLOT_SWATCH);
      }
      swap.disabled = !surf.b;

      gridLabel.textContent = `Pattern for ${s.toUpperCase()}`;
      for (const t of tiles) {
        t.btn.hidden = t.id === null && s !== 'b';
        const selected = slot ? t.id === slot.pattern : t.id === null;
        t.btn.setAttribute('aria-pressed', String(selected));
        if (t.recipe) {
          // Each swatch at its own default repeat size, on this pot's bead grid.
          const entry = findEntry(library, t.id);
          const g = beadGrid(entry.defaults ?? { repeats: 12, tileHeightMm: 18 }, fp.perimeterMm, layers);
          const key = `${Math.round(g.columns)}|${Math.round(g.rows)}`;
          if (key !== t.drawn) {
            drawSwatch(t.canvas, t.recipe, { id: t.id, size: GRID_SWATCH, columns: g.columns, rows: g.rows });
            t.drawn = key;
          }
        }
      }

      renderMine(d, fp, layers, slot);
      editBtn.setAttribute('aria-label', `Edit pattern ${s.toUpperCase()}`);

      const isPlain = slot && slot.pattern === PLAIN.id;
      const isImage = !!slot && d.assets?.[slot.pattern]?.kind === 'image';
      resNote.hidden = !isImage;
      if (isImage) resNote.textContent = resolutionText(slot, fp.perimeterMm, layers);
      emptyNote.hidden = !!slot;
      plainNote.hidden = !isPlain;
      slotBox.hidden = !slot || isPlain;
      if (slot && !isPlain) {
        depth.set(slot.depthMm);
        repeats.set(slot.repeats);
        const perRepeat = fp.perimeterMm / Math.max(1, slot.repeats);
        let info = `≈ ${Math.round(perRepeat)} mm per repeat`;
        if (d.form.plan.footprint === 'rectangle' && slot.repeats % 4 !== 0) info += ' · a multiple of 4 fits the corners';
        repeats.setInfo(info);
        tileHeight.setLimits({ step: layers.layerHeightMm });
        // Show the height that prints: the core snaps it to whole layers (C7).
        tileHeight.set(snapTileHeight(slot.tileHeightMm, layers.layerHeightMm));
      }

      from.set(surf.fromMm);
      to.set(surf.toMm);
      from.setLimits({ max: d.form.height });
      to.setLimits({ max: d.form.height });

      blendBox.hidden = !surf.b;
      if (surf.b) {
        blend.set(surf.blend.shape);
        amount.set(surf.blend.amount);
        const b = Math.round(surf.blend.amount * 100);
        const where = { fadesUp: 'At the top: ', middle: 'Halfway up: ' }[surf.blend.shape] ?? '';
        amount.setInfo(`${where}A ${100 - b} % · B ${b} %`);
      }
    };
    update(store.state);
    refreshSaved();
    const offPatterns = onPatternsChanged(refreshSaved);

    return {
      update,
      destroy() {
        offPatterns?.();
        el.replaceChildren();
      },
    };
  },
};

export default section;
export const { id, title, summary, applies, mount } = section;
