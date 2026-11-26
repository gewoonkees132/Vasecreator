# Vasecreator v2: issue drafts for the "Later" items

This file holds ready-to-post GitHub issue drafts. Decision D26 says that after launch, every later item in `docs/design/v2-design-brainstorm.md` §15.4 becomes a clearly documented GitHub issue. Nothing here has been posted. The owner posts them after launch.

How to use it:

- Issues 1–14 follow §15.4 in order. §15.4 puts **Mesh import** and **multi-copy layout** on one line. They touch different code, so they are two issues here (13 and 14).
- Issues 15 and 16 came out of the build. They are the checks that `v2/ARCHITECTURE.md` (Status) still lists as open.
- Issues 17–19 were parked in the pattern studio brainstorm ([`v2-pattern-studio.md`](v2-pattern-studio.md) §12). They need that work built first.
- Each section gives a title, suggested labels and a body. Copy the fenced block as the issue body.
- "Design §" means `docs/design/v2-design-brainstorm.md`. "Research §" means `docs/research/toolpath-foundation.md`. File paths are relative to `v2/`.
- Suggested labels: `enhancement`, `verification`, and the area labels `core`, `ui`, `printer`, `renderer`, `store`. Create them once before posting.
- Every UI item has to work on desktop and on a mid-range Android phone in Chrome before it counts as done (D3).

---

## 1. Share links

**Title:** Share links
**Labels:** `enhancement`, `core`, `ui`

```markdown
### Why
Users want to send a design to someone without a file. D0 and research Q8 rule out a server, so the design has to travel in the URL fragment (research §8.4).

### Scope
- Compress the design JSON with `CompressionStream('deflate-raw')` and encode it as base64url in `#…`.
- A *Share* button that copies the link.
- Opening a link opens the design as a new history step ("Opened: shared link"), as opening a file does (C3).
- Library patterns travel by id (`lib:…@1`). User recipes (`user:…`) travel inside `assets`, since they are tiny.
- Uploaded images (`img:…`) can't travel. The share dialog says so, and the receiver gets the `missingImage` warning.

### Out of scope
- Short links, a gallery, or anything that needs a server (D0).
- Embedding image pixels in the link.

### Where it goes in the code
- New `ui/share.js`: encode and decode. It uses browser streams, so it stays out of `core/`.
- `core/design.js`: `compactDesign`, `looksLikeDesign` and `normaliseDesign` before opening.
- `main.js`: read `location.hash` at start-up and on `hashchange`, then `store.open(…)`.
- `ui/topbar.js` (desktop) and the logo menu (phone, C11) for the button.

### Acceptance criteria
- [ ] node:test: encode → decode gives a design equal to the original (`designsEqual`) for every preset.
- [ ] A link from a newer design version shows an error. It never opens the default pot.
- [ ] A broken or truncated link shows a plain message, and the current design stays.
- [ ] The link length for each preset is measured and noted in the PR.
- [ ] Works on desktop and a mid-range Android phone (D3).

### Sources
Design §12, §15.4, §16 (Q8); research §8.4, §11.3 (Q8).
```

---

## 2. Polygon footprint

**Title:** Polygon footprint
**Labels:** `enhancement`, `core`, `ui`

```markdown
### Why
D11 ships circle and rectangle only, and names polygons as a later Advanced feature. Research §5.1 already describes an N-sided polygon with corner rounding.

### Scope
- A third footprint, *Polygon*: N sides (about 3–12) and corner rounding as a fraction, like the rectangle (C6).
- Same scaling rule as today: the outline at every height is the same shape at a different size.
- Points placed by arc length u, so beads stay evenly spaced.
- *Hidden* seam snaps to a corner (C13).
- Shown under Advanced → Footprint only (§9.5).

### Out of scope
- Custom outlines (issue 3).
- Different side lengths or a star polygon.

### Where it goes in the code
- `core/design.js`: add `'polygon'` to `FOOTPRINTS`, a `sides` field, `LIMITS` and normalising.
- `core/plan.js`: the polygon outline in `createPlan`, with an arc-length table.
- `core/toolpath.js`: seam placement for *Hidden*.
- `ui/sections/footprint.js`, plus `footprintAt` in `ui/sections/shape.js` for the size and perimeter.

### Acceptance criteria
- [ ] node:test (`test/plan.test.js`): the perimeter matches the closed form for a rounded polygon. Points are evenly spaced by arc length.
- [ ] A new golden G-code file for a hexagon pot. The existing golden files don't change.
- [ ] Older designs without the new fields still normalise unchanged.
- [ ] Works on desktop and a mid-range Android phone (D3).

### Sources
Design D11, §9.1, §9.5, §15.4; research §2.7 (base fillet row), §5.1.
```

---

## 3. Custom footprint

**Title:** Custom footprint
**Labels:** `enhancement`, `core`, `ui`

```markdown
### Why
D11 lists a custom 2D outline as a later Advanced feature. It must stay a single radius per angle, so a layer can never cross itself (research §5.1, "star-shaped about the axis").

### Scope
- *Custom* under Advanced → Footprint: draw the outline, or import a single closed path from an SVG.
- Store the outline as a unit outline in the design, so it scales with the profile like the other footprints.
- Check that the outline is star-shaped about its centre. If it isn't, say so plainly and don't apply it.
- Resample by arc length for even bead spacing.

### Out of scope
- Holes, several paths, or outlines that fold back (not single-valued).
- Normal-direction pattern displacement (research §5.1 calls it riskier).

### Where it goes in the code
- `core/design.js`: an `outline` field with limits on point count, and normalising.
- `core/plan.js`: an outline type built from the stored points.
- `ui/sections/footprint.js`: the editor and the SVG import. Flattening SVG curves needs the DOM, so it stays in `ui/`; only points reach `core/`.

### Acceptance criteria
- [ ] node:test: resampling keeps the perimeter within 0.1 mm. The star-shaped check rejects a C shape and accepts a rounded square.
- [ ] An SVG with one closed path imports. An SVG with none, or with several, shows a clear message.
- [ ] A golden G-code file for one custom outline.
- [ ] Drawing works with touch, and on desktop and a mid-range Android phone (D3).

### Sources
Design D11, §9.5, §15.4; research §5.1.
```

---

## 4. More base infills

> **Built 2026-11-26** as Spiral, Rings and Lines, with the sealing rules of [`v2-base-infill.md`](v2-base-infill.md) (D73–D75). Sunburst was left out. The text below is the original draft.

**Title:** More base infills
**Labels:** `enhancement`, `core`, `ui`

```markdown
### Why
Phase 1 has only the spiral base (§9.4). Research §5.4, stage 6, lists rings, lines, crosshatch and sunburst, as Potterware offers.

### Scope
- Add *Rings*, *Lines*, *Crosshatch* and *Sunburst* to the Infill control.
- Keep the fixed behaviour from §9.4: alternate direction per layer, an outline ring, finish at the seam, line spacing from `base.spacingRatio` (0.9 × bead width).
- Respect the drainage hole and the morphed outline, as the spiral does.
- Keep no-clay moves short. Clay can't retract, so use connector beads where the path has to jump.

### Out of scope
- Patterns or images on the floor (Q5, option a). A "base stamp" would be its own issue.

### Where it goes in the code
- `core/design.js`: there is no `base.infill` field yet. Add it (default `'spiral'`) to `LIMITS`/normalising.
- `core/toolpath.js`: the base section (`spiralTurns`, `spiralPoint` and the base layer loop) becomes one function per infill.
- `core/checks.js`: V13 (line spacing ≤ bead width, hole ≥ 2 beads).
- `ui/sections/base.js`: the options in the Infill segmented control, and the summary text.

### Acceptance criteria
- [ ] Property tests: every infill is flat per layer, ends at the seam, and leaves no gap wider than the spacing.
- [ ] A golden G-code file per new infill. The spiral golden files don't change.
- [ ] The hole is respected by every infill.
- [ ] Works on desktop and a mid-range Android phone (D3).

### Sources
Design §9.4, §15.4, §16 (Q5); research §5.4 (stage 6), §7 (V13), §3.6.
```

---

## 5. Linked double wall

**Title:** Linked double wall
**Labels:** `enhancement`, `core`, `ui`

```markdown
### Why
Phase 1 has 1 or 2 walls with no link between them (Q3). A zigzag or ribs between the two walls makes a stiffer pot, as WeaveSlicer does [P33].

### Scope
- In Prepare print → Walls, with 2 walls: link *None*, *Zigzag* or *Ribs*, with a pitch in mm.
- Decide how the link fits the one continuous path per layer (for example an inner pass that zigzags out to the outer wall). Write it down in `ARCHITECTURE.md`.
- Link beads must never pass the outer wall.
- Prepare print only. Nothing here touches the live design loop (D2).

### Out of scope
- FDM thickness methods (issue 9).
- Changing the inner-wall rule of D27.

### Where it goes in the code
- `core/design.js`: a `finish.link` field (type and pitch), limits and normalising.
- `core/toolpath.js`: `buildToolpath` with `walls = 2` (the inner wall, `KIND.inner`, `KIND.connector`).
- `core/checks.js`: update the `wallGap` info.
- `ui/print.js`: the Walls step.

### Acceptance criteria
- [ ] Property test: every link point lies between the inner and outer wall at its height.
- [ ] The seam still steps up cleanly, and the ramp rules (`RAMP_IN_LAYERS`) still hold.
- [ ] A golden G-code file for one preset with a zigzag link. Unlinked output doesn't change.
- [ ] Prepare print stays within 3 s at 150 k points on a mid-range Android phone (research §10.3).
- [ ] Works on desktop and a mid-range Android phone (D3).

### Sources
Design D27, §10, §15.4, §16 (Q3); research §5.4 (stage 5b), §11.3 (Q3), [P33].
```

---

## 6. Slight non-planarity

**Title:** Slight non-planarity
**Labels:** `enhancement`, `core`, `ui`

```markdown
### Why
Up-and-down patterns and a wavy rim are popular, but D10 keeps layers planar for now. This issue needs the owner to lift D10 in part before work starts.

### Scope
- Vertical displacement: patterns that move the bead up and down, and a wavy rim.
- Local layer thickness stays within 0.5–1.5 × layer height (V11).
- A V11 check that warns outside that range, plus a nozzle clearance check.
- The first layers above the base stay flat.

### Out of scope
- Full non-planar slicing or sculpting.
- A continuous-spiral mode (D10, Q7).

### Where it goes in the code
- `core/toolpath.js`: z per point instead of flat layers with a ramp.
- `core/patterns.js`, `core/surface.js`: a vertical component for patterns.
- `core/checks.js`: V11.
- `core/gcode.js`: the V16 sanity rule "Z non-decreasing (planar)" must allow small steps down.
- `ui/sections/surface.js` and `ui/sections/layers.js` for the controls.

### Acceptance criteria
- [ ] Property test: local layer thickness stays in [0.5 h, 1.5 h] wherever no V11 warning is raised.
- [ ] V16 still catches NaN, Inf, zero feeds and real Z errors.
- [ ] With the feature off, the golden G-code files don't change.
- [ ] Works on desktop and a mid-range Android phone (D3).

### Sources
Design D10, §15.4, §16 (Q6); research §7 (V11, V16), §11.3 (Q6).
```

---

## 7. Named printer profiles

**Title:** Named printer profiles
**Labels:** `enhancement`, `printer`, `core`, `ui`, `store`

```markdown
### Why
v2 ships one generic gantry profile (D9, Q11). Owners of PotterBot, WASP, LUTUM and Eazao printers should be able to start from a draft for their machine, and share profiles as files.

### Scope
- Draft profiles for PotterBot, WASP, LUTUM and Eazao, from the research table. Unverified fields are marked, and every profile shows as a draft (D4).
- A profile picker in Prepare print → Printer.
- Import and export of a profile as a JSON file.
- Keep a list of profiles instead of one.
- WASP deltas use a centre origin and a round bed. The bed check needs a circle bed.

### Out of scope
- SCARA beds and robots (issue 8).
- Testing the drafts on real printers (see issue 16).

### Where it goes in the code
- `core/printer.js`: profile list, a round bed shape, `normalisePrinter` for imported files.
- New `library/printers.json` for the drafts.
- `core/checks.js`: bed fit (V1) for a round bed.
- `core/gcode.js`: `validateTemplates` still applies to every profile.
- `store/db.js`: `settings` holds a list and the chosen id.
- `ui/print.js`: the picker, import and export.

### Acceptance criteria
- [ ] Every draft normalises, and `printerLabel` shows it as a draft.
- [ ] A golden G-code file per draft for one preset.
- [ ] Importing a file that isn't a profile shows a clear message. Heater codes are still refused.
- [ ] Works on desktop and a mid-range Android phone (D3).

### Sources
Design D9, C19, §15.4, §16 (Q11); research §3.5 (printers table, profile schemas), §5.3, §11.3 (Q11).
```

---

## 8. Robot output

**Title:** Robot output
**Labels:** `enhancement`, `printer`, `core`

```markdown
### Why
D9 targets a gantry printer only. Professionals with robot arms are a later audience (design §4), and they need output their robot controller can run.

### Scope
- First a short research pass: which robot controllers clay users run (for example KUKA KRL, ABB RAPID, Universal Robots script), how they drive the extruder, and what a robot profile needs (tool and base frames, speeds, extruder I/O). Add it to the research doc.
- Then one robot output format, from the same toolpath as the G-code.
- A robot profile type next to the gantry profile, labelled draft (D4).

### Out of scope
- Reach, joint limits and collision checks for the arm.
- More than one robot format in the first version.

### Where it goes in the code
- New emitter beside `core/gcode.js`, for example `core/robot.js`. It reads the same toolpath (`printResult.toolpath`).
- `core/printer.js`: a machine kind (gantry or robot) and the robot fields.
- `core/engine.js` and `worker/client.js`: an export call for the new format.
- `ui/print.js`: the Export step.

### Acceptance criteria
- [ ] The research section is written and cited.
- [ ] A golden output file for one preset. Output is deterministic (same bytes in every engine).
- [ ] Gantry G-code doesn't change.
- [ ] Works on desktop and a mid-range Android phone (D3).

### Sources
Design D9, §4, §5, §15.4. The research has no robot section yet; research §5.4 (one toolpath, several emitters) is the starting point.
```

---

## 9. FDM output

**Title:** FDM output
**Labels:** `enhancement`, `printer`, `core`, `ui`

```markdown
### Why
D1 named FDM as a target, but D6 narrowed this round to clay. This issue starts once the owner lifts D6.

### Scope
- First vase mode: a single wall with a chosen extrusion width.
- Then the other thickness methods from Q3: N concentric walls, two walls with a zigzag.
- Then the mesh build: a watertight solid (STL or 3MF) of the chosen thickness, for slicing elsewhere (Q4).
- FDM printer profiles, which do need heater codes.
- The design view stays in bead terms (D7). The process is chosen in Prepare print.

### Out of scope
- Supports, multi-material and slicer features beyond the methods above.

### Where it goes in the code
- `core/printer.js`: a process class (clay or FDM) and FDM templates with heater placeholders.
- `core/gcode.js`: allow heater codes only for FDM profiles; E in mm of filament.
- `core/toolpath.js`: the thickness methods (stage 5b).
- New `core/mesh.js` for the mesh build, run in the worker on demand.
- `core/checks.js`: FDM defaults (overhang about 45°).
- `ui/print.js`: the Walls step offers the FDM methods.

### Acceptance criteria
- [ ] Golden G-code files for vase mode and each method. Clay golden files don't change.
- [ ] Clay profiles still refuse heater codes.
- [ ] The mesh build gives a watertight solid on a deep texture (no self-intersection), within 5 s (research §10.3).
- [ ] Works on desktop and a mid-range Android phone (D3).

### Sources
Design D6, D7, §15.4, §16 (Q3, Q4); research D1, D2, §5.4 (stages 5b, 12), §10.3, §11.3 (Q3, Q4).
```

---

## 10. More checks

**Title:** More checks
**Labels:** `enhancement`, `core`, `ui`

```markdown
### Why
Phase 1 runs the checks in design §11. Research §7 also recommends in-layer slope (V3), turning angle (V4) and slenderness (V14).

### Scope
- V3, in-layer slope: warn above 60° between neighbouring points.
- V4, turning angle: warn above 90° between segments.
- V14, slenderness: height against base diameter, as info.
- Each one colours the affected beads, like the existing warnings, and none blocks designing (§11).
- Messages give heights in mm, never layers (D7, D15).
- The research marks the V3 and V4 thresholds as unverified. They are defaults, not limits.

### Out of scope
- Calibrating thresholds with test prints (D4).
- Auto-limiting the pattern.

### Where it goes in the code
- `core/checks.js`: new `ISSUE` bits and entries in `designChecks`.
- `core/toolpath.js`: per-point issue flags while the wall is evaluated.
- `ui/chips.js`: the new warnings in the list. `render/beads.js` `setHighlight` already takes a bitmask.
- The checks table in `ARCHITECTURE.md`.

### Acceptance criteria
- [ ] node:test cases in `test/checks.test.js` that trigger and don't trigger each check.
- [ ] Design checks stay within 30 ms at 150 k points (research §10.3).
- [ ] Works on desktop and a mid-range Android phone (D3).

### Sources
Design §11, C9, §15.4; research §7 (V3, V4, V14).
```

---

## 11. Shrinkage compensation

**Title:** Shrinkage compensation
**Labels:** `enhancement`, `core`, `printer`, `ui`

```markdown
### Why
A wet clay body can shrink up to 15 % while drying and 5–10 % more in firing (research §3.4). Users want the fired pot to come out at the size they designed.

### Scope
- A shrinkage percentage, set in Prepare print, not in the design view (D7).
- Separate values for width and height, since clay often shrinks more vertically.
- The G-code is scaled up so the fired pot matches the design size.
- Prepare print shows both sizes: as printed and as fired.

### Out of scope
- Per-clay presets beyond a name and a number.
- Uneven or direction-dependent shrinkage beyond width and height.

### Where it goes in the code
- `core/printer.js` (or a small material block next to it): the shrinkage values, normalised and clamped.
- `core/engine.js` and `core/toolpath.js`: apply the scale to the final toolpath only, so the preview and design checks are unchanged.
- `core/checks.js`: bed fit (V1) uses the printed size.
- `ui/print.js`: the setting and both sizes.

### Acceptance criteria
- [ ] With 0 % shrinkage, the golden G-code files don't change.
- [ ] node:test: with s %, printed size = designed size / (1 − s/100), checked on the toolpath extent.
- [ ] Bed fit fails when the printed size doesn't fit, even if the designed size does.
- [ ] Works on desktop and a mid-range Android phone (D3).

### Sources
Design D7, §15.4, §16 (Q13); research §3.4 (Shrinkage), §5.2 (`material.shrinkagePct`), §11.3 (Q13).
```

---

## 12. WebGPU renderer

**Title:** WebGPU renderer
**Labels:** `enhancement`, `renderer`

```markdown
### Why
Research Q12 sets a trigger for adopting three.js WebGPURenderer. WebGL 2 must stay the guaranteed path, because Android WebGPU support is still patchy (D3).

### Scope
- Check the trigger: WebGPURenderer has lost its "experimental" label [E15], or a prototype shows a clear gain on a mid-range Android phone.
- If it's met, port the bead renderer behind feature detection, and keep WebGL 2 as the fallback.
- Measure both paths with the same pots.

### Out of scope
- Dropping WebGL 2.
- GPU compute for the toolpath (research §8.8 keeps one Float64 buffer for preview and G-code).

### Where it goes in the code
- `render/beads.js`: the vertex-pulled, instanced bead shader and the LOD rules.
- `render/handles.js` only if the camera or ray API changes.
- `index.html`: the import map (three.js 0.187.0) and the WebGL 2 check.

### Acceptance criteria
- [ ] A measured comparison (frame time, preview latency, memory) on desktop and a mid-range Android phone, posted in the issue.
- [ ] Devices without WebGPU get the WebGL 2 path, unchanged.
- [ ] Both paths give the same picture, thumbnails included.
- [ ] Budgets from research §10.3 hold on both paths.

### Sources
Design D3, §15.4, §16 (Q12); research §8.1, §8.2, §8.8, §11.3 (Q12), [E15].
```

---

## 13. Mesh import

**Title:** Mesh import
**Labels:** `enhancement`, `core`, `ui`

```markdown
### Why
Some users want to print the outline of a model they already have (research Q9). A free mesh conflicts with assumption A6 (forms stay single-valued in z around a vertical axis) and would need slicing.

### Scope
- Import a binary or ASCII STL.
- Keep A6: sample the mesh into a radius per height and angle, r(z, u), then use it as a profile plus a custom footprint, or as a morph map (`core/morph.js`).
- A mesh that isn't single-valued around the axis gets a clear message instead of a broken pot.
- Run the import in the worker, with progress for large files.

### Out of scope
- Slicing arbitrary meshes, overhanging shapes and handles.
- OBJ, 3MF and other formats in the first version.

### Where it goes in the code
- New `core/mesh-import.js`: parse STL and sample r(z, u). Pure and deterministic.
- `core/morph.js`, or the custom footprint from issue 3, to carry the result.
- `worker/engine.worker.js` and `worker/client.js`: an import call.
- `ui/designs.js`: an *Import model* entry on the Designs screen.

### Acceptance criteria
- [ ] node:test: a revolved test STL comes back as its profile within 0.1 mm.
- [ ] A mesh that isn't single-valued shows the message, and the current design stays.
- [ ] Works on desktop and a mid-range Android phone (D3).

### Sources
Design §5, §15.4, §16 (Q9); research §9.4 (phase 5), §11.2 (A6), §11.3 (Q9).
```

---

## 14. Multi-copy layout

**Title:** Multi-copy layout
**Labels:** `enhancement`, `core`, `printer`, `ui`

```markdown
### Why
Users with a large bed want to print several copies of one design in one job (research Q14).

### Scope
- In Prepare print: a number of copies and a spacing, laid out on the bed.
- Decide the print order: one copy after another, or layer by layer across copies. Clay can't retract, so every travel between copies leaves a string. Write the choice down in `ARCHITECTURE.md`.
- One skirt and one prime for the whole job.
- Refill pauses count the volume of all copies.

### Out of scope
- Different designs in one job.
- Automatic packing beyond a simple grid.

### Where it goes in the code
- `core/design.js`: a `finish.copies` field (count, spacing), limits and normalising.
- `core/toolpath.js`: offset copies of one toolpath, and `buildSkirt` around all of them.
- `core/gcode.js`: `planRefills` and `writeGcode` for several copies.
- `core/checks.js`: bed fit and the `park` check for every copy.
- `ui/print.js`: the setting. `render/beads.js` `setBed` already draws the bed.

### Acceptance criteria
- [ ] A golden G-code file for two copies. Single-copy output doesn't change.
- [ ] Bed fit fails when any copy, or the skirt, is off the bed.
- [ ] The park point is never over a copy.
- [ ] Works on desktop and a mid-range Android phone (D3).

### Sources
Design §5, §15.4, §16 (Q14); research §9.4 (phase 5), §11.3 (Q14).
```

---

## 15. Verify v2 on a real mid-range Android phone

**Title:** Verify v2 on a real mid-range Android phone
**Labels:** `verification`, `ui`, `renderer`

```markdown
### Why
D3 says a phase only counts as done once it works on desktop and on a real mid-range Android phone in Chrome. `ARCHITECTURE.md` lists this check as still open, so phases 0 and 1 aren't done yet.

### Scope
Measure on one real phone, with Chrome remote debugging (`chrome://inspect`, Performance panel):
- Preview update after a change: ≤ 50 ms p95 to the updated beads (≤ 150 k points).
- Large pots up to about 1.3 M preview points: a coarse preview in ≤ 50 ms, full detail in ≤ 300 ms.
- Orbit: 60 fps at 150 k segments, at least 30 fps at 1 M.
- The renderer switches to 6-sided beads above 60 k segments on phones (`LOD_SIDES`, `LOD_SEGMENTS_COMPACT` in `render/beads.js`). Check it looks right and the switch doesn't flicker.
- Touch handles: drag, tap the line to add, long-press to remove, 44 px targets.
- The 40/60 split (D22): nothing covers the pot. The tab row reads at 360 px (C11).
- Prepare print ≤ 3 s and G-code export ≤ 1 s at 150 k points. Cold load ≤ 2.5 s on 4G.
- Designs screen, history thumbnails, and saves that survive a reload.

### Out of scope
- Fixing what fails. Each failed budget gets its own issue.

### Where it goes in the code
Nothing changes unless a budget fails. Likely places: `render/beads.js` (LOD), `worker/client.js` (progressive preview), `render/handles.js`, `styles/app.css`.

### Acceptance criteria
- [ ] The phone model, chipset, GPU, Android and Chrome versions are recorded.
- [ ] A results table (measured value against budget) is added to `ARCHITECTURE.md` Status.
- [ ] Every failed budget has its own linked issue.
- [ ] Once all budgets pass, the phone check comes off the "Still open" list.

### Sources
Design D3, D22, C11, §15; research §10.3, D3; `ARCHITECTURE.md` (Status, Renderer).
```

---

## 16. Verify the generic gantry G-code on a real clay printer

**Title:** Verify the generic gantry G-code on a real clay printer
**Labels:** `verification`, `printer`, `core`

```markdown
### Why
D4 deferred physical verification, so the generic gantry profile is labelled "draft, not tested on a printer". Before it can drop that label, its output has to run on real clay printers.

### Scope
Print the cylinder and the presets (the golden files; at least the first three) and check each process move:
- Prime: the stationary prime at the park point, its volume, and that the blob isn't printed into.
- Skirt: offset and loops.
- Seam ramp: the climb over `rampLengthMm`, and the first 4 wall layers above the base (`RAMP_IN_LAYERS`).
- Base spiral: alternating direction, ending at the seam.
- Refill pause: `M0` (Marlin), `M226` (RRF) and `PAUSE` (Klipper), then the resume onto the seam.
- End moves: the lift (at least 5 mm), `G28 X Y`, `M84`.
- Firmware: Marlin, RRF and Klipper, including E-mode handling (Marlin's `G90`/`G91` resets it) and cold-extrusion guards.
- Decide whether to block `G28 Z` (or a bare `G28`) in the end and refill templates. Homing Z there drives the nozzle into the pot.

### Out of scope
- Named printer profiles (issue 7) and calibrating check thresholds.

### Where it goes in the code
- `core/printer.js`: `DEFAULT_TEMPLATES`, default values, and `status`.
- `core/gcode.js`: `validateTemplates` (the `G28 Z` rule) and `writeGcode`.
- `test/gcode.test.js` and `test/golden/` for any intended change.

### Acceptance criteria
- [ ] A log per printer: model, firmware, file, what worked, what didn't.
- [ ] Default values are corrected from the results. Golden files are updated in the same commit (`UPDATE_GOLDEN=1`).
- [ ] The `G28 Z` decision is recorded in `ARCHITECTURE.md` and covered by a test.
- [ ] `status` moves from `draft` only for firmware that printed successfully.

### Sources
Design D4, D9, C19, §10; research §3.5 (E modes, start and end code, printers), §7 (V12, V16), §11.1 (D4); `ARCHITECTURE.md` (Status, Printer profile).
```

---

Issues 17–19 were parked in the pattern studio brainstorm (2026-11-25, [`v2-pattern-studio.md`](v2-pattern-studio.md) §12). They build on D35–D51 and only make sense once that work is built.

## 17. Pattern mask: only on raised or sunken parts

**Title:** Pattern mask: apply the Pattern only on the raised or sunken parts of the Detailed morph
**Labels:** `enhancement`, `core`, `ui`

```markdown
### Why
The bitmap Pattern (D35) is added on top of the Detailed morph everywhere in its range (D41). Designers will want texture only inside the raised diamonds, or only in the grooves between flutes. This was parked in the pattern studio session (Q12 c).

### Scope
- A *Mask* setting on the Pattern: *Everywhere* (default), *On raised parts*, *On sunken parts*.
- The Pattern's strength is multiplied by a soft step of the Detailed morph's value at that node (for example smoothstep over −0.2…0.2), so the edge of the mask follows the relief smoothly.
- It updates live (D20), and the bead-support check (D43) sees the masked result.

### Out of scope
- Masks from images or from Morph.

### Where it goes in the code
- `core/toolpath.js`: the Pattern term in the wall evaluation.
- The Pattern step's tools (`ui/dock-tools.js`, the Pattern section).
- The design JSON: `pattern.mask`.

### Acceptance criteria
- [ ] With Diamonds as the Detailed morph and *On raised parts*, the Pattern prints only on the diamonds.
- [ ] *Everywhere* gives exactly today's output.
- [ ] Works on a mid-range Android phone in Chrome (D3).

### Sources
`docs/design/v2-pattern-studio.md` §3.4, §12; D35, D41, D43.
```

## 18. One-off edits on the whole wall

**Title:** One-off Pattern edits on the whole wall (a band, a signature, a single motif)
**Labels:** `enhancement`, `core`, `ui`, `store`

```markdown
### Why
The Pattern is one repeating tile (D46). Sometimes you want something that happens once: your initials near the foot, a single band, one motif on the front. This was parked in the pattern studio session (Q10 c).

### Scope
- An editor view of the whole unrolled wall (every layer by every node in the Pattern's range), with the tile shown underneath.
- Single edits on top of the tile, stored as (layer, node) → in / flat / out.
- A clear rule for what happens to the edits when the height, the layer height, the density or the From / To changes: remap by relative position where it can, and say so when some edits can't stay.

### Out of scope
- Text tools and fonts (a later idea).

### Where it goes in the code
- The 2D editor (built in the pattern studio work), `core/toolpath.js` (the Pattern term), the design JSON (`pattern.overrides`).

### Acceptance criteria
- [ ] A single edited node prints once, at its place, and the tile prints everywhere else.
- [ ] Changing the density keeps the edits at the same place on the pot, or reports the ones it dropped.
- [ ] History holds one entry per editor session.

### Sources
`docs/design/v2-pattern-studio.md` §6, §12; D46, D48.
```

## 19. Image to Pattern

**Title:** Turn an image into a bitmap Pattern
**Labels:** `enhancement`, `ui`, `core`

```markdown
### Why
Image swatches exist for the Detailed morph (mm scale, blurred). For the bead-scale Pattern, an image could give a starting drawing that you then touch up in the editor. This was parked in the pattern studio session (Q21 b).

### Scope
- *From image* in the Pattern carousel and in the editor: pick an image, choose the tile size in cells (up to 64 × 64), and it is reduced to in / flat / out with two thresholds you can drag, previewed live.
- The result is an ordinary `bitmap` drawing, editable and saveable like any other (D48).

### Out of scope
- Dithering options beyond the two thresholds.

### Where it goes in the code
- `core/raster.js` (luminance and downsampling already exist), the 2D editor, `ui/pattern-actions.js`.

### Acceptance criteria
- [ ] A black and white logo becomes a clean in / out drawing at the chosen size.
- [ ] The drawing is stored as a `bitmap` recipe, not as an image asset.

### Sources
`docs/design/v2-pattern-studio.md` §3.8, §12; D45, D48.
```
