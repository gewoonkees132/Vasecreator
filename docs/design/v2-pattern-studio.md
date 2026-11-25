# Vasecreator v2: Pattern and Detailed morph (the pattern studio)

- **Date:** 2026-11-25
- **Status:** Owner decisions D35–D57. D52–D54 settled §13's open questions on 2026-11-25, and D55–D57 the questions slice 3 raised. Slices 1 (the engine, commit `a916a65`), 2 (the Pattern and Shape steps, `1164054`), 3 (the 2D editor, `e357d5b` and `d67d7ff`) and 4 (the warnings card rules) are built on `t3/pattern-studio` (local, not pushed); slices 5–6 are next (§11, notes in §11.1–§11.4).
- **Replaces:** the scope of GitHub issue #3 ("Pattern design: turn Surface into a pattern studio pop-up, with drawing your own pattern"). #3 is still open on GitHub and nothing has been posted about this session.
- **Builds on:**
  - [`v2-design-brainstorm.md`](v2-design-brainstorm.md), "the design". It revises §9.2 and §9.6 and decisions D16, D17, D24, D28 and D29.
  - [`v2-guided-journey.md`](v2-guided-journey.md), "the journey" (D28–D34).
  - [`v2-mobile-stage.md`](v2-mobile-stage.md), "the stage" (M1–M12, the phone dock).
- **Code:** everything lives in `v2/`, and paths below are relative to it.

---

## 0. Handoff brief (read this first)

### The goal, in the owner's words

> I believe there are two types of patterns: one more global, defining the shape, and one the actual pattern of the layer itself, matching the layer lines in a bitmap-like pattern, in/out/in/out. Can we differentiate the two in the slicer, and revamp the pattern generation, so the user can easily define a global pattern and a smaller pattern? It should also be optimal from a UX/UI perspective.

### The target in one paragraph

A v2 pot gets two clearly separate kinds of surface detail:

- **Detailed morph.** This is today's mm-scale relief (flutes, diamonds, scales…, slots A/B with blending). It moves into the **Shape** step, beside Morph, because it shapes the form.
- **Pattern.** This is a new bead-scale **bitmap**, and it owns the **Pattern** step. One row of the bitmap is exactly one printed layer. One cell is exactly one toolpath point (a *node*), set to *in*, *flat* or *out*, with straight lines between nodes, so what you draw is what prints. A density slider sets the spacing between nodes around the pot. The Pattern has its own From / To, two filters (Fade and Soften) and its own printability rule (bead support).

Both kinds are drawn in **one 2D editor**. It never covers the pot, it is simple on phones and fuller on desktop, and it has single-cell painting plus whole-row, whole-column and diagonal operations such as invert. Patterns can be saved apart from designs and applied to any shape. Alongside this, the whole app drops its *Next* buttons and prefers icons for single-task buttons. Warning rules are set right in the warnings card. No backwards compatibility is needed.

### How to start

1. Read this whole document. Then read `v2/ARCHITECTURE.md`, especially "The design document (JSON)", "Engine", "Checks" and "Phase 2 contracts".
2. Create the branch `t3/pattern-studio` from `t3/guided-journey`. When this was written, its head was `1a1150c` ("Make the pot the stage on a phone").
3. Build the slices in §11 in order, and check each one in the browser before starting the next.

### House rules that apply

- **D0:** v2 stays free. There are no accounts, paywalls or gated exports.
- **D3:** everything must work on desktop **and** on a mid-range Android phone in Chrome.
- **D20:** every control updates the pot live while you drag.
- **D7:** no clay, material or "slicer" words in the design view. Bead and layer terms are fine.
- Nothing may cover the pot (D22/D31).
- **`main` deploys to the live site** (Cloudflare Pages), so don't merge into `main`. Every pushed branch gets its own Cloudflare preview.
- Commit messages are plain, with no AI attribution lines.
- **Tests:** `cd v2 && npm test`. 258 tests passed when this was written.
- **Dev server:** `node v2/tools/serve.mjs [port]`, then open `http://localhost:<port>/v2/`. The default port is 8020; other worktrees often take it, so pass another port.

---

## 1. The model in one picture

```
SHAPE step (mm scale, smooth)                       PATTERN step (bead scale, crisp)
┌─────────────────────────────────────────┐        ┌──────────────────────────────────────┐
│ outline: profile, footprint, twist      │        │ Pattern: one bitmap tile             │
│ Morph: large soft map, full height      │        │   rows = layers, cells = nodes       │
│ Detailed morph: relief tiles A/B, blend │        │   in / flat / out × Depth            │
│   (today's "Surface" patterns, renamed) │        │ filters: Fade, Soften                │
└─────────────────────────────────────────┘        │ own From / To                        │
                                                    └──────────────────────────────────────┘
radius at a node = profile + Morph + Detailed morph + Pattern(layer, node) × filters
```

The order of terms is unchanged for what exists today: profile radius, then Morph (form-level, `core/morph.js`), then the relief (`core/surface.js` weights × `core/patterns.js`). The Pattern is a new term added last, per node.

| | Morph | Detailed morph | Pattern |
|---|---|---|---|
| Scale | the whole pot | mm tiles (about 10–50 mm) | one node × one layer |
| Look | soft | smooth relief | crisp pixels |
| Vertical unit | the full height (0–1) | tile height in mm (snaps to layers) | **one row = one layer, always** |
| Around | whole repeats | whole repeats | whole repeats, same nodes on every layer |
| Lives in | Shape | Shape (moved from Pattern) | Pattern |
| Blending | Blend amount | A/B: Even, Fades up, Fades down, Middle | Fade filter + Soften filter |

---

## 2. Decisions

"Owner" means the owner raised it. "Accepted" means I proposed it in the session and the owner picked it. The Q numbers point to the session record in §14. These rows are also added to the design's §3.

| # | Decision | Source |
|---|---|---|
| D35 | **Two kinds of surface detail.** *Detailed morph* is today's mm-scale relief (slots A/B and blending). *Pattern* is a new bead-scale bitmap matched to the layers. Morph stays as it is. | Owner (Q1, Q13) |
| D36 | **Detailed morph moves to Shape, beside Morph. The Pattern step holds only the bitmap Pattern.** On a phone, Morph and Detailed morph share one dock tool with a *Large · Detailed* toggle. Shape now shows Morph and Detailed morph on the pot, and the bitmap Pattern shows from step 2 on (revises D29). | Accepted (Q14, Q16) |
| D37 | **One bitmap row is one printed layer, always. One cell is one node,** a single toolpath point, and the wall runs straight from node to node: in·out·in·out is a zigzag, out·out·in·in a flat-topped wave. Points the engine adds between nodes for other terms lie on that straight line. The rendering and the bead itself do the smoothing. | Owner (Q2, Q5, Q7) |
| D38 | **Cells are in, flat or out.** Flat doubles as the eraser. One *Depth* in mm: out = +depth, in = −depth, with a range of 0 to ½ bead width. | Accepted (Q4, Q11) |
| D39 | **Columns are aligned.** Every layer in the Pattern's range has the same nodes at the same positions around (by angle, as today's patterns map `u`). The tile repeats a whole number of times, so columns line up from layer to layer and there is no seam. | Accepted (Q3) |
| D40 | **Density is one slider: the node spacing around.** It is continuous within ½ to 3 bead widths and snaps so the repeats are whole. It shows either as a **spacing in mm** (at the narrowest point in the Pattern's range) or as **points per layer**. The face you set last stays fixed when the pot changes size. Rows never scale; a tool in the editor doubles rows instead. | Owner (slider, constant point count); accepted (details) (Q2, Q8, Q9) |
| D41 | **The Pattern has its own From / To,** shown as a second bracket on the pot in another colour. There is one Pattern, with no A/B. It starts and stops sharply, with no edge fade. | Accepted (Q12) |
| D42 | **Filters run after the drawing and never change it**, so the drawing always stays in / flat / out. **Fade** (*Even* = off, *Fades up*, *Fades down*, *Middle*, *Diagonal*, plus an amount) runs over the Pattern's From–To. **Soften** is a blur from 0 (crisp, the default) to 2 cells, wrapping across tile edges. Detailed morph's A/B blend uses the same words and gains *Fades down*. | Owner (idea); accepted (set) (Q7, Q17) |
| D43 | **Bead-support rule for the Pattern.** It warns where a node sits more than ½ bead width off the node below, in either direction, with every displacement counted. The Pattern's own layer-to-layer steps are exempt from the 45° overhang rule and from the "two layers per bump" fineness rule. It warns and never blocks (D8). | Accepted (Q11) |
| D44 | **The warnings card is the one place for rules.** Each warning shows its threshold, editable right there: the overhang limit (moved out of *Layers & seam* and its dock tool), bead support (default 50 % of a bead width) and fineness. | Owner (idea); accepted (placement) (Q11, Q18) |
| D45 | **One 2D editor for both kinds.** The Pattern is drawn at node scale and shown crisp. A Detailed morph drawing is a coarse grid (about 4–16 cells a side) of in / flat / out, drawn soft at mm scale. Today's motif layouts (stripes, brick, diagonal, checker) become quick fills, and the 1D motif editor and the `motif` recipe kind go. The analytic library shapes (scales, honeycomb, dots…) stay library-only. | Accepted (Q15) |
| D46 | **The editor edits one tile,** with single-cell painting plus row, column and diagonal operations (Set, Invert). It never covers the pot. On a phone it takes the lower half and the pot stays live above it. On desktop it is a wide panel beside the pot. The grid shows the tile in full colour with its repeats dimmed around it, at the cells' true proportions. Phones get a simple tool set and desktop a fuller one (§6). | Owner (row and column operations, simple on phone); accepted (layout, tools) (Q10, Q19, Q20) |
| D47 | **A starter library of about 8 Patterns:** Knit, Rib 1×1, Rib 2×2, Brick bond, Seed, Herringbone, Basket, Diamond. A tap puts one on the pot at once; *Edit* copies it into the editor. | Accepted (Q21) |
| D48 | **Patterns are saved apart from designs.** *Save pattern* stores the whole setup in My patterns (the drawing, depth, density, Soften and Fade, but not From / To). One tap applies it to any design, presets included. The design keeps its own copy, so it still opens if the pattern is deleted or the file is shared. Detailed morph works the same way. Drawings are stored as a compact `bitmap` recipe kind of up to 64 × 64 cells. | Owner (separate); accepted (details) (Q22, Q24) |
| D49 | **App-wide: the *Next* buttons go** (reverses that part of D28), because the step emblems are how you move on. **Buttons that do one clear task are icons,** with their text as a tooltip on desktop, a long-press label on phones and the accessible name. Controls that hold a value (Depth, Density) keep a text label. | Owner (Q19, Q23) |
| D50 | **No backwards compatibility.** Old design files, saved designs, user recipes and the golden G-code may all change. The design format gets a version bump, with no migration code. | Owner (Q25) |
| D51 | **Issue #3 folds into this work.** It is built on `t3/pattern-studio` (from `t3/guided-journey`) in the six slices of §11. | Accepted (Q6, Q26) |
| D52 | **Presets open with their Detailed morph.** A preset is a shape (D30), and the Detailed morph is part of the shape now (D36), so the Classic vase opens with its flutes. `shapeOnly` strips only the Pattern. | Owner (§13, 2026-11-25) |
| D53 | **Detailed morph grids keep *Sharp, Soft, Round*.** The bitmap's optional `edges` field stays, and the editor offers the three for a Detailed morph grid. A Pattern is always crisp. | Owner (§13, 2026-11-25) |
| D54 | **The Detailed morph's A/B blend gains *Diagonal*:** the same winding band as the Pattern's Fade, with B's share amount × sin²(π(t + u)), one turn over From–To. | Owner (§13, 2026-11-25) |
| D55 | **The editor has no *Cancel*.** *Done* (or Esc) keeps the edits; the design's undo takes a whole session back in one step, and the editor's own undo goes back edit by edit. | Owner (after slice 3, 2026-11-25) |
| D56 | **Cells stay easy to hit.** A Detailed morph grid's cells keep their size on the wall, so adding columns widens the tile and lowers the repeats, which is allowed. On screen a cell is never smaller than a finger or a pointer hits easily (22 px on touch, 16 px with a mouse, on its short side); a tile that then runs past the grid's area moves instead. | Owner (after slice 3); sizes are the builder's |
| D57 | **Pinch to zoom, and a cap that stays clickable.** Two fingers pinch and move the grid (Ctrl+wheel and the wheel on desktop). The editor draws a Pattern up to 24 × 24 cells and a Detailed morph grid up to 16 × 16; the `bitmap` format still holds 64 × 64 (D48), so a larger drawing from a file opens but can't grow. | Owner (after slice 3); the cap of 24 is the builder's |

**What this revises:**
- D16 (swatches from a bitmap generator) is now carried by D45 and D47.
- D17 gains *Fades down* (D42).
- D24 (the pattern editor) is replaced by D45 and D46.
- D28 loses *Next* (D49).
- D29 is revised by D36.
- D30 is narrowed by D52: presets open as shapes with their Detailed morph and without a Pattern.
- Design §9.2 now describes Detailed morph's settings only.
- Design §9.6 stays as it is, with Detailed morph added beside it.

---

## 3. Pattern (the bitmap): how it works

### 3.1 Cells, nodes and layers

- A Pattern is one **tile** of `columns × rows` cells (up to 64 × 64). Each cell is `+1` (out), `0` (flat) or `−1` (in).
- **Rows are layers.** Row *k* of the tile prints on wall layer `(L − L₀ + k) mod rows`, where `L₀` is the first layer in the Pattern's range. In other words the tile starts at *From*, as drawn, and repeats upwards. Whether row 0 sits at the top or the bottom of the drawing is the builder's call; the drawing must read the same way up as the pot.
- **Columns are nodes.** On a layer in the range there are `N = repeats × columns` nodes, evenly spaced by `u` (the same around-the-outline parameter the patterns use today, so the Pattern follows the twist). Node *j* uses column `j mod columns`.
- **Displacement** at a node = `depth × value × fade × (soften applied)`, added radially like today's patterns.
- **Between nodes the Pattern is linear.** If another term (the outline, Morph or Detailed morph) needs more points, the engine puts `k` extra points in each gap, so a layer has `N × (k + 1)` points. The Pattern's value at those points is interpolated in a straight line, so its zigzag is unchanged (D37).

### 3.2 Density (D40)

- **What it sets:** the node spacing around, from **½ to 3 bead widths**. The default is 1 bead width.
- **Snapping:** the spacing is measured on the **narrowest layer in the Pattern's From–To**. `repeats = floor(perimeterMin / (columns × spacing))`, at least 1, and the spacing shown is then recomputed from that whole number.
- **Readout:** for example "96 points per layer · 3.8–6.1 mm". It shows the range from the narrowest to the widest layer.
- **Two faces of one slider:** *Spacing* (mm) or *Points per layer* (a multiple of `columns`). Whichever face you set last is the one stored, and it stays fixed when the pot changes size.
- **The point cap:** `N × (k + 1)` must stay within `MAX_POINTS_PER_LAYER` (1600, `core/toolpath.js`). If it doesn't, cut `k` first; if `N` alone is over the cap, clamp the density and show it in the readout.
- **Rows never scale.** To make a drawing taller, the editor has a *Double rows* tool that repeats every row.

### 3.3 Depth (D38)

- Measured in mm: out = +depth, in = −depth. The range is 0 to ½ bead width. The default is ¼ bead width, so out over in is exactly half a bead.

### 3.4 Where it runs (D41)

- The Pattern has its own `fromMm` / `toMm`, independent of Detailed morph's. By default it covers the same range as the Detailed morph, or 8 mm to 10 mm below the rim when there is none. (Slice 2: over a Detailed morph it keeps inside the relief's soft start and end, §11.2.)
- On the pot, a second bracket (like M7's), in a different colour from Detailed morph's, with a handle at each end. It shows in the Pattern step.
- The Pattern starts and stops **sharply**: the first layer in the range is fully patterned. Bead support (D43) catches any step that's too big.
- Outside the range, points per layer follow today's rule (`pointsAround`).

### 3.5 Filters (D42)

They are applied in this order to the drawn values, and they never change the drawing.

1. **Soften:** a Gaussian blur in cells. σ runs from 0 (crisp, the default) to 2 cells and wraps in both directions of the tile, because the tile repeats. One cell is one node around and one layer up. The result is grey (any value from −1 to 1). `core/raster.js` `blurGrid` already blurs with wrapping and could be reused.
2. **Fade:** a strength from 0 to 1 that multiplies the Pattern. Let *t* run from 0 at *From* to 1 at *To*, and *a* be the amount. It uses the same words as Detailed morph's A/B, with the Pattern as A and "no pattern" as B:
   - *Even*: no fade (strength 1). This is the default.
   - *Fades up*: strength `1 − a·smoothstep(0, 1, t)`. Full at the bottom, fading towards the top.
   - *Fades down*: strength `1 − a·smoothstep(0, 1, 1 − t)`.
   - *Middle*: strength `1 − a·sin²(πt)`. Weakest halfway up.
   - *Diagonal*: a band without pattern that winds round the pot as it climbs. Its exact formula is the builder's call (for example `1 − a·sin²(π(t + u))`, one turn over From–To). The owner accepted the description, not a formula.

### 3.6 The toolpath (where the engine changes)

- **`core/toolpath.js` `pointsAround`:** inside the Pattern's range a layer has exactly `N × (k + 1)` points, the same `N` on every layer. Outside it, today's rule applies.
- **The node positions need a fixed starting point in `u`.** They can't start at the seam, because the seam moves (`seamPositions`), and that would shift the columns. The seam should snap to a node, so the ramp doesn't cut a cell in half. Builder's call.
- **The wall evaluation** (around line 207–223 today: `surfaceWeights` × `evaluate`) gains the Pattern term per point, with the layer index known at every point. Layers are planar with a seam ramp, so the layer index is clear even on the ramp.
- **The "deepest groove" calculations** that place the smooth inner wall (D27) and the hidden seam must include the Pattern's depth.

### 3.7 Printability (D43, D44)

- **New check: bead support.** For each node, compare its radial position with the node at the same position on the layer below. Flag it if they differ by more than `support × beadWidth`, where `support` is 0.5 by default and set in the warnings card. Every displacement counts: profile, Morph, Detailed morph and Pattern. Message: "Bead not supported" (wording is the builder's call), with the usual highlight on the pot.
- **Exemptions:** the 45° overhang check and the V5 fineness check (`core/checks.js`, "a pattern needs at least two layers per bump") run on the wall **without** the Pattern term. They still apply to the outline, Morph and Detailed morph.
- Never blocks; warning only (D8).

### 3.8 Starter library (D47)

About 8 drawings in a new library, separate from the Detailed morph library: **Knit, Rib 1×1, Rib 2×2, Brick bond, Seed, Herringbone, Basket, Diamond.** The builder designs the exact cells. Each one needs default depth and density that pass bead support on the default pot.

- In the Pattern step the carousel (M9) shows these first, at the pot's own bead scale, followed by *None*, My patterns and *Make your own* (an empty editor).
- A tap applies a pattern at once. *Edit* opens the editor on a copy.

### 3.9 Saving and applying (D48)

- ***Save pattern*** (in the editor and in the Pattern step) writes one My patterns entry: the drawing plus depth, density (both the face and its value), Soften and Fade. It does **not** save From / To, because that depends on the pot's height.
- **Applying** a saved pattern to a design sets all of those, and keeps the design's own From / To (or the defaults when the design has no Pattern yet). It works on presets too.
- **The design keeps its own copy** of the drawing in `assets`, so it opens without My patterns, and a shared file carries it.
- Detailed morph gets the same: *Save* stores the drawing plus depth, repeats and tile height.

---

## 4. Detailed morph (today's relief, moved)

- **What it is:** everything that is the *Surface* section today. Slots A and B, depth, repeats around, tile height (snapped to whole layers), From / To, blend (*Even*, *Fades up*, **Fades down** (new), *Middle*, **Diagonal** (new, D54)) and the amount. The 12 library swatches (`library/patterns.json`), *Plain*, *None* for B, image swatches and My patterns all stay, under the new name.
- **Where it lives:** in the Shape step, as a part beside Morph (journey §6.3). On a phone, Morph and Detailed morph share one dock tool with a *Large · Detailed* toggle. That tool's sub-tools are Detailed morph's current tools (A, B, Depth, Repeats, Tile, From, To, Blend, Amount). How they nest in the dock is the builder's call, within M1–M12. Its From / To bracket shows in Shape.
- **The generator rework (D45):**
  - The `motif` recipe kind is removed. Its job moves into the 2D editor as a coarse `bitmap` grid that the engine draws **soft**.
  - The library's *Out·In·Out* entry becomes a coarse bitmap that looks the same.
  - Analytic shapes (`SHAPES` in `core/patterns.js`) stay as library-only recipes.
- **How a coarse grid is drawn soft:** generalise today's motif blending (`motifRow`, `EDGE_WIDTHS`) to two dimensions, so each cell blends into its neighbours across both borders. Today's *Edges* setting (sharp, soft, round) carries over to Detailed morph grids (D53).
- **Maths for the 11 analytic shapes and image swatches:** unchanged. Golden G-code may still change, because D50 allows it.

---

## 5. Names and where things are (D35, D36)

| Today | Becomes | Step |
|---|---|---|
| *Surface* / pattern slots A and B | **Detailed morph** | Shape |
| Geometry morph | **Morph** (unchanged) | Shape |
| (new) | **Pattern** | Pattern (step 2) |

- **The step order is unchanged:** 1 Shape, 2 Pattern, 3 Layers & seam, 4 Base, 5 Print. Pattern stays in step 2 even though the layer height is set in step 3. Rows lock to layers, so changing the layer height later only rescales the drawing in mm and never breaks it. The bead preview shows real layers in every step.
- **Shape shows the pot with Morph and Detailed morph.** The bitmap Pattern appears from step 2 on (revises D29). The Designs screen's `shapeOnly` (`ui/steps.js`, used by `ui/designs.js`) keeps the Detailed morph and strips only the Pattern (D52), so preset tiles show their relief.

---

## 6. The 2D editor (D45, D46)

Detail is deliberately light. The owner asked to settle the principles now and the rest at build time.

**Layout: it never covers the pot.**
- **Phone (≤ 760 px):** the editor takes the lower half, where the dock and sheet sit, and the pot stays live above it, smaller. The step bar can hide while the editor is open.
- **Desktop:** a wide panel beside the pot. It may widen the left panel or float next to it, but it never overlaps the canvas.
- **The grid:**
  - It shows **one tile in full colour, with its repeats dimmed around it**, so you see the pattern as it repeats while you draw.
  - Cells are drawn at their **true proportions**. A Pattern cell is (node spacing) × (layer height), often about 2 : 1 wide. A Detailed morph cell is (tile width ÷ columns) × (tile height ÷ rows).
  - Out, flat and in get three clear tones that work in both themes, following the white, professional look of D21.
- **Live:** every edit updates the pot at once (D20).

**Tools.** Single-task buttons are icons, with tooltip, long-press label and accessible name (D49).

| | Phone | Desktop adds |
|---|---|---|
| Paint | choose *Out*, *Flat* or *In*, then tap or drag cells | keyboard shortcuts for the three states |
| Select | a whole row, a column or a diagonal (both directions) | rectangle select |
| Apply to a selection | *Set* (to the chosen state), *Invert* | |
| Transform | | shift a row or column (rotating it), mirror (left-right, up-down) |
| Tile size | add or remove a row or column, *Double rows* | |
| Quick fills | stripes, brick, diagonal, checker, from the current row | |
| History | undo and redo inside the editor | |
| Save | *Save pattern* (D48), *Done* | |

- ***Invert*** swaps out and in and leaves flat as it is.
- **The selections give the "outside the single node" editing the owner asked for (Q10):** they are global operations on the 2D view, not edits to a wider wall.
- **One history entry per editor session.** The app's history (D14) gets one entry for the whole session, for example "Edited pattern", not one per stroke.
- **The same editor opens from Detailed morph** (on a slot's *Edit*) with a coarse grid and a soft render. Same tools; the soft look is the only difference.

---

## 7. Warnings card: rules you can set (D44)

- Today the warnings chip (`ui/chips.js`) opens a card that lists the warnings, and tapping one highlights it on the pot.
- **The card also becomes the one place to set each warning's rule:**
  - **Overhang limit** (°, today in `ui/sections/layers.js` and the *Overhang* dock tool, both removed).
  - **Bead support** (% of a bead width, default 50).
  - **Fineness** (today fixed: two layers per bump vertically, plus the bead-width check around).
- Each rule sits under its warning. The rule should also be reachable when there is no warning; the builder decides how (for example a *Rules* row at the foot of the card).
- The thresholds are stored in the design, as `overhangLimitDeg` is today.

---

## 8. App-wide UI clean-up (D49)

- **Remove every *Next* button:** the phone header (`step-next--head`) and the desktop foot (`step-next--foot`) in `ui/steps.js`. Moving between steps is done with the step emblems, which already work (journey §7.1).
- **Icon-first:** a button that does one clear task becomes an icon button, for example swap A ⇅ B, undo, redo, close, save, paint states, invert and mirror. Its text becomes the tooltip (desktop), the long-press label (phone) and `aria-label`. A button whose task isn't clear from an icon keeps its text. Controls that hold a value keep text labels.
- Do one sweep across all steps, the sheet, the dock and the top bar.

---

## 9. Data model (D48, D50; no backwards compatibility)

This is a proposal for the builder; the field names can change. Bump `DESIGN_VERSION` (`core/design.js`, 2 today) to 3. Old files and saved designs don't need to open (D50).

```jsonc
{
  "form": {
    "...": "profile, plan, twist as today",
    "morph": null,                       // unchanged
    "detail": {                          // was design.surface
      "fromMm": 10, "toMm": 150,
      "a": { "pattern": "lib:flutes@1", "depthMm": 2, "repeats": 20, "tileHeightMm": 19.5 },
      "b": null,                         // or a slot; "plain" stays a real choice
      "blend": { "shape": "fadesUp", "amount": 1 }   // even | fadesUp | fadesDown | middle
    }
  },
  "pattern": null,                       // or:
  // {
  //   "drawing": "user:3f2a…",          // or "lib:knit@1"
  //   "depthMm": 0.75,
  //   "density": { "by": "spacing", "spacingMm": 3, "points": 96 },   // by: spacing | points
  //   "fromMm": 10, "toMm": 150,
  //   "fade": { "shape": "even", "amount": 1 },  // even | fadesUp | fadesDown | middle | diagonal
  //   "softenCells": 0
  // },
  "layers": { "...": "as today; overhangLimitDeg stays here or moves to a rules object" },
  "rules": { "overhangLimitDeg": 45, "supportRatio": 0.5 },   // builder's call where this sits
  "assets": {
    "user:3f2a…": { "kind": "bitmap", "columns": 8, "rows": 4, "cells": "+-+-…" }   // row-major, '+' '0' '-'
  }
}
```

- **The `bitmap` recipe kind** is shared by Pattern drawings and Detailed morph coarse grids. `cells` is one character per cell (`+`, `0`, `-`), row-major, up to 64 × 64. Ids are content hashes, as for today's user recipes.
- **My patterns** (`store/assets.js`, the IndexedDB `patterns` store) entries become `{ kind: 'pattern' | 'detail', drawing, settings }` (D48).
- **Library:**
  - `library/patterns.json` becomes the Detailed morph library, with *Out·In·Out* rewritten as a coarse bitmap.
  - A new file (for example `library/layer-patterns.json`) holds the starter Patterns.
- **Golden G-code** (`test/golden/*.gcode`): regenerate as needed (D50). None of the four golden designs has a bitmap Pattern, so their files should only change if the Detailed morph refactor changes them, and any change there should be explained.

---

## 10. Where it touches the code

| Area | Files |
|---|---|
| Pattern recipes, bitmap kind, soft 2D grid | `core/patterns.js` (remove `motif`, add `bitmap`) |
| Detailed morph weights, Fades down | `core/surface.js` |
| Points per layer, node alignment, Pattern term, seam on a node, inner wall and seam groove | `core/toolpath.js` (`pointsAround`, `seamPositions`, the wall evaluation, slot resolution) |
| Bead support check, exemptions, editable thresholds | `core/checks.js` |
| Design shape, limits, normalising, version | `core/design.js`, `ARCHITECTURE.md` ("The design document (JSON)", "Phase 2 contracts") |
| Blur for Soften | `core/raster.js` (`blurGrid`) |
| Morph unchanged, but shares a Shape part | `core/morph.js`, `ui/sections/morph.js` |
| Step parts, *Next* removal, `shapeOnly` | `ui/steps.js` |
| Shape step: Detailed morph part | `ui/sections/surface.js` (rename or move), `ui/sections/shape.js` |
| Pattern step | a new section (for example `ui/sections/pattern.js`), `ui/pattern-actions.js`, `ui/swatch.js` |
| The 2D editor | replace `ui/pattern-editor.js` |
| Phone dock: Morph · Detailed toggle, Pattern tools, Overhang tool removed | `ui/dock-tools.js`, `ui/dock.js`, `ui/dial.js` |
| On-pot brackets (two colours) | `render/gizmos.js` |
| Warnings card rules | `ui/chips.js`, `ui/sections/layers.js` (remove the overhang limit) |
| My patterns, saved setups | `store/assets.js`, `ui/designs.js` |
| Image swatches (Detailed morph only) | `ui/image-swatch.js` |
| Libraries | `library/patterns.json`, a new starter Pattern library |
| Tests | `test/patterns.test.js`, `test/toolpath.test.js`, `test/checks.test.js`, `test/design.test.js`, `test/stage.test.js`, `test/phase2.test.js`, `test/golden/*` |

---

## 11. Build order

These go on the branch `t3/pattern-studio`, cut from `t3/guided-journey`. Each slice ends with the tests passing and a browser check at desktop size (1280 × 800) and phone size (360 × 660, touch). Push only when the owner asks; every pushed branch gets its own Cloudflare preview.

1. **Engine.**
   - Build: the `bitmap` kind; the Pattern term (nodes, rows = layers, density with both faces, depth, its own From / To, Fade, Soften); points per layer inside the range; the seam on a node; the bead-support check and the exemptions; Detailed morph renamed and moved in the data (`form.detail`), with *Fades down*; the `motif` kind removed.
   - Accept when: tests show a drawn tile prints node for node (a 2-column in/out tile gives an exact zigzag at ±depth); columns line up on a tapered pot; the point count is the same on every layer in the range; support warnings fire at 0.5 bead and not below.
   - **Built** in `a916a65` (§11.1).
2. **Pattern step and Shape step.**
   - Build: the starter library and the Pattern carousel; the Density, Depth, Fade, Soften, From and To tools (dock and sheet); the second bracket; Detailed morph as a Shape part, with the *Large · Detailed* toggle on phones; `shapeOnly` strips only the Pattern, so presets open with their relief (D52); *Diagonal* for the A/B blend (D54: the blend weight now depends on u as well as z, so `detailWeights` in `core/surface.js` and the z-keyed weight cache in `core/toolpath.js` change).
   - Accept when: one tap puts *Knit* on the pot; the density readout shows points per layer and the mm range; changing the layer height keeps the drawing row for row.
   - **Built** (§11.2).
3. **The 2D editor.**
   - Build: the phone and desktop tool sets in §6, live on the pot, also opened from Detailed morph with a coarse grid, a soft render and *Sharp, Soft, Round* (D53).
   - Accept when: on a phone the pot stays visible and live while drawing; inverting a column or a diagonal works across the dimmed repeats; one history entry per session.
   - **Built** (§11.3).
4. **The warnings card rules.**
   - Build: overhang limit, bead support and fineness, editable in the card; the overhang limit removed from *Layers & seam* and the dock.
   - **Built** (§11.4).
5. **The *Next* and icon-first sweep** (§8).
6. **Saved patterns** (§3.9, D48).
   - Build: *Save pattern* for Pattern and Detailed morph; apply to any design, presets included; the design keeps its own copy.

When all six slices are built, update `ARCHITECTURE.md` (Status and contracts) and the design's §9.2 and §9.6.

### 11.1 Slice 1 as built (notes for the next slices)

- **Data:** version 3. The Detailed morph is `form.detail`, the Pattern is `pattern` (null when off) and the thresholds are `rules: { overhangLimitDeg, supportRatio }`. The contracts are already in `v2/ARCHITECTURE.md`: "The design document (JSON)", "Engine" (`PreviewResult.pattern`, the density readout) and "Checks" (`support`, ISSUE bit 16).
- **`core/layer-pattern.js`** holds the Pattern. It exports `createLayerPattern`, `nodesAround`, `fadeAt`, `defaultPatternRange`, `findDrawing`, `newPattern` (the settings a new Pattern starts with) and the limits. Its `lib:` drawings resolve from `library.layerPatterns`, which nothing loads yet. Slice 2 adds the starter file (for example `library/layer-patterns.json`), loads it in `main.js` beside `patterns.json`, and passes it to the worker inside `library`.
- **Builder's calls made:**
  - Rows are stored bottom row first.
  - A layer is in the range when its middle, (i + ½)·h, lies in From–To.
  - The nodes start at u = 0.
  - The seam rounds to the nearest node, and a hidden seam moves in whole nodes, at most a bead width a layer.
  - *Diagonal* is 1 − a·sin²(π(t + u)).
  - The warning reads "Bead not supported" plus the heights.
- **Checks:** at a Pattern node, the bead-scale curve check (V6) measures to the nodes either side (`tp.nodes`). Otherwise the extra points between nodes would turn every node into a corner.
- **Library:** *Out·In·Out* is a 6 × 4 bitmap with round edges. The direct copy with soft edges failed the printability tests.
- **UI, only renamed so far:**
  - `ui/sections/surface.js` still sits in the Pattern step and edits `form.detail`.
  - The overhang limit is still in *Layers & seam* (slice 4 moves it).
  - `ui/pattern-editor.js` is a stopgap that writes bitmaps through the quick fills (`fillBitmap`). Slice 3 replaces it.
  - `mineEntries` lists every own recipe, so a Pattern drawing in the design's assets shows among the Detailed morph's *My patterns*. Slice 2 must keep the two apart.
- **Finding for the starter library:** where a cell flips straight from in to out between layers, the default depth of ¼ bead puts out over in at exactly half a bead, the support limit. Any lean in the profile then warns: a knit at ¼ bead on the Classic vase warns from 14 to 150 mm. The defaults must pass bead support on the default pot (§3.8), so use less depth, or drawings without direct in↔out flips between rows.
- **Browser check used:** headless Chrome over CDP, from a scratch script. It loads `/v2/` at 1280 × 800, then at 360 × 660 with touch emulation. It applies a Pattern through `window.vc2.store.apply`, reads `vc2.store.state.result` and the console, and takes screenshots. Port 8041 was free.

### 11.2 Slice 2 as built (notes for the next slices)

- **The starter library** is `library/layer-patterns.json`, which `main.js` loads into `library.layerPatterns` beside `patterns.json`, so the worker gets it too. Each entry is `{ id, name, description, recipe (a bitmap, rows bottom first), defaults: { depthBeads, spacingBeads } }`. All eight are spaced one bead apart.

  | Pattern | Tile | Depth | Drawing |
  |---|---|---|---|
  | Knit | 4 × 4 | 0.14 bead | Columns of V shapes two layers tall, with an in groove between them |
  | Rib 1×1 | 2 × 1 | 0.2 bead | Out, in |
  | Rib 2×2 | 4 × 1 | 0.2 bead | Out, out, in, in |
  | Brick bond | 6 × 8 | 0.14 bead | Raised bricks 5 points by 3 layers, flat joints, each course offset by half a brick |
  | Seed | 2 × 2 | 0.14 bead | Out dots in a checker on flat |
  | Herringbone | 8 × 8 | 0.14 bead | Diagonals of out, flat, in, flat, one point along per two layers, the two halves mirrored |
  | Basket | 6 × 12 | 0.14 bead | Blocks of 3 × 6 cells, upright and level out strands, in a checker |
  | Diamond | 6 × 12 | 0.14 bead | Out diamond outlines with in centres, flat between |

- **Why these depths.** No starter cell flips straight from out to in between rows, so each layer steps at most one depth off the layer below.
  - **Classic vase:** with its flutes (D52), the profile leans up to 0.88 mm a layer in the neck. That leaves 0.62 mm of the 1.5 mm support limit, so 0.2 bead (0.6 mm) is the most a drawing with steps can take there.
  - **Square planter:** its basket relief leaves less room. 0.14 bead (0.42 mm) passes on all three presets, so one tap never warns on a preset.
  - **Ribs:** they don't step between rows, so they take 0.2 bead.
  - **In the browser:** at 0.42 mm the texture reads clearly near the neck and more softly on the belly, where the nodes are 6.5 mm apart. 0.6 mm reads better on the Classic vase but warns on the Square planter.
  - `test/starters.test.js` checks every starter on every preset.
- **The default range (a refinement of §3.4).** Over a Detailed morph, a new Pattern runs inside the relief's soft start and end (`softEdgeMm`). On the Classic vase that is 16–144 mm instead of 10–150 mm. Without this, no starter could pass bead support on the default pot: the flutes' soft start (10–16 mm) grows 0.67 mm on the very layer where the Pattern starts sharply. A range too short for the inset keeps the Detailed morph's own.
- **One tap.** A tap on a starter is one history step, "Pattern: Knit". A first Pattern starts from `newPattern`. Switching drawings keeps From / To, Fade and Soften, and a starter brings its own depth and density. Tapping the drawing already on the pot does nothing, and *None* takes the Pattern off. All of this is in `ui/pattern-actions.js` (`setLayerPattern`, `pickLayerPattern`).
- **Density.**
  - The readout reads "60 points per layer · 3.2–6.5 mm". Points are nodes; the toolpath adds its extra points between them on top.
  - `patternReadout` (`core/layer-pattern.js`) works it out without the toolpath, for the controls, which also need it in Shape and before a preview arrives. A test keeps it equal to the preview's.
  - The dial and its chip show the value as set: the Spacing face in mm, or the Points face as a count in whole tiles. The note shows what prints.
  - Switching faces keeps the pot (`setDensityFace`).
- **Diagonal (D54).** `detailWeights(detail, z, h, u)` takes u. Per height, the toolpath's weight cache now holds the most each slot can reach (A the soft edges, B those times the amount). `detailAt` splits that per point. The golden G-code is unchanged.
- **UI as built:**
  - **Shape:** `ui/sections/detail.js` (was `surface.js`) is one part, *Detailed morph*, after Morph. On desktop it sits behind *More shape options*. Its bracket is dark and sits on the screen-left side of the pot, clear of the profile handles.
  - **The phone dock:** Morph is a group tool. Picking it opens a row with a fixed back button (an icon), a *Large · Detailed* toggle and that side's tools. *Next* hides while the row is open, since the back button and toggle need its room at 360 px; slice 5 removes *Next* anyway. Large shows the Morph's sheet hint as before.
  - **The Pattern step:** `ui/sections/pattern.js` has the parts Pattern, Depth, Density, From / to, Fade and Soften. The dock has the same tools, and the Density dial has an *mm · pts* toggle. The Pattern's bracket is blue and sits on the screen-right side.
  - **Swatches:** a Pattern swatch is drawn crisp in three tones at the pot's bead scale: a square of wall 8 bead widths wide, one cell per node spacing by one layer. The drawing on the pot shows at its own spacing, the others at their defaults.
  - **Controls:** segmented controls with five options (Blend, Fade) wrap onto two rows.
- **Left for later slices:**
  - *Make your own* and *Edit* in the carousel wait for the 2D editor (slice 3).
  - The Pattern's *My patterns* lists only a drawing the design carries, until *Save pattern* (slice 6).
  - The stopgap editor still opens from the Detailed morph's *Edit swatch…*. (Slice 3 replaced it, §11.3.)
- **Browser check:** as in §11.1, on port 8041, with scratch scripts.
  - **Desktop, 1280 × 800:**
    - A first visit opens the Classic vase with its flutes and the dark bracket.
    - In Pattern, one tap on Knit gives "Pattern: Knit" at 0.42 mm over 16–144 mm, the readout, the blue bracket and no warnings.
    - All eight starters are free of warnings on the default pot, and a 1.2 mm layer keeps the drawing row for row.
    - Designs shows the presets with their relief.
  - **Phone, 360 × 660 with touch:**
    - The Morph row opens and closes, and Blend → Diagonal applies.
    - A tap on Knit in the carousel puts it on the pot, and the Density dial works in both faces, in whole tiles.
    - The five Fade options fit, and the sheet shows the parts of Shape and Pattern.
    - The pot's region ends above the dock, and the handles stay inside it.
  - **Headless flick:** in headless Chrome the dial's flick can run on for seconds after a scripted drag, so values keep changing after the drag. That is the flick, not a bug.

### 11.3 Slice 3 as built (notes for the next slices)

- **Where it lives.** `ui/pattern-editor.js` is the 2D editor and replaces the stopgap. Its grid operations are pure functions in `core/bitmap.js`. `ui/pattern-actions.js` says what a session starts from and how its drawing goes into the design (`editorStart`, `writeEditorDrawing`, `editableEntry`, `detailTileFor`). `ui/press-label.js` shows an icon button's name on a long press. `styles/editor.css` lays it out, and `index.html` has an `aside#editor` for it. The contracts are in `v2/ARCHITECTURE.md` ("UI contracts", "Store").
- **Layout (D46).** While it is open, the editor stands in for the step frame: `<html>` gets `is-editing`, which hides the panel, and `main.js` fits the pot into what is left.
  - **Desktop:** a panel in the left column, up to 560 px wide. At 1280 × 800 the pot keeps a region 540 px wide beside it.
  - **Phone:** the lower part of the screen (clamp(300px, 54dvh, 460px)). The dock, the sheet and the step bar give way. At 360 × 660 the editor takes 356 px and the pot keeps 224 px above it, live.
  - The drag points, the brackets and the seam grip hide while the editor is open, so nothing else can land in history meanwhile.
- **The grid.** One canvas.
  - The tile is in full colour in the middle, and its repeats are dimmed round it towards a mid grey, so out, flat and in keep their order there too.
  - Cells are at their true proportions (§6), and never larger than 80 × 56 px, so a small tile shows more repeats.
  - **Cells stay easy to hit (D56).** The short side of a cell is never under 22 px on a touch screen or 16 px with a mouse (`MIN_CELL`). A tile larger than the grid's area at that size runs past it, and you move it. On the Classic vase a Pattern cell is then about 48 × 23 px on a phone.
  - **Zoom and move (D57).** Two fingers pinch and move the grid. A finger that had already drawn when the second one lands is taken back, with nothing left in the undo stack. On desktop Ctrl+wheel (and a trackpad's pinch) zooms about the pointer, the wheel and the middle button move it, + and − zoom, and 0 resets. The zoom runs from the whole tile in view to 4× the clickable size. A reset button shows in the grid's corner once you have zoomed or moved. The arrow keys move the grid to keep the current cell in view.
  - Before the first edit the grid already uses the node spacing the design will have with the new drawing, so it doesn't change scale on the first stroke.
  - The Pattern is crisp, with darker lines between rows (the layers). A Detailed morph grid is drawn soft as it prints (`evaluatePattern`), with faint cell lines.
  - Cells big enough carry a + or − mark, so the states never rest on tone alone.
  - A tap, a stroke or a selection in a dimmed repeat is the tile's own cell.
- **Tools as built** (single-task buttons are icons with a tooltip, a long-press label and an accessible name, D49):

  | Group | Phone (tabs Draw, Select, Tile, Fill; Edges for a Detailed morph) | Desktop adds |
  |---|---|---|
  | Draw | *Out*, *Flat*, *In*; tap or drag on the grid | keys 1, 2, 3 |
  | Select | *Row*, *Column*, *Diagonal ↗*, *Diagonal ↘*; a tap picks the line through a cell | *Paint* and *Rectangle* as tools; keys P, R, C; arrow keys move the current cell, Space draws or selects, Shift+arrows grow a rectangle |
  | Selection | *Set* (to the state you draw with; its corner shows it), *Invert* | keys S, I; Esc lets go of the selection, then closes |
  | Move | | shift a selected row ← →, a selected column ↑ ↓, otherwise the whole tile; mirror left to right, top to bottom |
  | Tile | add a copy of the current row or column, remove it, *Double rows* | |
  | Fill | *Stripes*, *Brick*, *Diagonal*, *Checker* from the current row | |
  | Edges | *Sharp*, *Soft*, *Round* (Detailed morph only, D53) | |
  | Done | ✓ in the header | Esc |

- **History.**
  - Every edit is live: `store.change` in the `'editor'` group, with strokes sent once a frame. *Done* commits once, as "Edited pattern" or "Edited Detailed morph A".
  - The editor keeps its own undo stack. While it is open, the top bar's undo and redo and Ctrl/Cmd+Z step through it (`ctx.editorHistory`), and the design's history doesn't move.
  - A drawing back where it started puts the design back as it was, so opening and closing the editor, or undoing every edit, adds no step.
  - **Store change:** `store.change` and `apply` take a `group`. A change of another group first commits the open gesture, and `open` keeps an editor session as its own step. Existing callers pass no group, so their behaviour is unchanged. If something else replaces the drawing during a session (a restore, opening a design), the editor closes; any other change (the size card) splits the session into two steps instead of mixing them.
- **Builder's calls made:**
  - *Make your own* opens an empty grid: 6 × 6 for a Pattern, so it fits a 360 px phone whole at the clickable size (it was 8 × 8 before D56), and 6 × 4 with soft edges for a Detailed morph. The pot doesn't change until the first edit.
  - *Edit* opens a library drawing as a copy named "Knit (mine)" under a new `user:` id, and your own drawing in place. A drawing that two places use (slots A and B) is copied instead.
  - A first Pattern made in the editor is 0.14 bead deep and one bead apart (`OWN_PATTERN_DEFAULTS`), like the starters, so a first drawing doesn't warn on the presets. Over an existing Pattern, depth, density, range, Fade and Soften are kept.
  - **A Detailed morph grid's cells keep their size when the tile grows (D56).** One row more is one cell height more (in whole layers). One column more takes the wall of one more cell, so fewer repeats fit around (20 repeats at 6 columns become 15 at 8). A slot with a texture starts from its own repeats, tile height and depth; a flat or empty one from 8 repeats, 20 mm and 1.5 mm. Grids go up to 16 cells a side (D45's "about 4–16"); a Pattern up to 24 (D57). Every starter fits, and the 12-row ones still double.
  - With nothing selected, *Set* and *Invert* act on the whole tile. Picking a line tool selects the line through the current cell at once, and picking it again lets go.
  - A diagonal runs on through the repeats, so in the tile it covers lcm(columns, rows) cells: every cell when the sides share no factor, every other cell on a 6 × 4 tile. This is what makes it unbroken across the dimmed repeats.
  - Rows count from the bottom, so row 1 is the first layer printed, and columns count from the left.
  - There is no *Cancel* (D55). The design's undo takes a whole session back in one step, and the editor's own undo goes back edit by edit.
  - There is no name field yet. Your own drawings are "My pattern", "My swatch" or "… (mine)"; naming comes with *Save pattern* (slice 6).
  - In the Detailed morph's grid (sheet and dock), *Edit swatch…* became two tiles beside *+ Image*: *Make* and *Edit*. The Pattern's carousel and grid end with the same two tiles after *None* and My patterns (§3.8). *Edit* shows only when the target holds a bitmap (`editableEntry`): analytic shapes, images and Plain stay library-only (D45).
  - `setLayerPattern` now drops a drawing of your own that it replaces when nothing else draws with it. Before this, a Pattern drawing you switched away from stayed in `assets` and showed among the Detailed morph's own swatches, which mixed the two.
- **Tests:** `test/bitmap.test.js` (the operations, including a column and a diagonal picked in a repeat), `test/editor.test.js` (the geometry, the clickable size, zoom, pinch and pan, the cap, and what a session starts from and writes, on the presets), and two store tests for the groups. That makes 334 in all.
- **Browser check:** as in §11.1, on port 8041, with scratch scripts.
  - **Desktop, 1280 × 800:**
    - *Make* opens an empty 8 × 8 grid, and a mouse stroke goes live on the pot (0.42 mm, no warnings).
    - A column picked in the repeat to the left takes Set and Invert. A ↗ diagonal inverts its 8 wrapped cells.
    - Ctrl+Z and the top bar's undo step the editor. *Double rows* gives 8 × 16 and the readout follows.
    - *Done* adds one "Edited pattern", and the design's undo takes it all back.
    - An edit undone before *Done* adds no step. *Edit* on Knit makes "Knit (mine)" and keeps 0.42 mm.
    - From Shape, the Detailed morph's *Make* draws soft. *Brick* and *Round* go live, and *Done* adds "Edited Detailed morph A".
  - **Phone, 360 × 660 with touch:**
    - *Make* in the dock's carousel opens the editor in the lower 356 px with the pot live above it, and a finger stroke repaints the pot.
    - A column picked in the repeat below and a ↘ diagonal picked in the repeat above invert the tile's cells.
    - A long press shows "Invert the ↘ diagonal" and doesn't invert. *Double rows*, *Checker* and the top bar's undo work.
    - *Done* gives one step and brings the dock back. The Detailed morph opens from the Morph tool's carousel, with an Edges tab.
  - **After D55–D57:**
    - **Phone:** an empty Pattern opens whole at 48 × 23 px cells, and keeps that scale after the first stroke. A pinch zooms 3×, and a finger that had drawn before the pinch is taken back. After zooming, a tap still draws the cell under it, and the reset button brings back the starting view. At 24 × 24 the buttons that would grow the tile are off, and two fingers move the grid.
    - **Desktop:** Ctrl+wheel zooms 2× with the same cell under the pointer, the wheel moves the grid, and 0 resets. A 24 × 24 tile has cells 42 × 16 px, and the arrow keys bring column 24 into view.
- **Left for later:**
  - *Save pattern* and names (slice 6).
  - The *Next* and icon sweep (slice 5) can reuse `ui/press-label.js`.

### 11.4 Slice 4 as built (notes for the next slices)

- **Data.** `design.rules` is `{ overhangLimitDeg: 45, supportRatio: 0.5, curveRatio: 0.5, layersPerBump: 2 }`.
  - The two new fields make fineness settable. `curveRatio` is the radius of the tightest curve, as a fraction of a bead width (V6, 0.1–1.5). `layersPerBump` is how many layers a Detailed morph bump needs at least (V5, whole, 1–6).
  - `normaliseDesign` fills and clamps all four, and `core/checks.js` reads both new ones. The cap of 1600 points a layer stays a hard limit of the engine, not a rule.
  - There is no migration (D50). The golden G-code changed only in the design line of its header.
  - The contracts are in `v2/ARCHITECTURE.md`: "The design document (JSON)", "Checks" and "UI contracts" (the warnings card).
- **Where it lives.** `ui/rules.js` has no DOM and holds the rules, how each one shows (degrees, or a percentage of a bead width) and where each one goes in the card (`cardLayout`). `ui/chips.js` builds the card.
- **The card as built.**
  - The chip always opens the card, also with no warnings. Its name then reads "No warnings, show the rules".
  - Each rule's fields sit right under its warning, with the rules first (Overhang, Bead support, Fineness) and then the other warnings. That is the order the checks already gave.
  - The rules without a warning wait in a *Rules* group at the foot, called *Other rules* while some rule is above it. It is open when the card opens with no warnings, and otherwise as you last left it.
  - **Fields:** *Overhang limit* (°), *Bead support* (% of a bead width), *Tightest curve* (% of a bead width, its radius) and *Layers per bump*. They are the app's number fields: drag sideways, type, use the arrow keys, or − and + on a touch screen.
  - **History:** each gesture is one step, named after the field: a drag, a held stepper, a typed value, one arrow key or one tap, as with every number field.
  - **Live (D20):** touching a rule colours its warning's beads, so the flagged beads come and go on the pot as the threshold moves.
  - **Nothing moves under a finger.** A rule you touch stays where it is until the card closes. If the edit fixes its warning, the line turns into a passing line with a green dot ("Nothing leans past the limit"). If an edit in the Rules group brings a warning up, the warning shows on the rule's own line there, and "No warnings" goes.
  - The card no longer closes itself when the last warning goes, so the rules stay in reach.
  - **In Print** the fields are read-only, with "Rules change in the design steps, not in Print." (C31, as the size card).
- **Removed:** the *Overhang* part and field of *Layers & seam*, which now has the parts Seam and Bead, and the *Overhang* dock tool. A test checks that no dock tool and no step part sets a rule.
- **Builder's calls made:**
  - **Fineness is two rules, not one.** The two checks measure different things in different units: a curve around the pot in bead widths, and bumps up the wall in layers. They share one warning, so both fields sit under it.
  - Ratios of a bead width show as percentages, as the bead support default of 50 % reads in D44.
  - The limits: bead support 10–100 % (as before), the tightest curve 10–150 %, layers per bump 1–6.
  - The wording of the passing lines: "Nothing leans past the limit", "Every bead sits on the one below", "Nothing finer than the bead can print". The info lines under the fields say what a percentage is of.
  - **Desktop placement.** With its rules the card is up to about 520 px tall, and hanging under the chip it covered half the pot (D22). So on desktop it (and the size card, which shares its frame) now opens below the chips at the window's right edge, over the history column. At 1280 × 800 it clears the Classic vase (the pot spans x 577–889, the card 964–1264). In a narrower desktop window it can still reach the pot's right side. The phone layout is unchanged: the card opens over the dock or sheet (`--bottom-chrome`) and scrolls. The owner kept this placement for now (2026-11-25).
- **Tests:** `test/rules.test.js` covers the fields against `design.rules`, the percentages and limits, writing a value back, the layout and the pinning, that no dock tool or part sets a rule, and a card edit changing the warning. There are also a design test for the rules' defaults and limits and two checks tests for the new rules. That makes 344 in all.
- **Browser check:** as in §11.1, on port 8041, with scratch scripts.
  - **Desktop, 1280 × 800:**
    - With no warnings the chip opens the card with the three rules.
    - Dragging *Overhang limit* from 45° to 20° adds one step, "Overhang limit". The warning shows on the rule's own line, the beads turn amber, and "No warnings" goes.
    - Reopened, the rule sits under its warning, with *Other rules* closed below. A typed value and each arrow key make one step each, and Ctrl+Z undoes them.
    - On a Detailed morph of dots 5 mm tall, the fineness warning carries both fields, and *Layers per bump* at 1 fixes it, leaving a passing line.
    - Bead support at 20 % on Knit brings up "Bead not supported" in the Rules group, with the beads coloured.
    - *Layers & seam* has no overhang field. In Print the fields are read-only with the note.
  - **Phone, 360 × 660 with touch:**
    - ✓ in the top bar opens the card over the dock (it starts at y 392; the pot's region ends at 384).
    - Holding − on *Overhang limit* takes it from 45° to 34° in one step, with the warning and its beads showing.
    - Tapping the warning closes the card with the beads still coloured, and the chip stops that, as before.
    - Tapping + until the warning goes leaves the passing line.
    - The Layers dock has Seam, Angle, Ramp, Bead and Layer, and the sheet has no Overhang part.
    - On Knit, − on *Bead support* down to 10 % brings up the warning in the Rules group, the pot above it amber.
- **Left for later:**
  - Esc closes the card only when the focus is inside it, as before.
  - The card's × is as it was. The *Rules* disclosure keeps its text, because it shows and hides a group rather than doing one task (D49). Slice 5's icon sweep can revisit both.

---

## 12. Later (parked; drafted in [`v2-later-issues.md`](v2-later-issues.md), issues 17–19)

- **17. Pattern mask:** apply the Pattern *everywhere*, *only on raised parts* or *only on sunken parts* of the Detailed morph (Q12).
- **18. One-off edits on the whole wall:** a layer of single edits over the repeating tile, such as a band, a signature or a single motif (Q10 c).
- **19. Image to Pattern:** turn an uploaded image into an in / flat / out drawing at node scale (Q21 b).

---

## 13. Open for the owner, and left to the builder

**Settled by the owner (2026-11-25):** presets keep their relief (D52), coarse grids keep *Sharp, Soft, Round* (D53), and the A/B blend gains *Diagonal* (D54). After slice 3: no *Cancel* in the editor (D55), cells that stay easy to hit (D56), and pinch to zoom with a clickable cap (D57). After slice 4: the warnings and size cards keep opening over the history column on desktop, for now (§11.4). Nothing is open for the owner now.

**Left to the builder:**
- the exact *Diagonal* fade formula (slice 1: 1 − a·sin²(π(t + u)))
- where the node positions start in `u`, and how the seam snaps to a node (slice 1: from u = 0, to the nearest node)
- which way up the rows are stored (slice 1: bottom row first)
- the cells of the eight starter Patterns and their defaults (slice 2: §11.2)
- the default density and depth (see §3.2–§3.3; slice 2: one bead apart, 0.14 bead deep, 0.2 for the ribs)
- the default range over a Detailed morph (slice 2: inside its soft start and end, §11.2)
- how the Morph and Detailed morph nest in the phone dock (slice 2: a group tool with a *Large · Detailed* toggle, §11.2)
- the editor's exact layout and icons, within §6 (slice 3: §11.3)
- where `rules` sits in the design JSON (slice 1: top level, `design.rules`)
- how fineness becomes settable (slice 4: two rules under the one warning, the tightest curve and layers per bump, §11.4)
- how the rules are reached with no warning (slice 4: a *Rules* group at the foot of the card, §11.4)
- the warning text for bead support (slice 1: "Bead not supported" plus the heights)

---

## 14. Session record (the grilling, 2026-11-25)

Rounds 1–4. "Rec" is the recommendation given in the session.

| Q | Question | Owner's answer |
|---|---|---|
| Q1 | What is the "global" pattern? | (a): global = today's A/B relief; the layer pattern is new; Morph stays in Shape |
| Q2 | Do rows lock to layers? | Yes, always. "Pattern density should be a slider that scales this in an acceptable range." Wants a 2D view to edit single nodes, rows and diagonals; simpler on phone, more on desktop |
| Q3 | Columns around: angle-locked or length-locked? | (a) angle-locked, "but also an option to have a constant point number; integrate both" (→ Q9) |
| Q4 | Cell values? | (b) in / flat / out |
| Q5 | Changes along a layer? | "The polyline should be crisp, containing a single point; the rendering and the clay printing will smooth this out." |
| Q6 | Fold issue #3 in? | Yes |
| Q7 | Cell = node, straight lines between? | Yes. Also: filters afterwards, like Morph, e.g. no pattern from bottom to top, top to bottom, or diagonally, plus a blur; the default is always one of the 3 states (→ Q17) |
| Q8 | What does density scale? | (a) node spacing around only |
| Q9 | "Integrate both" meaning | (a) one aligned mode, set as mm spacing or as points per layer |
| Q10 | "Outside the original bitmap" | Not a wider wall: the bitmap is the same tile, with row and column operations (invert row, invert column) as global edits in the 2D view. It must look good on phones and show the pattern while editing |
| Q11 | Printability rule | (a) its own bead-support rule; warning rules must be settable when you press the warning (→ Q18) |
| Q12 | Combining with the large pattern | (b) its own From / To |
| Q13 | Names | The bitmap stays "Pattern"; the large relief becomes "Detailed morph" (→ Q16) |
| Q14 | Where in the journey | (a) in step 2 |
| Q15 | Rework of the large pattern's generator | (a) one 2D editor for both |
| Q16 | Names and places confirmed | (a) Detailed morph moves to Shape beside Morph |
| Q17 | Filters | (a) Fade (incl. Diagonal as described) and Soften |
| Q18 | Rules in the warnings card | (a) the one place, in this build |
| Q19 | Editor layout | No option named; (a), never covering the pot, taken as agreed and confirmed through Q23. Note: drop "useless" buttons like *Next*; icons are preferred when they clearly describe a task (→ Q23) |
| Q20 | First tool set | Yes |
| Q21 | Starting points | (a) a starter library of about 8 |
| Q22 | Storage | "In the future patterns should be saved separately from designs, so you can apply a pattern to a shape design" (→ Q24) |
| Q23 | Scope of the UI note | (a) app-wide |
| Q24 | Saved patterns apart from designs | (a) in this build, whole setup, design keeps a copy |
| Q25 | Existing designs and output | No backwards compatibility is required |
| Q26 | Build order and branch | Agreed |
| Q27 | Writing it down | Write everything down cleanly, with the goal on top, for a clean session (this document). Posting the GitHub issue was not asked for, so nothing was posted |
