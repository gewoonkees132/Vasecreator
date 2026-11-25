# Vasecreator v2: Pattern and Detailed morph (the pattern studio)

- **Date:** 2026-11-25
- **Status:** Owner decisions D35–D54. D52–D54 settled §13's open questions on 2026-11-25. Slice 1 (the engine) is built on `t3/pattern-studio` (commit `a916a65`, local, not pushed); slices 2–6 are next (§11, notes in §11.1).
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

- The Pattern has its own `fromMm` / `toMm`, independent of Detailed morph's. By default it covers the same range as the Detailed morph, or 8 mm to 10 mm below the rim when there is none.
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
3. **The 2D editor.**
   - Build: the phone and desktop tool sets in §6, live on the pot, also opened from Detailed morph with a coarse grid, a soft render and *Sharp, Soft, Round* (D53).
   - Accept when: on a phone the pot stays visible and live while drawing; inverting a column or a diagonal works across the dimmed repeats; one history entry per session.
4. **The warnings card rules.**
   - Build: overhang limit, bead support and fineness, editable in the card; the overhang limit removed from *Layers & seam* and the dock.
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

---

## 12. Later (parked; drafted in [`v2-later-issues.md`](v2-later-issues.md), issues 17–19)

- **17. Pattern mask:** apply the Pattern *everywhere*, *only on raised parts* or *only on sunken parts* of the Detailed morph (Q12).
- **18. One-off edits on the whole wall:** a layer of single edits over the repeating tile, such as a band, a signature or a single motif (Q10 c).
- **19. Image to Pattern:** turn an uploaded image into an in / flat / out drawing at node scale (Q21 b).

---

## 13. Open for the owner, and left to the builder

**Settled by the owner (2026-11-25):** presets keep their relief (D52), coarse grids keep *Sharp, Soft, Round* (D53), and the A/B blend gains *Diagonal* (D54). Nothing is open for the owner now.

**Left to the builder:**
- the exact *Diagonal* fade formula (slice 1: 1 − a·sin²(π(t + u)))
- where the node positions start in `u`, and how the seam snaps to a node (slice 1: from u = 0, to the nearest node)
- which way up the rows are stored (slice 1: bottom row first)
- the cells of the eight starter Patterns and their defaults
- the default density and depth (see §3.2–§3.3)
- the editor's exact layout and icons, within §6
- where `rules` sits in the design JSON (slice 1: top level, `design.rules`)
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
