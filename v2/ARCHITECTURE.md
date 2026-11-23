# Vasecreator v2: architecture

What to read first: `docs/design/v2-design-brainstorm.md` (the approved design, "design" below, §-numbers without a prefix) and `docs/research/toolpath-foundation.md` ("research §…"). This file fixes the module boundaries and the contracts between them.

Run it: `node v2/tools/serve.mjs`, then open <http://localhost:8020/v2/>. Test the core: `cd v2 && npm test` (Node 24, `node:test`, no dependencies).

## Rules for every module

- Plain JavaScript ES modules, no build step, no framework. JSDoc types where they help.
- Two-space indent, single quotes, semicolons, `const` by default. Comments explain why, not what.
- v2 never changes a v1 file (design §14).
- Every dependency is loaded from the import map in `v2/index.html`: three.js **0.187.0** from jsDelivr (`three`, `three/addons/`). Nothing else.
- Wording in the design view is plain and in mm. Never mention clay, layer counts or material there (D7, D15).

## Folder layout

```
v2/
  index.html            app shell, import map, SEO-free preview page (noindex until the swap)
  main.js               bootstrap: store + engine client + renderer + UI
  styles/app.css        tokens, layout (desktop and phone), top bar, chips, history, dialogs, Prepare print
  styles/panels.css     sidebar sections and controls
  core/                 pure: no DOM, no three.js, deterministic maths only (core/math.js)
    math.js patterns.js surface.js   (exist)
    design.js           defaults, normalise(), validate(), migrations, helpers
    profile.js          r(z) for the profile curve
    plan.js             footprint outline at a height
    toolpath.js         layer grid, seam and ramp, wall evaluation, base spiral, walls
    checks.js           design-level and print-level checks
    printer.js          the generic gantry profile and its normalise()
    gcode.js            G-code emission
    engine.js           facade used by the worker and by tests
  worker/
    engine.worker.js    module worker around core/engine.js
    client.js           main-thread client: latest-request-wins
  render/
    beads.js            the bead renderer (research §8.2 interface)
    handles.js          profile handles drawn on the pot
  store/
    store.js            design state, gestures, history (snapshot undo)
    db.js               IndexedDB: history, saved designs, thumbnails, printer profile
  ui/
    controls.js         number field, slider, segmented control, toggle
    sidebar.js          sections container (desktop) and tabs (phone)
    sections/*.js       shape, surface, layers, base, curve, points, footprint
    swatch.js           pattern swatch drawing
    topbar.js chips.js history.js designs.js print.js
  library/              patterns.json, presets.json (exist)
  test/                 node:test suites, golden files in test/golden/
  tools/serve.mjs       dev server
```

## The design document (JSON)

The shape is the one in `library/presets.json` (design §13). `core/design.js` owns it:

```js
export const DESIGN_SCHEMA = 'vasecreator/design', DESIGN_VERSION = 2;
export function defaultDesign(): Design            // a copy of the "Classic vase" preset with meta.name 'Design 1'
export function normaliseDesign(json): Design      // fills defaults, clamps ranges, sorts knots, migrates; never throws on missing fields; throws TypeError on a non-design
export function cloneDesign(d): Design             // structuredClone
export function designsEqual(a, b): boolean        // deep equal, ignoring meta
export const LIMITS = { … }                         // numeric min/max/step per field, used by core clamps and UI controls
// Profile editing rules (design §9.1), all mutate a draft design in place:
export function moveKnot(d, index, { z, r })       // bottom knot stays at z 0; neighbours keep ≥ one layer height apart; r ≥ r_min
export function insertKnot(d, { z, r }): number    // index of the new knot, or -1 when 12 knots exist
export function deleteKnot(d, index): boolean      // false for the bottom/top knot or when only 2 remain
export function setHeight(d, mm), setWidth(d, mm)  // scale knot z / knot r in proportion (C6)
export function widestRadius(d): number            // widest radius of the evaluated profile curve
```

Fields added on top of the presets: `form.profile.cornerMm` (angular corner radius in mm, default 0; a knot's own `corner` overrides it). `meta` holds `name`, optional `id`, `description`, `created`, `app`.

Profile `interp` is `'catmullRomCentripetal'` (shown as *Smooth*), `'monotone'` or `'linear'` (shown as *Angular*). The profile is r as a function of z (z strictly increasing), so the wall never folds.

Slot B `null` means blending off. `pattern: 'plain'` is a real slot with no texture.

## Engine (core → worker → main)

`core/engine.js`:

```js
export function computePreview(design, { library, printer }): PreviewResult   // live loop: centreline wall + base, design checks
export function computePrint(design, { library, printer }): PrintResult       // finish: final walls, full checks
export function emitGcode(design, printResult, printer, { library, onProgress }): string[]  // chunks; throws GcodeError on V16
```

`PreviewResult` (all typed arrays are transferred, never copied):

```js
{
  positions: Float32Array,   // x,y,z per point in print order, mm, part centred on the origin, z up, z = top of the bead
  kinds: Uint8Array,         // per point: what the move ENDING at this point is. 0 = no bead (path start, travel),
                             // 1 = outer wall, 2 = inner wall, 3 = base infill, 4 = connector between walls
  issues: Uint8Array,        // per point: bitmask of checks the bead ending here fails (ISSUE bits below)
  beadWidthMm, layerHeightMm,
  warnings: Warning[],       // see Checks
  size: { heightMm, widthMm, depthMm },   // final outer surface incl. patterns: centreline extent + bead width
  bounds: { min: [x,y,z], max: [x,y,z] },  // centreline
  profileLine: Float32Array, // r,z pairs, the evaluated profile curve from z = 0 to H (for the handle overlay)
  seamLine: Float32Array,    // x,y,z per wall layer at its seam point (for the seam marker)
  pointCount, computeMs,
}
```

`PrintResult` is the same shape (with walls) plus `checks: Warning[]` (all print-time checks, `severity: 'ok' | 'info' | 'warning' | 'error'`) and `canExport: boolean`.

`worker/client.js`:

```js
export function createEngine({ library }): {
  preview(design, printer): Promise<PreviewResult | null>   // newest request wins; a superseded request resolves null
  print(design, printer): Promise<PrintResult>
  gcode(design, printer, onProgress?: (fraction) => void): Promise<Blob>   // text/plain G-code
  dispose()
}
```

## Checks

`ISSUE = { overhang: 1, finePattern: 2, narrow: 4, bed: 8 }` (exported from `core/checks.js`).

```js
Warning = { id: 'overhang' | 'finePattern' | 'narrow' | 'bed' | 'layerRatio' | …print checks,
            severity: 'warning' | 'error' | 'info' | 'ok', bit: number /* 0 if no beads */, message: string }
```

Design-level set (design §11): overhang past `layers.overhangLimitDeg` (V2, radial step between a point and the point one layer below at the same u), pattern finer than the bead can print (V5, V6), too narrow for the bead (V7, r ≥ 2 × bead width, clamped), doesn't fit the printer bed (V1, `error`), layer height outside 0.3–0.6 × bead width. Messages give heights in mm, never layers: "Leans past 45° between 96 and 110 mm".

## Renderer

`render/beads.js`:

```js
export class BeadRenderer {
  constructor(canvas: HTMLCanvasElement)
  setToolpath(result: PreviewResult)       // takes ownership of the typed arrays
  setHighlight(bitmask: number, severity: 'warning' | 'error' | null)  // colours beads whose issues & bitmask ≠ 0
  setSeamMarker(visible: boolean)
  setBed({ widthMm, depthMm } | null)
  setViewport({ x, y, width, height })     // CSS px inside the canvas where the pot must fit (phone: top 40 %)
  fitCamera()                               // only on load, double-click, viewport change (D20)
  resize()
  requestRender()                           // render on demand only
  thumbnail(result?: PreviewResult, size = 192): Promise<Blob>   // white bead render of the current or given toolpath
  get camera, get controls, get scene      // for handles.js
  dispose()
}
```

`render/handles.js`: `createProfileHandles(renderer, overlayEl, { onDrag(index, {z, r}), onCommit(), onAdd({z, r}), onRemove(index), onSelect(index) })` with `.update(design, profileLine)`, `.setSelected(index)`, `.setVisible(bool)`, `.dispose()`. Handles sit in the vertical plane through the axis that faces the camera (C17). `overlayEl` is an absolutely positioned element over the canvas; handles are DOM elements (focusable, ≥ 44 px touch target on phones) and the profile line is SVG, re-projected after every render. Pointer Events with `setPointerCapture`. Raw drag values go out; the caller applies `moveKnot()`.

## Store

`store/store.js`:

```js
export function createStore({ design, history?, printer? }): Store
Store = {
  get state(): { design, view, printer, result, savedId, historyIndex }
  subscribe(fn: (state, what: Set<'design' | 'view' | 'printer' | 'result' | 'history'>) => void): () => void
  change(label, mutator: (draft: Design) => void)   // live edit inside a gesture (drag); notifies 'design'; no history yet
  commit()                                          // ends the gesture: one history step if the design changed
  apply(label, mutator)                             // change + commit (clicks, typed values)
  open(design, label)                               // replaces the design, adds "Opened: <name>"
  undo(), redo(), canUndo(), canRedo()
  restore(stepId)                                   // adds "Restored: <time>" (C3)
  history(): Step[]                                 // newest first; Step = { id, label, time, design, thumb: Blob | null }
  setView(patch), setPrinter(printer), setResult(result)
  setThumb(stepId, blob)
}
view = { advanced, mode: 'design' | 'print', openSections: string[], slot: 'a' | 'b', selectedKnot, highlight: warningId | null,
         phoneTab, designsOpen, sizeLocked }
```

History keeps about 200 steps and survives reloads (IndexedDB, `store/db.js`). Not in history: camera, view state, printer settings (design §8.4).

## UI contracts

- `ui/controls.js` exports factories that return `{ el, set(value), destroy() }`:
  - `numberField({ label, unit, min, max, step, decimals, value, onInput(v), onCommit(v), info? })`: drag the label to scrub, type to edit (commit on Enter or blur), − / + steppers on touch screens (≥ 44 px).
  - `slider({ … same … })`, `segmented({ label, options: [{ value, label }], value, onChange })`, `toggle({ label, value, onChange })`, `select({…})`.
  - `onInput` is for live updates (call `store.change`), `onCommit` ends the gesture (`store.commit`).
- A section module exports `{ id, title, advanced: boolean, summary(design): string, mount(el, ctx): { update(state), destroy() } }`. `ctx = { store, library, engine, renderer }`.
- `ui/sidebar.js` exports `mountSidebar(el, ctx)`, which renders the sections as collapsible cards (desktop) or tabs (phone, ≤ 760 px wide), and the "ADVANCED" divider when `view.advanced` is on.
- `ui/print.js` exports `mountPrintPanel(el, ctx)`: the four Prepare print steps (design §10). It replaces the sidebar content while `view.mode === 'print'`.
- `main.js` builds `ctx = { store, library, engine, renderer, handles }` and owns the DOM regions below. `#panel` holds `#design-panel` (sidebar) and `#print-panel`; on a phone `#panel` is the bottom 60 %.

```
body
  header.topbar                     logo, title, credit · undo redo · Designs · Save design · Prepare print →
  main.workspace
    div#view   canvas#scene + div#overlay (handles)       fills the window behind the panels (desktop) / top 40 % (phone)
    aside#panel  div#design-panel · div#print-panel
    div#chips   warnings chip · size chip
    div#rightcol  history card · Advanced button
  dialog#designs                    Designs screen
```

## Visual tokens

Defined once in `styles/app.css` `:root`, used everywhere:

```css
--c-primary: rgb(139,197,193); --c-primary-light: rgb(93,138,139); --c-primary-dark: rgb(26,47,48);
--c-text: rgb(18,47,45); --c-text-2: rgba(18,47,45,.7); --c-surface: rgba(248,248,248,.9); --c-card: rgba(255,255,255,.72);
--c-border: rgba(0,0,0,.1); --c-input-bg: rgba(255,255,255,.85); --c-input-border: rgba(0,0,0,.15);
--c-accent: #3fa66a; --c-warn: #e0a100; --c-error: #d64545;
--radius-card: 12px; --radius-ctl: 8px; --font: 'Inter', system-ui, sans-serif;
--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px;
--shadow-1: 0 1px 3px rgba(0,0,0,.05); --shadow-2: 0 4px 8px rgba(0,0,0,.08); --shadow-3: 0 10px 20px rgba(0,0,0,.12);
--topbar-h: 64px; --sidebar-w: 320px; --rightcol-w: 132px;
```

v1's look carries over (design §8.7): Inter, white translucent cards with 12 px corners, buttons and chips with 8 px corners. The background is v1's teal gradient (primary-light → primary) as plain CSS.
