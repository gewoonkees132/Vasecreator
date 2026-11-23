# Vasecreator v2: toolpath-first foundation research

- **Date:** 2026-11-23
- **Status:** Research input for a design brainstorm. The decisions taken after the first review are listed in §11.1 and marked D0–D5 where they apply; everything else is undecided.
- **Decisions so far (§11.1):** clay *and* FDM; walls and thickness chosen at the end, not during design; three.js, working on Android like the current app; physical printer verification deferred, with the focus on the pre-G-code design interface; web only.
- **Scope:**
  - An audit of the current codebase.
  - The landscape of toolpath-first tools.
  - Printing constraints for clay and FDM vase mode, and G-code.
  - The pattern system.
  - Architecture and performance.
- **Fixed constraint, set by the project owner:** Vasecreator stays freely available to the public. The app itself will not be licensed or monetised, so there are no paid tiers, accounts or gated exports. In this document, "licensing" only means whether dependencies and assets are compatible with the repository's GPL-3.0 licence.

**How to read this document**

- **Facts carry citations.** A tag such as [P2] or [E14] points to §12. Each source there has a URL and an access date. *UNVERIFIED* means I could not confirm a claim at a primary source.
- **Recommendations are labelled.** §1–§3 are mostly facts. §4–§11 are proposals unless a sentence carries a citation. Recommendations are marked **Rec**, or they sit in sections whose heading says they are proposals.
- **Measured numbers are labelled "measured".** They come from a throwaway benchmark run for this document (§10.2). No code from it was added to the repository.

**Inputs**

- The repository at commit `da51f2f`: `README.md`, `index.html`, `script.js` and `style.css`.
- The Potterware 5.0 beta user manual.
  - The brief gave its path as `docs/reference/potterware-5.0-manual.pdf`, but that path does not exist in the repository. I used a local copy of the same 30-page manual, which is also published online [P2].
  - The manual is summarised here in my own words. No text or images from it are reproduced.
- Four parallel web-research tracks: landscape, printing and G-code, patterns, architecture. Their findings were checked against each other and merged here.

---

## 1. Summary

Vasecreator today builds a closed mesh from a revolved profile and exports OBJ. Its design model is already a single-valued radius over height times a plan shape, so it maps almost directly onto a toolpath design function r(z, θ). Only wall thickness and OBJ export don't carry over, and the move removes two mesh distortions: a wall offset horizontally rather than along the surface, and wall thickness stretched by the width/depth scale. Toolpath-first is already standard for clay. Potterware 5.0, 3dSynth, WASP App, CoilCAM, FullControl and Termite all generate the nozzle path directly, while slicing a textured mesh for clay is a documented failure. The open niche is a free, browser-local GPL tool with honest printer profiles and an expressive, deterministic pattern system. Existing web tools gate export behind accounts or servers, and the rest are plugins for CAD experts. Technically, the toolpath should be computed once on the CPU in a worker, and both drawn and exported from that same buffer. It is fast enough (one million points in about 31 ms, measured on a desktop), and GPU arithmetic and engine-specific JS trigonometry would otherwise break deterministic G-code. WebGPU is not yet available on every platform, and three.js's WebGPU renderer is still labelled experimental. The provisional rendering choice is therefore three.js `WebGLRenderer` with a vertex-pulled bead, kept isolated so a later WebGPU port is mechanical.

**The five most important findings**

1. **Toolpath-first is validated, and today's model fits it.**
   - Every serious clay vessel tool designs the path, not a mesh [P2][P7][P15][P25][P17][P28].
   - Users who sliced textured meshes for clay got the texture on the inside too, and weak walls [P6]. Constant-layer slicing also thins walls on overhangs [P33].
   - Most current Vasecreator features translate one-to-one (§2.7).
2. **The free, local, GPL slot is open, and the owner's "stays free" constraint makes it the strategy.**
   - Potterware needs a sign-in and a subscription to export: $300–500 a year, or $99 a semester for students [P4]. Its uploads and limits are server-side [P2].
   - WASP App builds G-code on a server and asks for an email address [P15].
   - 3dSynth's free tier caps exports at two effects [P7].
   - ClayShaper is local, but its licence is source-available (PolyForm), not open source [P34].
   - No open-source, browser-local tool combines printer profiles, bitmap patterns and rules or curves.
3. **The canonical toolpath belongs on the CPU. The GPU only draws it.**
   - **CPU cost, measured:** about 31 ms to evaluate 1 M points. Turning them into G-code text costs about 10× more (336 ms).
   - **GPU precision:** WGSL `sin`/`cos` may be off by up to 2⁻¹¹ absolute, which is about 0.05 mm at a 100 mm radius [E33].
   - **JS engines differ:** `Math.sin` is "implementation-approximated", and V8, SpiderMonkey and JavaScriptCore use different maths libraries [E31][E32].
   - So the earlier plan to evaluate r(z, θ) in a GPU compute pass should be dropped for v2.0. Draw the bead by vertex pulling from the CPU buffer, the approach PrusaSlicer 2.8 uses [E20]. This works on WebGL 2 today.
4. **The pattern system has a clear precedent, and clear gaps.**
   - Potterware 5.0 already ships image relief, wave masks or both, tiling and fades [P2].
   - Where Vasecreator can improve:
     - Rules whose result doesn't depend on the order they are listed in. Potterware's "ends at" is a share *of the remaining layers*, which is easy to misread [P2].
     - Real curves over height.
     - Showing the *printable* resolution. A ⌀100 mm pot, 150 mm tall, with 4 tiles around, a 4 mm bead and 1.5 mm layers resolves only about 39 × 100 samples per tile, so a 2048-px image is mostly discarded.
5. **Clay numbers depend on printer and material, so profiles and validation must be explicit.**
   - **Overhang limits:** undried clay held 22° from vertical and failed at 27°. With forced drying it held 50° [C1]. Per layer, that is a radial step of only about 0.20–0.25 of the bead width.
   - **E values are a fudge:** extrusion is expressed through a made-up filament diameter across vendors and tools [P17][C10].
   - **Pauses differ by firmware:** `M0`/`M600` on Marlin, `M226` on RRF, `PAUSE` on Klipper [C25][C27][C28].
   - **Implication:** printer profiles need explicit volume-to-E calibration and pause templates. Checks should be warnings with heatmaps, using conservative defaults that test prints calibrate.

---

## 2. Current approach audit

All line references are to the `main` snapshot at commit `da51f2f` (2025-04-08), the last change to the code.

### 2.1 Architecture

- **Shape of the code.** It is a static site of three files and needs no build step: `index.html` (218 lines), `script.js` (2,694 lines) and `style.css` (630 lines). There is no `package.json`, no tests and no linter.
- **Three.js r175 (0.175.0).** Three.js loads from jsDelivr, and `script.js` imports it by absolute URL (`script.js:1-3`). The import map in `index.html:29-37` declares the same modules under bare names, but nothing uses them.
- **One app object.** Every module subclasses `ModuleBase` (`script.js:82-89`), which keeps `app`, `app.config` and `app.state`. Modules reach each other through `this.app.*`.
  - Modules: `ConfigurationManager` (189), `StateManager` (301), `SceneManager` (342), `InputManager` (484), `RenderManager` (857), `ExportManager` (895), `ResourceManager` (947), `UIController` (1039), `GeometryModule` (1260), `DimensionModule` (1669), `DynamicBackground` (1869).
  - The orchestrator is `FlowerpotApp` (2168), which builds the modules in a fixed order (2295-2307).
  - Because of that order, `ModuleBase` copies `this.config` and `this.state` before they exist for the first modules. For example, `StateManager.state` is `undefined`. Nothing breaks, because the code mostly reads through `this.app`.
- **Two WebGL contexts.**
  - The vase renderer (`script.js:368-386`) uses antialiasing, ACES tone mapping and 512² PCF soft shadows.
  - A second `WebGLRenderer` draws the animated gradient background (`script.js:1902-1927`).
  - The render loop runs every frame, even when nothing changes (`script.js:876-891`). It pauses only when the tab is hidden (`script.js:2339-2347`).
- **Outdated WebGL check.** `checkWebGLSupport()` (`script.js:6-15`) only tests for WebGL 1. Three.js has required WebGL 2 since r163 [E13], so a device with only WebGL 1 passes the check and then fails inside Three.js.

### 2.2 Data model

- **`app.config`** (`script.js:254-265`) holds:
  - `curve`: `tension`, `type`, `filletRadius`, `segments` (20), `heightSegments` (60) and `wallThickness`.
  - `base.filletRadius`, `dimensions.width` and `dimensions.depth`, and `drainageHoleScale`.
  - `display` flags, `unitToMm` (50) and the live Three.js `materials`.
- **`app.state`** (`script.js:316-334`) holds the design data and the scene objects side by side.
  - The design data is `controlPoints`, an array of `THREE.Vector2` in normalised units.
  - Next to it sit meshes, groups, a `Raycaster`, a `Clock` and the drag and hover state.
- **Not serialisable.** Neither object can be turned into JSON without filtering. Design data, view state and GPU resources share one tree.
- **Units are not millimetres.** One internal unit is 50 mm (`unitToMm`, `script.js:263`).
  - The default 5-point profile is 1 unit (50 mm) tall (`script.js:309-315`).
  - A drag clamps height to 3 units, which is 150 mm (`script.js:655`).
  - The radius is clamped to `[0.01, 1.5] × width` (`script.js:653`).
- **Defaults disagree.**
  - The slider defaults in HTML differ from `config`. Base fillet is 0.1 in HTML (`index.html:115`) and 0.8 in config (`script.js:258`). Width is 0.5 (`index.html:135`) against 1.
  - `UIController` copies the config values onto the sliders at start (`script.js:1061-1071`), so config wins. The first labels shown are still inconsistent.
- **No persistence.** There is no undo, no saving to `localStorage` or `IndexedDB`, no URL state, no presets and no numeric entry.

### 2.3 Geometry pipeline (mesh)

`generateFlowerpot()` (`script.js:2492-2575`) rebuilds everything from scratch whenever anything changes:

1. **Clean up.** `cleanupPreviousMeshes()` (`script.js:954-993`) disposes the pot mesh, the control-point meshes, the dimension lines, sprites and handles.
2. **Plan shape.** `createBaseShape(1, 1, base.filletRadius)` (`script.js:1379-1414`) draws a unit square with quadratic-Bézier rounded corners. `getPoints(20)` then samples it, giving about 84 points per ring (4 straight edges plus 4 × 20 corner points).
   - Despite its label, **"Base Fillet Radius" is the plan-view corner rounding of the whole cross-section.** It is not a fillet between floor and wall.
   - At 100 % rounding, a quadratic Bézier only approximates a circle, so the shape is close to round but not exactly round.
3. **Profile.** `getCurvePoints()` (`script.js:1263-1294`) builds the profile in one of two ways:
   - **Spline:** a `CatmullRomCurve3` (type `catmullrom`, with `tension`), sampled at 51 points (`getPoints(50)`). The samples are evenly spaced in the curve parameter, not in arc length.
   - **Polyline:** the control points plus corner fillets (`script.js:1297-1375`).
4. **Wall.** `generateThickFlowerpotGeometry()` (`script.js:1417-1607`) builds the solid wall:
   - It places 61 rings, evenly spaced in *y* (`heightSegments = 60`).
   - At each ring it finds the radius with `findRadiusAtHeight()` (`script.js:1640-1665`), a linear search with linear interpolation that **assumes the profile rises monotonically in y**.
   - It adds a matching inner ring offset by `wallThickness`, plus a floor with a drainage hole and a chamfer (`script.js:1466-1556`).
5. **Width and depth.** The mesh is then scaled unevenly by `(2·width, 1, 2·depth)` (`script.js:2533`) and moved so it sits on y = 0 (`script.js:2537-2547`).

**What the pipeline shows about the model:**

- **The design is already single-valued, r(y) × plan(θ).** The mesh samples radius as a function of height, so an undercut profile (a point dragged below its neighbour) can't be represented. The profile line drawn on screen (`updateCurveLine`, `script.js:2476-2489`) still shows the true spline, so the line and the mesh can disagree.
  - This matches r(z, θ) well, as long as the profile stays a function of z.
- **Wall thickness is a horizontal offset** of the outer profile (`generateInnerProfileCurve`, `script.js:1610-1637`), not an offset along the surface normal.
  - On a wall sloping at angle α, the true thickness is t·cos α.
  - The uneven width and depth scale afterwards also stretches the wall thickness along one axis.
- **The polyline "fillet" is not a tangent fillet.** `calculateFilletPoints()` (`script.js:1323-1375`) does find the right tangent distance (d = R / tan(φ/2)). But the arc it draws sits at a constant distance d from the corner (`script.js:1366-1368`).
  - The result is an arc centred on the vertex, which bulges away from the corner. It meets each edge at 90°, so the outline dips inward instead of rounding the corner.
  - A numeric check confirms it. At a 90° corner with R = 0.2, the code's arc midpoint is (−0.141, 0.141). The chord midpoint is (−0.100, 0.100) and a true fillet's midpoint is (−0.059, 0.059).
- **The spline depends on width.** It is built in width-scaled space and then divided back by width (`script.js:1267-1293`), so changing the width slightly changes the curve's shape as well as its size.

### 2.4 UI and interaction

- **Sliders.** Each slider updates its label at once, but the geometry rebuild is debounced by 150 ms (`script.js:1113-1130`). The shape doesn't follow a slider while it is being dragged.
- **Control points.** Points are dragged on the z = 0 plane in 3D (`script.js:639-667`). Every mouse move runs the full rebuild, including throwing away the control-point meshes and dimension sprites.
  - Point 0 is pinned to y = 0.
  - **Add** inserts a point between the last two, 0.05 units higher (`script.js:2578-2619`), up to 10 points.
  - **Remove** always deletes the second-to-last point (`script.js:2622-2633`). The user can't pick which point.
- **Width and depth handles.** Cone handles on the ground plane drag width and depth (`script.js:670-739`). Text sprites label the dimensions in mm (`script.js:1809-1851`).
- **Input events.** `UnifiedEventHandler` (`script.js:92-144`) uses touch events *or* mouse events, chosen by detecting a touch device. On hybrid laptops the mouse can stop working. Pointer Events would avoid this.
- **Small defects.**
  - The label text colour is set to the invalid string `"--colorText"` (`script.js:45`), so it is ignored.
  - The label canvas is 24 × the font size tall (`script.js:39`).
  - `detachEventListeners()` calls `.bind` again, so it removes nothing (`script.js:2325-2329`).
  - `disposeAll()` refers to a `Utils.textureCache` that is really private to a closure (`script.js:28`, `script.js:1011`).

### 2.5 Export

- **How it works.** `exportToObj()` (`script.js:896-943`) copies the mesh, scales it by 50 to millimetres, and turns it from Y-up to Z-up. Three.js `OBJExporter` then writes it, and the browser downloads `flowerpot.obj`.
- **What is missing.** The file has no units and no metadata. It also has no G-code, STL or design file.

### 2.6 Performance

- **The workload is small.** A mesh has about 61 × 2 × 84 ≈ 10 k vertices, plus the floor. The rebuild cost comes from allocating and disposing objects (Three.js objects are rebuilt on every change), not from computation.
- **The idle cost is not small.** Two WebGL contexts render continuously, and the shadow map updates every frame.
- **Nothing is measured.** There is no worker, no budget and no profiling.

### 2.7 Feature mapping to a toolpath model

| Current feature | Where | Becomes in a toolpath model | Translates? |
|---|---|---|---|
| Profile points | `state.controlPoints`, `script.js:309-315` | Profile knots `(z_mm, r_mm)` defining r₀(z), the base term of r(z, θ). z must increase strictly from knot to knot, which makes the current implicit rule explicit. | Yes, directly |
| Spline / polyline | `script.js:1276-1290` | The interpolation mode of the profile curve, evaluated exactly at each layer's z instead of from 51 pre-sampled points. The spline should be centripetal Catmull-Rom or monotone cubic to avoid overshoot, which turns into unplanned overhang. | Yes |
| Tension | `config.curve.tension` | The spline tension, or per-knot smoothness. | Yes |
| Fillet (polyline) | `script.js:1297-1375` | Corner rounding of the profile: a tangent arc with radius in mm. **The current algorithm draws a notch, so it has to be fixed (§2.3).** | Yes, after a fix |
| Width / depth | `config.dimensions`, `script.js:2533` | A plan-shape affine scale (sx, sy) applied to each layer's XY points. The bead width stays constant, unlike today's mesh scaling. Because r(z, θ) loses its strict polar meaning after a non-uniform scale, θ becomes a curve parameter (§5.1). | Yes |
| Wall thickness | `config.curve.wallThickness` | No longer a free geometric value. A single-bead wall is as thick as the bead (nozzle × extrusion factor). Thicker walls become "walls per layer: 1 or 2 (+ spacing)", or a zigzag infill between two perimeters. | Moves to the finish step (D2): clay 1–2 walls, FDM thickness methods |
| Base fillet (plan corner rounding) | `script.js:1379-1414` | A plan-shape parameter: a rounded rectangle or superellipse, or an N-sided polygon with rounding, written as a radial function s(θ). | Yes, and generalises |
| Drainage hole | `config.drainageHoleScale`, `script.js:1466-1556` | A floor-pattern parameter. The floor infill (spiral or concentric) runs from r_hole to the foot outline instead of from the centre. The chamfer has no toolpath equivalent. | Yes, except the chamfer |
| OBJ export | `script.js:896-943` | Replaced by G-code as the primary output. Optional extras: the bead as a solid (STL/OBJ) for renders, the bare toolpath as polylines (OBJ lines), and the design as JSON. For FDM, a solid mesh with thickness can be built at the finish step for slicing elsewhere (D2). | Replaced, with a possible secondary export |
| Dimension handles and labels | `script.js:1669-1866` | Bed-fit overlay, plus size, path, time and material stats. | Yes |
| Animated background | `script.js:1869-2165` | Not design-relevant. A CSS gradient would free one WebGL context. | Drop or replace |

### 2.8 Licence and intent

- **The licence.** The repository is GPL-3.0 (`LICENSE`).
- **The README describes the project as non-commercial,** educational and free to use (`README.md:13`, `README.md:26`). This matches the owner's constraint for v2: the app stays free to the public.
- **What that means for this document.** The licensing questions are about dependencies and shipped assets. Each one must be GPL-3.0 compatible (§8.6).

---

## 3. Landscape and best practices

Prices, versions and status were checked on 2026-11-23. **Reddit was unreachable:** it returned HTTP 403 to every fetch, and searches found no indexed threads. User sentiment below therefore comes from forums, blogs, GitHub issues and product pages, and Reddit sentiment is UNVERIFIED for every tool.

### 3.1 Prior findings, verified

| Prior claim | Status | What the sources say |
|---|---|---|
| Potterware: profile + texture → G-code | **Confirmed** | [P1][P2] |
| Potterware: bitmap relief and wave mask | **Confirmed** | Image *Relief*, *Wave mask* or *Both*. 12 built-in tileable images, plus uploads [P2] |
| Potterware: seam ramp or continuous spiral | **Confirmed** | [P2] |
| Potterware: non-planar sculpting | **Confirmed** | New in 5.0: a cage of handles plus a brush, with a non-planar toggle [P2] |
| Potterware: $300–500/yr, $99/semester students | **Confirmed** | $500/yr for companies and colleges; $300/yr for high schools and individuals; $99 per semester for individual students [P4] |
| Potterware: (implied) runs locally | **Refined** | Runs in the browser, but needs sign-in to export, has 12-hour sessions, keeps uploads on the server for 3 days, and rate-limits previews and exports [P2]. Whether the G-code itself is generated client-side or server-side is UNVERIFIED |
| 3dSynth (Kubuz): browser-based | **Confirmed** | Free web app, plus a Premium desktop app for Windows, macOS and Linux [P7]. Kubuz is in Belgium. Launch coverage ran from January to September 2026 [P8][P9] |
| 3dSynth: effect stack, node and block modes | **Confirmed** | G-code Sculptor (effect stack), Node Sculptor (since 2.0.0, Apr 2026), SynthBlocks (Scratch-style) [P7][P13] |
| 3dSynth: clay/paste mode | **Confirmed** | A "process dialect" setting, added in 2.1.1 (May 2026) [P12][P13] |
| 3dSynth: $39 one-time | **Confirmed** | USD 39 lifetime via Gumroad. The free tier caps exports at two effects [P7] |
| WASP App: free, WASP-oriented | **Confirmed, with caveats** | v2.1.2 in the browser. Supports only the WASP 2040 Clay and 40100 Clay. Export needs an email address, and the G-code is generated on WASP's server [P15] |
| FullControl: Python/JS, GPL-3.0 | **Corrected** | The Python library is GPL-3.0 (PyPI 0.1.2, last commit 2026-10-09) [P17][P18]. The original Excel designer is GPL-3.0 too [P19], and the method is published in Gleadall (2021) [P24]. There is **no official JS library**: *fullcontrol-js* is a community TypeScript port by Kyle Grover, also GPL-3.0 (v0.2.1) [P20] |
| CoilCAM-js: UCSB research tool | **Confirmed** | CHI '23 paper [P25]. MIT licence on both repositories [P26] |
| Termite: Grasshopper, MIT | **Confirmed** | v1.4, free, 21 components [P28] |
| TOOLPATHS: Grasshopper, commercial beta | **Confirmed** | Open beta announced 2026-09-30, with a paid licence planned [P31] |
| Claywoven: Blender | **Partly confirmed** | Blender assets plus a plugin, distributed via Patreon ($8/month tier). Licence and export formats are UNVERIFIED (paywalled) [P32] |
| Rendering: one r(z, θ) evaluated on the GPU | **Recommend against for v2.0** | GPU trig error is up to 2⁻¹¹ absolute [E33]. Evaluating on the CPU is cheap (measured, §10.2). See §8 |
| Rendering: toolpath points generated in a compute pass | **Not needed; limited on fallback** | On WebGL 2, TSL compute is emulated with transform feedback. Atomics and indirect draws are WebGPU-only [E16][E18] |
| Rendering: bead via ray–capsule impostors or vertex pulling | **Both feasible** | Writing fragment depth disables early-Z. The mitigating extensions are patchy (`EXT_conservative_depth` is in 2.7 % of Firefox sessions; WGSL `fragment_depth` is temporarily disabled) [E26][E27][E28]. Vertex pulling keeps early-Z and is what PrusaSlicer 2.8 ships [E20] |
| Rendering: G-code on the CPU from the same function | **Confirmed as necessary,** plus one addition | JS `Math.sin` is implementation-approximated and differs across engines, so bit-identical output needs a custom trig routine (§8.3) [E31][E32] |
| WebGPU ships in all major browsers | **True per brand, not per platform** | See §8.1. caniuse lists WebGPU at 88.6 % total support and WebGL 2 at 97.3 % [E2][E11]. Firefox on Linux, Intel Macs and Android has WebGPU off by default; Chrome on Linux is still rolling out by GPU [E1] |
| WebGPURenderer + TSL falls back to WebGL 2, except some compute features | **Confirmed, with more caveats** | Still labelled *experimental* in the manual. `ShaderMaterial`, `RawShaderMaterial` and `onBeforeCompile` are unsupported [E15] |

### 3.2 Tool comparison

| Tool | Platform · licence · price | Design model | Layers and seam | Base | Textures | Output and preview |
|---|---|---|---|---|---|---|
| **Potterware 5.0 beta** [P1][P2][P4] | Browser, closed source. Subscription required to export | Profile of 2–12 handles (smooth or angular); plan 3–360 sides; twist up to 1800°; exact values entry; mesh import (≤ 150 k triangles, outer outline only) | Layer height 0.2–10 mm; seam ramp (last 0–40 points climb) or continuous spiral; seam fixed or follows twist; 24–1000 points per layer | 0–5 layers. Rings, spiral, lines, crosshatch, sunburst. **Every pattern finishes at the seam.** Directions alternate per layer; outline ring; inset scale | Horizontal waves (sine, saw, square, seeded jitter) with start/end, fades, per-layer phase, waved/plain bands, interior offset. Image relief/mask/both with tiling and coverage. Vertical waves with height gradients | Absolute E; parameter header; refill comment plus pause; STL bead + OBJ path exports. Bead or lines preview, scrubber, stats chips, bed fit. 100-step labelled undo; JSON designs; separate printer profiles |
| **3dSynth** [P7][P10][P11][P12][P13] | Browser (free) plus desktop Premium, $39 one-time, closed source | Bézier radius-vs-height profile plus an **ordered modulator stack** (ripples XY/Z, noise, twist, shape, pattern/SVG, caps). Also node and block modes | Vase mode (helix, flat first loop) or layer mode (1–10 walls, infill). Seams aligned or seeded random; seam anchored to a wave peak (2.1.1) | Bottom cap. Other floor options UNVERIFIED | Effect stack. Texture positions normalised by arc length (2.1.1) | Hundreds of FDM profiles; slicer-style placeholders; G2/G3 arcs on by default; clay dialect without cold-extrusion checks; E from true 3D length |
| **WASP App 2.1.2** [P15][P16] | Browser, free, needs email; G-code built server-side | Control points (z, r); sides; corner radius; twist | Continuous spiral (from reading the client code) | Concentric or parallel infill, rotated per layer, then a shell | Waves, vertical waves, bubbles, cells, image (BMP/PNG/JPG; black = 100 %) | Two WASP printers only; animated simulation; no time or clay estimate seen |
| **FullControl** [P17][P20][P21] | Python library (GPL-3.0); community JS port (GPL-3.0); fullcontrol.xyz gallery (appears server-backed) | **A list of steps that change state** (Point, Extruder, Printer, ManualGcode…) | Up to the author's code | Up to the author's code | Ripple and other examples written in code | About 18 device profiles, including `wasp2040clay`; stadium, rectangle or circle area models; tube or line plots |
| **CoilCAM / CoilCAM-js** [P25][P26][P27] | Grasshopper plus browser editor, MIT, research | `toolpathUnitGenerator` + per-layer and per-point arrays from **1-D/2-D shaping functions** (additive or multiplicative); layer-wise Boolean union/difference | `spiralize()` for continuous layers | `baseSpiral`, `baseFill` | Shaping functions (sine, staircase, square…) | G-code and URScript; Potterbot presets |
| **Termite 1.4** [P28][P29][P30] | Rhino/Grasshopper, MIT, free | Components: wall, spiral from curve or surface, alternated layers, **shifted seams and ends**, sorting | Spiral or stacked layers | Base component | Via Grasshopper geometry | G-code generator; simulation; inrun speed control; intersection detection |
| **TOOLPATHS** [P31] | Grasshopper, commercial beta | Planar and non-planar slicing; **per-vertex modulation of speed, flow and geometry through modulators and masks** (developer claim) | Vase mode | Spiral infill | Modulators and masks | Deposition simulator that adjusts flow (developer claim) |
| **Claywoven** [P32] | Blender, Patreon; licence UNVERIFIED | Printer assets + G-code builder assets + modifiers (Geometry Nodes) | UNVERIFIED | Revolve builder with base controls | Sculpting the path with Blender's tools | Colour overlays per move (UNVERIFIED in detail) |
| **ClayShaper** [P34] | Browser or Windows, local; source-available (PolyForm), **not** OSI open source | Mesh → seamless spiral wall; slider design; virtual wheel | Spiral | Staggered base | — | **G-code validator** that grades files: unsupported walls, over-extrusion, speed, missing start code. Tuned for Eazao |
| **WeaveSlicer** [P33] | Rhino/Grasshopper, open source, CHI '24 | Mesh → sinusoidal woven wall whose amplitude follows the wall angle to keep thickness constant | — | — | Weave by construction | — |
| **BumpMesh / stlTexturizer** [P37][P38][P39] | Browser, AGPL-3.0, mesh-based | Displacement on a mesh: triplanar, cylindrical, planar projections; angle and paint masks | n/a (mesh) | n/a | Greyscale displacement; one texture per export cycle | STL; known issues with non-manifold output and seams |
| **FDM slicer vase mode** [P40][P41][P42] | PrusaSlicer, Cura, OrcaSlicer | Mesh, single perimeter | Spiral; Cura can smooth the seam (blurs detail); Orca ramps flow at both ends | Bottom solid layers | Fuzzy skin (random, or noise types in Orca) | Standard flavours |

**Other tools that exist but matter less here:**

- **DigitalClay3D** is mesh-first and costs $179 one-time [P36].
- **Clay Slicer 3** is commercial; its current terms are UNVERIFIED [P35].
- **Vasemaker** offers image depth maps with tiles around and up [P48].
- **Grasshopper clay plugins:** WASPer_3DP and Ovenbird, plus Silkworm, which has been inactive since 2015 [P45].
- **Research prototypes for editing the toolpath directly:** SketchPath, SculptAR and Clay ARTools [P47].

### 3.3 What users praise and complain about

**Potterware (2020 posts by a Potterbot owner)** [P5][P6]
- Praised as intuitive, with real-time sliders.
- Criticised for a wireframe-only preview, no way to re-import a design, and no tutorials.
- The owner then sliced textured meshes in Cura and Simplify3D instead. That **mirrored the texture onto the inner wall**, and the pots failed. Potterware's own output was textured outside, smooth inside, with thicker walls.
- Version 5.0 answers the old complaints with a bead preview, JSON designs and a full manual [P2]. Vendor-hosted testimonials praise how approachable it is for artists [P1].

**FullControl (Bambu forum, 2023–25)** [P22][P23]
- Users like the per-line control.
- They report prints starting above the bed, missing filament load or prime routines, weak adhesion and no retraction. The workaround was to paste start and end code copied from Bambu Studio.
- GitHub issues include "Colab G-code differs from website G-code" and requests for a LUTUM 5 profile.

**BumpMesh** [P38][P39]
- Praised as far easier than Blender.
- Limits: stacking textures needs export/re-import cycles, photo textures print blurry, issues report non-manifold output and seam scars, and the viewer is slow.

**3dSynth, WASP App** [P14]
- No independent reviews found. 3dSynth's Product Hunt page has 2 upvotes and no reviews.

**Termite** [P28]
- 5/5 from 18 ratings and about 3,000 downloads on food4Rhino.

**Researchers**
- Termite's authors argue that general slicers such as Cura and PrusaSlicer need expert tuning for clay and offer little manual control over the path [P30].
- CoilCAM's evaluation involved only its ceramicist co-authors [P25].

**Manufacturers' advice**
- 3D Potter recommends Cura and Simplify3D (with profiles) and lists Potterware as the beginner design tool [P43].
- Eazao recommends Cura [P44].
- So the default clay workflow is still "model a mesh, then slice it".

### 3.4 Printing constraints (clay first, FDM vase mode where relevant)

**Bead width vs nozzle**
- Clay bead width is effectively set by the nozzle, rather than tuned through flow as with plastic [C43].
- Example profiles:
  - FullControl's WASP 2040 profile: a 1.2 mm bead at 0.6 mm layers [P17].
  - A LUTUM profile: a 3 mm bead from a 3 mm nozzle at 1 mm layers [C10].
- FDM reference: PrusaSlicer's automatic width is 1.125 × the nozzle [C20].
- Potterware's bead model is w = max(h, nozzle × extrusion %), with a stadium cross-section: area = (w − h)·h + π·h²/4 [P2]. The same formula is Slic3r's flow model [C21].
- Nozzle ranges by machine:

| Machine | Nozzles |
|---|---|
| WASP LDM | 1.5–3 mm; XL 4–8 mm [C5] |
| PotterBot 10 | 3–6 mm [C13] |
| PotterBot Scara | 3–8 mm [C13] |
| LUTUM 4 | 0.6–7 mm [C11] |
| Eazao Zero | 1.5–3 mm [C17] |

**Layer height**
- FDM: layer height stays below about 80 % of the nozzle diameter [P41].
- Clay advice and examples cluster at 0.33–0.55 × nozzle:
  - CoilCAM docs: about 0.5 [P27].
  - Yale's PotterBot default: 1 mm on a 3 mm nozzle [C3].
  - LTH's LUTUM profile: 1 mm on 3 mm [C10].
  - One paper reports about 0.55 as optimal (abstract only) [C38].
- Layers too tall for the nozzle don't bond; layers too thin over-extrude and clog [C4].
- The WASP 40100 manual sets the first-layer gap at half the nozzle diameter for its XL extruder [C6].

**Overhang**
- **Undried clay** (3 mm nozzle, 1.7 mm layers): stable at 22° from vertical, failed at 27° [C1].
- **Forced hot-air drying:** held 50°, failed at 60°. Failures started at the seam [C1].
- Earlier literature puts the limit at about 17–20° [C1].
- Yale gives no number: it depends on the whole geometry, and supports don't work in clay [C2].
- The FDM rule of thumb is 45°: half of each layer is supported [C42].
- **Derived:** the per-layer radial step is h·tan θ. Undried clay fails at roughly 0.20–0.25 × bead width; force-dried clay holds about 0.6 × bead width.

**Seam vs spiral**
- **Slicer vase modes:**
  - In PrusaSlicer the spiral removes the layer-change scar, but it needs one perimeter, no infill or top, and one object at a time [P41].
  - Cura can smooth the spiral, at the cost of fine detail [P42].
  - Orca's default flow ramps on the first and last loop can under-extrude both ends [P40].
- **Seam placement in slicers:**
  - Cura offers user-specified, shortest, random and sharpest-corner seams [P42].
  - Orca's scarf seam ramps Z and flow over about 20 mm and is never used in spiral mode [C23].
- **Clay tools:**
  - CoilCAM turns seams to the inside of the vessel [P25].
  - Termite offers shifted seams and ends [P28].
  - Potterware offers a ramp over N points, or a spiral [P2].

**Base and floor**
- **Why floors fail:**
  - Most clay-print failures come from uneven drying [C36].
  - S-cracks in the floor usually mean the rim dried before the base [C37].
  - A soft base collapses under the wall; a plaster bed helps by pulling water out [C19].
  - A user made drying more even by thinning an over-thick base to match the wall [C40].
- **Typical floor settings:**
  - 3 solid layers in an LTH profile [C10].
  - CoilCAM's `baseSpiral`/`baseFill` are sized from the nozzle [P27].
  - Potterware ends every floor pattern at the seam, so the wall starts in place [P2].
  - PotterBot users report lowering the first layers to squash the base onto the bed for adhesion [C39].

**Prime, wipe and retraction**
- **Clay systems hold pressure:**
  - WASP uses a 5–6 bar air tank feeding an auger [C6].
  - LUTUM uses air pressure up to 4 bar [C10].
  - PotterBot uses a ram driven by a screw [C15].
- **Retraction barely works.** 3D Potter needed extreme values to retract at all [C41]. RISD runs about 20 s of retraction to depressurise before pauses, and re-primes until the flow is steady [C16].
- **Real start sequences:**

| Source | Prime | Other details |
|---|---|---|
| FullControl WASP | Stationary 300 mm³ in the air at a park point, then lift | Travel moves as `G1 … E0` [P17] |
| Aalto WASP | `G92 E0`, then a short `G1 E3` | [C8] |
| CoilCAM Potterbot | Large E prime | Explicit depressurise at the end [P26] |

- Travel moves leave bumps on high-inertia materials such as clay, which argues for continuous paths [P46].

**Non-planar**
- Potterware keeps local layer gaps between 0.5× and 1.5× the layer height, keeps the bottom ring on the bed, and warns that steep tilts drag the nozzle through the layer below [P2].
- An FDM collision model uses two numbers: a maximum angle and a collision-free height (about 8° up to about 50 mm on an Ultimaker 2) [C34].
- With clay, the slope of the path is limited by collisions between nozzle and part, because the paste doesn't set instantly [P46].

**Refills and pauses**

| Reservoir | Capacity |
|---|---|
| WASP 2040 tank | 3 L [C7] |
| WASP 40100 tank | 5 L [C6] |
| PotterBot Micro 10 tube | 1,000 ml [C13] |
| PotterBot 10 Pro tube | 2,000 ml [C13] |
| PotterBot Scara | 3,600–4,000 ml [C13][C14] |
| Eazao Zero | 500 ml [C18] |

- Clay is about 1.9 g/ml (an Eazao tube measured [C44]; also Potterware's assumption [P2]).
- RISD leaves a few inches unused at each end of a PotterBot tube [C16].
- **Pause commands by firmware:**
  - Marlin: `M0` needs an LCD or the emergency parser; `M600` needs `ADVANCED_PAUSE_FEATURE` [C25].
  - RRF: `M226` runs `pause.g` [C27].
  - Klipper: `PAUSE`/`RESUME` from `[pause_resume]` [C28].
  - WASP: the manual describes pausing from the menu and resuming from a measured Z ("Free Zeta") [C6].

**Speeds and layer time**
- **Rated speeds:**

| Machine | Speed |
|---|---|
| PotterBot 10 | 30–60 mm/s (Micro), 30–130 mm/s (Pro) [C13] |
| WASP | up to 150 mm/s [C5] |
| LUTUM | 20–100 mm/s, depending on viscosity [C11] |
| Eazao Zero | 10–40 mm/s [C17] |

- Real profiles print walls at about 20 mm/s [C10][C1].
- Clay needs fans or time between layers. Slowing down is often the only fix [C19].
- No clay-specific minimum layer time was found (UNVERIFIED).

**Shrinkage**
- A wet body can shrink up to 15 % while drying, then 5–10 % more in firing, and rarely evenly. Yale advises making the piece oversize [C2].

**Collapse height**
- A plain cylinder printed with a 4 mm nozzle collapsed above about 18–20 cm in one study [C35].

### 3.5 G-code conventions and printers

**E modes**
- **Marlin:** `M83` makes E relative even under `G90`, but a later `G90`/`G91` resets it. Marlin's `G91` also makes E relative [C25][C26].
- **RRF:** `G91` affects only XYZ [C26].
- **Klipper:** `M83` forces relative E even under `G90` [C28].
- **Cura** defaults to absolute E and periodically resets it with `G92` [P42][C22].

**E units in clay workflows**
- E is a *virtual filament length*, scaled by a stand-in diameter.
  - FullControl's WASP profile uses relative E with a 3.1 mm "feed diameter". Its own code comments call this a hack, tuned from measured volumes [P17].
  - The LTH LUTUM profile uses the RepRap flavour, absolute E and a 3 mm filament diameter [C10].
  - WIT's WASP 2040 Cura profile uses the Marlin flavour, a 6.0 mm material diameter and a centre origin [C9].
  - Eazao's manual tells users to enter 1.75 mm in Cura [C17].
- Potterware's Potterbot profile states 6.366 E per mm of path for a 4 × 1.5 mm bead [P2].
- No vendor documents E in ml or in motor revolutions (UNVERIFIED for WASP and LUTUM firmware).

**Start and end code**
- A typical clay start is `G21 G90 M107 G28 G92 E0`, then a prime [C8].
- Cura inserts heater lines unless the start code contains its temperature placeholders [C33].
- Marlin's cold-extrusion guard can be disabled with `M302 S0`/`M302 P1` [C25].
- Klipper's `[extruder]` section requires a heater pin and defaults to a 170 °C minimum extrusion temperature [C28].

**Arcs and segment density**
- Marlin `G2`/`G3` need `ARC_SUPPORT`; Klipper needs `[gcode_arcs]` [C25][C28].
- Measured streaming limits:
  - Marlin: about 45 segments/s over USB versus about 200/s from SD [C30].
  - RRF warns about too many commands per second, with a planner queue of about 40–60 moves [C29][C27].
- Cura's default maximum resolution is 0.5 mm with 0.025 mm deviation [P42].

**Comments that previewers read**
- Cura: `;FLAVOR:`, `;TIME:`, `;LAYER_COUNT:`, `;LAYER:n`, `;TYPE:` [C32].
- PrusaSlicer: `;LAYER_CHANGE`, `;Z:`, `;HEIGHT:`, `;TYPE:`, `;WIDTH:` [C31].
- RRF parses layer changes better with the RepRap flavour than with Marlin [C32].

**Profile schemas in existing slicers**
- **Cura** (`*.def.json`): bed size and shape, `machine_center_is_zero`, flavour, nozzle size, `{placeholders}` [P42].
- **PrusaSlicer** (INI): `bed_shape` polygon, `use_relative_e_distances`, `pause_print_gcode`, macros with `{if}` [C31].
- **OrcaSlicer** (JSON with inheritance): `before_layer_change_gcode`, `machine_pause_gcode` [C24].
- **FullControl** (Python dict): `e_units` (mm or mm³), `relative_e`, `dia_feed`, `travel_format`, `primer` [P17].

**Printers** (unverified fields are marked)

| Maker · model | Kinematics | Build volume | Controller / firmware | Reservoir | Notes |
|---|---|---|---|---|---|
| 3D Potter · PotterBot Micro 10 | Cartesian (inferred) | 280×265×305 mm | Duet (RRF) | 1 L ram tube | 3–6 mm nozzles [C13][C15] |
| 3D Potter · 10 Pro / Super 10 | Cartesian | 415×405×500 mm | Duet (RRF) | 2 L | Absolute E with a corner origin in CoilCAM's output [C13][P26] |
| 3D Potter · Scara V4 | SCARA | Ø1829 × 1143 mm | Duet + web control | 3.6–4 L | Potterware centres prints on the reachable ring [C13][P2] |
| WASP · Delta 2040 Clay | Delta, centre origin | Ø200 × 400 mm | Closed WASP build (UNVERIFIED); accepts Marlin-style G-code | 3 L tank + auger | [C7][C9][P17] |
| WASP · Delta 40100 Clay | Delta, centre origin | Ø400 × 1000 mm | WASP's own; Cura, Slic3r, Simplify3D | 5 L, 5–6 bar | Resume from a measured Z ("Free Zeta") [C5][C6] |
| VormVrij · LUTUM 4 / 4.5 / 5 | UNVERIFIED | about 430×450×500 mm | UNVERIFIED; "RepRap" flavour in the LTH profile | Air ≤ 4 bar | [C10][C11][C12] |
| Eazao · Zero | Cartesian (UNVERIFIED) | 150×150×240 mm | Modified Marlin | 500 ml, push rod + screw | Manual pre-extrusion before each print [C17][C18] |
| Eazao · "Bisque", "Mega" | — | — | — | — | Not found as clay printers. The "Mega Tong" is a concrete printer (UNVERIFIED naming) |

**Gaps.** The WASP firmware's identity and command support (`M0`/`M226`/`G2`), LUTUM's controller, and 3D Potter's official Cura profile all remain UNVERIFIED. The reliable fix is to collect real exported G-code from each vendor workflow. That work is deferred (D4).

### 3.6 Patterns worth adopting

Each pattern is followed by the tools that show it.

1. **One bead model drives everything** — Potterware, FullControl, 3dSynth [P2][P17][P13].
   - The preview, E values, material volume and weight all come from the same cross-section.
   - E is computed from the 3D segment length.
   - Preview estimates run the same code as export.
2. **Explicit E calibration in the printer profile** — Potterware's "E per mm" [P2], plus the reason FullControl gives for its own workaround [P17].
   - Store a volume-to-E factor rather than faking one through a filament diameter.
   - Tell users to calibrate by matching the preview bead to a measured print.
3. **Bead preview and lines preview** — Potterware, FullControl [P2][P17].
   - Add a scrubber, a top view for checking seams and bases, and colour by order or height.
4. **A clear seam menu** — Potterware, 3dSynth, Termite [P2][P11][P13][P28].
   - Spiral, or ramp over N points.
   - Seam fixed or following the twist.
   - Seeded random placement.
   - Anchored to a texture peak or valley.
5. **Floors that hand off cleanly** — Potterware, WASP App, CoilCAM [P2][P15][P27].
   - Floors end at the seam, alternate direction per layer, and rotate their infill angle.
   - Optional outline ring and floor inset.
   - Zero floor layers allowed, for sleeves.
6. **Textures defined in toolpath space** — Potterware, WASP App, 3dSynth, DigitalClay3D [P2][P15][P13][P36].
   - Amplitude in mm; start and end bands; fades; height gradients; a phase offset per layer.
   - Textured outside with a smooth inside.
   - Whole-number repeats so the wrap has no seam.
7. **A composable, ordered pipeline** — 3dSynth, CoilCAM, FullControl [P10][P27][P17].
   - Profile → modulator stack (additive or multiplicative, masked) → ordered points with per-point speed and flow → emitter.
8. **Printability guardrails before export** — Potterware, ClayShaper, 3dSynth [P2][P34][P10].
   - Bed fit with auto-fit; slope and layer-gap warnings; a graded validator; a raised Z where a collision is predicted.
9. **Clay logistics** — Potterware, FullControl, 3dSynth [P2][P17][P12].
   - Canister share, refill markers in the preview and the G-code, and a configurable pause command.
   - Prime in place, a skirt, and a wipe-and-lift at the end.
   - No cold-extrusion checks in the clay dialect.
10. **Reproducibility** — Potterware, 3dSynth [P2][P12].
    - Every parameter written into the G-code header.
    - JSON designs.
    - Printer settings separate from designs, so a preset never changes the machine.
11. **Local, account-free generation** — ClayShaper, BumpMesh, 3dSynth's free tier [P34][P37][P7].
    - These contrast with Potterware's and WASP App's account and server requirements [P2][P15].
12. **Parity tests whenever two generators exist** — fullcontrol-js runs Python↔JS diffs of the G-code [P20], after FullControl's "Colab vs website" mismatch [P23].

### 3.7 Mistakes to avoid

Each mistake is followed by the evidence for it.

1. **Slicing a textured mesh for clay.** The texture is mirrored inside, walls weaken, and walls thin on overhangs. Mesh tools also produce non-manifold seams [P6][P33][P37].
2. **Measuring extrusion along XY only on Z-modulated paths.** It under-extrudes the flanks of waves. 3dSynth fixed this in 2.1.1 [P13].
3. **Estimates that differ between preview and export** [P13].
4. **Parametrising textures by angle on shapes that aren't round, or with non-integer repeats.** The pattern spaces unevenly, and a seam appears where θ = 0 meets 2π [P13][P36].
5. **A wireframe-only preview** [P5].
6. **Start and end code that hasn't been tested on the printer.** Prints start in the air, or skip the prime [P22].
7. **Relying on retraction and travel moves for clay.** Design continuous paths instead [P46][C41].
8. **Unbounded amplitude, slope or tilt with no warning** [P2].
9. **Vendor lock-in or fragile profiles.** Examples: only two printers supported [P15], custom printers lost on reload [P34], hand-tuned filament diameters [P17].
10. **Carrying FDM vase-mode assumptions over to clay.** Examples: one part per layer, seam smoothing that blurs detail, flow ramps at the ends [P40][P41][P42].
11. **Copying code under an incompatible licence.**
    - Reusable: FullControl (GPL-3.0) and CoilCAM/Termite (MIT).
    - AGPL: BumpMesh, PrusaSlicer's `libvgcode` and OrcaSlicer. Copying their code would bring AGPL terms.
    - Ideas only: ClayShaper (PolyForm) and the closed tools [P17][P26][P28][P37][E20][E55][P34][D34].

---

## 4. Comparative spec: current vs future

The "Future" column is a proposal.

| Aspect | Current (v1) | Future (v2 proposal) | Why change |
|---|---|---|---|
| **Source of truth** | A Three.js mesh rebuilt from `controlPoints` plus `config`, with live scene objects mixed into the state (§2.2) | A versioned design JSON, evaluated to **one canonical toolpath buffer** (Float64, CPU worker). Preview and G-code both read that buffer | The printer executes a path, not a mesh. One buffer means the preview can't disagree with the file |
| **Geometry model** | r(y) profile (51 samples) × rounded-square plan, scaled by width/depth. Wall thickness is a horizontal offset. Solid floor with a drainage hole | P(z, θ) = plan-scaled base curve + radial displacement from an effect stack (§5.1). While designing, a single centreline wall; walls or thickness are added at the finish step (D2). The floor is a toolpath pattern with an optional hole | Bead width is physical, so it can't be offset freely. Textures need a function of (z, θ). Removes the stretched walls that width/depth scaling causes today |
| **Output formats** | OBJ only, no units, `flowerpot.obj` | **G-code** (primary, with a parameter header and layer comments). Also design `.json`, toolpath OBJ (polylines), bead STL, and, for FDM, thickness applied at G-code export or a solid mesh (STL/3MF) built afterwards for slicing elsewhere (D2) | The toolpath-first goal. Potterware's export set is the reference [P2] |
| **Rendering** | WebGLRenderer r175 with MeshStandardMaterial, shadows, a continuous loop, and a second WebGL context for the background | three.js WebGLRenderer r187, which must run on Android (D3); **vertex-pulled instanced bead** from data textures; lines mode; scrubber; render on demand; CSS background (§8) | 1 M segments as `TubeGeometry` would need about 480 MB (derived, §8.1), and gcode-preview moved off `TubeGeometry` for speed [E29]. Vertex pulling keeps memory at about 40 B/point [E20] |
| **Patterns** | None | Effect stack: waves, image relief/mask/both, seeded noise. Cylindrical UV with aspect lock, prefiltered sampling and a printable-resolution readout (§6) | The core requirement. Potterware sets the baseline [P2] |
| **Rules and curves** | None | Per-effect and global layer-range rules (layers/mm/%), fades and bands, with order-independent precedence. Curves over height for intensity, rotation, scale and offset, with a monotone cubic default (§6.4–6.6) | Deterministic and predictable. Fixes Potterware's ambiguous "ends at" wording [P2] |
| **Printer configuration** | None (units are 50 mm) | A separate printer-profile document: kinematics, bed shape and origin, flavour, E mode/units/calibration, templates with placeholders, reservoir, limits (§5.3). Covers clay and FDM (D1). Ships as unverified drafts (D4) | G-code is meaningless without a target machine. Profiles must survive reload and be exportable [P2][P34] |
| **Validation** | Clamps on drag only | A check catalogue (bed fit, overhang, slopes, Nyquist, curvature, self-intersection, segment rate, layer time, material) with heatmaps and severities (§7) | Clay limits are tight and material-dependent [C1]. Users need to see why, not just a slider stop |
| **Persistence** | None; no undo | Snapshot undo/redo (labelled, coalesced drags). IndexedDB gallery with `persist()`. JSON import/export. Share links in the URL fragment (compressed, no server) | Potterware has 100-step undo and a design gallery [P2]. Sharing has to work with no server cost, because the app stays free |
| **Performance budgets** | None; full rebuild on every input | Main thread ≤ 4 ms per input. Preview ≤ 50 ms p95 at 150 k points. 60 fps orbit at 150 k segments (§10) | Live feedback during drags; mobile reach |
| **Testing** | None | `node:test` (or Vitest) with golden `.gcode` files, fast-check property tests on invariants, cross-engine runs through Playwright, screenshot tests baselined in CI (§8.5) | G-code drives a machine. Regressions cost clay, time and possibly hardware |
| **Licensing** | GPL-3.0; README says non-commercial and free | **Unchanged:** GPL-3.0, free for the public. Dependencies limited to MIT/BSD/ISC/Apache-2.0/MPL-2.0. Assets CC0 or self-made. No AGPL code copied (§8.6) | The owner's constraint. Keeps the app and its derivatives free |

---

## 5. Proposed toolpath model

> Everything in this section is a **recommendation** to argue over in the brainstorm. Facts it relies on are cited.

### 5.1 The design function

Coordinates are in mm, Z up, with the origin at the centre of the part. The printer profile maps that origin to bed coordinates (centre-origin deltas versus corner-origin Cartesians [C9][P26]).

**Notation**

- *H*: object height.
- *h*: nominal layer height.
- *L* = round(*H*/*h*): number of wall layers. Layer *i* has its top at z_i = (i+1)·h.
- *t* = z/H ∈ [0, 1]: normalised height.
- θ ∈ [0, 2π): the angle parameter, with u = θ/2π.

```
base point     B(z, θ) = A · ( r₀(z) · S(t) · s_plan(θ − φ_form(t)) · ĉ(θ − φ_form(t)) )
direction      d̂(z, θ) = radial unit vector of B in XY        (default; option: in-layer normal)
wall point     P(z, θ) = B + D(z, θ) · d̂  +  [0, 0, z + V(z, θ)]
displacement   D(z, θ) = Σ_k blend_k( g_k(i) · I_k(t) · M_k · d_k(u_k, v_k) )     (§6)
radius guard   |P_xy| ≥ r_min   (clamped and reported, §7)
```

**The terms**

- **r₀(z)** is the profile, interpolated from its knots (z strictly increasing).
- **S(t)** is an optional form-scale curve.
- **s_plan(θ)** is the plan shape:
  - 1 for a circle.
  - An N-sided polygon with corner rounding.
  - A rounded rectangle or superellipse, which carries v1's "base fillet".
- **φ_form(t)** is the form twist.
- **A** = diag(sx, sy) is v1's width/depth.
- **V** is vertical (non-planar) displacement. It is 0 for planar designs.

**Why displacement is radial, in final XY, after A**

- **Amplitudes stay in real millimetres.** Potterware defines amplitude as true mm [P2].
- **Every layer stays star-shaped about the axis.** A path whose radius is single-valued in θ can't cross itself globally while the radius stays above r_min. Normal-direction mode loses this guarantee and relies on check V8 (§7).
- **The alternative is riskier.** Displacing along the in-layer normal gives more uniform relief on polygons, but it can fold at concave corners. Offer it as an option, guarded by the self-intersection check.

**Sample spacing.** θ is a curve parameter, not the true polar angle, once A or s_plan isn't circular. Sample points are therefore placed by **arc length** on the final curve. 3dSynth had to make the same fix for its textures [P13].

**Continuous spiral.** Evaluate along the helix z(θ) = z_i + h·θ/2π, with a continuous layer index i = z/h − 1. Rules and fades then vary smoothly along it.

### 5.2 Design data model (JSON sketch)

The design is plain JSON. The printer profile is a separate document (§5.3). Image bytes are stored separately, keyed by content hash.

```jsonc
{
  "schema": "vasecreator/design", "version": 2, "units": "mm",
  "meta": { "name": "Fluted jar", "created": "2026-11-23T10:00:00Z", "app": "2.0.0" },

  "form": {
    "height": 160,
    "profile": {
      "interp": "monotone",                 // "linear" | "monotone" | "catmullRomCentripetal"
      "tension": 0.5,                       // Catmull-Rom only
      "knots": [ { "z": 0, "r": 45 },
                 { "z": 60, "r": 62, "corner": 0 },      // corner = tangent fillet radius (mm), linear mode
                 { "z": 160, "r": 38 } ]
    },
    "plan": { "sides": 0, "rounding": 1.0, "scaleX": 1, "scaleY": 1 },   // sides 0 = circle
    "twist": { "keys": [ { "t": 0, "v": 0 }, { "t": 1, "v": 90, "interp": "linear" } ] },
    "scale": null
  },

  "surface": {
    "effects": [
      { "id": "w1", "type": "wave", "enabled": true, "direction": "radial",
        "wave": { "shape": "sine", "count": 24, "amplitude": 3, "phasePerLayerDeg": 0, "seed": null },
        "blend": "add",
        "intensity": { "keys": [ { "t": 0, "v": 0 }, { "t": 0.2, "v": 1 }, { "t": 1, "v": 1 } ] },
        "rotation": null, "scale": null, "offsetV": null,
        "maskedBy": [ "img1" ],
        "rules": [ { "op": "exclude", "from": { "anchor": "top", "unit": "layers", "value": 4 } },
                   { "op": "fade", "in": { "unit": "mm", "value": 10 }, "out": { "unit": "layers", "value": 3 },
                     "ease": "smoothstep" } ]
      },
      { "id": "img1", "type": "image", "enabled": true, "direction": "radial",
        "image": { "asset": "lib:cells@1", "channel": "luma", "encoding": "auto" },   // auto | height | srgb
        "mapping": { "tilesU": 6, "tilesV": "auto", "offsetU": 0, "offsetV": 0, "coverU": 1.0,
                     "vMode": "height", "flipU": false, "flipV": false, "wrapV": "repeat" },
        "sampling": { "filter": "bilinear", "prefilter": "auto", "smoothingMm": 0 },
        "mode": "mask",                      // "relief" | "mask" | "both"
        "relief": { "depth": 2, "midlevel": 0 },
        "threshold": { "value": 0.5, "softness": 0.1, "invert": false },
        "rules": []
      }
    ],
    "protect": [ { "anchor": "bottom", "unit": "layers", "value": 3 },
                 { "anchor": "top", "unit": "layers", "value": 2 } ]
  },

  "slicing": {
    "layerHeight": 1.5, "firstLayerHeightRatio": 0.75,
    "pointsPerLayer": "auto", "maxChordError": 0.05,
    "layerChange": "spiral",                // "spiral" | "seamRamp"
    "seam": { "angleDeg": 0, "follow": "fixed", "rampLengthMm": 15, "anchor": "none" }   // anchor: none|valley|peak
  },

  "finish": {                               // D2: chosen at the end; never read by the live design loop
    "target": "clay",                       // "clay" | "fdm"
    "clay": { "walls": 1, "wallGap": 0, "link": "none" },              // walls 1 | 2; link: none | zigzag (Q3)
    "fdm":  { "method": "vase", "thickness": 1.2, "perimeters": 3,     // vase | perimeters | twoWallZigzag | mesh (Q3)
              "meshFormat": "3mf" }
  },

  "base": { "layers": 2, "pattern": "spiral", "spacingRatio": 0.9, "outline": true,
            "inset": 0.95, "hole": { "diameter": 0 } },

  "process": { "prime": "printer", "skirt": { "offset": 15, "loops": 1 },
               "wipe": { "distance": 10 }, "liftMm": 10,
               "speed": { "wall": 25, "base": 20, "travel": 40 }, "minLayerTimeS": "printer" },

  "material": { "name": "Stoneware", "densityGPerMl": 1.9, "shrinkagePct": 0, "flowPct": 100 },

  "assets": { "img1": { "hash": "sha256-…", "w": 512, "h": 512, "embedded": false } },
  "printer": { "ref": "potterbot-10-pro", "hash": "sha256-…" }
}
```

**Decisions this sketch encodes**

- **Lengths are in mm.** Each rule stores its own unit (layers, mm or %). Curves use normalised height *t*, so they survive changes to the height.
- **The printer is referenced, not embedded.** A preset therefore never changes the machine, as in Potterware [P2]. The hash lets the G-code header name the exact profile used.
- **Images are referenced by hash** and never go into undo snapshots. Export can optionally embed them, which avoids Potterware's "upload it again" step [P2].
- **Effects have stable `id`s.** Masks name their targets, so reordering the stack never silently re-targets a mask.
- **Walls and thickness live in `finish` (D2).** Only the finish step reads it, so the live design loop never depends on it and stays fast. Changing the target from clay to FDM never touches the design itself.
- **`protect` sits outside every effect.** It holds the global plain zones (first and last N layers), applied last and multiplicatively (§6.4).
- **There is no v1 migration.** v1 never persisted designs (§2.2), so there is nothing to convert. An optional importer could read v1's default profile shape.

### 5.3 Printer profile (separate document, sketch)

Based on the printer research in §3.5. The fields follow Cura, PrusaSlicer, Orca and FullControl conventions [P42][C31][C24][P17]. **The values are illustrative and not verified for this machine.**

```jsonc
{
  "schema": "vasecreator/printer", "version": 1,
  "id": "wasp-2040-clay-3.0", "name": "Delta WASP 2040 Clay, 3 mm", "process": "clay",   // clay | paste | fdm
  "status": "community",                           // verified | community | draft
  "sources": [ "https://…" ],
  "machine": { "kinematics": "delta",               // cartesian | delta | scara | polar
               "bed": { "shape": "circle", "diameter": 200, "origin": "center" },   // or rect + front_left; scara ring
               "maxZ": 400, "parkPoint": { "x": 0, "y": -90, "z": 50 },
               "nozzleClearance": { "coneHalfAngleDeg": 30, "freeHeightMm": 15 } },
  "firmware": { "flavour": "marlin", "arcs": false, "maxSegmentsPerSec": 50, "minSegmentMm": 0.5,
                "preamble": "", "forbidHeaterCodes": true },
  "extruder": { "nozzleDiameter": 3.0, "eMode": "relative", "absoluteReset": "per_layer",
                "eUnits": "filament_mm", "feedDiameter": 3.1, "eScale": 1.0,     // or eUnits "mm3"
                "reservoirMl": 3000, "usableFraction": 0.85 },
  "bead": { "widthRatio": 1.0, "layerHeightRatio": 0.5, "crossSection": "stadium" },
  "motion": { "print": 25, "travel": 40, "z": 10, "minLayerTimeS": 20 },
  "travel": { "format": "G1_E0", "liftMm": 2, "depressurizeE": 0, "repressurizeE": 0, "coastMm": 0 },
  "prime": { "type": "stationary", "volumeMm3": 300, "liftAfterMm": 50 },
  "limits": { "maxRadialStepRatio": 0.25, "maxOverhangDeg": 27, "maxIntraLayerDzRatio": 0.5 },
  "gcode": { "decimals": { "xyz": 3, "e": 5, "f": 0 }, "lineEnding": "\n", "comments": ["cura", "prusa"],
             "templates": { "start": "G21\nG90\n{e_mode_cmd}\nG28\nG92 E0\n{prime}",
                            "end": "{depressurize}\nG28\nM84",
                            "beforeLayer": ";LAYER_CHANGE\n;Z:{layer_z}\n;HEIGHT:{layer_height}",
                            "refill": "{depressurize}\nG1 X{park_x} Y{park_y} F{travel_f}\nM0 Refill clay ({refill_index}/{refill_count})\n{prime}" } }
}
```

**Notes**

- **E is tracked internally as volume (mm³).** At emission it is converted to the output unit: filament-equivalent mm using `feedDiameter`, or mm³. `eScale` is the user's calibration multiplier. This replaces FullControl's diameter hack with an explicit setting [P17].
- **Pause commands are firmware-specific** [C25][C27][C28]. The template must be validated per flavour. That validation is deferred (D4).
- **Placeholders use `{name}`,** compatible with Cura and Prusa syntax. Unknown names are rejected at export.
- **Heater codes (`M104`/`M109`/`M140`/`M190`) are never emitted for clay** [C33].
- **Built-in profiles are labelled `verified` only** once G-code exported from them has run on a real machine.

### 5.4 Pipeline: design → G-code

| # | Stage | Input → output | Runs on | Notes |
|---|---|---|---|---|
| 1 | Normalise | JSON → typed design: defaults, schema migrations, references resolved | Worker | A pure function |
| 2 | Layer grid | H, h, layer mode → z_i, L, continuous index | Worker | Rules resolve to intervals here (§6.4) |
| 3 | Pre-compute | Curves → lookup tables. Images → float arrays plus a prefilter per sampling grid (§6.3) | Worker | Cached by hash and parameters |
| 4 | Evaluate the wall | P(z, θ) → XYZ points. N per layer is fixed or "auto" (arc length, chord error, Nyquist; capped by the segment rate) | Worker | **The canonical toolpath** (Float64) |
| 5 | Topology | Spiral helix, or planar layers + seam ramp that follows the *displaced* wall. Seam angle and anchor | Worker | |
| 5b | Finish: walls and thickness (D2) | Centreline → final walls. Clay: 1 or 2 walls (inner offset, optional link). FDM: vase width, N perimeters, two walls + zigzag, or hand off to stage 12 | Worker, on demand | Never runs during live editing |
| 6 | Base | Floor pattern inside the foot curve (spiral, rings, lines, crosshatch, sunburst). Hole, outline, inset. **Ends at the seam angle; alternates direction per layer** | Worker | As Potterware does [P2] |
| 7 | Process moves | Prime, skirt, travel (`G1 E0`), lift, wipe, coast, refill pauses at volume thresholds | Worker | Uses profile templates |
| 8 | Extrusion and feed | Volume per segment = 3D length × stadium area × flow. Feed rate, limited by minimum layer time and segment rate | Worker | Bead area (w − h)·h + π·h²/4 [P2][C21] |
| 9 | Validate | Toolpath → issues list plus per-point scalar fields | Worker | Feeds the heatmaps (§7) |
| 10 | Render | Float32 positions plus attributes → GPU data textures → bead instances | Main / GPU | Display only |
| 11 | Emit | Toolpath → G-code text: header with design JSON, profile hash, stats; layer and type comments | Worker, streamed into `Blob` parts | Fixed decimals; `-0.000` normalised [E31] |
| 12 | Mesh build (FDM option, D2) | Finished surface → watertight solid of the chosen thickness → STL/3MF | Worker, on demand | Inward offset must not self-intersect on deep textures (Q4) |

**What this table encodes**

- Stages 1–9, 11 and 12 form one pure, DOM-free module. Stage 12, the optional FDM mesh build, turns the finished surface into a watertight solid of the chosen thickness (STL/3MF). Its inward offset must not self-intersect on deep textures (Q4).
- **Live loop vs finish step (D2).** While the user edits, only stages 1–6, the design-level checks of stage 9, and stage 10 run. Stages 5b, 7, 8, the full stage 9, 11 and 12 run at the finish step or on export.
- The preview and the G-code come from **the same buffer**. That is the main departure from the brief's "evaluate on the GPU" idea (§8).

---

## 6. Pattern system spec

> This section is a **recommendation**. Prior art and facts are cited inline.

### 6.1 Prior art

- **Potterware 5.0** [P2]:
  - Image *relief*, *wave mask* or *both*, with soft (greys) or hard (threshold) edges.
  - *Effect follows white/black*, which inverts the image.
  - *Tiles around/up*, *width* (share of the circumference) and position.
  - Waves with start, end, fades, a phase per layer and waved/plain bands.
  - Amplitudes defined as real mm that masks never reduce.
- **OrcaSlicer's Texture Displacement** [P49]:
  - Up to 8 layers with Add/Subtract/Multiply/Divide/Override blends.
  - A *midlevel* (0 = raise only, 0.5 = emboss and engrave), plus *edge fade*.
  - Tile size in mm, with repeat, mirrored repeat or decal.
- **DigitalClay3D** warns that non-integer cell counts create a seam at θ = 0/2π [P36].
- **Blender's Displace modifier** uses the same pair of controls: a *midlevel* (the value meaning "no displacement") and a strength [D6].
- **Fuzzyficator** applies displacement maps as a G-code post-processor. Because it works on the G-code, it struggles to tell raised areas from indents, and patterns deform on curved surfaces [D17]. This argues for texturing before the path exists, not after.
- **Lithophane tools** set resolution in mm per pixel and report diminishing returns below about 0.2 mm/px [D11][D12].
- **BumpMesh** stacks textures only through export/import cycles [P37][P38].

### 6.2 Pattern sources

- **Built-in library.**
  - Tileable greyscale height and mask maps with versioned ids (`lib:cells@1`).
  - Licence: **CC0 or self-made only** (§8.6). ambientCG and Poly Haven are CC0. Poly Haven asks that its files not be re-licensed or claimed as your own [D31][D32].
- **Upload.**
  - PNG, JPEG or WebP, decoded in a worker. Use `createImageBitmap(…, {premultiplyAlpha: 'none', colorSpaceConversion: 'none'})` so canvas premultiplication doesn't corrupt values [D8][D9].
  - 16-bit PNG needs a WASM decoder, because canvas has no 16-bit path [D10].
  - Store the original bytes in IndexedDB by SHA-256, plus a derived Float32 array capped at 2048 px on the long side.
  - **Images never leave the device.** Potterware, by contrast, keeps uploads on its server for 3 days [P2].
- **Procedural sources:** waves (sine, triangle, saw, square, seeded jitter) and seeded coherent noise.
  - Sample the noise in 3D at (r_ref·cos θ, r_ref·sin θ, z). That makes it seamless around the wall and coherent from layer to layer.
  - Orca's notes say independent random offsets per point make layer lines *more* visible [D14].
  - PrusaSlicer's fuzzy skin is documented only as random point displacement, with no noise types [D15].
  - Use a seeded PRNG and never `Math.random` [E45].

### 6.3 Mapping and sampling

**Coordinates, always computed on the *undisplaced* base surface**

This rule means a pattern can't feed back into its own mapping.

```
u = frac( tilesU · ( (θ − θ_seam − φ_k(t)) / 2π ) − offsetU )          around, wraps
v = tilesV · ( vCoord(z) − offsetV )                                   up; wrapV = repeat | clamp | mirror
vCoord: "height"  z/H                          default; aligns with layers, rules and curves
        "along"   s(z)/S  (profile arc length)  less vertical stretch on flared walls and bowls
        "aspect"  ψ(z)/Ψ, ψ = ∫ ds / r           conformal: motifs keep their aspect everywhere [D1]
```

**Integer tiles around by default.** `tilesU` snaps to whole numbers unless the user unlocks it, which shows a seam warning [P36][P37]. Offer mirrored repeat for images that don't tile [P49].

**Aspect lock (`tilesV: "auto"`)**

```
tileW  = 2π · r_ref / tilesU,  r_ref = mean base radius over the image's v-span
tileH  = tileW · imgH / imgW
tilesV = H / tileH        (rounded to an integer if wrapV = repeat; otherwise kept fractional)
```

Averaging the radius follows LithophaneMaker's average-diameter rule [D12].

**Coverage (decal)**

- `coverU` < 1 makes the motif cover that share of the circumference, as in Potterware's *Width* [P2].
- Outside the motif, the sample is "no effect": relief 0 and mask off.

**Encoding**

- Greyscale files default to **height data**: raw value ÷ max, with no gamma. This follows the "Non-Color data" convention for displacement maps [D7].
- Colour photos default to luminance:
  1. Decode sRGB to linear.
  2. Weight with Rec. 709: Y = 0.2126 R + 0.7152 G + 0.0722 B [D4].
  3. Re-encode perceptually, so mid-grey reads as about 0.5.
- Alpha is a separate mask that multiplies the effect's gate.

**Sampling grid.** The samples form a regular grid of N points by L layers. Twist only shifts u. So:

- **Shrinking** (the common case, especially vertically): prefilter each pattern once onto its own sampling grid, using area averaging or a small Gaussian. This stops a 512-px image over 100 layers from aliasing into moiré bands. The basis is Nyquist: content above half the sampling rate aliases [D5]. A per-axis mip pyramid handles different footprints in u and v [D2].
- **Enlarging:** bilinear, with wrap in u. Bicubic (Keys a = −0.5) is optional and must be **clamped** to [0, 1], because cubic kernels overshoot, which would push relief past its set amplitude [D3]. Nearest-neighbour is for a deliberate stepped look.
- **Smoothing in mm.** A blur radius in mm is converted to texels per axis. Potterware 4.0, Orca and BumpMesh all offer a similar control [P3][P49][P37].
- **Layer stair-steps are inherent.** There is one sample per layer in v, so hard masks should be at least one layer soft.

**Printable resolution, shown to the user**

```
samples per tile around  n_u ≈ (2π · r / tilesU) / (w/2)
samples per tile up      n_v ≈ (H / tilesV) / h
```

- **Example.** ⌀100 mm, H 150 mm, 4 tiles around and 1 up, w = 4 mm, h = 1.5 mm gives about **39 × 100** samples per tile.
- **UI.** Show "*prints at ~39 × 100 px per tile*", alongside a thumbnail of the image downsampled to that size.
- **8-bit is enough.** Its steps are A/255, for example 0.02 mm at a 5 mm amplitude, far below clay layer heights. 16-bit input is nice to have, not required.

**Points per layer ("auto")** is the largest of three limits, then capped by the printer's segment rate (§7, V9):

1. Spacing ≤ w/2. Beyond about w/4 there is probably no visible gain (heuristic, UNVERIFIED).
2. At least 4 samples per period of the highest active wave or pattern frequency.
3. Chord error ≤ `maxChordError`.

### 6.4 Rules

Rules gate an effect by height. They resolve once per evaluation into **half-open layer intervals [a, b)** on the real layer grid.

| Rule | Example | Resolution |
|---|---|---|
| `include` / `exclude` with `from` and `to` | "first 3 layers plain", "top 4 layers plain" | anchor bottom → index = value; anchor top → index = L − value |
| unit `layers` | 4 | as given |
| unit `mm` | 6 mm | floor(value / h) |
| unit `%` | 10 % | round(value / 100 · L), **always of the total printed wall height**. Don't copy Potterware's "share of the remaining layers" [P2] |
| `bands` | 5 waved / 2 plain | periodic include pattern from a start index (Potterware has the same feature [P2]) |
| `fade` | in 10 mm, out 3 layers, smoothstep | ramps *inside* each active run |
| `protect` (global) | first 3 and last 2 layers plain, for every effect | applied last, multiplicatively |

**Evaluation order.** It is deterministic and independent of the order of rules in the list.

1. **Include set.** The union of `include` intervals, or all wall layers if there are none.
2. **Excludes.** Subtract the union of `exclude` intervals. **Exclusion always beats inclusion.** Set union and subtraction commute, so list order never matters.
3. **Bands.** Intersect with `bands`.
4. **Fades,** per remaining run [a, b):
   ```
   g(i) = ease( clamp((i − a + 1)/F_in, 0, 1) ) · ease( clamp((b − i)/F_out, 0, 1) )
   ```
   Fades sit inside the active run, as in Potterware [P2]. If F_in + F_out exceeds the run, both are scaled down in proportion, with a warning ("fades overlap; peak 70 %").
5. **Intensity.** Multiply by the intensity curve I_k(t).
6. **Global protection.** Multiply the *summed* displacement by the global `protect` gate G(t). Nothing can override it. This mirrors the slicers' first-layer safety rules: Cura skips fuzzy skin on the first layer when a brim is used, and Orca makes first-layer fuzzy skin opt-in [D16][D13].
7. **Spiral mode.** Use the continuous index i = z/h − 1, so gates vary smoothly along the helix.

**Units in practice**

- **Pin adhesion and rim rules to layers,** so they keep their count when *h* changes.
- **Use % or mm for aesthetic bands,** so they follow the form.
- **Show all three equivalents** next to each rule: "4 layers · 6 mm · 3 %".

**Conflicts**

- Within an effect, gating is multiplicative, so there are no conflicts.
- Across effects, only stack order matters, and the user can see it.
- If two rule sources ever set the *same scalar*, as a future per-range parameter override would, the later entry wins, as in CSS source order [D19]. The UI shows a conflict badge.
- For comparison, Cura uses an explicit numeric rank to settle overlapping modifier meshes [P42]. PrusaSlicer's height-range modifiers don't document which one wins on overlap [D18].

**Edge cases**

- Runs shorter than one layer are dropped.
- When *H* or *h* changes, `layers` rules keep their count and `mm`/`%` rules move. The rule chip shows which unit is in use.
- Rules apply to **wall layers only.** Floor layers carry no wall effects; whether bitmaps should also pattern the floor is open question Q5.
- The seam ramp follows the actual (possibly faded) wall.

### 6.5 Modes, combination and evaluation order

Per effect *k*, with sample *p* ∈ [0, 1] (luminance, or the waveform normalised to [0, 1]):

```
relief:  d_k = depth · (p' − midlevel)        midlevel 0 = outward only, 0.5 = both ways, 1 = inward only
         p' = p (soft) | step(thr, p) (hard) | smoothstep(thr − soft, thr + soft, p)
mask:    m_k = smoothstep(thr − soft, thr + soft, p), inverted if invert
         multiplies the displacement of every effect listing k in maskedBy
both:    produces d_k and m_k
```

**Combining effects**

- **Masks attach by id.** When a mask is created, the UI targets the effect directly below it, like Photoshop clipping, where white reveals and black conceals [D36]. The target is then stored as an id.
- **Blend modes:** `add` (default), `max` (union of outward reliefs), `min` and `replace`, each with an opacity.
  - Leave out multiply, divide and screen for now. They are hard to reason about in millimetres, even though Orca offers some of them [P49].
- **Amplitude is real mm.** A 3 mm wave is 3 mm wherever it is fully on [P2].
- **Direction.**
  - `radial` follows §5.1.
  - `vertical` changes Z, which makes the design non-planar. It is gated by the non-planar checks (§7, V11).

**Full evaluation, per point**

```
for each layer i (or helix parameter):
  z, t = …;  B, d̂ = base point and direction at (z, θ)          # §5.1
  D = 0
  for k in stack (top → bottom), enabled, g_k(i) > 0:
      (u, v) = map_k(θ, z) on the undisplaced base               # §6.3
      p      = prefiltered_source_k(u, v)                        # image or waveform or noise
      d_k    = mode_k(p) · g_k(i) · I_k(t) · Π_{m ∈ maskedBy_k} m(u_m, v_m)
      D      = blend_k(D, d_k)
  D = D · G_protect(i)
  P = B + D · d̂ + [0, 0, z + V];  enforce |P_xy| ≥ r_min (clamp and report)
```

### 6.6 Curves over normalised height

| Curve | Unit | Default | Notes |
|---|---|---|---|
| Intensity I(t) | 0–1, times amplitude | constant 1 | Must stay ≥ 0, so the default interpolation is monotone |
| Rotation φ(t) | degrees, unbounded | constant 0 | A linear ramp equals Potterware's "offset per layer" [P2]. Optional °/mm entry |
| Scale | × | constant 1 | Scales v and the motif inside its cell. The tile count around changes only in whole steps, to protect the seam. Vasemaker scales the motif inside the cell [P48] |
| Offset v / midlevel | 0–1 | constant 0 | Scrolls a motif, or shifts emboss toward engrave |
| Form twist, form scale | degrees, × | none | Form-level (§5.1) |

**Interpolation**

- **Default `monotone`: Fritsch–Carlson monotone cubic.** It never overshoots its keys, so intensity can't go negative and amplitude can't exceed what was keyed [D27].
- **Other modes:** `linear`, `step`/hold, and per-segment `bezier` easing given as a CSS cubic-bezier [D24].
- **Bézier handles clamp by default,** like Blender's Auto Clamped [D20]. Handles that may overshoot (Rive's "cubic value") are an expert opt-in [D25].
- **Why clamp:** unclamped smooth modes surprise users elsewhere too. After Effects' Auto Bézier can make a "boomerang" between two equal keys [D21], and Cinema 4D's cubic splines overshoot on tight bends [D22].
- **Avoid uniform Catmull-Rom.** It overshoots and can loop. If it is used, prefer centripetal (α = 0.5) [D26].

**Editor UX**

- **Orientation and overlays.**
  - Draw the curve **vertically**, with height on the y-axis aligned to the profile editor and the 3D preview.
  - Behind it, show layer ticks, rule bands (plain zones hatched), the current scrubber layer and a faint silhouette.
- **Editing keys.**
  - Click to add, double-click or Delete to remove, Shift-drag to lock an axis.
  - Keys can't pass their neighbours, and the end keys are locked in *t*, as with Houdini ramps [D23].
  - Selected keys get numeric fields for *t*, also shown in mm and as a layer number, and for the value.
- **Snapping** to 5 % steps, layer boundaries and rule edges.
- **Presets:** constant, ramp up, ramp down, ease in, ease out, peak in middle, valley, step at 50 %. Also *reverse* and *complement* [D23]. Potterware offers "grows to top" and "peaks in middle" [P2].
- **History and reuse.** Each drag is one undo step. Copy and paste curves as JSON.
- **Implementation:**
  - A small in-house SVG/canvas editor with its own Fritsch–Carlson evaluator (d3's monotone curve draws paths but has no `evaluate(t)` [D26]).
  - `bezier-easing` (MIT) for the easing segments [D28].
  - CanvasSpliner or Curvity (MIT) as references [D29].
  - Theatre.js studio is AGPL, so avoid it [D30].

### 6.7 Edge cases checklist

- **Neck radius.** Inward displacement at a narrow neck is clamped to r_min and reported.
- **Normal-direction mode.** On a tight concave plan corner it can self-intersect. Detect this and report it (§7, V8).
- **Non-integer `tilesU`, or an image that doesn't tile.** Warn about the visible seam. Optionally detect the image's left/right mismatch.
- **"Auto" `tilesV` changes with *H*.** Locking it stores the computed value.
- **Hard thresholds** make one-layer staircase edges. The UI suggests softness of at least one layer.
- **Spiral mode** has no discrete layers, so band edges are soft.
- **Seam in seam-ramp mode.** Optionally anchor it to the displacement valley, or to a peak as 3dSynth does [P13].
- **Masks.** A mask with no target is a no-op, with an info note. Circular `maskedBy` references are rejected.
- **Missing asset.** Show a placeholder in the preview and block export with a clear message.

---

## 7. Printability and validation checks

> The check set and thresholds are **recommendations**. The evidence for each starting value is cited. Every threshold is a per-material or per-printer setting, to be calibrated with test prints.

**Notation:** w = bead width, h = layer height, r = radius, Δs = arc step, N = points per layer.

| # | Check | Formula / method | Default (warn → error) | Evidence |
|---|---|---|---|---|
| V1 | Bed fit | Every point, including skirt and prime, inside the bed polygon: rectangle, circle, or SCARA ring | error when outside; offer "fit to bed" | Potterware bed chip and Fit to bed [P2] |
| V2 | Overhang per layer | Δ_k(θ) = r_k(θ) − r_{k−1}(θ) on final points (twist included); angle = atan(Δ/h) | warn \|Δ\| > 0.25 w (~27° at h = 0.5 w); error > 0.5 w | Undried clay: 22° held, 27° failed; dried: 50° held [C1]. FDM 45° ≈ 0.5 w [C42] |
| V3 | In-layer slope | α = atan(\|Δr\| / Δs) between neighbouring points | warn > 60° (UNVERIFIED heuristic) | Potterware warns that steep slopes in a layer won't hold in soft clay [P2] |
| V4 | Turning angle | Angle between successive segments | warn > 90° (heuristic) | The clay bead rounds or drags at sharp turns (UNVERIFIED, calibrate) |
| V5 | Sampling (Nyquist) | Smallest pattern wavelength along the path λ_u vs Δs; vertically λ_v vs h | error λ_u < 2Δs; warn < 4Δs; warn λ_v < 2h | [D5]; Potterware's "two points make one wave" [P2] |
| V6 | Bead-scale curvature | Discrete curvature κ; require 1/\|κ\| ≥ w/2. For a sine: **A ≤ λ² / (2π² w)** | warn when violated (e.g., λ 12 mm, w 4 mm → A ≲ 1.8 mm) | Derived geometrically. No published clay rule was found (UNVERIFIED) |
| V7 | Minimum radius | \|P_xy\| ≥ r_min = max(2w, user value) | clamp + warn | Derived |
| V8 | Self-intersection | Segment–segment test within each layer using a spatial hash. Mostly relevant to normal-mode displacement | error | Termite detects path intersections [P29] |
| V9 | Segment rate and length | feed / segment length ≤ `maxSegmentsPerSec`; segment ≥ `minSegmentMm` | warn, then auto-simplify by chord tolerance | Marlin about 45/s over USB vs about 200/s from SD [C30]; RRF warnings [C29]; Cura 0.5 mm / 0.025 mm [P42] |
| V10 | Layer time | Layer length / speed ≥ `minLayerTimeS` | warn; option to slow down, then park with a `G4` dwell | Clay needs time or air between layers [C19]. The minimum value itself is UNVERIFIED |
| V11 | Non-planar layer gap | Local layer thickness ∈ [0.5 h, 1.5 h]; nozzle cone clearance | warn outside the range; error on a predicted collision | Potterware's 0.5–1.5 × h rule [P2]; collision model [C34] |
| V12 | Material and refills | Volume = Σ length × stadium area; compare with reservoir × usable fraction | info; place refill markers and pause templates | Potterware refill rings and comments [P2]; RISD dead volume [C16] |
| V13 | Floor | Line spacing ≤ w (overlap); hole ⌀ ≥ 2w; floor layers ≈ wall thickness | warn | Even drying [C36][C40]; Potterware floor options [P2] |
| V14 | Slenderness | H / base ⌀, and absolute H against a clay-specific collapse height | info | A 4 mm-nozzle cylinder collapsed above ~18–20 cm [C35] (one study) |
| V15 | Amplitude sanity | \|D\| > w | info (weaving deliberately exceeds it) | Slicers advise fuzzy depth near the wall width [P42][D13]; WeaveSlicer exceeds it on purpose [P33] |
| V16 | G-code sanity (always on) | No NaN or Inf; feeds > 0; Z non-decreasing (planar); absolute E strictly increasing; no `-0.000`; no heater codes on clay | error (blocks export) | [E31][C33] |

**Live checks vs finish checks (D2)**

- V1–V8 and V11 run live on the centreline, using the nominal bead width.
- V9, V10, V12, V13 and V16 depend on the final walls, speeds and process moves, so they run at the finish step. V1 runs again there with the final footprint.
- Because physical verification is deferred (D4), every threshold ships as a sensible default the user can change, not a calibrated value.

**Presenting the results**

- **An issues panel**, grouped by severity. Each issue gives a layer range and an angle range, and clicking it jumps the scrubber there.
- **A heatmap mode** in the bead preview showing the overhang, slope or curvature field.
- **An optional "auto-limit"** that lowers intensity locally with a smooth (C¹) limiter, shown as a separate, visible effect. Clipping is never silent.
- **Export rules.** Errors block export, except overhang (V2) and non-planar (V11) errors, which the user may override after confirming. Warnings never block.

---

## 8. Architecture options

§8.1–8.6 are facts, with citations. §8.7–8.8 give the options and a **provisional** recommendation.

### 8.1 Platform facts (November 2026)

**WebGPU by browser** [E1]

- **Chrome and Edge**
  - Windows x86/x64, macOS and ChromeOS since version 113.
  - Android 12+ since 121, on ARM, Qualcomm or Intel GPUs. Imagination GPUs need Android 16+, and some other GPUs are still TBD.
  - Linux is a staged rollout: Intel Gen12+ from Chrome 144 [E3], then NVIDIA on Wayland. Other Linux setups still need flags.
  - Windows on ARM64 is still behind a flag.
  - Chrome 146 added an opt-in "compatibility" mode for older GPUs [E4].
- **Firefox**
  - On by default on Windows since 141 [E5], and on Apple-silicon Macs (all macOS versions since 147). ESR 153 includes both [E6].
  - Off by default on Intel Macs, Linux and Android [E1][E7].
  - The Firefox 160 release notes (10 Nov 2026) mention no change [E8].
- **Safari**
  - On by default in Safari 26 on macOS, iOS, iPadOS and visionOS 26 [E9]. caniuse marks it "partial" [E2].
  - Devices that can't run OS 26 have no WebGPU.

**Coverage.** caniuse lists WebGPU at 86.8 % full + 1.8 % partial, against WebGL 2 at 97.3 % [E2][E11]. MDN still labels WebGPU "Limited availability" [E10]. Estimate (UNVERIFIED): 10–15 % of sessions would need a WebGL 2 fallback. Maker audiences probably lean more towards Linux and Firefox than average.

**three.js**

- **Releases.** Latest is r187 (0.187.0, 30 Oct 2026), MIT. The repo pins r175 [E12][E14]. WebGL 1 has been unsupported since r163 [E13].
- **WebGPURenderer status.**
  - The manual still calls it **experimental**, and says WebGLRenderer can perform better [E15].
  - WebGLRenderer is still maintained and is "recommended for pure WebGL 2 applications", but no larger new features are planned [E15].
  - WebGPURenderer falls back to a WebGL 2 backend automatically [E16].
  - It does **not** support `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile` or `EffectComposer` [E15].
- **Compute on the WebGL 2 backend.**
  - TSL compute is emulated with transform feedback [E16].
  - Storage buffers are readable through a pixel-buffer path [E17].
  - Atomics and indirect draws are WebGPU-only [E18].
  - `NodeMaterial.depthNode` allows depth-writing impostors [E17].
- **WebGPU limits.** The core limits allow 8 storage buffers in the vertex stage, but **compatibility mode allows 0** [E19]. Vertex pulling would then have to go through textures.

**Rendering techniques for about 1 M segments**

| Technique | Memory at 1 M segments | Strengths | Weaknesses |
|---|---|---|---|
| **Vertex pulling** [E20][E21] | ~40 MB | Early-Z stays intact | A low-poly tube is not perfectly round up close |
| **Ray–capsule impostors** [E22][E23][E24] | ~16–32 MB | Perfectly round at any zoom | Writing fragment depth **disables early-Z** |
| **`TubeGeometry`** [E29] | ~480 MB | Simple to build | Too much memory for 1 M segments |
| **`Line2` fat lines** [E30] | ~48 MB (~48 B per segment) | Cheap | Flat ribbons, with no true occlusion between beads |

- **Vertex pulling.** PrusaSlicer 2.8's `libvgcode` instances an 8-vertex template once per segment. The shader reads positions and width/height/angle from float textures. It is AGPL-3.0, so reuse the idea only.
- **Ray–capsule impostors.** This is the approach of molecular viewers such as NGL and Mol\*.
  - Early-Z can be kept with `EXT_conservative_depth`, which is present in 79.7 % of WebGL 2 sessions but only 2.7 % on Firefox [E27].
  - WGSL's `fragment_depth` extension is temporarily disabled [E26][E28].
  - Inigo Quilez's algorithm code is MIT, according to his site. Whether the capsule routine is still published there is UNVERIFIED [E25].
- **`TubeGeometry`.** The ~480 MB figure is derived: 9 M vertices × 32 B, plus 48 M indices. gcode-preview (MIT) moved away from `TubeGeometry` because it was slow [E29].
- **`Line2` fat lines.** Fine for distant views and travel moves.
- **No benchmarks.** No head-to-head browser benchmark at 1 M segments was found (UNVERIFIED).

**Threading and hosting**

- Module workers have been Baseline since 2023, and OffscreenCanvas is at 97 % [E39].
- Comlink (Apache-2.0) is optional. Transferring an `ArrayBuffer` is enough [E40].
- `SharedArrayBuffer` needs COOP/COEP headers [E41].
  - **GitHub Pages cannot set them** ("No ETA") [E42].
  - The service-worker workaround reloads the page on first visit, and has reported breakage [E43].
  - Netlify and Cloudflare Pages can set the headers [E44].
  - Under COEP, a CDN-hosted three.js must send CORS or CORP headers [E41].
- The current host of vasecreator.com is UNVERIFIED: the repo has no `CNAME` file.

### 8.2 Bead renderer (recommended for every option)

**The default: a vertex-pulled instanced prism**

- Shape: 6–8 sides, with rounded end caps approximated by spikes, like PrusaSlicer's template [E20].
- Data: one instance per segment. The shader reads p[i], p[i+1], width and height from an RGBA32F data texture (WebGL 2) or a storage buffer (WebGPU).
- Per-point attributes: layer index, print order and a validation scalar.
- Colour modes: clay colour with a gradient (as Potterware does [P2]), heatmap, or by order.
- The scrubber is a single uniform, `maxVisibleIndex`. Refill markers are drawn as rings.

**Other modes**

- **Close-up "quality" mode:** capsule impostors, using conservative depth where the browser supports it [E27].
- **Lines mode:** fat lines [E30] for distant views, travel moves and very large prints. Potterware has the same bead/lines split [P2].

**Interface (renderer-agnostic)**

```
setToolpath(positions: Float32Array, attrs: Float32Array, segments: Uint32Array?)
setStyle({ mode: "bead" | "lines", color: …, field: "none" | "overhang" | … })
setVisibleRange(n)
```

Rendering is on demand: on input, damping or scrubbing.

### 8.3 Determinism

**Facts**

- **JS arithmetic.**
  - `+ − × ÷` are IEEE binary64 with no fused operations, and `Math.sqrt` is correctly rounded.
  - `Math.sin`, `cos`, `exp`, `log` and `pow`/`**` are implementation-approximated [E31].
- **Engines differ on trigonometry.**
  - V8 has moved to glibc-derived trig.
  - SpiderMonkey calls the OS maths library, except under fingerprinting resistance.
  - JavaScriptCore uses the platform library.
  - Defaults per platform are partly UNVERIFIED [E32].
- **Output formatting.** `toFixed` is exactly specified on the binary value. It can print `-0.000`, which needs normalising [E31].
- **GPU precision.**
  - WGSL `sin`/`cos` have absolute error up to 2⁻¹¹ on [−π, π], implementations may reassociate operations, and there is no f64 [E33].
  - GLSL ES conformance accepts similar error [E34].
  - At a 100 mm radius that is about 0.05 mm, 50× a 0.001 mm output step.
- **WebAssembly.** Float operations are deterministic, apart from NaN bit patterns and relaxed SIMD [E38].

**Recommendation**

- **Generate G-code only from the CPU toolpath.**
- **Use deterministic trig in the core.** Write it from `+ − × ÷` alone, for example an fdlibm-style polynomial.
- **Avoid `**`/`Math.pow`** in geometry code.
- **Seed every random source** (PRNG plus noise [E45]) and ban `Math.random`.
- **Format with fixed decimals** (xyz 3, E 5) and normalise `-0`.
- **Expected result:** the same design gives byte-identical G-code in every engine. Tests enforce this (§8.5).

### 8.4 State, undo and persistence

**Design state** is small: a few kilobytes of JSON, excluding images.

- Store a `{schema, version}` header and migrate older files with an ordered chain of pure `migrate_vN→vN+1` functions.
- Validation can use a schema library such as Zod (MIT) [E14], or a hand-written validator to avoid the dependency.

**Undo and redo**

- **Snapshots:** `structuredClone` of the design on each committed change.
  - This is simple and correct at this size. A command pattern would need an inverse for every operation, and Immer patches add a dependency and aren't guaranteed minimal [E46].
- **One step per gesture.** A whole drag coalesces into one step.
- **Labelled steps**, such as "Undo: Amplitude". About 200 steps.
- **View state is excluded:** camera, display options and the scrubber. Potterware works the same way [P2].

**Persistence**

- **Gallery.** Designs live in IndexedDB, with `navigator.storage.persist()` [E49].
  - Safari can evict script-written storage after 7 days without user interaction, so always offer JSON export.
- **Files.** Export and import a single design or the whole gallery as JSON, optionally embedding the images.
- **Share links.**
  - Compress the design with `CompressionStream('deflate-raw')` (Baseline since 2023) [E48], or lz-string (MIT) [E47].
  - Encode it as base64url in the URL `#fragment`. It never reaches a server, so it costs nothing to host. This fits the "free" constraint.
  - Library images are shared by id. Uploaded images can't travel in a link, and the share dialog says so.

### 8.5 Testing

**The core** runs under `node:test` (snapshots are stable since Node 23.4, and type stripping works with no bundler) [E50]. Vitest (MIT) is an alternative; its `toMatchFileSnapshot` writes `.gcode` files [E51].

**Golden files**

- 5–10 reference designs:
  - A plain cylinder.
  - A spiral vase.
  - Seam ramp with twist.
  - A wave + bands + fades.
  - An image relief.
  - A mask.
  - A floor with a hole.
  - A refill split.
  - A delta profile and a corner-origin profile.
- Each design is checked in with its expected `.gcode`.
- A change to golden output needs an explicit update and a review of the diff.

**Property tests** (fast-check, MIT) [E52] assert these invariants:

- No NaN or Inf anywhere.
- Z never decreases in planar mode; it increases strictly in spiral mode.
- Absolute E increases strictly; relative E is ≥ 0 except for deliberate depressurise moves.
- All XY within the bed.
- Segment length ≥ min and ≤ max.
- Layer count = round(H/h).
- Feeds > 0.
- No `-0.000`.
- No heater codes in clay profiles.
- The same input gives byte-identical output.
- Volume = Σ segment volume.
- Rules are order-independent: shuffling the rule list doesn't change the output.

**Cross-engine.** Playwright (Apache-2.0) runs the same golden suite in Chromium, Firefox and WebKit, to catch engine drift in trig and formatting. Screenshot tests use a tolerance and are baselined in CI only, because rendering varies by OS and GPU [E53]. Headless WebGPU needs flags or SwiftShader [E54].

**Hardware.** A short manual test plan prints calibration coupons per verified profile:

- An overhang ladder.
- A wave-amplitude ladder.
- A refill pause.

### 8.6 Licensing (dependencies and assets only; the app stays free and GPL-3.0)

**Compatibility rules** [D34][D35]

- MIT, BSD, ISC and zlib are compatible with GPL-3.0.
- Apache-2.0 is compatible with GPLv3, though not with GPLv2.
- MPL-2.0 is compatible through its secondary-licence clause.
- AGPL-3.0 can be combined only as a separate module that keeps its own terms. Avoid copying AGPL code.

**Libraries**

| Library | Version checked | Licence | GPL-3.0 OK? | Role |
|---|---|---|---|---|
| three.js | 0.187.0 | MIT | Yes | Renderer [E14] |
| bezier-easing | — | MIT | Yes | Curve easing [D28] |
| d3-shape (reference only) | — | ISC | Yes | Monotone curve reference [D26] |
| simplex-noise / alea | 4.0.3 / 1.0.1 | MIT | Yes | Seeded noise [E45][E14] |
| lz-string (optional) | 1.5.0 | MIT | Yes | Share links [E47] |
| idb / idb-keyval (optional) | 8.0.4 / 6.3.0 | ISC / Apache-2.0 | Yes | IndexedDB helpers [E14] |
| Comlink (optional) | 4.4.2 | Apache-2.0 | Yes | Worker RPC [E40] |
| Zod (optional) | 4.6.7 | MIT | Yes | Schema validation [E14] |
| @jsquash/png (optional) | 3.1.1 | UNVERIFIED | Check before use | 16-bit PNG decode [D10] |
| fast-check | 4.11.0 | MIT | Yes (dev) | Property tests [E52] |
| Vitest (optional) | 5.1.1 | MIT | Yes (dev) | Tests [E51] |
| Playwright | 1.65.1 | Apache-2.0 | Yes (dev) | Cross-engine and screenshot tests [E53] |
| TypeGPU (not recommended) | 0.12.11 | MIT | Yes | Option C' [E35] |
| wgpu / wasm-bindgen (option C) | 30.0.2 / 0.2.130 | MIT OR Apache-2.0 | Yes | Option C [E36] |
| gcode-preview (reference) | 2.18.0 | MIT | Yes | Viewer reference [E29] |
| Mol* (reference) | — | MIT | Yes | Impostor reference [E24] |
| FullControl | 0.1.2 | GPL-3.0 | Yes | Code reuse allowed [P17][P18] |
| fullcontrol-js | 0.2.1 | GPL-3.0 | Yes | Code reuse allowed [P20] |
| CoilCAM-js | — | MIT | Yes | Code reuse allowed [P26] |
| PrusaSlicer `libvgcode`, OrcaSlicer, BumpMesh, Theatre.js studio | — | AGPL-3.0 | **Ideas only** | [E20][E55][P37][D30] |
| ClayShaper | — | PolyForm Internal Use | **Ideas only** | [P34] |

**Assets (pattern library)**

- **CC0 or self-made** (ambientCG, Poly Haven) [D31][D32].
- **CC BY 4.0** is acceptable, with attribution [D34].
- **CC BY-SA 4.0** is only *one-way* compatible with GPLv3 [D33]. Avoid it unless the brainstorm accepts it.
- **NC and ND licences are not free.** Exclude them [D34].
- **Presets and textures inspired by Potterware** must be re-created, not copied.

### 8.7 Options

| | **A. Vanilla JS + three.js WebGLRenderer (r187)** | **B. three.js WebGPURenderer + TSL** | **C. Rust core (+ wgpu) → WASM** |
|---|---|---|---|
| **Core** (toolpath + G-code) | Plain JS ES modules, JSDoc types checked by `tsc --noEmit`, in a module worker | Same as A | Rust compiled to WASM in a worker. Float ops deterministic [E38] |
| **Renderer** | GLSL3 `ShaderMaterial`, vertex pulling from `DataTexture` | TSL node materials, one source compiled to WGSL or GLSL. WebGL 2 fallback is automatic | wgpu (WebGPU, or WebGL 2 "best effort"), or keep three.js for rendering |
| **Build step** | None (import map) | None (import map to `three.webgpu.js`) [E15] | Required (cargo + wasm-bindgen) |
| **Browser reach** | ~97 % (WebGL 2) [E11] | ~97 % via fallback; WebGPU path on ~88 % | ~88 % WebGPU; WebGL 2 best effort [E36] |
| **Maturity risk** | Low; WebGLRenderer is feature-frozen [E15] | Medium; "experimental"; TSL API still moving [E15] | Medium; two languages and a JS bridge |
| **Shader port cost** | None today | Every custom shader rewritten in TSL [E15] | WGSL |
| **Compute** | n/a, and not needed | Optional, WebGPU path only (transform feedback on fallback) [E16] | WebGPU only |
| **Contributor barrier** | Lowest. Matches today's code | Medium | High |
| **Desktop story** | Wrap the web app (PWA or a WebView shell; not researched) | Same as A | Native Rust desktop possible; also wrappable |
| **Determinism** | Needs a custom trig routine in JS (§8.3) | Same as A | Built in (WASM) |
| **Bundle** | three.js + a small core | three.js WebGPU build + core | WASM ~3 MB (2023 report, UNVERIFIED for v30) [E37] |

**Also considered, not recommended now (C′): raw WebGPU or TypeGPU.**

- TypeGPU 0.12.11 is MIT and pre-1.0. 0.12 shipped breaking changes. Its JS-shader plugin targets Vite or Babel [E35].
- Its WebGL fallback (`@typegpu/gl`) is experimental: a render subset, no compute [E35].
- Raw WebGPU has no fallback at all.

### 8.8 Recommendation (provisional; three.js confirmed by D3)

**Go with option A, built so that B is a mechanical port later.**

1. **The core is DOM-free and Three.js-free.**
   - `core/` holds design normalisation, evaluation, topology, base, process, validation and emission.
   - It uses Float64 arithmetic, deterministic trig and fixed-decimal output.
   - It runs in a module worker. Results arrive as transferred `Float32Array`s, so no `SharedArrayBuffer` is needed and GitHub Pages remains viable.
2. **The renderer sits behind the small interface in §8.2.**
   - Upgrade to r187 now, with a vertex-pulled bead in GLSL3.
   - Re-evaluate WebGPURenderer once it loses its "experimental" label, or if live GPU evaluation becomes necessary above about 1 M points.
3. **No GPU compute in v2.0.** CPU evaluation is fast enough (§10.2). A GPU path can come later as an optional preview accelerator.
4. **Web only (D5).** There is no desktop build. Option C would only come back if much heavier computation became necessary, for example mesh import or slicing.
5. **Android is a first-class target (D3).** Test on a mid-range Android phone in Chrome from the first prototype. On Android, WebGPU needs Android 12+ and a supported GPU, and it is off by default in Firefox [E1], so the WebGL 2 path is the one that has to be fast.

**Why provisional**

- No bead-renderer prototype has yet been measured on low-end mobile GPUs.
- Whether `DataTexture` vertex pulling handles 1–2 M points within WebGL 2 texture-size limits needs a prototype. The fallback is to split the toolpath into chunks.

---

## 9. Migration path from the current codebase

> These are recommendations.

### 9.1 Keep

- **Static hosting, the GPL-3.0 licence and the no-build ES-module delivery.** Keep the import map and actually use it (§2.1).
- **The page shell and branding.** Keep the header, intro dialog, CSS tokens in `:root` (`style.css:1-25`), the responsive sidebar and the mobile breakpoints (`style.css:537+`).
- **OrbitControls camera behaviour** and the "drag profile points in the view" interaction. It is the product's signature, and Potterware works the same way [P2].
- **The profile concept.** Knots plus a choice of spline or polyline, tension, and corner rounding on polylines.
- **Width and depth as a plan-scale concept, and plan corner rounding.** These carry over as plan-shape parameters.
- **Dimension readouts in mm.** These become the stats chips.

### 9.2 Replace

| Current | Replacement | Why |
|---|---|---|
| `GeometryModule` mesh builder (`script.js:1260-1666`) | A pure toolpath core module (no Three.js, no DOM) running in a Worker | Single source of truth; testable; off the main thread |
| `app.config` and `app.state` with live Three.js objects in them (`script.js:254-334`) | A serialisable design JSON (§5.2), a store with snapshot undo, and view state kept separate | Undo, save, share and golden tests all need it |
| Internal units (`unitToMm = 50`) | mm everywhere | G-code and printers work in mm |
| `findRadiusAtHeight` linear search over 51 samples | Exact profile evaluation per layer, with monotone-z knots enforced by the editor | Accuracy; no mismatch between the line and the mesh |
| Polyline fillet (`script.js:1323-1375`) | A true tangent-arc fillet in mm | Fixes the notch (§2.3) |
| `UnifiedEventHandler` (touch *or* mouse) | Pointer Events with `setPointerCapture` | Works on hybrid devices |
| Debounced full rebuild on each input | Live worker evaluation with coalesced requests (latest wins) and progressive detail | Live feedback while dragging |
| OBJ as the only export | G-code first. Then design JSON, toolpath OBJ (lines), bead STL, and for FDM, a solid mesh with thickness built at the finish step (D2) | The toolpath-first goal |
| `checkWebGLSupport()` (WebGL 1) | A WebGL 2 check, with WebGPU detection if option B (§8) is chosen | Three.js r163+ requires WebGL 2 [E13] |
| Continuous render loop plus a second WebGL context for the background | Render on demand (on input or damping). CSS gradient background | Battery, GPU memory, and mobile browsers' limits on the number of WebGL contexts |

### 9.3 Add

1. Printer profiles, as a separate document: built-in profiles plus import and export, with start, end and pause templates.
2. Layer, seam and base settings, and the prime, skirt, wipe and lift process moves.
3. The effect stack: waves first, then image relief and mask, then noise.
4. Rules and curves, with the curve editor.
5. The image library, upload, and IndexedDB asset storage.
6. A validation panel and preview heatmaps.
7. Stats chips: layers, size, path length, time, material volume and canister share, bed fit. All of them are in Potterware [P2].
8. A playback scrubber and the bead/lines toggle.
9. Presets, a designs gallery, JSON import/export and URL sharing.
10. Tests (golden G-code, property tests, cross-engine runs) and CI. The core gets JSDoc types checked by `tsc --noEmit` (no build step needed to run).

### 9.4 Suggested phasing

The phases are a draft. Each phase ships to vasecreator.com. After the review, the weight sits on the design interface (D4). Profiles ship as unverified drafts, and calibration work is out of scope for now.

- **Phase 0 – Core.** A toolpath core and printer-profile schema, with tests. The only visible change is an experimental G-code download. It produces G-code from *today's* design: profile, plan rounding, width and depth. This proves the pipeline end to end in software, through golden files. Printing the result is optional (D4).
- **Phase 1 – Toolpath preview.** The bead renderer, layer, seam and base settings, process moves, stats, validation v1 (bed fit, overhang, material), and finish step v1: clay 1 or 2 walls, FDM vase mode, G-code download (D2). The current OBJ export stays alongside.
- **Phase 2 – Waves.** Procedural waves with rules and fades, the intensity and rotation curves, and the curve editor v1.
- **Phase 3 – Bitmaps.** Image relief and mask, the library and upload, aspect lock, and the resolution readout.
- **Phase 4 – Persistence, sharing and finish methods.** Gallery, URL share, presets. The remaining FDM finish methods: perimeters, two walls + zigzag, and mesh build (STL/3MF).
- **Phase 5 – Advanced.** Non-planar vertical effects, multi-copy layout, mesh import (open question).

---

## 10. Proposed performance budgets

> These are recommendations. The measured numbers are labelled as measured.

### 10.1 Workload sizes

Typical sizes (derived values):

| Case | Height / layer | Layers | Points/layer | Points | Note |
|---|---|---|---|---|---|
| Clay, small | 100 mm / 1.5 mm | 67 | 200 | 13 k | Potterware defaults: 100 mm, 1.5 mm, 200 pts [P2] |
| Clay, textured | 300 mm / 2 mm | 150 | 1,000 | 150 k | Potterware max is 1,000 pts/layer [P2] |
| FDM vase mode | 200 mm / 0.2 mm | 1,000 | 500–1,000 | 0.5–1 M | Upper bound for design |

### 10.2 Measured baseline (throwaway benchmark, not product code)

**Setup.**

- Machine: Node 24.18 (V8) on an Intel i7-14700F desktop.
- Workload: a toy r(z, θ) with a per-layer profile, one sine wave and a 512² bilinear image sample per point, plus G-code text formatting (`toFixed(3)` for XYZ, `toFixed(5)` for absolute E, Z only on layer change).

**Results.**

| Points | Evaluate | Format G-code | Output size | Bytes/line |
|---|---|---|---|---|
| 20 k | 0.6 ms | 6.8 ms | 0.7 MB | 33 |
| 100 k | 3.3 ms | 41 ms | 3.3 MB | 33 |
| 500 k | 20 ms | 168 ms | 17 MB | 34 |
| 1 M | 31 ms | 336 ms | 34 MB | 34 |

**What the numbers show.**

- **Evaluating the wall on the CPU is not the bottleneck.** Formatting numbers as text is about 10× the cost of evaluating them.
- **Expect a mid-range laptop or phone to be 3–6× slower.** This multiplier is an assumption, not a measurement.
- **The figures are consistent with Potterware's export sheet example:** 18,938 lines for a 13-minute jar [P2].

### 10.3 Budgets

| Metric | Budget | Reasoning |
|---|---|---|
| Main-thread work per input event | ≤ 4 ms | Leaves room inside a 16.7 ms frame for rendering and input. All evaluation runs in a worker |
| Preview update after a parameter change, typical (≤ 150 k pts) | ≤ 50 ms to the updated bead on screen (p95, mid-range Android phone in Chrome, D3) | The ~3 ms evaluation × 5 for a slower device, plus buffer upload and one frame. Feels immediate |
| Preview update, large (≤ 1 M pts) | Coarse preview (every 4th layer, or N/4) in ≤ 50 ms. Full detail in ≤ 300 ms | Progressive refinement. Latest request wins, and stale results are dropped |
| Orbit frame rate | 60 fps at 150 k segments and ≥ 30 fps at 1 M segments, on integrated GPUs | Vertex pulling keeps early-Z (§8.1). Segments smaller than a pixel can fall back to lines. Needs a prototype on low-end mobile (UNVERIFIED) |
| GPU memory for the preview | ≤ 96 MB at 1 M points | Vertex pulling at ~40 B/point [E20], ×2 while double-buffering an update. `TubeGeometry` would need ~480 MB (§8.1) |
| Validation pass | ≤ 30 ms at 150 k pts (worker) | Runs after each evaluation; mostly linear scans plus a spatial hash for self-intersection |
| G-code export | ≤ 1 s for 150 k lines and ≤ 3 s for 1 M lines, with a progress indicator | Measured 41 ms / 336 ms on desktop, ×5 margin. Stream with `Blob` parts, so there is never one giant string |
| G-code file size | Clay: typically ≤ 10 MB, warn above 50 MB | About 33 B/line (measured). Upload limits of printer web UIs and SD workflows are UNVERIFIED (deferred, D4) |
| Finish step (walls + process moves + G-code) | ≤ 3 s at 150 k points on a mid-range Android phone, with progress shown. Mesh build ≤ 5 s | Runs only on demand (D2). Formatting measured at 41 ms per 100 k lines on desktop, ×5 for the device and ×2 for two walls, plus margin |
| Image import | ≤ 300 ms to decode, convert and prefilter a 4096² image (worker, one-off) | Cached by hash |
| Cold load | ≤ 2.5 s to interactive on 4G for the app shell plus three.js, excluding the image library | Library thumbnails load lazily, and full images load on use |
| Undo snapshot | ≤ 20 KB per design snapshot (images excluded), 200 steps | Snapshot undo is cheap at this size, so no command pattern is needed (§8.4) |
| Segment rate in output | ≤ `maxSegmentsPerSec` of the profile (default 50/s) | Streaming limits of about 45/s over USB on Marlin [C30]. A 25 mm/s wall at 0.5 mm spacing is 50 segments/s |

---

## 11. Decisions and open questions for the brainstorm

### 11.1 Decisions taken after review (2026-11-23)

The project owner reviewed the first version of this document and decided the following. The earlier question numbers are kept in brackets for traceability.

| # | Decision | What it changes in this document |
|---|---|---|
| D0 | **Vasecreator stays free for the public.** No licensing, paid tiers, accounts or gated exports | Licensing is about dependencies and assets only (§8.6). Static hosting with no paid backend |
| D1 | **Both clay and FDM are targets** (was Q1) | Printer profiles cover both process classes (§5.3). Validation defaults depend on the process: clay overhang ~27°, FDM ~45° [C1][C42] |
| D2 | **Walls and thickness are chosen at the end, not during design** (was Q5, Q8). Clay gets 1 or 2 walls. FDM gets several thickness methods, applied at G-code export *or* by building a solid mesh afterwards | The live design loop only evaluates the single centreline wall, so it stays fast. A separate *finish step* adds walls or thickness (§5.2 `finish`, §5.4). A mesh export exists only as an FDM finish method |
| D3 | **Rendering uses three.js and must work on Android, like the current app** (was Q11, Q15) | WebGL 2 stays the baseline renderer. Android WebGPU is limited to Android 12+ on some GPUs, and is off in Firefox for Android [E1]. Option A is preferred (§8.8). Full touch editing on Android phones is assumed, because v1 supports it |
| D4 | **Physical verification is deferred** (was Q3). The focus is the pre-G-code design step, with a really good interface | Built-in printer profiles ship as `draft` or `community`. Calibration prints and collecting vendor G-code are out of scope for now. *Interpretation to confirm:* the software printability checks (§7) remain, as design feedback inside the interface |
| D5 | **Web only** (was Q4) | No desktop wrapper or native build. Option C loses its desktop argument (§8.8). Offline install as a PWA stays possible but isn't required |

### 11.2 Assumptions made in this session

These were made without asking. The "Status" column shows where each one stands after the review.

| # | Assumption | Status |
|---|---|---|
| A1 | Clay is the primary target and FDM vase mode secondary | **Superseded by D1** (both are targets) |
| A2 | The app is hosted statically with no paid backend | Follows from D0. Any server component is still Q8 |
| A3 | The Potterware manual reviewed is the published 30-page 5.0 beta edition [P2] | — |
| A4 | v1 never persisted designs, so no user data needs migrating (§2.2) | — |
| A5 | Mid-range devices run 3–6× slower than the benchmark desktop | Budgets now target a mid-range Android phone (D3, §10) |
| A6 | Forms stay single-valued in z around a vertical axis | Q9 |
| A7 | Users calibrate once per clay or filament (E scale, overhang limit) | Calibration UX is deferred with D4 |
| A8 | Single-wall vessels are the main use case | **Superseded by D2** (walls and thickness are set at the end) |
| A9 | The v2 UI is English-only | — |

### 11.3 Remaining questions, ranked by impact

**Q1. What is the interface concept for the design step?** (new; the top question after D4)
- **Why it matters:** D4 makes the pre-G-code design experience the product. Everything else serves it.
- **To decide:**
  - The overall layout: tabbed panels like Potterware's six tabs [P2], a single canvas with contextual panels, or a step flow.
  - Where profile editing happens: in the 3D view, as v1 does it, or in a 2D side profile.
  - How the effect stack, image mapping, rules and curves are shown, and how the bead/lines preview, the scrubber and validation feedback are presented.
  - The desktop layout versus the Android phone layout (D3).
- **Inputs:** §6 (pattern UX), §7 (feedback presentation), §3.6 (patterns worth adopting), §3.7 (mistakes to avoid).

**Q2. MVP scope: which design features are in the first release?**
- **Proposal:** today's form plus plan shape, seam and spiral, floor, the bead preview with scrubber, waves with rules, fades and an intensity curve, design-level checks, and a basic finish step with export.
- **The alternative:** include image relief and mask (Phase 3) in the MVP, because they are the stated core requirement.
- **Also to settle:** the budgets in §10, now on a mid-range Android phone.

**Q3. Which thickness methods does the finish step offer?** (new, from D2)
- **FDM candidates:**
  - (a) Vase mode, a single wall with a chosen extrusion width.
  - (b) N concentric perimeters.
  - (c) Two walls with zigzag between them.
  - (d) A solid mesh of the given thickness, built afterwards for slicing in Cura, Prusa or Orca.
- **Clay:** 1 or 2 walls.
  - With 2 walls: are they linked (zigzag or ribs, à la WeaveSlicer [P33]), what gap separates them, and does the inner wall carry the texture or stay smooth?
- **Impact:** topology (pipeline stage 5b), material estimates, and the checks that only make sense once thickness exists.

**Q4. How does the finish step behave in the interface?** (new, from D2)
- **Preview:** does it re-render with the final walls or thickness, or only show a summary and export?
- **Mesh build (method d):**
  - Formats (STL or 3MF).
  - Offsetting a deep texture inward without self-intersection.
  - Whether it runs in a worker, with progress shown.
- **Guiding rule:** keep the design loop fast. Nothing in the finish step may slow down editing.

**Q5. Should bitmaps also drive the floor/base pattern?** (was Q6)
- **Options:**
  - (a) No. Floors stay functional patterns (spiral, rings, lines).
  - (b) An image modulates the *top* floor layer only.
  - (c) A separate "base stamp" effect.
- **Lean:** (a) for the MVP, with the effect interface designed so (c) is possible later.

**Q6. Is non-planar design (vertical effects, sculpting) in scope for v2?** (was Q7)
- **Lean:** vertical waves only, behind a toggle, after Phase 3.

**Q7. What is the default layer change for each process?** (was Q9)
- **Lean:**
  - Clay: a continuous spiral by default, because failures started at the seam [C1]. A seam ramp is the option.
  - FDM: spiral for vase mode. Seam placement becomes relevant with the perimeter methods.

**Q8. Is any server component acceptable, given D0?** (was Q10)
- **Examples:** short share links, a community gallery, profile sharing.
- **The static-only option:** share links in the URL fragment (§8.4).

**Q9. Mesh import ("print the outline of my model")?** (was Q12)
- It conflicts with assumption A6 and needs slicing.

**Q10. Pattern library: how many patterns, made by whom, under which licences?** (was Q13)
- **Proposal:** 12–20 maps, made in-house or CC0.

**Q11. Which draft printer profiles ship first?** (new, from D1 and D4)
- **Candidates:**
  - Generic clay profiles (delta with centre origin; Cartesian with corner origin).
  - PotterBot, WASP, LUTUM and Eazao drafts.
  - Generic FDM profiles (Marlin, Klipper, a Bambu-style template).
- **Labelling:** all are labelled unverified (D4).

**Q12. When should Vasecreator adopt three.js WebGPURenderer?** (rest of Q11)
- The base is three.js on WebGL 2 (D3).
- **Proposed trigger:**
  - WebGPURenderer loses its "experimental" label [E15], or a prototype shows a clear gain on Android.
  - And the WebGL 2 fallback stays the guaranteed path.

**Q13. Shrinkage compensation for clay?** (was Q14)
- **Options:** a per-clay scale factor, plus "as printed" and "as fired" dimensions.

**Q14. Multi-copy layout?** (was Q16)

---

## 12. Sources

All sources were accessed on **2026-11-23**. Sources marked *(excerpt)* could only be read through search-engine excerpts, because the page blocked fetching, was too large or returned an error. Treat them as weaker evidence.

### P: Potterware and the toolpath landscape

- [P1] Potterware 5.0 site. https://potterware.com (accessed 2026-11-23)
- [P2] Potterware 5.0 Beta User Manual (PDF; the web edition is at https://www.potterware.com/manual.html). https://potterware.com/Potterware-Manual.pdf (accessed 2026-11-23)
- [P3] Potterware 4.0 guide. https://www.potterware.com/manual-4.html (accessed 2026-11-23)
- [P4] Emerging Objects, Potterware membership and pricing. https://emergingobjects.com/potterware/membership-join/ (accessed 2026-11-23)
- [P5] Claybottress, "Potterware and G-Code" (2020-03-24). https://claybottress.com/potterware-and-g-code/ (accessed 2026-11-23)
- [P6] Claybottress, "The Saga of My G-Code Wall Mystery" (2020-06-02). https://claybottress.com/the-saga-of-my-g-code-wall-mystery/ (accessed 2026-11-23)
- [P7] 3dSynth homepage and pricing. https://3dsynth.app (accessed 2026-11-23)
- [P8] VoxelMatters, "Kubuz launches 3dSynth" (2026-09-24). https://www.voxelmatters.com/kubuz-launches-3dsynth-a-browser-based-tool-for-designing-fdm-toolpaths/ (accessed 2026-11-23)
- [P9] 3D Printing Industry, "3dSynth introduces generative G-code approach" (2026-01-05). https://3dprintingindustry.com/news/3dsynth-introduces-generative-g-code-approach-for-creative-3d-printing-247721/ (accessed 2026-11-23)
- [P10] 3dSynth docs, G-code Sculptor. https://app.3dsynth.app/docs/overview-gcode-sculptor.html (accessed 2026-11-23)
- [P11] 3dSynth docs, Layer Mode. https://app.3dsynth.app/docs/layer-mode.html (accessed 2026-11-23)
- [P12] 3dSynth docs, Printer settings. https://app.3dsynth.app/docs/printer-settings.html (accessed 2026-11-23)
- [P13] 3dSynth changelog. https://app.3dsynth.app/docs/changelog.html (accessed 2026-11-23)
- [P14] Product Hunt, 3dsynth.app. https://www.producthunt.com/products/3dsynth-app (accessed 2026-11-23)
- [P15] WASP App v2.1.2 (UI and client scripts). https://app.3dwasp.com (accessed 2026-11-23)
- [P16] 3D ADEPT, WASP App v0.2 (2023-08-02). https://3dadept.com/wasp-releases-parametric-3d-modelling-application-to-improve-experience-with-clay-3d-printing/ (accessed 2026-11-23)
- [P17] FullControl Python repository (README, LICENSE, devices/community/singletool/wasp2040clay.py, extrusion classes, primer library). https://github.com/FullControlXYZ/fullcontrol (accessed 2026-11-23)
- [P18] fullcontrol on PyPI. https://pypi.org/project/fullcontrol/ (accessed 2026-11-23)
- [P19] FullControl GCode Designer (Excel). https://github.com/AndyGlx/FullControl-GCode-Designer (accessed 2026-11-23)
- [P20] fullcontrol-js (community TypeScript port). https://github.com/kylegrover/fullcontrol-js (accessed 2026-11-23)
- [P21] fullcontrol.xyz. https://fullcontrol.xyz (accessed 2026-11-23)
- [P22] Bambu Lab forum, "Anyone have success working with FullControl gcode". https://forum.bambulab.com/t/anyone-have-success-working-with-fullcontrol-gcode/5726 (accessed 2026-11-23)
- [P23] FullControl GitHub issues. https://github.com/FullControlXYZ/fullcontrol/issues (accessed 2026-11-23)
- [P24] Gleadall, "FullControl GCode Designer", Additive Manufacturing 46:102109 (2021). https://doi.org/10.1016/j.addma.2021.102109 (accessed 2026-11-23)
- [P25] Bourgault, Wiley, Farber, Jacobs, "CoilCAM", CHI '23. https://doi.org/10.1145/3544548.3580745 ; PDF https://par.nsf.gov/servlets/purl/10466841 (accessed 2026-11-23)
- [P26] CoilCAM repositories (Grasshopper; JS, including dist/GCodeGenerator and PrinterPresets). https://github.com/sambourgault/coilCAM ; https://github.com/sambourgault/coilCAM-js (accessed 2026-11-23)
- [P27] CoilCAM-js documentation. https://sambourgault.github.io/coilCAM-docs/docs/documentation (accessed 2026-11-23)
- [P28] Termite on food4Rhino. https://www.food4rhino.com/en/app/termite (accessed 2026-11-23)
- [P29] McNeel forum, Termite announcement (2025-12-22). https://discourse.mcneel.com/t/termite-rhino-grasshopper-plugin-developed-for-3d-printing-of-clay/213910 (accessed 2026-11-23)
- [P30] Jauk et al., JMMP 10(4):128 (2026). https://doi.org/10.3390/jmmp10040128 (accessed 2026-11-23)
- [P31] McNeel forum, TOOLPATHS beta release (2026-09-30). https://discourse.mcneel.com/t/toolpaths-3d-printing-plugin-beta-release/223142 (accessed 2026-11-23)
- [P32] Claywoven on Patreon (posts paywalled; excerpts). https://www.patreon.com/Claywoven (accessed 2026-11-23)
- [P33] WeaveSlicer, Hand and Machine Lab (CHI '24). https://handandmachine.org/projects/weave_slicer_python/ ; https://doi.org/10.1145/3613904.3642622 (accessed 2026-11-23)
- [P34] ClayShaper. https://github.com/RandoTechNerd/ClayShaper (accessed 2026-11-23)
- [P35] Clay Slicer 3 (Gumroad). https://gcodetools.gumroad.com/l/ClaySlicerDEMO (accessed 2026-11-23)
- [P36] DigitalClay3D help: surface decoration; tips. https://digitalclay3d.pages.dev/help/04-surface-decoration.html ; https://digitalclay3d.pages.dev/help/10-tips.html (accessed 2026-11-23)
- [P37] CNC Kitchen stlTexturizer (BumpMesh). https://github.com/CNCKitchen/stlTexturizer (accessed 2026-11-23)
- [P38] 3DPrint.com on BumpMesh (2026-04-10). https://3dprint.com/325083/cnc-kitchen-vibe-coded-texture-tool-gave-it-away-for-free/ (accessed 2026-11-23)
- [P39] Prusa forum, BumpMesh thread. https://forum.prusa3d.com/forum/english-forum-general-discussion-announcements-and-releases/bumpmesh-a-really-nice-online-texture-editor (accessed 2026-11-23)
- [P40] OrcaSlicer wiki, Special mode (spiral vase). https://www.orcaslicer.com/wiki/print_settings/others/others_settings_special_mode (accessed 2026-11-23)
- [P41] Prusa Knowledge Base, Layers and perimeters. https://help.prusa3d.com/article/layers-and-perimeters_1748 (accessed 2026-11-23)
- [P42] Cura setting definitions, fdmprinter.def.json. https://github.com/Ultimaker/Cura/blob/main/resources/definitions/fdmprinter.def.json (accessed 2026-11-23)
- [P43] 3D Potter, software. https://3dpotter.com/software/ (accessed 2026-11-23)
- [P44] Eazao blog, "What software do ceramic 3D printers use". https://www.eazao.com/blog/what-software-do-ceramic-3d-printers-use/ (accessed 2026-11-23)
- [P45] Grasshopper clay plugins: WASPer_3DP; Ovenbird; Silkworm. https://www.food4rhino.com/en/app/wasper3dp ; https://www.food4rhino.com/en/app/ovenbird ; https://github.com/ProjectSilkworm (accessed 2026-11-23)
- [P46] Zhong et al., "As-Continuous-As-Possible Extrusion" (arXiv 2201.02374). https://arxiv.org/abs/2201.02374 (accessed 2026-11-23)
- [P47] Direct toolpath editing research: SketchPath (CHI '24), Clay ARTools (CHI '26), SculptAR (UIST '23 Adjunct). https://doi.org/10.1145/3613904.3642684 ; https://doi.org/10.1145/3772318.3791878 ; https://doi.org/10.1145/3586182.3615822 (accessed 2026-11-23)
- [P48] Vasemaker wiki, Textures. https://github.com/dcityorg/vasemaker/wiki/Textures (accessed 2026-11-23)
- [P49] OrcaSlicer wiki, Texture Displacement. https://www.orcaslicer.com/wiki/print_prepare/prepare_texture_displacement (accessed 2026-11-23)

### C: Printing constraints, printers and G-code

- [C1] ISARC 2025, "Exploring Extreme 3D Printed Clay Overhangs with Integrated Active Hot Air Drying System on Robotic Arm". https://www.iaarc.org/publications/fulltext/042_Exploring_Extreme_3D_Printed_Clay_Overhangs_with_Integrated_Active_Hot_Air_Drying_System_on_Robotic_Arm.pdf (accessed 2026-11-23)
- [C2] Yale School of Architecture, Clay 3D Printing Design Guide. https://www.architecture.yale.edu/advanced-technology/tutorials/32-clay-3-d-printing-design-guide (accessed 2026-11-23)
- [C3] Yale School of Architecture, Submitting models for the clay 3D printer. https://www.architecture.yale.edu/advanced-technology/tutorials/22-submitting-models-for-the-clay-3-d-printer (accessed 2026-11-23)
- [C4] UNSW Making, Clay printing. https://www.making.unsw.edu.au/learn/clay_printing/ (accessed 2026-11-23)
- [C5] WASP 40100 LDM technical sheet (Oct 2023). https://www.3dwasp.com/wp-content/uploads/2024/01/WASP-40100-LDM-Technical-Sheet.pdf (accessed 2026-11-23)
- [C6] WASP, Manual Delta WASP 40100 Clay (2019). https://www.3dwasp.com/wp-content/uploads/2019/09/Manual-Delta-WASP-40100-Clay.pdf (accessed 2026-11-23)
- [C7] WASP, Delta WASP 2040 Clay. https://www.3dwasp.com/en/clay-3d-printer-delta-wasp-2040-clay/ (accessed 2026-11-23)
- [C8] Aalto OpenLearning, Delta WASP 40100 Clay and Cura setup. https://openlearning.aalto.fi/mod/page/view.php?id=10524 (accessed 2026-11-23)
- [C9] WIT SoAD Labs, Liquid deposition modeling. https://sites.wit.edu/soad-labs/?p=3228 (accessed 2026-11-23)
- [C10] LTH Makerspace, LDM printers (LUTUM profile). https://www.architecture.lth.se/about/makerspace/ldm-printers (accessed 2026-11-23)
- [C11] 3D Printing Industry, VormVrij LUTUM 4 specifications. https://3dprintingindustry.com/news/vormvrij-lutum-4-clay-3d-printer-technical-specifications-and-pricing-135058/ (accessed 2026-11-23)
- [C12] Aniwaa, VormVrij LUTUM 5 *(excerpt)*. https://www.aniwaa.com/product/3d-printers/vormvrij-lutum-5/ (accessed 2026-11-23)
- [C13] 3D Universe, PotterBot Micro 10 / 10 Pro / Scara V4. https://shop3duniverse.com/products/3d-potterbot-micro-10 ; https://shop3duniverse.com/collections/3d-potter-clay-printers/products/3d-potterbot-10-pro ; https://shop3duniverse.com/products/3d-potterbot-scara-v4 (accessed 2026-11-23)
- [C14] Sheffield Pottery, 3D Potter model comparison. https://www.sheffield-pottery.com/pages/3dpotter-printer-models-comparison-chart (accessed 2026-11-23)
- [C15] CCA, 3D Printing Clay Wiki (PotterBot). https://portal-media.cca.edu/documents/3D_Printing_Clay_Wiki_-_CURRENT.pdf (accessed 2026-11-23)
- [C16] RISD Nature Lab, extrusion (PotterBot). https://naturelab.risd.edu/collections/biomaterials-natural-pigments-and-fabrication/ (accessed 2026-11-23)
- [C17] Eazao Zero manual (ManualsLib). https://www.manualslib.com/manual/2816862/Eazao-Zero.html (accessed 2026-11-23)
- [C18] Hand and Machine Lab, Eazao Zero. https://handandmachine.org/?p=1071 (accessed 2026-11-23)
- [C19] Digitalfire, 3D printing clay. https://digitalfire.com/glossary/3d+printing+clay (accessed 2026-11-23)
- [C20] Prusa Knowledge Base, profiles for different nozzles *(excerpt)*. https://help.prusa3d.com/article/creating-profiles-for-different-nozzles_127540 (accessed 2026-11-23)
- [C21] Slic3r manual, Flow math. https://manual.slic3r.org/advanced/flow-math (accessed 2026-11-23)
- [C22] CuraEngine docs, G-code export. https://sources.debian.org/src/cura-engine/1%3A5.0.0-6/docs/gcode_export.md (accessed 2026-11-23)
- [C23] OrcaSlicer wiki, seam and scarf seam *(excerpt)*. https://www.orcaslicer.com/wiki/print_settings/quality/quality_settings_seam (accessed 2026-11-23)
- [C24] OrcaSlicer profile fdm_klipper_common.json. https://github.com/SoftFever/OrcaSlicer/blob/main/resources/profiles/Custom/machine/fdm_klipper_common.json (accessed 2026-11-23)
- [C25] Marlin docs: M0/M1, M600, M83, M302, G2/G3. https://marlinfw.org/docs/gcode/M000-M001.html ; https://marlinfw.org/docs/gcode/M600.html ; https://marlinfw.org/docs/gcode/M083.html ; https://marlinfw.org/docs/gcode/M302.html ; https://marlinfw.org/docs/gcode/G002-G003.html (accessed 2026-11-23)
- [C26] RepRap wiki, G-code. https://reprap.org/wiki/G-code (accessed 2026-11-23)
- [C27] Duet3D forum, pause and M226 *(excerpt)*; RRF 3.x changelog. https://forum.duet3d.com/post/73011 ; https://github.com/Duet3D/RepRapFirmware/wiki/Changelog-RRF-3.x (accessed 2026-11-23)
- [C28] Klipper, G-Codes and Config Reference. https://www.klipper3d.org/G-Codes.html ; https://www.klipper3d.org/Config_Reference.html (accessed 2026-11-23)
- [C29] Duet3D forum, segment stutter *(excerpt)*. https://forum.duet3d.com/post/215772 (accessed 2026-11-23)
- [C30] V1 Engineering forum, "Stuttering and slow" *(excerpt)*. https://forum.v1engineering.com/t/stuttering-and-slow/10413 (accessed 2026-11-23)
- [C31] Prusa Knowledge Base: G-code viewer; macros; list of placeholders *(excerpts)*. https://help.prusa3d.com/article/prusaslicer-g-code-viewer_193152 ; https://help.prusa3d.com/article/macros_1775 ; https://help.prusa3d.com/article/list-of-placeholders_205643 (accessed 2026-11-23)
- [C32] Duet3D forum, Cura header and flavour *(excerpt)*. https://forum.duet3d.com/post/170053 (accessed 2026-11-23)
- [C33] Ultimaker Community, temperature placeholders in start G-code *(excerpt)*. https://community.ultimaker.com/topic/26253-temp-gcode-not-in-start-gcode-of-cura/ (accessed 2026-11-23)
- [C34] Ahlers, MSc thesis on nonplanar layers (2018). https://tams.informatik.uni-hamburg.de/publications/2018/MSc_Daniel_Ahlers.pdf (accessed 2026-11-23)
- [C35] ACADIA 2022 clay non-planar paper *(excerpt)*. https://discovery.ucl.ac.uk/id/eprint/10196949/1/2022_acadia22_90.pdf (accessed 2026-11-23)
- [C36] SFF Symposium 2024, predictive modeling of drying in clay 3D printing *(excerpt)*. https://utw10945.utweb.utexas.edu/sites/default/files/2024/72%20Predictive%20Modeling%20of%20Drying%20Process%20in%20Clay%203.pdf (accessed 2026-11-23)
- [C37] Digitalfire, drying crack *(excerpt)*. https://digitalfire.com/glossary/drying+crack (accessed 2026-11-23)
- [C38] E3S Conf. ICEGC 2024 paper 00023 (abstract). https://www.e3s-conferences.org/articles/e3sconf/abs/2025/01/e3sconf_icegc2024_00023/e3sconf_icegc2024_00023.html (accessed 2026-11-23)
- [C39] Instructables, PotterBot clay planter *(excerpt)*. https://www.instructables.com/Clay-3D-Printed-Planter (accessed 2026-11-23)
- [C40] Hubs Talk, DeltaWASP clay extruder *(excerpt)*. https://hubs.com/talk/t/deltawasp-clay-extruder/3779/26 (accessed 2026-11-23)
- [C41] Ultimaker Community, 3D Potter "Retraction while coasting" *(excerpt)*. https://community.ultimaker.com/topic/32182-retraction-while-coasting/ (accessed 2026-11-23)
- [C42] Snapmaker, the 45-degree rule. https://www.snapmaker.com/blog/45-degree-rule-3d-printing/ (accessed 2026-11-23)
- [C43] McNeel forum, designing for 3D printing ceramics *(excerpt)*. https://discourse.mcneel.com/t/designing-for-3d-printing-especially-ceramics/79137 (accessed 2026-11-23)
- [C44] Hand and Machine Lab, play dough and clay-dough printing *(excerpt)*. https://handandmachine.org/?p=1101 (accessed 2026-11-23)

### D: Pattern system, graphics and curves

- [D1] Wikipedia, Isothermal coordinates. https://en.wikipedia.org/wiki/Isothermal_coordinates (accessed 2026-11-23)
- [D2] Wikipedia, Mipmap. https://en.wikipedia.org/wiki/Mipmap (accessed 2026-11-23)
- [D3] Wikipedia, Bicubic interpolation. https://en.wikipedia.org/wiki/Bicubic_interpolation (accessed 2026-11-23)
- [D4] Wikipedia, sRGB. https://en.wikipedia.org/wiki/SRGB (accessed 2026-11-23)
- [D5] NI, Nyquist theorem. https://www.ni.com/docs/en-US/bundle/ni-scope/page/nyquist-theorem.html (accessed 2026-11-23)
- [D6] Blender Manual, Displace modifier. https://docs.blender.org/manual/en/latest/modeling/modifiers/deform/displace.html (accessed 2026-11-23)
- [D7] Blender Manual, Color management (Non-Color data). https://docs.blender.org/manual/en/4.0/render/color_management.html (accessed 2026-11-23)
- [D8] MDN, createImageBitmap. https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap (accessed 2026-11-23)
- [D9] Mozilla bug 1613369 (canvas premultiplied alpha). https://bugzilla.mozilla.org/show_bug.cgi?id=1613369 (accessed 2026-11-23)
- [D10] @jsquash/png README. https://cdn.jsdelivr.net/npm/@jsquash/png@3.1.1/README.md (accessed 2026-11-23)
- [D11] ItsLitho, lithophane features. https://itslitho.com/itslitho-lithophane-features/ (accessed 2026-11-23)
- [D12] LithophaneMaker, lamp lithophane. https://lithophanemaker.com/Lamp%20Lithophane.html (accessed 2026-11-23)
- [D13] OrcaSlicer wiki, Fuzzy skin. https://www.orcaslicer.com/wiki/print_settings/others/others_settings_fuzzy_skin (accessed 2026-11-23)
- [D14] OrcaSlicer v2.3.0-beta release notes. https://newreleases.io/project/github/SoftFever/OrcaSlicer/release/v2.3.0-beta (accessed 2026-11-23)
- [D15] Prusa Knowledge Base, Fuzzy skin; PrusaSlicer 2.9 what's new. https://help.prusa3d.com/article/fuzzy-skin_246186 ; https://blog.prusa3d.com/prusaslicer-2-9-whats-new_107659/ (accessed 2026-11-23)
- [D16] CuraEngine FffPolygonGenerator.cpp (processFuzzyWalls). https://github.com/Ultimaker/CuraEngine/blob/main/src/FffPolygonGenerator.cpp (accessed 2026-11-23)
- [D17] Hackaday, Fuzzyficator (2025-01-25). https://hackaday.com/2025/01/25/software-lets-you-paint-surface-patterns-on-3d-prints/ (accessed 2026-11-23)
- [D18] Prusa Knowledge Base, Modifiers. https://help.prusa3d.com/article/modifiers_1767 (accessed 2026-11-23)
- [D19] MDN, @keyframes. https://developer.mozilla.org/en-US/docs/Web/CSS/@keyframes (accessed 2026-11-23)
- [D20] Blender Manual, F-Curve properties (interpolation, handle types). https://docs.blender.org/manual/en/latest/editors/graph_editor/fcurves/properties.html (accessed 2026-11-23)
- [D21] Adobe, After Effects keyframe interpolation. https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/animation-keyframes/keyframe-interpolation.html (accessed 2026-11-23)
- [D22] Maxon, Cinema 4D Spline object. https://help.maxon.net/c4d/2026/en-us/Content/html/OSPLINE-ID_OBJECTPROPERTIES.html (accessed 2026-11-23)
- [D23] SideFX, Houdini ramps. https://www.sidefx.com/docs/houdini/network/ramps.html (accessed 2026-11-23)
- [D24] MDN, easing-function. https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function (accessed 2026-11-23)
- [D25] Rive, interpolation (easing). https://rive.app/docs/editor/animate-mode/interpolation-easing (accessed 2026-11-23)
- [D26] d3-shape, curves (ISC licence). https://d3js.org/d3-shape/curve ; https://github.com/d3/d3-shape (accessed 2026-11-23)
- [D27] Wikipedia, Monotone cubic interpolation; Fritsch & Carlson (1980), SIAM J. Numer. Anal. 17(2) (OSTI record). https://en.wikipedia.org/wiki/Monotone_cubic_interpolation ; https://www.osti.gov/biblio/6893418 (accessed 2026-11-23)
- [D28] bezier-easing. https://github.com/gre/bezier-easing (accessed 2026-11-23)
- [D29] CanvasSpliner; Curvity. https://github.com/jonathanlurie/CanvasSpliner ; https://github.com/nudopnu/curvity (accessed 2026-11-23)
- [D30] Theatre.js (core Apache-2.0, studio AGPL-3.0). https://github.com/theatre-js/theatre (accessed 2026-11-23)
- [D31] ambientCG licence (CC0). https://docs.ambientcg.com/license (accessed 2026-11-23)
- [D32] Poly Haven licence and FAQ (CC0). https://polyhaven.com/license ; https://polyhaven.com/faq (accessed 2026-11-23)
- [D33] Creative Commons, "CC BY-SA 4.0 now one-way compatible with GPLv3" (2015-10-08). https://creativecommons.org/2015/10/08/cc-by-sa-4-0-now-one-way-compatible-with-gplv3/ (accessed 2026-11-23)
- [D34] FSF, Various licenses and comments about them. https://www.gnu.org/licenses/license-list.en.html (accessed 2026-11-23)
- [D35] Apache Software Foundation, GPL compatibility. https://www.apache.org/licenses/GPL-compatibility.html (accessed 2026-11-23)
- [D36] Adobe, Photoshop layer masks *(excerpt)*. https://helpx.adobe.com/photoshop/how-to/layer-mask.html (accessed 2026-11-23)

### E: Architecture, platform, determinism and testing

- [E1] gpuweb, Implementation Status. https://github.com/gpuweb/gpuweb/wiki/Implementation-Status (accessed 2026-11-23)
- [E2] caniuse, WebGPU. https://caniuse.com/webgpu (accessed 2026-11-23)
- [E3] Chrome for Developers, What's New in WebGPU (Chrome 144). https://developer.chrome.com/blog/new-in-webgpu-144 (accessed 2026-11-23)
- [E4] Chrome for Developers, What's New in WebGPU (Chrome 146). https://developer.chrome.com/blog/new-in-webgpu-146 (accessed 2026-11-23)
- [E5] Mozilla Gfx, "Shipping WebGPU on Windows in Firefox 141" (2025-07-15). https://mozillagfx.wordpress.com/2025/07/15/shipping-webgpu-on-windows-in-firefox-141/ (accessed 2026-11-23)
- [E6] Firefox 153.0esr release notes. https://www.firefox.com/en-US/firefox/153.0esr/releasenotes/ (accessed 2026-11-23)
- [E7] gpuweb issue #6331 (Firefox Linux status). https://github.com/gpuweb/gpuweb/issues/6331 (accessed 2026-11-23)
- [E8] Firefox 160.0 release notes. https://www.firefox.com/en-US/firefox/160.0/releasenotes/ (accessed 2026-11-23)
- [E9] web.dev, "WebGPU is now supported in major browsers". https://web.dev/blog/webgpu-supported-major-browsers (accessed 2026-11-23)
- [E10] MDN, WebGPU API. https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API (accessed 2026-11-23)
- [E11] caniuse, WebGL 2.0. https://caniuse.com/webgl2 (accessed 2026-11-23)
- [E12] three.js releases. https://github.com/mrdoob/three.js/releases (accessed 2026-11-23)
- [E13] three.js r163 release notes (WebGL 1 support removed). https://github.com/mrdoob/three.js/releases/tag/r163 (accessed 2026-11-23)
- [E14] npm registry metadata (three, zod, alea, idb, idb-keyval, vitest, @playwright/test and others; versions and licences). https://registry.npmjs.org/three (same URL pattern per package) (accessed 2026-11-23)
- [E15] three.js manual, WebGPURenderer. https://github.com/mrdoob/three.js/blob/dev/manual/pages/webgpurenderer.html (accessed 2026-11-23)
- [E16] three.js source: WebGPURenderer.js; WebGLBackend.js. https://github.com/mrdoob/three.js/blob/dev/src/renderers/webgpu/WebGPURenderer.js ; https://github.com/mrdoob/three.js/blob/dev/src/renderers/webgl-fallback/WebGLBackend.js (accessed 2026-11-23)
- [E17] three.js: StorageBufferNode docs; NodeMaterial.js (depthNode). https://github.com/mrdoob/three.js/blob/dev/docs/pages/StorageBufferNode.html ; https://github.com/mrdoob/three.js/blob/dev/src/materials/nodes/NodeMaterial.js (accessed 2026-11-23)
- [E18] three.js forum, "TSL and webgl2 vs webgpu". https://discourse.threejs.org/t/tsl-and-webgl2-vs-webgpu/87974 (accessed 2026-11-23)
- [E19] W3C, WebGPU specification: limits. https://www.w3.org/TR/webgpu/#limits (accessed 2026-11-23)
- [E20] PrusaSlicer libvgcode (SegmentTemplate.cpp at 2.8.0; master viewer). https://github.com/prusa3d/PrusaSlicer/blob/version_2.8.0/src/libvgcode/src/SegmentTemplate.cpp ; https://github.com/prusa3d/PrusaSlicer/tree/master/src/libvgcode (accessed 2026-11-23)
- [E21] PrusaSlicer 2.8.0-alpha5 release notes. https://newreleases.io/project/github/prusa3d/PrusaSlicer/release/version_2.8.0-alpha5 (accessed 2026-11-23)
- [E22] Sigg et al., "GPU-based ray-casting of quadratic surfaces" (2006). https://cg.cs.tu-dortmund.de/publications/2006-quadrics.pdf (accessed 2026-11-23)
- [E23] Rose et al., "NGL viewer" (2018). https://pmc.ncbi.nlm.nih.gov/articles/PMC6198858 (accessed 2026-11-23)
- [E24] Mol* repository. https://github.com/molstar/molstar (accessed 2026-11-23)
- [E25] Inigo Quilez, site notes on code licence; intersectors article. https://iquilezles.org/ ; https://iquilezles.org/articles/intersectors (accessed 2026-11-23)
- [E26] Dawn/Tint, fragment_depth extension. https://dawn.googlesource.com/dawn/+/main/docs/tint/extensions/fragment_depth.md (accessed 2026-11-23)
- [E27] Khronos, EXT_conservative_depth; web3dsurvey coverage. https://registry.khronos.org/webgl/extensions/EXT_conservative_depth/ ; https://web3dsurvey.com/webgl2/extensions/EXT_conservative_depth (accessed 2026-11-23)
- [E28] Chrome for Developers, What's New in WebGPU (Chrome 155–156). https://developer.chrome.com/blog/new-in-webgpu-155-156 (accessed 2026-11-23)
- [E29] gcode-preview (README and releases). https://github.com/remcoder/gcode-preview ; https://github.com/remcoder/gcode-preview/releases (accessed 2026-11-23)
- [E30] three.js docs, LineMaterial / LineSegmentsGeometry. https://github.com/mrdoob/three.js/blob/dev/docs/pages/LineMaterial.html (accessed 2026-11-23)
- [E31] ECMA-262 (Number arithmetic, Math.sin, Math.sqrt, Number.prototype.toFixed). https://tc39.es/ecma262/ (accessed 2026-11-23)
- [E32] Engine trig implementations: v8-dev thread on `v8_use_libm_trig_functions`; Mozilla bugs 1823880 and 1895749; T. MacWright, "Math keeps changing" (2020). https://groups.google.com/g/v8-dev/c/tdP33vfp4Lk/m/1p_TbZ8wAwAJ ; https://bugzilla.mozilla.org/show_bug.cgi?id=1823880 ; https://bugzilla.mozilla.org/show_bug.cgi?id=1895749 ; https://macwright.com/2020/02/14/math-keeps-changing (accessed 2026-11-23)
- [E33] W3C, WGSL specification (§15.7 floating-point accuracy). https://www.w3.org/TR/WGSL/ (accessed 2026-11-23)
- [E34] dEQP GLES3 built-in function precision test spec. https://android.googlesource.com/platform/external/deqp/+/fcc8d1a/doc/testspecs/GLES3/functional.shaders.builtin_functions.precision.txt (accessed 2026-11-23)
- [E35] TypeGPU: repository; 0.12 release post; unplugin-typegpu; @typegpu/gl. https://github.com/software-mansion/TypeGPU ; https://docs.swmansion.com/TypeGPU/blog/typegpu-012/ ; https://docs.swmansion.com/TypeGPU/tooling/unplugin-typegpu/ ; https://docs.swmansion.com/TypeGPU/ecosystem/typegpu-gl/ (accessed 2026-11-23)
- [E36] wgpu README; crates.io (wgpu, wasm-bindgen). https://github.com/gfx-rs/wgpu ; https://crates.io/crates/wgpu (accessed 2026-11-23)
- [E37] Rust users forum, "Treeshaking wasm?" (size report). https://users.rust-lang.org/t/treeshaking-wasm/101515 (accessed 2026-11-23)
- [E38] WebAssembly design, Nondeterminism. https://github.com/WebAssembly/design/blob/main/Nondeterminism.md (accessed 2026-11-23)
- [E39] caniuse: module workers; OffscreenCanvas; WebAssembly SIMD. https://caniuse.com/mdn-api_worker_worker_ecmascript_modules ; https://caniuse.com/offscreencanvas ; https://caniuse.com/wasm-simd (accessed 2026-11-23)
- [E40] Comlink. https://github.com/GoogleChromeLabs/comlink (accessed 2026-11-23)
- [E41] web.dev, COOP and COEP. https://web.dev/articles/coop-coep (accessed 2026-11-23)
- [E42] GitHub community discussion #13309 (custom headers on GitHub Pages). https://github.com/orgs/community/discussions/13309 (accessed 2026-11-23)
- [E43] coi-serviceworker. https://github.com/gzuidhof/coi-serviceworker (accessed 2026-11-23)
- [E44] Netlify custom headers; Cloudflare Pages headers. https://docs.netlify.com/manage/routing/headers/ ; https://developers.cloudflare.com/pages/configuration/headers/ (accessed 2026-11-23)
- [E45] simplex-noise.js. https://github.com/jwagner/simplex-noise.js (accessed 2026-11-23)
- [E46] Immer, Patches. https://immerjs.github.io/immer/patches/ (accessed 2026-11-23)
- [E47] lz-string. https://github.com/pieroxy/lz-string (accessed 2026-11-23)
- [E48] MDN, CompressionStream; WHATWG Compression Streams; caniuse deflate-raw. https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream ; https://compression.spec.whatwg.org ; https://caniuse.com/mdn-api_compressionstream_compressionstream_deflate-raw (accessed 2026-11-23)
- [E49] MDN, Storage quotas and eviction criteria. https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria (accessed 2026-11-23)
- [E50] Node.js test runner. https://nodejs.org/api/test.html (accessed 2026-11-23)
- [E51] Vitest, Snapshot guide. https://vitest.dev/guide/snapshot (accessed 2026-11-23)
- [E52] fast-check. https://github.com/dubzzz/fast-check (accessed 2026-11-23)
- [E53] Playwright, Visual comparisons. https://playwright.dev/docs/test-snapshots (accessed 2026-11-23)
- [E54] Chrome for Developers, headless WebGPU testing; Chromium SwiftShader notes. https://developer.chrome.com/blog/supercharge-web-ai-testing ; https://chromium.googlesource.com/chromium/src/+/da170c2267b2201954efe1c8fa5d2d89ab09f7bf/docs/gpu/swiftshader.md (accessed 2026-11-23)
- [E55] OrcaSlicer repository (AGPL-3.0). https://github.com/OrcaSlicer/OrcaSlicer (accessed 2026-11-23)
