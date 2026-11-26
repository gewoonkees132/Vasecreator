# Vasecreator v2: recreating two vases (Facets and Slant)

- **Date:** 2026-11-26
- **Status:** Owner decisions D69–D72 (2026-11-26, after the first round of renders). Being built on `t3/recreate-vases` (§6). The preview's light and bead shape went to a separate agent at the owner's request (§5.4).
- **Builds on:** [`v2-pattern-studio.md`](v2-pattern-studio.md) (the Pattern, D35–D68) and [`v2-design-brainstorm.md`](v2-design-brainstorm.md) (the Morph, §9.6, D23).
- **Code:** everything lives in `v2/`, and paths below are relative to it.

---

## 1. The goal, in the owner's words

> The goal is to adjust the shape design, so with morph, and other features, with the right bitmap, and vase settings the images should be makeable. It should be a session where AI uses the tool to recreate the vases.

The two references:

1. **Faceted planter.** A cement planter, 32 × 32 × 49 cm. Large, irregular flat facets in staggered rows, like a low-poly rock, slightly wider at the shoulder. Each facet carries fine parallel hatch lines whose direction changes from facet to facet. The rim is round.
2. **Ribbed bottle.** A 3D-printed bottle: straight body, rounded shoulder, a short wide neck with a plain band at the lip. 60–80 vertical ribs run from the foot over the shoulder to the neck band.

## 2. Round 1: what today's tool makes (before D69)

The vases were built in the running app through the same store edits the controls make (profile points, Morph, Pattern, density, range, bead). Renders were made in headless Chrome at a fixed side view.

### 2.1 Ribbed bottle: makeable

- **Shape.** 360 mm tall, 170 mm body, 9 profile points: straight to 240 mm, a shoulder held at the 45° overhang limit, an 84 mm neck.
- **Pattern.** The *Rib 1×1* starter with density set to 128 points, so 64 ribs, from 0 to 345 mm. The top 15 mm stays plain for the lip band.
- **Result.** No warnings. The ribs follow the shoulder by themselves, because a Pattern column stays at the same place around the pot (D58), so they converge on the neck just as in the photo.
- **Tool limits found (small).**
  - Soften wipes out a 2-column rib: a blur of ±1 cells over 2 columns averages to nearly 0.
  - Rounder flutes need a 4-column drawing (`+0-0`), which doubles the points and is finer than the bead on the neck.
- **Clay limits.**
  - A rib needs about one bead of width to read. So 64 ribs need a body of ~165 mm or more with the 8 mm bead, or ~80 mm with a 4 mm bead.
  - With 5 mm layers every rib is a stack of bumps, not a smooth flute (§5.4).

### 2.2 Faceted planter: only with a workaround

- **Shape.** 490 mm tall, egg-shaped, 7 profile points.
- **Facets.** These were only possible as an *uploaded Morph image*. The image was computed outside the tool: the radial push of a set of flat planes, tangent to the profile, in staggered rows, minus the profile. A user can't draw that image by hand. It also stops being flat as soon as the profile or the height changes, because it stores a push relative to one profile.
- **Hatching that turns per facet.**
  - The Pattern is one tile that repeats everywhere, so it gives one direction for the whole pot (a diagonal drawn in the 2D editor reads well, but it is the same everywhere).
  - Baking the hatching into the Morph image works, but that image holds at most 512 px and 256 grey levels: about 2 mm a pixel around a 1 m perimeter, and 0.2 mm steps once it shares the range with 26 mm facets.
- **The 2D editor's 24 × 24 cap doesn't matter here.** A single facet is about 30 layers × 60 cells, so a bigger cap would not make it drawable.
- **Clay limits.**
  - A slanted line needs at least two layers a repeat, so with 5 mm layers the hatching has to be 12–16 mm apart.
  - Grooves deep enough to read (6 mm) make each layer step out past 45° here and there ("leans past 45°").
  - The photo's ~5 mm hatching needs ~2 mm layers (a ~3 mm bead).
- **Printer.** 320 mm is wider than the generic gantry's 300 mm bed: a printer setting, not a tool limit.

## 3. What the owner chose (D69–D72)

**D69: Facets, a built-in Morph map made of flat faces calculated from the shape** (`lib:facets@1`).
- **The faces.** Each face is a plane tangent to the pot at a point, in rows round the pot. The radius at a height and an angle is the nearest plane along that ray, so the faces stay flat when the profile changes (on a round footprint, without twist).
- **Where the faces sit.** The planes are moved in by cos(π / facets around), so the edges between faces lie about on the profile line and the faces sink in. The Width you set stays the pot's width.
- **Settings:**
  - *Facets around*: the Morph's Repeats, 3–24.
  - *Rows*: 1–8.
  - *Stagger*: odd rows shifted half a face.
  - *Irregularity*: 0–1, how far each face's centre is moved from the grid.
  - *Shuffle*: a seed, 0–999, for another irregular layout.
  - *Round rim*: 0–100 mm, a band at the top that fades to round.
  - *Edges*: the Morph's Softness, a rounding of the edges in mm.
  - *Blend*: 1 is flat faces, less is between round and faceted.
- **Strength.** It has no meaning here, because the faces' depth follows from their number (fewer faces cut deeper), so it is hidden for Facets.
- **Neighbours only.** A face only reaches the rows next to its own, so a neck or a waist isn't cut away by a plane from far below.
- **Trade-offs.**
  - It is the first map that depends on the profile.
  - It is exactly flat only on the round footprint without twist; on the rectangle and with twist it is close to flat.

**D70: Slant, a Pattern setting that moves the drawing a whole number of cells each layer.**
- **How it moves.** Layer k from From is shifted round(slant × k) cells, so Rib 1×1 becomes diagonal lines, and a fractional slant steps every few layers.
- **Range.** −8 to 8 cells a layer, in quarter cells. The readout gives the lines' angle from the bead size and the spacing.
- **What stays.** One row is still one layer and one cell is still one node (D35, D58), so the 2D editor, Soften, Fade and the hidden seam keep their meaning.
- **Trade-off.** The angles come in steps. With 2 mm nodes and 5 mm layers they are 68°, 51°, 40° and 32° at 1, 2, 3 and 4 cells.

**D71: Slant per facet.**
- **How it works.** With the Facets map on, the Pattern can take a different slant on each face. *Different on each facet* picks, per face, a slant between Slant and *To*, fixed by the Facets layout (its Shuffle).
- **What you see.** Within a face the lines are continuous. At a face's edge they change direction, as in the photo.
- **When it applies.** Without Facets the toggle doesn't show and the even Slant applies.

**D72: The seam with Slant.**
- **Even slant.** The seam column moves with the slant, so every layer still starts on the same column of the drawing (D65, D66) and the seam is a slanted line.
- **Slant per facet.** The seam stays at one place round the pot, on a node, as a straight line. The drawing slides under it by a different amount in each face, so the hidden seam's quiet column holds only on the range's first layer.
- **Ramp.** The ramp is unchanged: a layer starts on the row below at the same place (D60), and that row already carries its own shift.

## 4. Data model (design version 5, no migration)

```jsonc
"form": { "morph": {
  "map": "lib:facets@1", "softnessMm": 4, "strengthMm": 16, "repeats": 6, "blend": 1,
  "facets": { "rows": 4, "stagger": true, "irregularity": 0.5, "seed": 1, "rimMm": 20 }   // only with lib:facets@1
} },
"pattern": { …, "slant": { "cells": 0, "perFacet": false, "toCells": 0 } }   // absent or { cells: 0 } is no slant
```

- `normaliseDesign` fills `facets` for the Facets map and drops it for every other map. `slant` is always filled.
- Older files have no `slant` and get `{ cells: 0, perFacet: false, toCells: 0 }`.
- Saved Pattern setups (My patterns, D48) carry the slant with their other settings.

## 5. Left open, and later

1. **Rounder flutes** (§2.1). Soften on a 2-column drawing erases it. The owner didn't ask for a change here.
2. **A larger Morph image** (1024 px, 16-bit). This is not needed once Facets and Slant exist.
3. **Hatching finer than 12 mm at 8 × 5.** That is clay physics. A finer bead is a Layers setting.
4. **The preview's light and bead shape.** The light follows the camera, so relief looks flat from the front, and the beads look like stacked bumps. A separate agent is working on a studio light and rounder, flowing beads, in its own worktree (owner, 2026-11-26).

## 6. Build notes

(Filled in as the slices land.)
