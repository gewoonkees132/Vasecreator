# Vasecreator v2: painting the Pattern on the pot (the paint brush)

- **Date:** 2026-11-26
- **Status:** **removed on 2026-11-26 at the owner’s request** ("I don’t like it"), the same day it was built and went live (commit `adfd252`). None of the code below is in the app any more; this document is kept for the record. The design version stays 6, so designs saved while it was live still open: their `pattern.paint` is dropped on opening.
- **Builds on:** [`v2-pattern-studio.md`](v2-pattern-studio.md) (the Pattern, D35–D68, D78), [`v2-mobile-stage.md`](v2-mobile-stage.md) (the phone dock) and `v2/ARCHITECTURE.md`. It takes up the parked item 18 of the pattern studio, "one-off edits on the whole wall", in a different form.
- **Code:** everything lives in `v2/`, and paths below are relative to it.
- **Decisions:** D79–D87 below. D79–D82 are the owner's; the rest are the builder's calls and are marked so.

---

## 1. Intent

The owner, 2026-11-26:

> I want people to design the pattern in the 3D viewer.

> The whole wall is a free canvas, there is a reset. Essentially it's a black-white overlay, which you indirectly paint, causing more or less pattern in that spot.

Today the Pattern is one small tile that repeats around and up the pot, and the only ways to vary it over the pot are From / To and the Fade. The paint brush lets a person say *where* on the pot the Pattern shows, and how strongly, by painting on the pot itself.

## 2. Goals, non-goals, anti-goals

**Goals**
- Paint more Pattern and less Pattern on the pot, in the 3D view, with a mouse and with a finger.
- Several strokes: free, a straight line (which gives a diagonal), a band around, and a fade.
- Brush settings: size, soft edge, strength.
- A reset.
- Works on a mid-range Android phone in Chrome (D3), and the pot updates live (D20).

**Non-goals**
- Painting single cells of the drawing on the pot. The drawing stays the tile and is made in the 2D editor.
- Making the Pattern deeper than its Depth. White is the Pattern as set, never more.
- A second 2D view of the overlay, layers of paint, or importing an image as the overlay.
- Painting the base, or painting in Shape, Layers & seam, Base or Print.

**Anti-goals** (it has failed if any of these is true, even when it works)
- A finger that wants to turn the pot paints on it, or the other way round, without the person seeing why.
- Painting lags so far behind the finger that the stroke can't be steered.
- The painting moves or is lost when the pot's size, the density or the drawing changes.
- Anything covers the pot (D22, D31).

## 3. The model

```
radius at a node = profile + Morph + Pattern(layer, node) × Fade × Paint(u, z)
```

**D79 (owner): the paint is a black-and-white overlay over the whole wall.** White (1) shows the Pattern in full, black (0) leaves the plain wall, grey is in between. A person paints the overlay, never the cells.

**D80 (owner): the whole wall is the canvas.** Not the tile, and not only From–To.

**D81 (owner): there is a reset**, which puts the overlay back to white everywhere.

**D82 (owner): the strokes are Free, Line, Around and Fade** (§5), as shown to the owner and agreed.

**D83 (builder): the overlay is a small greyscale picture stored with the Pattern.** See §4 and §9.

What follows from the model:

- **A new Pattern is white**, so it looks as it does today. A design without paint builds the same toolpath as before, byte for byte, so the golden G-code doesn't change.
- **It multiplies with everything else**: depth × (cell + sit) × fade × paint. Where the paint is black the node lies on the plain wall, whatever *Sits* says, because the paint scales the whole displacement including the sit.
- **It is fixed to the pot, not to the grid.** The overlay is read at a node's place around the pot (`u`, the outline's own position, the same one the Pattern's columns use, so it follows the twist) and at its layer's middle height as a share of the pot's height. Changing the density, the drawing, the bead, the layer height or From / To leaves the painting where it is. Changing the height stretches it with the pot, as the profile points do. It does not follow the Slant.
- **Outside From–To the paint has nothing to act on.** It is kept, and shows again when the range grows.
- **The checks don't change.** Bead support and fineness already measure the displaced path.
- **It belongs to the pot, not to the drawing.** Picking another drawing keeps the paint. *None* (no Pattern) drops it. A saved pattern in My patterns never carries paint, like From / To.

## 4. The overlay as data

**D84 (builder): `design.pattern.paint`** is `null` (white everywhere, the default, left out of files) or a picture of fixed size:

```jsonc
"pattern": {
  …,
  "paint": { "cells": "<text>" }   // PAINT_AROUND × PAINT_UP values, 0–255, row 0 at the bottom, column 0 at u = 0
}
```

- **Size:** `PAINT_AROUND` = 128 columns around, `PAINT_UP` = 96 rows over the full height (0 at the bottom of the pot, the last row at the rim). On a pot 400 mm round and 200 mm high a cell is about 3 mm by 2 mm, finer than a bead.
- **Levels:** 256 (0 = black … 255 = white), a byte a cell. Fewer would stall a weak brush: at 5 % Strength a stroke changes a cell by less than one of 16 levels, and rounding would throw it away. With 256 a stroke at the least Strength still moves every cell above level 10, and a cell that a stroke would move by less than one level moves by one, so a brush always reaches black and white. That last rule is the one place a stroke may pass its Strength, by under half a percent.
- **Text:** run-length coded and then base64, so a mostly white overlay is a few dozen characters and the worst case (soft greys everywhere) stays near 16 KB. The exact coding is the builder's.
- **Why inside the design** and not by reference like an image: an overlay changes with every stroke, so a store of them by hash would fill with one picture per stroke and nothing to clean it up. In the design it rides along with history (200 steps at most), files and saved designs with no extra plumbing.
- **An overlay that is white everywhere is `null`**, so reset, and painting everything back, give a design equal to one never painted.
- `normaliseDesign` keeps a `paint` that decodes to the right size and drops anything else. The design version goes up by one, with no migration, as before (D50).

**Reading it (the engine).** `core/layer-pattern.js` multiplies each node's value by the overlay at (`u` = j / N, `v` = (i + ½)·h / H), read bilinearly, wrapping around and clamped at the bottom and the rim. One row is prepared per layer, in `nodesOf`, where the Fade is applied today. Nothing else in the engine changes: the seam column, the ramp and Soften work on what they get.

## 5. The brush

All brush maths is pure and lives in a new `core/paint.js` (no DOM, no three.js, tested, and within the determinism rules of `core/`).

**More and Less.** A brush either adds (towards white) or removes (towards black). *Less* is the default, because a new overlay is white and there is nothing to add yet.

**A stroke never goes past its Strength.** While the pointer is down the brush builds up a stroke picture (the most each cell was touched, 0–1), and the overlay shown is the overlay before the stroke combined with it:

- Less: `before × (1 − strength × touched)`
- More: `before + (1 − before) × strength × touched`

So going over the same spot twice in one stroke changes nothing more, and a second stroke does. This is how Blender's paint strength behaves, and it makes an even grey easy.

**Settings**

| Setting | Range | Default | Meaning |
|---|---|---|---|
| Size | 4–120 mm, never more than half the pot's height | 30 mm | the brush's width on the wall |
| Soft edge | 0–100 % | 50 % | 0 is a hard edge; 100 % falls off smoothly from the middle |
| Strength | 5–100 % | 100 % | the most one stroke changes |

The brush is round **on the wall**: its size in overlay cells is worked out from the wall's perimeter at that height and from the pot's height, so it is as wide on a narrow neck as on a wide belly. The falloff is a smoothstep polynomial.

**Strokes (D82)**

- **Free.** Follows the pointer. Between two pointer positions the stroke is filled in along the straight way between them on the unrolled wall, the short way round, in steps of a quarter of the brush size at most, so a fast finger leaves no gaps. Browsers that give the positions between two frames (`getCoalescedEvents`) have them used.
- **Line.** Press, drag, release: a straight stroke on the unrolled wall from the press to the release, the short way round. Drawn at an angle it winds round the pot, which is the diagonal. It shows live while dragging and can be dragged back to nothing.
- **Around.** A level band all the way round the pot, as wide as the brush, at the heights the pointer passes while it is down.
- **Fade.** Press, drag, release: a ramp by height, all the way round. With *Less* the Pattern is left as it is at the press height and below it (or above it, when dragging down), goes to nothing at the release height, and is nothing beyond. With *More* the same ramp adds instead. Size and Soft edge don't apply; Strength does. The ramp is level: a fade that winds round the pot already exists as the Pattern's *Fade → Diagonal*.

**Reset (D81)** sets `paint` to `null`: one history step, *Reset paint*. It is off when there is no paint.

**History.** A stroke is live while the pointer is down (`store.change`, once a frame) and one step when it lifts (`store.commit`): *Painted pattern*. Undo and redo are the app's own. A stroke that changed nothing adds no step.

## 6. Painting in the 3D view

**D85 (builder): Paint is a mode of the Pattern step.** It is on while the person has the Paint part open (desktop: a *Paint on the pot* toggle in it; phone: the Paint tool's row in the dock, §7). It goes off when they leave the Pattern step, open the 2D editor, or remove the Pattern. `view.paint` holds it; it is not in history.

**D86 (builder): what a pointer does in Paint mode**

| Gesture | Does |
|---|---|
| One finger or the left button, starting **on the pot** | paints |
| One finger or the left button, starting **off the pot** | turns the pot, as always |
| Two fingers | turn, zoom and move, as always. A stroke begun by the first finger is taken back when the second lands (as in the 2D editor, D57) |
| Wheel, right button, middle button | zoom and move, as always |
| The *Paint · Turn* switch set to *Turn* | every gesture turns the pot; the brush settings stay in view |

The switch is always in view while Paint mode is on. It is there for a phone, where a zoomed-in pot fills the stage and there is no "off the pot" to start from. This follows the common practice of 3D paint apps (ZBrush for iPad, Procreate, Nomad Sculpt): an explicit, visible switch, plus two fingers that always move the view.

**Finding the spot.** The beads are built in the vertex shader, so there is no mesh to hit. The engine adds to `PreviewResult` a coarse grid of the **plain wall** (without the Pattern), sampled from `createWallModel().centrePoint` on regular steps of `u` and height (about 96 around by 64 up, moved out by half a bead to the wall's outer face). The renderer makes an unseen mesh of it and casts the pointer's ray at it; the hit's place in the grid is the (`u`, `v`) to paint at. Only the outside of the wall takes paint, and only where it faces the camera: a press that lands on the inside of the pot, looking down into its mouth, turns the pot like a press beside it. This grid is also what the overlay is drawn on (next).

**Seeing it (D87, builder).** Two things show the paint, because the beads alone can't show a brush on a spot that is already plain:

1. **A tint, at once.** While Paint mode is on, the overlay is drawn on that wall grid as a dark, see-through wash over the beads: clear where the overlay is white, darker the blacker it is. It updates in the same frame as the pointer, without waiting for the engine. Outside From–To it is fainter, so painting there is seen to be kept but idle.
2. **The beads, a moment later.** Every frame of a stroke also goes to the engine as usual (newest request wins), and the Pattern itself grows or flattens under the tint.

The tint shows only in Paint mode. Out of it, the pot is white beads as always.

**The brush mark.** A ring the size of the brush lies on the wall under the mouse, and under the finger while it is down; for Line, Around and Fade a preview of what releasing will give.

**While painting, other things on the pot step aside.** The Pattern's From / To bracket hides in Paint mode (its handles would sit where people paint), as the drag points do for the 2D editor.

**Keyboard.** Painting itself needs a pointer. Everything else is a normal control: the switch, More / Less, the stroke, the three settings and Reset. People who can't paint still have From / To and Fade for where the Pattern shows.

## 7. The controls

A new part of the Pattern step, **Paint**, after Fade. It applies once there is a Pattern (C34).

**Desktop (the panel)**

```
Paint
[ Paint on the pot ]            ← toggle; on while you paint
[ Paint | Turn ]   [ + More | − Less ]
Stroke   [ Free | Line | Around | Fade ]
Size        ●────────  30 mm
Soft edge   ────●────  50 %
Strength    ────────●  100 %
↶ Reset paint
```

**Phone (the dock).** A *Paint* tool in the Pattern step's tool row, a `group` tool (the kind `ui/dock-tools.js` still documents): picking it turns Paint mode on and opens a row of its own with a back button, the *Paint · Turn* switch fixed at the left, and the tools *More / Less*, *Stroke*, *Size*, *Soft edge*, *Strength* and *Reset*. The adjuster shows the picked tool's control as for any tool (options or the dial). Back turns Paint mode off. The dock keeps its height, so the pot doesn't jump.

**Names.** Single-task buttons are icons named three ways with `labelIcon` (D49): Reset. Toggles and options keep their words. No clay or material words (D7).

**The brush settings are not part of the design.** Size, soft edge, strength, stroke and More / Less are kept for the session in `view` (and the last ones used in `localStorage`), never in history.

## 8. Approaches

How to keep the painted layer:

1. **A small greyscale picture of the wall (chosen).** Any brush works, erasing really erases, the size never grows, and it keeps its place when the pot changes. Its detail is limited to the grid, about 3 mm by 2 mm on a mid-size pot, which is finer than a bead.
2. **A list of strokes, replayed.** Sharp at any size, but it only grows, erasing is more strokes on top, and a long session slows every preview.
3. **One value per node of the Pattern.** Exact to the bead, but tied to the grid, so it breaks when the density or the height changes. The owner ruled it out by asking for a free canvas.

The owner left the choice to the builder, who took 1 and told the owner so on 2026-11-26.

How to show it while painting: only recomputing the beads (true to the print, but late on a phone and blind where the wall is already plain) against a tint drawn at once with the beads following. The tint was chosen (D87).

## 9. Where it touches the code

- **`core/paint.js` (new):** `PAINT_AROUND`, `PAINT_UP`, `PAINT_LEVELS`; decode and encode; `paintAt(cells, u, v)`; the stroke picture (`stamp`, `segment`, `band`, `ramp`); `composite(before, touched, strength, more)`; the brush's size in cells from the perimeter and height. Pure and tested.
- **`core/layer-pattern.js`:** multiply by the overlay in `nodesOf`. `newPattern` gets `paint: null`.
- **`core/design.js`:** `normalisePattern` keeps or drops `paint`; `compactDesign` leaves a null one out; the version goes up; `LIMITS` for the brush settings if the controls want them there.
- **`core/engine.js`, `core/toolpath.js`:** the wall grid in `PreviewResult` (`wallGrid: { around, up, positions: Float32Array }`), transferred like the other arrays.
- **`render/beads.js`:** the unseen pick mesh and the tint from `wallGrid`; `pickWall(clientX, clientY)` → `{ u, v, point } | null`; `setPaint(cells | null, { fromV, toV })`; `setPaintVisible(on)`.
- **`render/paint.js` (new):** the pointer handling on the canvas in Paint mode (Pointer Events with capture, coalesced events, the two-finger take-back, switching OrbitControls off for a stroke that starts on the pot), the brush mark, and the calls to `store.change` / `store.commit`. Only `render/` imports three.js.
- **`store/store.js`:** `view.paint` and the brush settings in `view`.
- **`ui/sections/pattern.js`, `ui/steps.js`:** the Paint part. **`ui/dock-tools.js`, `ui/dock.js`:** the Paint group tool.
- **`ui/pattern-actions.js`:** switching drawings keeps `paint`; saved patterns leave it out (they already list their settings by name).
- **`main.js`:** Paint mode per step, hiding the bracket, feeding the tint from the design.
- **`ARCHITECTURE.md`:** the contracts above, in the same commits.

## 10. Build order

Each slice is checked in the browser, desktop and a touch phone viewport, before the next.

1. **The engine.** `core/paint.js`, the overlay in the design and in the Pattern, tests: a white overlay changes nothing (golden G-code unchanged), a black one gives the plain wall, half grey halves the displacement, the painting keeps its place when the density changes and stretches with the height.
2. **Painting on desktop.** The wall grid, picking, the tint, the Free stroke, More / Less, the three settings, Reset, history.
3. **The other strokes.** Line, Around, Fade, with their previews.
4. **The phone.** The dock's Paint group, the switch, two fingers, the take-back; a check of the frame rate while painting against the research §10.3 budgets.

## 11. Left to the builder

- the overlay's exact text coding
- the tint's colour and strength, and how much fainter it is outside From–To
- the brush mark's look, and the previews for Line, Around and Fade
- the icons, and the exact wording of the tips
- whether the wall grid is 96 × 64 or another size that picks well on every preset
- how a stroke is throttled to the engine if a phone falls behind (the tint must stay at the pointer)

## 12. Open for the owner

None that blocks the build. To look at once it runs: whether *Less* is the right brush to start with, and whether 30 mm is the right starting size.

## 13. House rules that apply

D0 (free, no accounts), D3 (desktop and a mid-range Android phone), D7 (no clay words in the design view), D20 (live), D22 / D31 (nothing covers the pot), D49 (icons named three ways, no *Next*). `main` deploys, so the work goes on its own branch from `main`. Commit messages are plain, with no AI attribution. Tests: `cd v2 && npm test`.

## 14. As built (2026-11-26)

All four slices of §10 are built. The contracts are in `v2/ARCHITECTURE.md` under "Paint". What differs from the text above, or was the builder's to settle:

- **The design version is 6.** The presets and the golden G-code carry it (their header line is the only change in the golden files).
- **The overlay's text** is PackBits-style run-length packing (a control byte under 128 is that many + 1 cells as they are; from 128, the next byte repeated control − 126 times), then base64. A white overlay with one band is about 250 characters; the worst case stays under 17 KB.
- **A touched cell moves a level at least** only where the stroke touched it by 2 % or more, so a soft brush's faint fringe doesn't creep.
- **The wall grid is 96 × 64**, as proposed. The surface built from it lies on the plain wall's outer face (half a bead out, plus 0.3 mm) and is drawn nearer in depth by the Pattern's reach plus 2 mm. A first build put it outside the Pattern's raised beads instead, and the wash then stood off the pot's outline.
- **The wash** is the app's dark teal at up to 42 % (16 % outside From–To). **The brush mark** is a blue ring, a pair of level lines for Around, and nothing for Fade.
- **Line, Around and Fade have no separate preview**: the stroke itself is live while the pointer is down, so the pot shows what letting go will give.
- **A modifier key** (Shift, Ctrl, Alt, Cmd) with the left button moves the view even on the pot, as OrbitControls has it.
- **Reset is a text button**, *Reset paint*, in the panel and in the dock, not an icon: no icon says it as clearly (D49 keeps text in that case).
- **On the phone the Paint · Turn switch sits beside Back** and stays there while the brush tools scroll.
- **Fade is a straight ramp** between the two heights.
- **Brush size** steps by 1 mm; the largest is half the pot's height, 120 mm at most.

**Checked.** 429 tests pass. In headless Chrome:

- **Desktop:** Free, Around and Fade strokes each make one *Painted pattern* step; a drag beside the pot turns it and paints nothing; undo and Reset work; Paint mode ends on leaving the step, and the bracket comes back.
- **A 390 × 844 touch viewport:** one finger paints without moving the view; a second finger takes the stroke back and the two zoom; Turn turns without painting; Back ends Paint mode.

**Not checked:** a real Android phone (the frame rate while painting), and the Line stroke by eye (tests cover it).
