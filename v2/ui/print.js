// Print, step 5 (design §10, C10, C19; Prepare print before issue #1): the
// parts Walls, Printer, Check and Export. ui/steps.js mounts it as the Print
// step's content, and it computes while that step is open.
//
// Walls are design data (a history step). The printer profile is not: it is
// stored apart from designs and changing it never adds a history step. The
// final walls and full checks are computed only while this panel is showing.
//
// Export also offers CAD files (issue #7): the nozzle path as DXF lines and
// a closed solid as STL (core/cad.js). The print checks don't block them.

import { numberField, segmented, select, h } from './controls.js';
import { defaultPrinter, normalisePrinter, PRINTER_LIMITS } from '../core/printer.js';
import { LIMITS } from '../core/design.js';
import { designFileBlob } from './design-file.js';

const CHECK_DELAY = 300;
const ICONS = { ok: '✓', warning: '⚠', error: '✕', info: 'ℹ' };
const SEVERITY_NAMES = { ok: 'OK', warning: 'Warning', error: 'Error', info: 'Note' };

// Every printer field (core/printer.js), with its range from PRINTER_LIMITS.
const L = PRINTER_LIMITS;
const PRINTER_GROUPS = [
  { title: 'Machine', fields: [
    { label: 'Bed width', unit: 'mm', path: 'machine.bedWidthMm', lim: L.bedWidthMm, decimals: 0 },
    { label: 'Bed depth', unit: 'mm', path: 'machine.bedDepthMm', lim: L.bedDepthMm, decimals: 0 },
    { label: 'Origin', kind: 'segmented', path: 'machine.origin', options: [{ value: 'frontLeft', label: 'Front-left' }, { value: 'centre', label: 'Centre' }] },
    { label: 'Max height', unit: 'mm', path: 'machine.maxHeightMm', lim: L.maxHeightMm, decimals: 0 },
    { label: 'Firmware', kind: 'select', path: 'machine.firmware', options: [{ value: 'marlin', label: 'Marlin' }, { value: 'rrf', label: 'RepRapFirmware' }, { value: 'klipper', label: 'Klipper' }] },
  ] },
  { title: 'Extrusion', fields: [
    { label: 'E mode', kind: 'segmented', path: 'extrusion.eMode', options: [{ value: 'relative', label: 'Relative' }, { value: 'absolute', label: 'Absolute' }] },
    { label: 'Feed diameter', unit: 'mm', path: 'extrusion.feedDiameterMm', lim: L.feedDiameterMm, decimals: 2 },
    { label: 'Flow (E scale)', unit: '×', path: 'extrusion.eScale', lim: L.eScale, decimals: 2 },
  ] },
  { title: 'Prime and moves', fields: [
    { label: 'Prime volume', unit: 'mm³', path: 'prime.volumeMm3', lim: L.volumeMm3, decimals: 0 },
    { label: 'Park X', unit: 'mm', path: 'prime.parkX', lim: L.parkX, decimals: 1 },
    { label: 'Park Y', unit: 'mm', path: 'prime.parkY', lim: L.parkY, decimals: 1 },
    { label: 'Park Z', unit: 'mm', path: 'prime.parkZ', lim: L.parkZ, decimals: 1 },
    { label: 'Lift after prime', unit: 'mm', path: 'prime.liftMm', lim: L.liftMm, decimals: 1 },
    { label: 'Skirt offset', unit: 'mm', path: 'skirt.offsetMm', lim: L.offsetMm, decimals: 1 },
    { label: 'Skirt loops', path: 'skirt.loops', lim: L.loops, decimals: 0, info: '0 = no skirt' },
    { label: 'End lift', unit: 'mm', path: 'end.liftMm', lim: L.endLiftMm ?? L.liftMm, decimals: 1 },
    { label: 'End wipe', unit: 'mm', path: 'end.wipeMm', lim: L.wipeMm, decimals: 1 },
  ] },
  { title: 'Speeds', fields: [
    { label: 'Wall', unit: 'mm/s', path: 'speeds.wallMmS', lim: L.speedMmS, decimals: 1 },
    { label: 'Base', unit: 'mm/s', path: 'speeds.baseMmS', lim: L.speedMmS, decimals: 1 },
    { label: 'Travel', unit: 'mm/s', path: 'speeds.travelMmS', lim: L.speedMmS, decimals: 1 },
    { label: 'Z moves', unit: 'mm/s', path: 'speeds.zMmS', lim: L.speedMmS, decimals: 1 },
    { label: 'Minimum layer time', unit: 's', path: 'speeds.minLayerTimeS', lim: L.minLayerTimeS, decimals: 0 },
    { label: 'Slowest wall speed', unit: 'mm/s', path: 'speeds.minSpeedMmS', lim: L.speedMmS, decimals: 1 },
  ] },
  { title: 'Reservoir', fields: [
    { label: 'Reservoir', unit: 'ml', path: 'reservoirMl', lim: L.reservoirMl, decimals: 0, info: '0 = no refill pauses' },
    { label: 'Usable share', unit: '×', path: 'usableFraction', lim: L.usableFraction, decimals: 2 },
  ] },
  { title: 'G-code templates', fields: [
    { label: 'Start', kind: 'text', path: 'templates.start' },
    { label: 'End', kind: 'text', path: 'templates.end' },
    { label: 'Refill', kind: 'text', path: 'templates.refill' },
  ] },
];

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

/** "bed 300 × 300 mm · origin front-left · max height 400 mm" */
function printerSummary(printer) {
  const m = printer.machine || {};
  return `bed ${m.bedWidthMm} × ${m.bedDepthMm} mm · origin ${m.origin === 'centre' ? 'centre' : 'front-left'} · max height ${m.maxHeightMm} mm`;
}

function safeFileName(name) {
  const cleaned = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return cleaned.slice(0, 120) || 'design';
}

function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: fileName });
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before the URL goes.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const fmt = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '–');

/**
 * Mounts the Print step's content.
 * @param {HTMLElement} el
 * @param {{ store: object, engine: { print: Function, gcode: Function }, library?: object, renderer?: object }} ctx
 * @returns {{ destroy(): void }}
 */
export function mountPrintPanel(el, ctx) {
  const { store, engine } = ctx;
  const printerOf = () => store.state.printer ?? defaultPrinter();

  // One part of the Print step; the step frame gives it its heading.
  const part = (id, children) => {
    const node = h('div', { class: 'print-part' }, children);
    node.dataset.part = id;
    return node;
  };

  // ---- 1 Walls ------------------------------------------------------------
  const d0 = store.state.design;
  const walls = segmented({
    label: 'Walls',
    hideLabel: true,
    options: [{ value: 1, label: '1 wall' }, { value: 2, label: '2 walls' }],
    value: d0.finish?.walls ?? 1,
    onChange: (v) => store.apply(v === 2 ? '2 walls' : '1 wall', (d) => {
      d.finish = d.finish || {};
      d.finish.walls = v;
      // Fused walls by default (C1).
      if (v === 2 && !(d.finish.wallSpacingMm > 0)) d.finish.wallSpacingMm = Math.round(0.9 * d.layers.beadWidthMm * 100) / 100;
    }),
  });
  const spacing = numberField({
    label: 'Wall spacing', unit: 'mm', ...LIMITS.wallSpacingMm, decimals: 2, info: '',
    value: d0.finish?.wallSpacingMm ?? 0.9 * d0.layers.beadWidthMm,
    onInput: (v) => store.change('Wall spacing', (d) => { d.finish.wallSpacingMm = v; }),
    onCommit: () => store.commit(),
  });
  const inner = segmented({
    label: 'Inner wall',
    options: [{ value: 'smooth', label: 'Smooth' }, { value: 'followPattern', label: 'Follows pattern' }],
    value: d0.finish?.innerWall ?? 'smooth',
    onChange: (v) => store.apply('Inner wall', (d) => { d.finish.innerWall = v; }),
  });
  const twoWallBox = h('div', { class: 'two-walls' }, [spacing.el, inner.el]);

  // ---- 2 Printer ----------------------------------------------------------
  const printerName = h('span', { class: 'printer-name' });
  const badge = h('span', { class: 'badge badge--draft', text: 'draft, not tested on a printer' });
  const summaryLine = h('p', { class: 'printer-summary' });
  const editBtn = h('button', { type: 'button', class: 'link-btn', 'aria-expanded': 'false', 'aria-controls': 'printer-editor', text: 'Edit printer' });
  const editor = h('div', { class: 'printer-editor', id: 'printer-editor', hidden: true });
  editBtn.addEventListener('click', () => {
    const open = editor.hidden;
    editor.hidden = !open;
    editBtn.setAttribute('aria-expanded', String(open));
  });

  const writePrinter = (path, value) => {
    const next = structuredClone(printerOf());
    setPath(next, path, value);
    store.setPrinter(normalisePrinter(next));
  };

  const fieldControls = [];
  for (const group of PRINTER_GROUPS) {
    const groupEl = h('fieldset', { class: 'printer-group' }, [h('legend', { text: group.title })]);
    for (const f of group.fields) {
      const { path } = f;
      const value = getPath(printerOf(), path);
      let control;
      if (f.kind === 'text') {
        const id = `printer-${path.replace(/\W+/g, '-')}`;
        const area = h('textarea', { id, class: 'template-input', rows: 4, spellcheck: false, value: value ?? '' });
        area.spellcheck = false;
        area.addEventListener('change', () => writePrinter(path, area.value));
        control = {
          el: h('div', { class: 'template-field' }, [h('label', { class: 'template-label', htmlFor: id, text: f.label }), area]),
          set: (v) => { if (document.activeElement !== area) area.value = v ?? ''; },
        };
      } else if (f.kind === 'select' || f.kind === 'segmented') {
        const make = f.kind === 'select' ? select : segmented;
        control = make({ label: f.label, options: f.options, value, onChange: (v) => writePrinter(path, v) });
      } else {
        control = numberField({
          label: f.label, unit: f.unit, min: f.lim.min, max: f.lim.max, step: f.lim.step, decimals: f.decimals, info: f.info,
          value,
          onCommit: (v) => writePrinter(path, v),
        });
      }
      fieldControls.push({ path, control });
      groupEl.append(control.el);
    }
    if (groupEl.children.length > 1) editor.append(groupEl);
  }
  const reset = h('button', { type: 'button', class: 'link-btn', text: 'Reset to defaults' });
  reset.addEventListener('click', () => store.setPrinter(defaultPrinter()));
  editor.append(reset);

  // ---- 3 Check ------------------------------------------------------------
  const checkStatus = h('div', { class: 'check-status', role: 'status', 'aria-live': 'polite' });
  const checkList = h('ul', { class: 'check-list' });

  // ---- 4 Export -----------------------------------------------------------
  const gcodeBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Download G-code' });
  const designBtn = h('button', { type: 'button', class: 'btn', text: 'Download design file' });
  const progress = h('progress', { class: 'export-progress', max: 1, value: 0, hidden: true, 'aria-label': 'Writing G-code' });
  const exportNote = h('p', { class: 'export-note', role: 'status', 'aria-live': 'polite' });
  const sizeLine = h('p', { class: 'size-line' });
  const dxfBtn = h('button', { type: 'button', class: 'btn', text: 'Toolpath (.dxf)' });
  const stlBtn = h('button', { type: 'button', class: 'btn', text: 'Solid (.stl)' });
  const cadNote = h('p', { class: 'export-note', role: 'status', 'aria-live': 'polite' });
  const cadBox = h('div', { class: 'cad-export' }, [
    h('p', { class: 'cad-title', text: 'For CAD' }),
    h('p', { class: 'cad-hint', text: 'Toolpath: the whole nozzle path as one continuous line in mm, in print order. Opens in Rhino, Grasshopper and most CAD programs. Solid: a closed mesh of the finished pot.' }),
    h('div', { class: 'export-buttons' }, [dxfBtn, stlBtn]),
    cadNote,
  ]);

  el.classList.add('print-panel');
  el.replaceChildren(
    part('walls', [walls.el, twoWallBox]),
    part('printer', [h('div', { class: 'printer-line' }, [printerName, badge]), summaryLine, editBtn, editor]),
    part('check', [checkStatus, checkList]),
    part('export', [h('div', { class: 'export-buttons' }, [gcodeBtn, designBtn]), progress, exportNote, sizeLine, cadBox]),
  );

  // ---- Behaviour ----------------------------------------------------------
  let printResult = null;
  let running = false;
  let exporting = false;
  let runToken = 0;
  let timer = 0;

  const visible = () => store.state.view.step === 'print';
  const blocked = () => !printResult || printResult.canExport === false || (printResult.checks || []).some((c) => c.severity === 'error');
  // A check is waiting to start or running: the shown checks may be for an older design.
  const busy = () => running || timer !== 0;

  const renderChecks = () => {
    if (busy()) {
      checkStatus.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Checking the print…');
    } else if (!printResult) {
      checkStatus.textContent = '';
    } else {
      const n = (printResult.checks || []).filter((c) => c.severity === 'error').length;
      checkStatus.textContent = n ? `${n === 1 ? 'One problem stops' : `${n} problems stop`} the export.` : '';
    }
    if (!busy() && printResult) {
      const checks = printResult.checks || [];
      checkList.replaceChildren(...checks.map((c) => {
        const sev = ICONS[c.severity] ? c.severity : 'info';
        return h('li', { class: `check check--${sev}` }, [
          h('span', { class: 'check-icon', 'aria-hidden': 'true', text: ICONS[sev] }),
          h('span', { class: 'visually-hidden', text: `${SEVERITY_NAMES[sev]}: ` }),
          h('span', { class: 'check-text', text: c.message }),
        ]);
      }));
    }
    checkList.classList.toggle('is-stale', busy());
  };

  const renderExport = () => {
    gcodeBtn.disabled = busy() || exporting || blocked();
    const size = printResult?.size ?? store.state.result?.size;
    sizeLine.textContent = size ? `Size ${fmt(size.heightMm)} × ${fmt(size.widthMm)} × ${fmt(size.depthMm)} mm` : '';
    if (!exporting && !busy() && printResult && blocked()) exportNote.textContent = 'Fix the problems above to download G-code.';
    else if (!exporting && exportNote.dataset.kind !== 'done') exportNote.textContent = '';
  };

  const runCheck = () => {
    timer = 0;
    if (!visible()) return;
    const token = ++runToken;
    running = true;
    renderChecks();
    renderExport();
    const { design } = store.state;
    Promise.resolve()
      .then(() => engine.print(design, printerOf()))
      .then((result) => {
        if (token !== runToken || !result) return;
        printResult = result;
        // The pot now shows the final walls (design §10); main.js redraws the
        // centreline preview when the panel closes.
        if (visible() && result.positions) ctx.renderer?.setToolpath?.(result);
      }, (err) => {
        if (token !== runToken) return;
        printResult = { checks: [{ id: 'engine', severity: 'error', message: `Couldn't check the print: ${err?.message || err}` }], canExport: false };
      })
      .finally(() => {
        if (token !== runToken) return;
        running = false;
        renderChecks();
        renderExport();
      });
  };
  const scheduleCheck = () => {
    clearTimeout(timer);
    timer = 0;
    if (!visible()) return;
    timer = setTimeout(runCheck, CHECK_DELAY);
    renderChecks();
    renderExport();
  };

  gcodeBtn.addEventListener('click', async () => {
    if (gcodeBtn.disabled) return;
    const { design } = store.state;
    exporting = true;
    exportNote.dataset.kind = '';
    exportNote.textContent = 'Writing G-code…';
    progress.hidden = false;
    progress.value = 0;
    renderExport();
    try {
      const blob = await engine.gcode(design, printerOf(), (f) => { progress.value = Math.max(0, Math.min(1, f)); });
      download(blob, `${safeFileName(design.meta?.name)}.gcode`);
      exportNote.dataset.kind = 'done';
      exportNote.textContent = 'G-code downloaded.';
    } catch (err) {
      exportNote.dataset.kind = 'done';
      exportNote.textContent = `Couldn't write the G-code: ${err?.message || err}`;
    } finally {
      exporting = false;
      progress.hidden = true;
      renderExport();
    }
  });
  // CAD files: written in the worker, one at a time.
  let cadBusy = false;
  const exportCad = async (format, what) => {
    if (cadBusy) return;
    const { design } = store.state;
    cadBusy = true;
    dxfBtn.disabled = stlBtn.disabled = true;
    cadNote.textContent = `Writing the ${what}…`;
    try {
      const blob = await engine.cad(design, format);
      download(blob, `${safeFileName(design.meta?.name)}.${format}`);
      cadNote.textContent = `${what[0].toUpperCase()}${what.slice(1)} downloaded.`;
    } catch (err) {
      cadNote.textContent = `Couldn't write the ${what}: ${err?.message || err}`;
    } finally {
      cadBusy = false;
      dxfBtn.disabled = stlBtn.disabled = false;
    }
  };
  dxfBtn.addEventListener('click', () => exportCad('dxf', 'toolpath'));
  stlBtn.addEventListener('click', () => exportCad('stl', 'solid'));

  designBtn.addEventListener('click', async () => {
    const { design } = store.state;
    // The shared writer embeds the pixels of any image patterns (phase 2).
    download(await designFileBlob(design), `${safeFileName(design.meta?.name)}.vasecreator.json`);
  });

  const update = (state) => {
    const d = state.design;
    const n = d.finish?.walls === 2 ? 2 : 1;
    walls.set(n);
    twoWallBox.hidden = n !== 2;
    spacing.set(d.finish?.wallSpacingMm ?? 0.9 * d.layers.beadWidthMm);
    const fused = (d.finish?.wallSpacingMm ?? 0) <= d.layers.beadWidthMm;
    spacing.setInfo(fused ? 'The walls fuse where they meet' : 'Leaves a gap between the walls');
    inner.set(d.finish?.innerWall ?? 'smooth');

    const p = printerOf();
    printerName.textContent = p.name || 'Generic gantry';
    badge.hidden = p.status === 'verified';
    summaryLine.textContent = printerSummary(p);
    for (const { path, control } of fieldControls) control.set(getPath(p, path));
    renderExport();
  };
  update(store.state);
  renderChecks();
  scheduleCheck();

  let wasVisible = visible();
  const unsubscribe = store.subscribe((state, what) => {
    if (what.has('design') || what.has('printer')) {
      // A "downloaded" note belongs to the file that was written, not to this design.
      if (exportNote.dataset.kind === 'done' && !exporting) {
        exportNote.dataset.kind = '';
        exportNote.textContent = '';
      }
      if (!cadBusy) cadNote.textContent = '';
    }
    if (what.has('design') || what.has('printer') || what.has('result')) update(state);
    if (what.has('design') || what.has('printer')) {
      // Old checks no longer describe this design, and neither does a check
      // still running for it: drop its result when it lands.
      runToken += 1;
      running = false;
      if (visible()) scheduleCheck();
      else printResult = null;
    }
    if (what.has('view')) {
      const nowVisible = visible();
      // Coming back with nothing changed: the checks still hold, but main.js
      // drew the centreline preview meanwhile, so show the final walls again.
      if (nowVisible && !wasVisible && printResult?.positions && !running) ctx.renderer?.setToolpath?.(printResult);
      wasVisible = nowVisible;
      if (nowVisible && !printResult && !running && !timer) scheduleCheck();
      if (!nowVisible && timer) {
        // The check that was waiting would have replaced these results.
        clearTimeout(timer);
        timer = 0;
        printResult = null;
      }
    }
  });

  return {
    destroy() {
      unsubscribe();
      clearTimeout(timer);
      runToken++;
      el.replaceChildren();
      el.classList.remove('print-panel');
    },
  };
}
