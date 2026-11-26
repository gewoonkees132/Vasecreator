// The Designs screen (design §8.3, D13, C14): Last design and the three
// presets, then the saved designs and a "+ Save design" tile. Saved designs
// live in IndexedDB (store/db.js); design files move them between devices.
//
// Presets are shapes (D30, C29, narrowed by D52): their tiles show the pot
// with its Morph, which is part of the shape now, and
// opening one starts on Shape without a Pattern, keeping its form, layers,
// base and finish. Saved designs and design files
// open whole. Everything opens on the Shape step, except Last design, which
// keeps the step you're on.

import { looksLikeDesign, normaliseDesign } from '../core/design.js';
import { designFileBlob, takeFileImages, FILE_MAX_BYTES } from './design-file.js';
import { shapeOnly } from './steps.js';
import { labelIcon } from './press-label.js';

const LS_NOTE = 'vc2.storageNoteDismissed';
const FILE_SUFFIX = '.vasecreator.json';
const NAME_MAX = 80;
// A design file is a few KB plus its images (ui/design-file.js caps those at 8 MB).

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

// Designs compare without meta, like the store does.
function sameDesign(a, b) {
  if (!a || !b) return false;
  const { meta: _a, ...ra } = a;
  const { meta: _b, ...rb } = b;
  return JSON.stringify(ra) === JSON.stringify(rb);
}

function newTileId() {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function fileName(name) {
  const safe = String(name || 'design').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim()
    .replace(/^\.+/, '').slice(0, NAME_MAX) || 'design';
  return safe + FILE_SUFFIX;
}

function lsGet(name) { try { return localStorage.getItem(name); } catch { return null; } }
function lsSet(name, v) { try { localStorage.setItem(name, v); } catch { /* storage off */ } }

/**
 * A small modal on top of everything (also on top of the Designs screen):
 * asks for a name or a confirmation. One element, reused.
 */
function createAsker() {
  const dialog = el('dialog', { class: 'small-dialog', 'aria-labelledby': 'ask-title' });
  document.body.append(dialog);
  let resolveFn = null;

  dialog.addEventListener('close', () => {
    const r = resolveFn;
    resolveFn = null;
    r?.(dialog.returnValue === 'cancel' || dialog.returnValue === '' ? null : dialog.returnValue);
  });

  /**
   * @param {{ title: string, text?: string, name?: string, buttons: { value: string, label: string, primary?: boolean, danger?: boolean }[] }} o
   * @returns {Promise<{ action: string, name: string } | null>}
   */
  function ask({ title, text, name, buttons }) {
    const input = name != null
      ? el('input', { type: 'text', name: 'name', value: name, maxlength: '80', autocomplete: 'off', required: true, spellcheck: 'false' })
      : null;
    const form = el('form', { method: 'dialog' }, [
      el('h2', { id: 'ask-title', text: title }),
      text ? el('p', { text }) : '',
      input ? el('label', {}, ['Name', input]) : '',
      el('div', { class: 'dialog-actions' }, [
        el('button', { type: 'submit', value: 'cancel', class: 'btn', formnovalidate: true, text: 'Cancel' }),
        ...buttons.map((b) => el('button', {
          type: 'submit', value: b.value,
          class: `btn${b.primary ? ' btn-primary' : ''}${b.danger ? ' btn-danger' : ''}`,
          text: b.label,
        })),
      ]),
    ]);
    // Enter in the name field must not pick the first submit button (Cancel).
    input?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const primary = form.querySelector('.btn-primary, .btn-danger');
      if (primary) form.requestSubmit(primary);
    });
    dialog.replaceChildren(form);
    dialog.returnValue = '';
    return new Promise((resolve) => {
      resolveFn = (action) => resolve(action ? { action, name: (input?.value || '').trim() } : null);
      dialog.showModal();
      if (input) { input.focus(); input.select(); }
      else form.querySelector('.btn-primary, .btn-danger')?.focus();
    });
  }
  return { ask };
}

/**
 * Mounts the Designs screen in dialog#designs.
 * @param {HTMLDialogElement} dialog
 * @param {{ store, presets: object[], db, renderer, thumbnailFor(design): Promise<Blob | null>, requestFit(): void }} ctx
 * @param {{ lastDesign?: { design: object, savedId: string | null, thumb: Blob | null } | null }} [options]
 *   the design the visitor left off with (newest step at load), or null on a first visit
 * @returns {{ open(): void, close(): void, promptSave(): Promise<void>, get isOpen(): boolean }}
 */
export function mountDesigns(dialog, ctx, { lastDesign = null } = {}) {
  const { store, db } = ctx;
  const asker = createAsker();

  /** @type {{ id: string, name: string, design: object, thumb: Blob | null, updated: number }[]} */
  let saved = [];
  const savedReady = db.all('designs').then((rows) => {
    saved = rows.filter((r) => r && r.id && r.design)
      .map((r) => ({ ...r, name: String(r.name || 'Design').slice(0, NAME_MAX), updated: Number(r.updated) || 0 }))
      .sort((a, b) => b.updated - a.updated);
  });

  // Normalised presets as shapes, made once; a broken preset is skipped, not fatal.
  const presets = (ctx.presets || []).map((p) => {
    try { return shapeOnly(normaliseDesign(p)); } catch (err) { console.warn('[designs] preset skipped', err); return null; }
  }).filter(Boolean);

  // Thumbnail object URLs: presets and Last design are cached for the session;
  // saved tiles get fresh URLs per render and the old ones are revoked.
  const cachedUrls = new Map();
  let tileUrls = [];

  // ---------- Layout ----------

  const closeBtn = labelIcon(el('button', { type: 'button', class: 'icon-close', text: '×', onclick: () => close() }), 'Close Designs');
  const continueGrid = el('div', { class: 'tile-grid' });
  const savedGrid = el('div', { class: 'tile-grid' });
  const status = el('p', { class: 'tile-sub', role: 'status', 'aria-live': 'polite' });
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  const openFileBtn = el('button', { type: 'button', class: 'btn', text: 'Open design file…', onclick: () => fileInput.click() });
  const note = el('div', { class: 'storage-note' }, [
    el('p', { text: 'Browsers can clear saved designs. Download the ones you care about.' }),
    el('button', {
      type: 'button', class: 'btn btn-ghost', text: 'Got it',
      onclick: () => { lsSet(LS_NOTE, '1'); note.hidden = true; },
    }),
  ]);
  note.hidden = lsGet(LS_NOTE) === '1';

  // Saving from the top bar happens with the Designs screen closed, so the
  // confirmation shows as a short note under the top bar instead.
  const toast = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  document.body.append(toast);
  let toastTimer = 0;
  function notify(text) {
    status.textContent = text;
    if (isOpen()) return;
    toast.textContent = text;
    toast.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('is-shown');
      toastTimer = setTimeout(() => { toast.textContent = ''; }, 400);
    }, 2600);
  }

  dialog.replaceChildren(
    el('div', { class: 'designs-head' }, [
      el('h2', { id: 'designs-title', text: 'Designs' }),
      el('p', { class: 'designs-hint', text: 'Click one to start from it' }),
      closeBtn,
    ]),
    el('div', { class: 'designs-body' }, [
      el('h3', { class: 'designs-row-title', text: lastDesign ? 'Continue · Presets' : 'Presets' }),
      continueGrid,
      el('h3', { class: 'designs-row-title', text: 'Saved' }),
      savedGrid,
      note,
      el('div', { class: 'designs-foot' }, [openFileBtn, fileInput, status]),
    ]),
  );

  // ---------- Tiles ----------

  function thumbImg(url, loading) {
    return el('img', { class: `tile-thumb${loading ? ' is-loading' : ''}`, alt: '', draggable: 'false', ...(url ? { src: url } : {}) });
  }

  // Thumbnails are rendered one at a time: the engine answers the newest
  // request only, so a queue keeps tiles from cancelling each other.
  let queue = Promise.resolve();
  function lazyThumb(img, cacheKey, design) {
    if (cachedUrls.has(cacheKey)) { img.src = cachedUrls.get(cacheKey); return; }
    img.classList.add('is-loading');
    queue = queue.then(async () => {
      if (cachedUrls.has(cacheKey)) { img.src = cachedUrls.get(cacheKey); return; }
      let blob = null;
      try { blob = await ctx.thumbnailFor(design); } catch (err) { console.warn('[designs] thumbnail failed', err); }
      if (blob) {
        const url = URL.createObjectURL(blob);
        cachedUrls.set(cacheKey, url);
        img.src = url;
      }
    }).finally(() => img.classList.remove('is-loading'));
  }

  function tile({ name, sub, onOpen, extraClass = '', label }) {
    const img = thumbImg(null, false);
    const openBtn = el('button', {
      type: 'button', class: 'tile-open', 'aria-label': label || `Open ${name}`, onclick: onOpen,
    }, [img, el('span', { class: 'tile-text' }, [
      el('span', { class: 'tile-name', text: name }),
      sub ? el('span', { class: 'tile-sub', text: sub }) : '',
    ])]);
    const node = el('div', { class: `tile ${extraClass}`.trim() }, [openBtn]);
    return { node, img, openBtn };
  }

  function renderContinue() {
    const tiles = [];
    if (lastDesign) {
      const t = tile({
        name: 'Last design', sub: 'where you left off', extraClass: 'is-last',
        label: 'Open Last design, where you left off',
        onOpen: () => {
          if (sameDesign(store.state.design, lastDesign.design)) { close(); return; }
          openDesign(lastDesign.design, 'Last design', lastDesign.savedId, { keepStep: true });
        },
      });
      if (lastDesign.thumb) {
        if (!cachedUrls.has('last')) cachedUrls.set('last', URL.createObjectURL(lastDesign.thumb));
        t.img.src = cachedUrls.get('last');
      } else {
        lazyThumb(t.img, 'last', lastDesign.design);
      }
      tiles.push(t);
    }
    presets.forEach((p, i) => {
      const name = p.meta?.name || `Preset ${i + 1}`;
      const t = tile({ name, onOpen: () => openDesign(p, name, null) });
      lazyThumb(t.img, `preset:${p.meta?.id || i}`, p);
      tiles.push(t);
    });
    continueGrid.replaceChildren(...tiles.map((t) => t.node));
    return tiles[0]?.openBtn;
  }

  let openMenuEl = null;
  function closeTileMenu() {
    if (!openMenuEl) return;
    openMenuEl.hidden = true;
    openMenuEl.previousElementSibling?.setAttribute('aria-expanded', 'false');
    openMenuEl = null;
  }

  function renderSaved() {
    for (const url of tileUrls) URL.revokeObjectURL(url);
    tileUrls = [];
    const nodes = saved.map((rec) => {
      const t = tile({
        name: rec.name,
        sub: new Date(rec.updated || Date.now()).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
        onOpen: () => openSaved(rec),
      });
      if (rec.thumb instanceof Blob) {
        const url = URL.createObjectURL(rec.thumb);
        tileUrls.push(url);
        t.img.src = url;
      }
      const menuBtn = labelIcon(el('button', {
        type: 'button', class: 'tile-menu-btn', text: '⋯', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
      }), `More for ${rec.name}`);
      const item = (text, fn, cls = '') => el('button', {
        type: 'button', role: 'menuitem', class: `menu-item ${cls}`.trim(), text,
        onclick: () => { closeTileMenu(); fn(); },
      });
      const menu = el('div', { class: 'menu', role: 'menu', hidden: true }, [
        item('Rename', () => renameSaved(rec)),
        item('Duplicate', () => duplicateSaved(rec)),
        item('Download design file', () => downloadSaved(rec)),
        item('Delete', () => deleteSaved(rec), 'btn-danger'),
      ]);
      menuBtn.addEventListener('click', () => {
        const wasOpen = openMenuEl === menu;
        closeTileMenu();
        if (wasOpen) return;
        menu.hidden = false;
        menuBtn.setAttribute('aria-expanded', 'true');
        openMenuEl = menu;
        menu.querySelector('.menu-item')?.focus();
      });
      t.node.append(menuBtn, menu);
      return t.node;
    });
    const addTile = el('button', {
      type: 'button', class: 'tile-add', onclick: () => promptSave(),
    }, [el('span', { text: '+ Save design' }), el('small', { text: 'adds the current design' })]);
    savedGrid.replaceChildren(...nodes, addTile);
  }

  dialog.addEventListener('pointerdown', (e) => {
    if (openMenuEl && !openMenuEl.contains(e.target) && !e.target.closest('.tile-menu-btn')) closeTileMenu();
  });

  // ---------- Actions ----------

  function openDesign(design, name, savedId, { keepStep = false } = {}) {
    // A design you open starts on Shape (§7.1); Last design carries on where you are.
    if (!keepStep && store.state.view.step !== 'shape') store.setView({ step: 'shape', highlight: null });
    store.open(design, `Opened: ${name}`, { savedId });
    ctx.requestFit();
    close();
  }

  function openSaved(rec) {
    let design;
    try { design = normaliseDesign(rec.design); } catch (err) {
      status.textContent = `"${rec.name}" could not be opened.`;
      console.warn(err);
      return;
    }
    openDesign(design, rec.name, rec.id);
  }

  function nextName() {
    const names = new Set(saved.map((s) => s.name));
    let n = saved.length + 1;
    while (names.has(`Design ${n}`)) n += 1;
    return `Design ${n}`;
  }

  async function currentThumb() {
    // The renderer shows the current design's beads; render a fresh one only
    // when there is no preview yet, or when the pot on screen is plain (Shape):
    // a saved tile shows the finished pot (§7.3).
    try {
      if (store.state.result && !ctx.resultIsPlain?.()) return await ctx.renderer.thumbnail();
      return await ctx.thumbnailFor(store.state.design);
    } catch (err) {
      console.warn('[designs] thumbnail failed', err);
      return null;
    }
  }

  /** @returns {Promise<boolean>} false when the browser didn't store it (the tile stays for this session) */
  async function putRecord(rec) {
    const ok = await db.put('designs', rec.id, rec);
    const i = saved.findIndex((s) => s.id === rec.id);
    if (i >= 0) saved.splice(i, 1);
    saved.unshift(rec);
    if (isOpen()) renderSaved();
    if (ok === false) notify(`Couldn't store "${rec.name}" in this browser. Download the design file to keep it.`);
    return ok !== false;
  }

  // One save at a time: a second click while the name is asked or the tile
  // is written would add a second tile instead of updating the first.
  let saving = null;
  function promptSave() {
    saving ||= saveDesign().finally(() => { saving = null; });
    return saving;
  }

  /** Save design: asks for a name; updates the tile it came from, or adds one. */
  async function saveDesign() {
    await savedReady;
    const current = saved.find((s) => s.id === store.state.savedId) || null;
    const answer = await asker.ask(current
      ? {
        title: 'Save design',
        text: `Updates "${current.name}" in your saved designs.`,
        name: current.name,
        buttons: [{ value: 'new', label: 'Save as new' }, { value: 'update', label: 'Save', primary: true }],
      }
      : {
        title: 'Save design',
        text: 'Adds it to your saved designs in this browser.',
        name: nextName(),
        buttons: [{ value: 'new', label: 'Save', primary: true }],
      });
    if (!answer) return;
    let name = answer.name || (current ? current.name : nextName());
    // Save as new with the name left as it was: two tiles of one name would confuse.
    if (current && answer.action === 'new' && name === current.name) name = `${name} copy`;
    const id = answer.action === 'update' && current ? current.id : newTileId();
    const thumb = await currentThumb();
    const design = structuredClone(store.state.design);
    design.meta = { ...(design.meta || {}), name };
    const ok = await putRecord({ id, name, design, thumb, updated: Date.now() });
    store.setSaved(id, name);
    if (ok) notify(`Saved "${name}".`);
  }

  async function renameSaved(rec) {
    const answer = await asker.ask({ title: 'Rename design', name: rec.name, buttons: [{ value: 'ok', label: 'Rename', primary: true }] });
    if (!answer || !answer.name) return;
    const next = { ...rec, name: answer.name, design: { ...rec.design, meta: { ...(rec.design.meta || {}), name: answer.name } }, updated: Date.now() };
    await putRecord(next);
    if (store.state.savedId === rec.id) store.setSaved(rec.id, answer.name);
  }

  async function duplicateSaved(rec) {
    const name = `${rec.name} copy`;
    await putRecord({ ...rec, id: newTileId(), name, design: { ...rec.design, meta: { ...(rec.design.meta || {}), name } }, updated: Date.now() });
  }

  async function deleteSaved(rec) {
    const answer = await asker.ask({
      title: `Delete "${rec.name}"?`,
      text: 'It is removed from this browser. Download the design file first if you want to keep it.',
      buttons: [{ value: 'delete', label: 'Delete', danger: true }],
    });
    if (!answer) return;
    await db.delete('designs', rec.id);
    saved = saved.filter((s) => s.id !== rec.id);
    if (store.state.savedId === rec.id) store.setSaved(null);
    renderSaved();
    status.textContent = `Deleted "${rec.name}".`;
  }

  async function downloadSaved(rec) {
    // The file carries the pixels of the images the design uses.
    const url = URL.createObjectURL(await designFileBlob(rec.design));
    const a = el('a', { href: url, download: fileName(rec.name) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    let design;
    try {
      if (file.size > FILE_MAX_BYTES) throw new TypeError('File too big for a design');
      const json = JSON.parse(await file.text());
      // normaliseDesign() fills anything missing, so check it is a design first.
      if (!looksLikeDesign(json)) throw new TypeError('Not a design file');
      // Its images go into this browser's storage first; normalising drops the field.
      design = normaliseDesign(await takeFileImages(json));
    } catch (err) {
      console.warn('[designs] not a design file', err);
      status.textContent = `"${file.name}" isn't a Vase Creator design file.`;
      return;
    }
    const name = ((design.meta?.name && String(design.meta.name).trim())
      || file.name.replace(/\.vasecreator\.json$|\.json$/i, '') || nextName()).slice(0, NAME_MAX);
    design.meta = { ...(design.meta || {}), name };
    const id = newTileId();
    let thumb = null;
    try { thumb = await ctx.thumbnailFor(design); } catch { /* tile without picture */ }
    await putRecord({ id, name, design, thumb, updated: Date.now() });
    openDesign(design, name, id);
  });

  // ---------- Open / close ----------

  function isOpen() { return dialog.open; }

  function open() {
    if (dialog.open) return;
    closeTileMenu();
    status.textContent = '';
    const first = renderContinue();
    renderSaved();
    savedReady.then(() => { if (dialog.open) renderSaved(); });
    dialog.showModal();
    first?.focus();
    store.setView({ designsOpen: true });
  }

  function close() {
    closeTileMenu();
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('cancel', (e) => {
    // Esc closes an open tile menu first, then the screen.
    if (openMenuEl) { e.preventDefault(); const btn = openMenuEl.previousElementSibling; closeTileMenu(); btn?.focus(); }
  });
  dialog.addEventListener('close', () => {
    if (store.state.view.designsOpen) store.setView({ designsOpen: false });
  });
  // A click on the backdrop closes too and keeps the current design.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });

  return { open, close, promptSave, get isOpen() { return isOpen(); } };
}
