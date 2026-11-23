# Vasecreator v2: architecture

Read these first: `docs/design/v2-design-brainstorm.md` (the approved design, called "design" below; § numbers without a prefix point there) and `docs/research/toolpath-foundation.md` ("research §…"). This file describes the module boundaries and the contracts between them as they are built. If you change a contract, update this file in the same commit.

## Status

**Phase 0 (§15.1) is built.** The `core/` engine runs in a worker. It covers the profile, footprint, twist, the layer grid with a seam ramp, the base spiral, 1 or 2 walls, the generic gantry profile and G-code emission. It comes with deterministic maths, golden G-code and property tests. There is no separate bare test page: `/v2/` is the full app.

**Phase 1 (§15.2), items 1–8, is built in code:** the Designs screen (1); dragging, adding and removing profile points in the view, plus height, width, depth, footprint, corner rounding and twist (2); 12 swatches in slots A and B with blending (3); layers, seam and base (4); the Advanced sections for curve, points and footprint (5); live white beads, with warnings that colour them (6); history, undo, redo, and saving as tiles or files (7); Prepare print with walls, inner wall, printer, checks, and the G-code and design-file downloads (8).

Still open:
- **Phone check (D3).** A phase only counts as done once it works on desktop and on a real mid-range Android phone in Chrome, within the research §10.3 budgets. The phone check hasn't been done yet, so neither phase counts as done.
- **The swap (item 9, §14).** v2 moves to the root and v1 to `/v1/`. That is the owner's call. Until then, v2 changes no v1 file.
- **Patterns and presets (Q10).** The 12 patterns in `library/patterns.json` and the 3 presets in `library/presets.json` are suggestions. The owner still has to confirm or swap them.
- **Printer profile (D4).** The generic gantry values are a draft that hasn't been tested on a printer. The app labels it that way.
- **Deploy routine (§14).** The owner still has to confirm whether deploys run automatically from `main` or are uploaded by hand.

## Rules for every module

- Plain JavaScript ES modules, no build step, no framework. JSDoc types where they help. Two-space indent, single quotes, semicolons, `const` by default. Comments explain why, not what.
- v2 never changes a v1 file (design §14).
- Every dependency loads from the import map in `v2/index.html`: three.js **0.187.0** from jsDelivr (`three`, `three/addons/`). Nothing else. Only `render/` imports three.js.
- `core/` is pure: no DOM, no three.js, no fetch. It must give the same bytes in every JavaScript engine. So it uses `core/math.js` (`dsin`, `dcos`, `datan`, `datan2`, `radians`) and never `Math.sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, the hyperbolic functions, `exp`, `log*`, `pow`, `cbrt`, `hypot`, `random` or `**`. `Math.sqrt` is fine because it is correctly rounded. A test enforces this rule (see Testing).
- Wording in the design view is plain and in mm. It never mentions clay, layer counts or material (D7, D15).

## Folder layout

```
v2/
  index.html            app shell, import map, WebGL 2 check, noindex until the swap
  main.js               bootstrap and wiring: store + engine client + renderer + handles + UI
  styles/               app.css: tokens, layout (desktop and phone), top bar, chips, history, dialogs, Prepare print; panels.css: sections, controls
  core/                 pure and deterministic (see Rules)
    math.js patterns.js surface.js      deterministic maths, pattern recipes, A/B blend weights
    design.js profile.js plan.js        the design document, r(z) of the profile curve, footprint outlines
    toolpath.js checks.js               buildToolpath, buildSkirt, KIND, RAMP_IN_LAYERS; ISSUE, designChecks, printChecks
    printer.js gcode.js engine.js       the gantry profile; writeGcode, planRefills, GcodeError; the facade
  worker/ render/ store/                engine.worker.js client.js · beads.js handles.js · store.js db.js
  ui/                   controls.js sidebar.js swatch.js topbar.js chips.js history.js designs.js print.js
  ui/sections/          shape, surface, layers, base · advanced: curve, points, footprint
  library/              patterns.json, presets.json
  test/                 *.test.js, support/ (fixtures, printability measures), golden/
  tools/serve.mjs       dev server
```

## The design document (JSON)

The shape is the one in `library/presets.json` (design §13). `core/design.js` owns it:

```js
export const DESIGN_SCHEMA = 'vasecreator/design', DESIGN_VERSION = 2, MIN_KNOTS = 2, MAX_KNOTS = 12, INTERPS, FOOTPRINTS, SEAM_POSITIONS, INNER_WALLS;
export const LIMITS = { … }                    // { min, max, step } per field, keyed by JSON field name (below)
export function defaultDesign(): Design        // a copy of the "Classic vase" preset named 'Design 1' (a test keeps them equal)
export function normaliseDesign(json): Design  // new object: fills defaults, clamps, sorts knots, snaps tile heights, migrates;
                                               // never throws on missing fields; TypeError on a non-design or a newer version
export function cloneDesign(d), designsEqual(a, b)   // structuredClone; deep equal ignoring meta
export function minRadius(d): number           // 2 × bead width, the smallest wall radius (V7)
export function snapTileHeight(mm, layerHeightMm)    // a whole number of layers, at least one (C7)
export function widestRadius(d): number        // of the evaluated curve, which can bulge past the knots
// Editing rules (design §9.1). All of them mutate a normalised draft in place:
export function moveKnot(d, index, { z?, r? }) // bottom knot stays at z 0; the top knot sets the height; neighbours ≥ a layer apart; r ≥ minRadius
export function insertKnot(d, { z, r? }): number   // z moves into the free space between neighbours; r defaults to the curve; −1 only with 12 knots or no room
export function deleteKnot(d, index): boolean  // false for the bottom/top knot or when only 2 remain
export function setHeight(d, mm)               // scales knot z and the surface range; never squeezes knots under a layer apart
export function setWidth(d, mm), setDepth(d, mm)   // scale knot r to the widest diameter (C6); set form.plan.depthRatio = mm / width
```

`LIMITS` keys: `height`, `width`, `depth` (for setWidth and setDepth), `depthRatio`, `cornerRounding`, `twist`, `knotZ`, `knotR` (an absolute floor; the real minimum is `minRadius`), `tension`, `cornerMm`, `depthMm`, `repeats`, `tileHeightMm`, `fromMm`, `toMm`, `amount` (blend), `beadWidthMm`, `layerHeightMm`, `overhangLimitDeg`, `rampLengthMm`, `angleDeg` (seam), `baseLayers`, `spacingRatio`, `holeDiameter`, `wallSpacingMm`. UI fields read them through `limit(keys, fallback)` from `ui/sections/shape.js`.

Fields added on top of the presets: `form.profile.cornerMm` (angular corner radius in mm, default 0; a knot's own `corner` overrides it). `meta` holds `name`, plus optional `id`, `description`, `created` and `app`. Slot B `null` means blending is off. `pattern: 'plain'` is a real slot with no texture. A pattern id that isn't in the library prints plain. Tile heights snap to whole layers twice: in `normaliseDesign` and again when the toolpath resolves the slots, so a design edited without normalising still lines up.

Profile `interp` is `'catmullRomCentripetal'` (shown as *Smooth*), `'monotone'` or `'linear'` (shown as *Angular*). The profile is r as a function of z, with z strictly increasing, so the wall never folds. `core/profile.js` evaluates it: `createProfile(profile)` → `{ at(z), heightMm, knots }` (at clamps z to the height), and `profileLine(profile, stepMm = 1)` → a Float32Array of r,z pairs.

## Printer profile

`core/printer.js` holds one generic gantry profile, stored apart from designs (IndexedDB `settings/printer`, never in history). It exports `defaultPrinter()`, `normalisePrinter(json)` (null gives the default; it fills and clamps; TypeError on a non-profile), `PRINTER_LIMITS` (ranges for the fields Prepare print edits), `printerLabel(p)` ("Generic gantry (draft, not tested on a printer)" while `status` is `'draft'`), `PAUSE_COMMANDS`, `E_MODE_COMMANDS` and `DEFAULT_TEMPLATES`.

```
{ schema: 'vasecreator/printer', version: 1, id, name, status: 'draft' | 'community' | 'verified',
  machine:   { bedWidthMm, bedDepthMm, origin: 'frontLeft' | 'centre', maxHeightMm, firmware: 'marlin' | 'rrf' | 'klipper' },
  extrusion: { eMode: 'relative' | 'absolute', feedDiameterMm, eScale },
  prime:     { volumeMm3, parkX, parkY, parkZ, liftMm },   // park point relative to the bed centre
  skirt:     { offsetMm, loops },   end: { liftMm, wipeMm },
  speeds:    { wallMmS, baseMmS, travelMmS, zMmS, minLayerTimeS, minSpeedMmS },
  reservoirMl, usableFraction,                             // reservoirMl 0 = no refill pauses
  templates: { start, end, refill } }                      // G-code text with {placeholders}
```

Placeholders allowed in every template: `{e_mode_cmd} {pause_cmd} {travel_f} {z_f} {bed_width} {bed_depth} {max_height} {layer_height} {bead_width} {park_x} {park_y} {park_z}`. `{prime}` (a stationary prime of `prime.volumeMm3`) works in start and refill only. Refill also gets `{refill_index} {refill_count} {resume_x} {resume_y} {resume_z} {layer_z}`, and end gets `{layer_z}`. Each of these is a `GcodeError`: a heater code (M104, M109, M140, M190), an unknown placeholder, or a placeholder used in a template that doesn't allow it. So is a `G92` other than `G92 E0`, and `{prime}` sharing a line. If the start template leaves out `{prime}`, `G90`, the E-mode command or `G92 E0`, the writer adds them after it. After any template that switches G90/G91 or M82/M83 (on Marlin, G90 and G91 also reset the E mode), the writer puts back `G90` and the profile's E mode, also before a `{prime}` inside it. A refill template without `{resume_z}` gets the lift, travel and descent back onto the seam appended. `end.liftMm` is at least 5 mm (`PRINTER_LIMITS.endLiftMm`; it is also the refill park height above the print) and `prime.parkZ` at least 2 mm.

## Engine (core → worker → main)

```js
// core/engine.js: each function normalises the design and the printer itself
export function computePreview(design, { library, printer }): PreviewResult   // live loop: centreline wall + base, design checks
export function computePrint(design, { library, printer }): PrintResult       // final walls, skirt, refills, all checks
export function emitGcode(design, printResult | null, printer, { library, onProgress }): string[]
  // chunks: header + start, one per layer, end. Reads printResult.toolpath (from computePrint in the same thread);
  // null computes it. Throws GcodeError on a V16 sanity failure. GcodeError is re-exported.
```

```js
PreviewResult = {            // the typed arrays are transferred, never copied
  positions: Float32Array,   // x,y,z per point in print order, mm, part centred on the origin, z up, z = top of the bead
  kinds: Uint8Array,         // what the move ENDING at this point is (KIND): 0 = no bead (path start, travel, and the
                             // vertical no-clay steps), 1 = outer wall, 2 = inner wall, 3 = base infill, 4 = connector
  issues: Uint8Array,        // per point: bitmask of checks the bead ending here fails (ISSUE)
  beadWidthMm, layerHeightMm,
  warnings: Warning[],       // design-level checks
  size: { heightMm, widthMm, depthMm },   // height = top z; width/depth = centreline extent + bead width
  bounds: { min: [x,y,z], max: [x,y,z] },  // centreline
  profileLine: Float32Array, // r,z pairs of the evaluated profile, about 1 mm apart plus every knot (handle overlay)
  seamLine: Float32Array,    // x,y,z per wall layer at its start point (seam marker)
  pointCount, computeMs,
}
```

`PrintResult` has the same fields, built with `finish.walls` walls, plus `checks: Warning[]` and `canExport: boolean`. Inside the core it also carries `toolpath: { tp, skirt, refills }` (the Float64 path and its layer table). The worker drops that field before posting.

The toolpath is one continuous line of beads (header of `core/toolpath.js`). Layer i has its top at (i + 1)·h. A wall layer starts at its seam, at the height of the layer below. It climbs one layer height over `layers.seam.rampLengthMm`, then runs flat back to the seam. Base layers are flat, rings included. Each one climbs to the next with a no-clay step at the seam or at the spiral centre. The first `RAMP_IN_LAYERS` (4) wall layers above a flat layer grow the ramp, and the rest of the climb is a no-clay step at the seam. That keeps the gap to the bead below at 0.75 h or more. Each layer has 64–1600 points; a layer that would need more is capped and flagged `finePattern`.

```js
// worker/client.js
export function createEngine({ library, workerUrl? }): {
  preview(design, printer): Promise<PreviewResult | null>   // newest request wins; a superseded request resolves null
  print(design, printer): Promise<PrintResult>              // without `toolpath`
  gcode(design, printer, onProgress?: (fraction) => void): Promise<Blob>   // text/plain G-code
  dispose()
}
```

The worker never computes previews that were superseded before they started. `gcode` rejects with `name: 'ExportBlocked'` (the blocking messages) when any print check is an error, and with `name: 'GcodeError'` on a V16 failure. If the worker itself fails (it doesn't load, or it throws outside a request), every pending and later request rejects with an error flagged `engineBroken: true`. `main.js` then says the preview stopped and asks for a reload.

## Checks

```js
ISSUE = { overhang: 1, finePattern: 2, narrow: 4, bed: 8 }   // exported from core/checks.js
Warning = { id: string, severity: 'ok' | 'info' | 'warning' | 'error', bit: number /* 0 if no beads are flagged */, message: string }
```

| id | Run by | Severity | Fails when |
| --- | --- | --- | --- |
| `overhang` | design | warning | the radial step to the point one layer below at the same u is more than h·tan(`overhangLimitDeg`) (V2) |
| `finePattern` | design | warning | a bead-scale curve is tighter than half a bead (V6), a layer hits the 1600-point cap, or a tile has fewer than two layers per bump (V5) |
| `narrow` | design | warning | a radius is under 2 × bead width; the wall is clamped to it (V7) |
| `bed` | design, print | error (print: `ok` when it fits) | off the bed or above `maxHeightMm` (V1); the print check also counts the skirt, the park point, the prime lift and the end lift above the top |
| `layerRatio` | design | warning | the layer height is outside 0.3–0.6 × bead width |
| `missingPattern` | design | warning | a slot's pattern isn't in the library |
| `park` | print | error | the prime park point lies over the pot or the skirt (the prime blob would be printed into) |
| `simplified` | design | warning | the toolpath is over its point budget (`MAX_TOOLPATH_POINTS` 4 M, preview `MAX_PREVIEW_POINTS` 2 M), so points are spaced further apart |
| `hole` | print | warning | the hole is under two beads wide |
| `refill` | print | info | refill pauses are planned (it lists their heights) |
| `wallGap` | print | info | two smooth walls leave gaps behind raised parts |

`designChecks` runs on every preview, and none of its checks blocks designing (design §11). `printChecks` runs in Prepare print: its own checks come first, then the design warnings except `bed`. `canExport` is false while any check is an error. Messages give heights in mm, never layers: "Leans past 45° between 96 and 110 mm".

## Renderer

`render/beads.js`: one instanced bead per path segment, built in the vertex shader straight from `positions`. Rings are mitred onto the plane that bisects each turn, so beads join without gaps or bulges. Kind-0 segments collapse to nothing. It renders on demand only.

```js
export class BeadRenderer {
  constructor(canvas)                        // WebGL 2; double-click fits the camera
  setToolpath(result | null)                 // takes ownership of the typed arrays; fits the camera only for the first one
  setHighlight(bitmask, severity)            // colours beads where issues & bitmask ≠ 0; 0 turns it off; 'error' = red, else amber
  setSeamMarker(visible)                     // faint line through seamLine
  setBed({ widthMm, depthMm } | null)
  setViewport({ x, y, width, height } | null)   // CSS px inside the canvas where the pot must fit
  fitCamera({ keepDirection = false } = {})  // only on load, double-click, opening a design and layout changes (D20)
  resize(), requestRender()                  // resize also runs from a ResizeObserver; renders coalesce to one frame
  onAfterRender(fn): () => void              // after each on-screen render, camera current; returns unsubscribe
  rayFromClient(clientX, clientY, out?): THREE.Ray
  worldToCanvas(v, out?): { x, y, behind }   // CSS px from the canvas' top-left corner, camera of the last render
  thumbnail(result = current, size = 192): Promise<Blob>   // white beads, fixed 3/4 view, transparent; drawn at 2× and averaged down
  get canvas, get camera, get controls, get scene; dispose()
}
```

`render/handles.js`: `createProfileHandles(renderer, overlayEl, { onDrag(index, {z, r}), onCommit(), onAdd({z, r}), onRemove(index), onSelect(index) })` returns `{ update(design, profileLine), setSelected(index), setVisible(bool), dispose() }`. `setSelected(null)` or `setSelected(-1)` clears the selection. Raw values go out; the caller applies `moveKnot`, `insertKnot` or `deleteKnot` and calls `update()`.

Handles sit in the vertical plane through the axis that faces the camera, on the screen-right side (C17). The module sets `overlayEl` to `pointer-events: none` itself, so the view still orbits; only the handles and the line's hit stroke take events. Handles are focusable DOM elements (44 px on touch), and the line is SVG, re-placed in `onAfterRender`. Input uses Pointer Events with capture. Tap the line to add a point. Delete, Backspace, right-click or a long-press offers Remove. Arrow keys nudge 1 mm (Shift: 10), with one commit per nudge.

## Store

```js
// store/store.js
export function createStore({ design, history?: { steps, pointer }, printer?, label = 'Start', db? }): Store
  // history: persisted steps, oldest first (db.loadHistory()); without it the store starts with one step `label`
export function relativeTime(time, now = Date.now()): string   // 'now', '3 min', '2 h', '3 d'
Store = {
  get state(): { design, view, printer, result, savedId, historyId, historyIndex }   // historyIndex counts from the top: 0 = newest
  subscribe(fn: (state, what: Set<'design' | 'view' | 'printer' | 'result' | 'history'>) => void): () => void
  change(label, mutator)            // live edit inside a gesture, on a structuredClone draft; notifies 'design'; no step yet
  commit(): boolean                 // ends the gesture: one step if the design differs from the step at the pointer
  apply(label, mutator): boolean    // change + commit (clicks, typed values)
  open(design, label, { savedId? }) // replaces the design and adds a step ("Opened: <name>") unless nothing changed
  undo(), redo(), canUndo(), canRedo()   // move the pointer; an open gesture is committed first
  restore(stepId)                   // adds "Restored: <relative time>" on top, reusing that step's thumbnail
  history(): Step[]                 // newest first; Step = { id, label, time, design, savedId, thumb: Blob | null }
  currentStep(): Step               // the step at the pointer
  setView(patch), setPrinter(printer), setResult(result), setThumb(stepId, blob)
  setSaved(savedId, name?)          // the current design is now a saved tile (optionally renamed); no new step
  flush(): Promise<void>            // writes pending history now; otherwise 500 ms after a change, and on page hide
}
view = { advanced, mode: 'design' | 'print', openSections: string[], slot: 'a' | 'b', selectedKnot: number | null,
         highlight: warningId | null, phoneTab, designsOpen, sizeLocked }   // advanced, openSections kept in localStorage
```

History (C3): the history is a list of design snapshots, oldest first, plus a pointer. Undo and redo only move the pointer. A commit, open or restore made below the top is added on top, so no step is ever dropped, except the oldest once there are more than 200. Designs are compared without `meta`, so renaming or saving doesn't count as a step. Camera, view state and printer settings are not in history (§8.4).

`store/db.js`: `openDb()` never rejects. It returns `{ persistent, get(store, key), put(store, key, value), delete(store, key), all(store), loadHistory(), saveHistory({ put, remove, order, pointer }) }`. The IndexedDB database `vasecreator-v2` has three stores: `history` (one record per step, plus `meta` = `{ order, pointer }`), `designs` (saved tiles, `{ id, name, design, thumb, updated }`) and `settings` (`printer`). Without IndexedDB (some private modes), the same API works in memory for the session. A failing call is logged and returns a fallback; it never throws. `put` and `saveHistory` resolve `false` when the write failed, so the caller can keep the data for a retry or say it wasn't saved.

## UI contracts

- `ui/controls.js`. Each factory returns `{ el, set(value), destroy() }` plus the extras listed here. `onInput` is for live updates (`store.change`) and `onCommit` ends the gesture (`store.commit`). A typed value calls both, once, on Enter or blur. `set()` never overwrites a field that someone is typing in or scrubbing.
  - `numberField({ label, unit, min, max, step, decimals, value, onInput, onCommit, info?, compact?, readOnly? })` also returns `input`, `setInfo(text)`, `setDisabled(bool)` and `setLimits({ min?, max?, step? })`. Drag the label to scrub (Shift ×10). Arrow keys step and Escape reverts. − / + steppers show on touch screens. `compact` hides the visible label and the steppers.
  - `slider({ …same })` is a range with a compact number field. It also returns `setInfo` and `setDisabled`.
  - `segmented({ label, options: [{ value, label, disabled? }], value, onChange, hideLabel? })`, `toggle({ label, value, onChange })`, `select({ label, options, value, onChange })`.
  - `h(tag, props, children)` is the shared DOM helper. `parseNumber(text)` reads "2,5 mm" or a typographic minus and returns NaN when there's no number.
- A section module's default export is `{ id, title, advanced, summary(design, ctx?): string, mount(el, ctx): { update(state), destroy() } }`. The same members are also named exports. `shape.js` also exports `limit(keys, fallback)`, `footprintAt(design)` → `{ widthMm, depthMm, cornerMm, perimeterMm }` at the widest point, and `footprintControls(store, { hideLabel? })`, which the Footprint section shares.
- `ui/swatch.js`: `drawSwatch(canvas, recipe, { id, size = 56, columns = 12, rows = 12, tiles = 2 })` draws a cached swatch. `beadGrid(slot, perimeterMm, layers)` → `{ columns, rows }` gives the bead-scale grid of one tile.
- `ui/sidebar.js`: `mountSidebar(el, ctx)`. On desktop it shows collapsible cards; a closed card shows its `summary`, and the advanced sections sit under an "ADVANCED" divider while `view.advanced` is on. On a phone (≤ 760 px wide) it shows the tabs Shape, Surface, Layers, Base and Advanced. Each section mounts once and its DOM moves between the two layouts, so a drag or a focused field survives every update.
- `ui/print.js`: `mountPrintPanel(el, ctx)` shows the four Prepare print steps (Walls, Printer, Check, Export; design §10) while `view.mode === 'print'`. It runs `engine.print` 300 ms after a change and draws the final walls with `renderer.setToolpath`; `main.js` redraws the preview when the panel closes. Printer edits go through `store.setPrinter(normalisePrinter(…))`.
- `mountTopbar(header, ctx)`, `mountChips(el, ctx)` (picking a warning sets `view.highlight`), `mountHistory(el, ctx)` (the history card and the Advanced button) and `mountDesigns(dialog, ctx, { lastDesign })` → `{ open(), close(), promptSave(), isOpen }`. The Designs screen opens on every visit, once the first preview is in. Design files are named `<name>.vasecreator.json`.
- `main.js` builds `ctx = { store, library, presets, engine, renderer, handles, db, designs, thumbnailFor(design), requestFit() }`; `designs` is filled in once mounted. `thumbnailFor` waits until the live preview is idle, so thumbnails never delay it. `requestFit()` fits the camera when the next preview arrives. `main.js` also takes a history thumbnail once a step has settled for 600 ms, backfills missing ones when idle, saves the printer, and handles Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y and Delete. Each UI part mounts in a try/catch, so one broken part doesn't stop the app. `window.vc2 = ctx` is a debugging handle, not an API.

```
body
  header.topbar      #logo-button + #logo-menu (phone: Designs, Save design) · title, credit · .topbar-actions
  main.workspace
    div#view         canvas#scene + div#overlay (handles) + #webgl-message    fills the window (desktop) / top 40 % (phone)
    aside#panel      div#design-panel · div#print-panel                       left sidebar (desktop) / bottom 60 % (phone)
    div#chips        warnings chip · size chip
    div#rightcol     history card · Advanced button
  dialog#designs     Designs screen
```

`#webgl-message` shows when WebGL 2 is missing; a script in `index.html` checks this before the modules load. `main.js` reuses it for a failed start or a broken engine. `main.js` passes the free region between the panel, the chips and the right column to `renderer.setViewport`.

## Testing and running

- `cd v2 && npm test` runs `test/*.test.js` with `node:test` (Node 24, no dependencies). The suites cover `core/` only. The store, the renderer and the UI are checked by hand in a browser.
- **Golden G-code.** `test/golden/*.gcode` holds the output for a plain cylinder and the three presets. Any change to the output fails with the first line that differs. Read the diff, and if the change is intended, rewrite the files with `UPDATE_GOLDEN=1 npm test` (PowerShell: `$env:UPDATE_GOLDEN=1; npm test`). Commit them with the change. A missing golden file is written on the next run.
- **Determinism.** A test in `test/math.test.js` scans `core/*.js`, with comments stripped, for the banned `Math` functions and `**` (see Rules).
- **Run the app.** From the repository root, run `node v2/tools/serve.mjs [port]` and open <http://localhost:8020/v2/>. The server serves the repository root without caching, so `/v2/` sits at the same path as on the live site. You need a server because module workers don't load from `file://`. The browser needs WebGL 2, plus network access for three.js and the Inter font.

## Visual tokens

```css
/* styles/app.css :root, used everywhere */
--c-primary: rgb(139,197,193); --c-primary-light: rgb(93,138,139); --c-primary-dark: rgb(26,47,48);
--c-text: rgb(18,47,45); --c-text-2: rgba(18,47,45,.7); --c-surface: rgba(248,248,248,.9); --c-card: rgba(255,255,255,.72);
--c-border: rgba(0,0,0,.1); --c-input-bg: rgba(255,255,255,.85); --c-input-border: rgba(0,0,0,.15);
--c-accent: #3fa66a; --c-warn: #e0a100; --c-error: #d64545;
--radius-card: 12px; --radius-ctl: 8px; --font: 'Inter', system-ui, sans-serif;
--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px;
--shadow-1: 0 1px 3px rgba(0,0,0,.05); --shadow-2: 0 4px 8px rgba(0,0,0,.08); --shadow-3: 0 10px 20px rgba(0,0,0,.12);
--topbar-h: 64px; --sidebar-w: 320px; --rightcol-w: 132px;
```

Derived layout values (`--gap`, `--ctl-h`, `--focus-ring`, the `-bg` tints) follow in the same block. v1's look carries over (design §8.7): Inter, white translucent cards with 12 px corners, buttons and chips with 8 px corners. The background is v1's teal gradient (primary-light → primary) as plain CSS.
