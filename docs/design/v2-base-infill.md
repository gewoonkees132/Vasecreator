# Vasecreator v2: a base that holds water (three infills)

- **Date:** 2026-11-26
- **Status:** Approved by the owner as a short design on 2026-11-26 and built on `t3/recreate-vases`. Not printed yet (D4): the numbers below come from sources and geometry, not from a clay test.
- **Builds on:** [`v2-design-brainstorm.md`](v2-design-brainstorm.md) §9.4 (the base) and research §5.4 stage 6. Covers most of GitHub issue #4 (base design review) and the later item "More base infills" (§15.4).
- **Code:** everything lives in `v2/`, and paths below are relative to it.

---

## 1. The goal, in the owner's words

> Can you refine the bottom infill, the most important part of infills is that it fills the bottom solidly, so no water can leak out. Can you lookup best practices, and implement various infill methods. with a toggle button.

## 2. What the sources say

Clay-specific advice on floors is thin. What was found:

| Source | What it says |
|---|---|
| A porcelain vase printed on a WASP, written up on the McNeel forum [B1] | Cover each solid layer exactly once and never cross your own path: a crossing lays down too much clay and makes bumps. Four layers of infill at alternating 90° angles, which the author calls critical against cracks in drying and firing. |
| Prusa's watertight guide (plastic) [B2] | Leaks from the bottom come from the joint between infill and wall. Raise the infill overlap from 10 % to 25–35 %, and the flow by 5–10 %. |
| Prusa's vases article and Bambu Lab's leak guide (plastic) [B3][B4] | More bottom layers and more material both help; no setting guarantees a watertight print. |
| OrcaSlicer's infill settings [B5] | Pinholes sit where infill lines meet a wall at a shallow angle; filling them costs some over-extrusion. |
| Our own research (§3.4 of `toolpath-foundation.md`) | Three solid layers in a known clay profile; floors end at the seam; S-cracks come from uneven drying, so the floor should not be much thicker than the wall. |

The two Potterware pages the search turned up could not be read (one is gone, the other is a PDF without text).

## 3. What was wrong with the spiral

Read from `core/toolpath.js` and measured with a script that looks for the spot of the floor furthest from any bead (half a bead width means the beads just meet):

1. **A wedge beside the wall.** The spiral started one spacing inside the ring and was two spacings inside it a lap later, so a wedge was open next to the wall: on a plain round floor the furthest spot was 0.89 bead widths from a bead.
2. **Grooves stacked.** Every base layer ran on exactly the same track as the one below, so the grooves between beads lined up through the whole floor.
3. **The middle and the hole were loose ends.** The spiral simply stopped there, at the same spot on every layer.
4. **A round hole in a floor that isn't round.** The spiral stopped where it first touched the hole, on the floor's narrow side. On an oval or a square the floor beside the hole on the long sides was left open: a spot 2.9 bead widths from any bead on the test oval.
5. **Sharp corners were cut.** Points were spaced evenly along the outline, so a square corner was cut short by up to a quarter bead.
6. **A morphed outline didn't close.** The tracks kept the morph's shape all the way in, so the middle stayed open by the depth of the morph.

## 4. Approaches

| Approach | Trade-off | |
|---|---|---|
| **A. Fix the spiral only** | Smallest change. One pattern for every floor; nothing for the owner to choose. | Not chosen: the owner asked for several. |
| **B. Three infills on shared sealing rules** | One module, one set of rules, three paths. Each is tested the same way. | **Chosen.** |
| **C. Infill per layer (spiral, then lines, then rings)** | Crosses grooves well, but hides what prints and adds a setting per layer. | Not chosen: too much to explain in the design view (D7). |

Sunburst was left out: it piles clay up in the middle and opens gaps at the edge.

## 5. The decisions

**D73: Three infills behind a toggle.** `base.pattern` is `'spiral'`, `'rings'` or `'lines'`; anything else is the spiral, which stays the default. The Base step shows them as a segmented control with one line saying what the chosen one is.

| Infill | The path | Good for |
|---|---|---|
| **Spiral** | One bead from the wall to the middle. | The default: the fewest turns and the smoothest print. |
| **Rings** | Closed laps one spacing apart, joined by a short slanting bead. | No groove runs from the wall to the middle. |
| **Lines** | Straight lines to and fro, turned 90° on every layer. | Each layer crosses the grooves of the one below; the layout the porcelain source calls critical against cracks [B1]. |

**D74: The sealing rules, the same for all three.**

- **Overlap with the wall.** The infill starts with a closed lap beside the ring, on average a quarter of a bead into it (`RING_OVERLAP`, from [B2]).
- **Stagger.** That lap sits half a spacing further in on every other layer, and the tracks inside it with it, so a bead lies over each groove of the layer below. Lines turn 90° instead, and every other layer that runs the same way has one line more.
- **Closed middle.** The path ends with a closed lap round the hole, or round the middle of the floor.
- **A round hole is round on any floor.** On a floor that isn't round the hole gets a closed lap of its own, and the laps that would run through it are printed as arcs from the hole round and back to it.
- **Line ends run a quarter of a bead into the bead beside the ring** (`TIP_OVERLAP`, the 25–35 % of [B2]) and turn along it. Less than that leaves a sliver between two line ends where the lines meet the lap at a shallow angle [B5].
- **Sharp corners are points of their own.**
- **With a morph** the tracks start as the morphed outline and lose the morph evenly on the way in.
- **Kept from §9.4:** direction alternates per layer, every base layer is flat, the last one ends at the seam, spacing is 0.9 × bead width, and there is no move without clay other than the short step up between layers. A layer printed from the middle out starts right over the end of the layer below.

**D75: Extra flow in the base infill, a print setting.** `extrusion.baseFlow` in the printer profile, 1.1 by default (the 5–10 % of [B2], and the owner's note in issue #4), 1 to 1.5. It applies to the base infill beads only, not to the ring, the walls or the skirt, and shows as *Base flow* in the Print step, so the design view stays free of material talk (D7). The refill planning counts it.

## 6. What it measures now

The same script, over round, oval, rectangular, twisted, morphed and two-walled floors, with and without a hole, on four base layers:

| | Before | After |
|---|---|---|
| Furthest spot from a bead, plain round floor | 0.89 bead widths (the wedge) | 0.49 |
| Oval floor with a hole | 2.93 | ≤ 0.51 |
| Square floor with a hole | 1.90 | 0.53 |
| Square planter preset | 1.53 | ≤ 0.52 |
| Worst case of any infill on any tested floor | 2.93 | ≤ 0.54 |

Half a bead width is where two beads just meet. The spots between 0.50 and 0.54 are at sharp corners and where a line ends at a shallow angle; the 10 % extra flow is there to close them.

## 7. What it costs

- **A little more clay at three places:** beside the wall on the layers where the lap sits nearer, round the hole or the middle (a layer printed outward runs up to half a lap extra there, to start over the end of the layer below), and along the hole's lap on a floor that isn't round. This is the over-extrusion issue #4 asks for at the wall and the hole, but it has not been printed.
- **Lines** lay a second bead beside the first lap for up to a quarter of the way round on every other layer, to get from where one layer ends to where the next starts without stopping the clay.
- **The golden G-code files changed**, all of them: the spiral itself is different and the printer profile has a new field.

## 8. Not done, and open

- **A print test.** Whether 1.1 is the right flow and whether the extra clay at the wall and the hole shows as a bump is for a real print to say.
- **Checks.** No new check warns about a floor of fewer than three layers; the sources suggest three or four.
- **A view from below** in the preview (issue #4).
- **Lines on a deeply dented outline** follow the outline round a dent instead of jumping it; this has only been tested on the Drape vase's morph.

## 9. Where it is in the code

- `core/base-infill.js`: the three infills and the sealing rules. `baseInfill()` returns one layer's path, going inward from the seam.
- `core/toolpath.js`: `infillOf()` gives it the layer's curves; the base layer loop runs it forward or backward.
- `core/plan.js`: `cornersOf()`, the corners of an offset rectangle.
- `core/design.js`: `base.pattern` is normalised against `BASE_PATTERNS`.
- `core/gcode.js`, `core/printer.js`, `ui/print.js`: the base flow.
- `ui/sections/base.js`: the toggle.
- `test/base-infill.test.js`: every infill on ten floors (covered, flat, out of the hole, no jump), the stagger, the 90° turn, the flow. `test/golden/plain-cylinder-rings.gcode` and `-lines.gcode`.

## Sources

- [B1] McNeel forum, "Spiral vase, 3D printed in porcelain": https://discourse.mcneel.com/t/spiral-vase-3d-printed-in-porcelain/133840
- [B2] Prusa Knowledge Base, "Watertight prints": https://help.prusa3d.com/article/watertight-prints_112324
- [B3] Prusa blog, "Watertight 3D printing, part 1": https://blog.prusa3d.com/watertight-3d-printing-pt1-vases-cups-and-other-open-models_48949/
- [B4] Bambu Lab wiki, "Reduce vase leaking guide": https://wiki.bambulab.com/en/filament/reduce-vase-leaking-guide
- [B5] OrcaSlicer wiki, infill settings: https://www.orcaslicer.com/wiki/print_settings/strength/strength_settings_infill
