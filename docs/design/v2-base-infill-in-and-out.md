# Vasecreator v2: base infill that goes in and comes back out (proposal)

- **Date:** 2026-11-26
- **Status:** Decided by the owner on 2026-11-26 and built: always in-and-out pairs of layers, with the spiral and the crossed lines as the only infills (D76 and D77 in [`v2-base-infill.md`](v2-base-infill.md) §5). Option B (the double spiral) and Rings are not built. The rest of this record is the research and the options as they were put to the owner.
- **Builds on:** [`v2-base-infill.md`](v2-base-infill.md) (D73–D75, the three infills at commit 666e39f).
- **Not printed (D4):** every number here comes from sources, geometry and a throwaway prototype, not from clay.

---

## 1. What the owner asked

> can it be written in a way e.g. multiple of 2, so it always can go to the inside and outside, next to this is it possible to maybe get to the middle of the print. easier. I believe on aspect ratio 1:1 the spiral works, and lines for non 1 aspect ratio, but always multiple of 2.

How this is read is a guess; the open questions are in §6.

## 2. What the sources say

Clay sources on floors are still thin. C = clay practice, P = plastic printing, T = thrown clay.

| Topic | Finding | From |
|---|---|---|
| In-and-out pairs | "Each base layer is actually composed of two layers": one spirals in, the next spirals out. Two reasons given: one layer is too thin once the clay shrinks, and with one layer the nozzle would have to travel from the middle back to the side, leaving extra clay in the middle. | C [R1] |
| Gaps | "Even if there is a slight gap in between one of the lines, these shrinkages can make it open more." Spacing there is nozzle width less 0.1 mm. | C [R1] |
| Crossing layers | Four layers at alternating 90°, called critical against cracks; cover each layer exactly once, crossings make bumps. | C [B1] |
| Layer count | "Usually you print 3 or 4 solid layers"; one user printed a concentric first layer and lines above. Both threads report a bulge where the wall starts on the floor. | C [R2][R3] |
| Double (Fermat) spiral | In on every other lap, turn at the middle, out between; start and end both on the boundary, next to each other. | P [R4] |
| Its weaknesses | One sharp turn at the middle. Smoothing "tends to increase under-fills". The printed test showed "visible gaps from a top view", expected to close as the plastic melts (clay does not melt). Stacked spirals "cannot be cross-weaved"; the authors suggest alternating spiral and zigzag layers, and prefer zigzag for simple convex layers. | P [R4] |
| Zigzag against contour-parallel | Zigzag "incurs little under-fill" but is weaker near the boundary; contour-parallel under- or over-fills "near the center". | P [R4] |
| One path, low curvature | Called "promising for clay printing"; the paper joins model and support paths and has no floor fill. | C [R5] |
| Joining infill without travel | Cura joins concentric skin into one path ("can reduce the top surface quality") and joins zigzag ends along the wall. | P [R6] |
| S-cracks | A sign of uneven drying, the rim ahead of the base. "Lack of compression doesn't cause an S crack." Keep the floor no thicker than the wall. | T [R7][R8] |

**Nothing found:** a double spiral used for a clay floor; starting the print in the middle; extra flow in the base; a floor recipe in CoilCAM, FullControl, Termite, or by Keep, Lauerman or van Herpt; anything saying a spiral that ends in the middle causes an S-crack in printed clay; readable concrete-printing sources. The Potterware guide is still gone (a search snippet says its default was 2 base layers).

## 3. What the current code costs

Measured on a 40 mm floor with a 5 mm bead, two base layers. "Extra" is bead length beyond the floor's area divided by the spacing; the wall overlap of D74 is part of it by design.

| Infill | Round | Oval 0.6 | Rounded rectangle 0.7 | Round with a 20 mm hole |
|---|---|---|---|---|
| Spiral, layer 1 / 2 | 25 % / 13 % | 47 % / 36 % | 34 % / 22 % | 31 % / 21 % |
| Lines, layer 1 / 2 | 34 % / 31 % | 47 % / 33 % | 38 % / 29 % | 48 % / 45 % |

- **Spiral:** the closed lap beside the wall with the spiral peeling off it is about half a lap of extra bead; the closing lap in the middle is one lap, plus up to one more on a layer printed outward so that it starts over the end of the layer below.
- **Lines:** on a round floor about 1.4 laps' worth of extra bead beside the wall on each layer: the closed lap, the turns that run along it, and the walk to and from the line that starts a quarter turn away. Turning the lines 90° makes that walk unavoidable: a sweep ends half a turn from where it starts, so the next one cannot begin where the last ended.
- **Where the print starts:** with an even number of base layers it starts at the wall. With an odd number the first layer is printed from the middle outward, so the first clay lands in the middle of the floor.
- **The step up between layers** is in the middle of the floor (or on the hole's lap) on every other layer, at the same spot each time.
- **Coverage** is the same for every infill and footprint (0.40 to 0.52 bead widths). The measurements do not show the spiral failing on floors that aren't round.

## 4. The options

Pictures of all three were shown to the owner with this proposal (prototype script, not in the repository).

### A. Pairs of layers: in on one, out on the next

The paths as they are, with one rule added: base layers come in twos (2, 4, 6; 0 stays a sleeve).

- **To the middle and back:** layer 1 goes in from the seam and ends in the middle; layer 2 starts there and comes out to the seam.
- **Even count:** required.
- **Floors:** as today on round, oval, rectangle and with a hole.
- **For:** the only option with clay practice behind it [R1]. Smallest change. The print never starts in the middle.
- **Against:** the step up stays in the middle, at the same spot in every pair. Odd counts go (3 layers becomes 2 or 4).

### B. Double spiral: in and out within one layer

New. A closed lap beside the wall, a spiral in at two spacings a lap, straight through the middle, and a spiral back out between the laps of the way in.

- **To the middle and back:** every layer does both. On a round floor the path runs straight through the middle without stopping or turning back. On an oval or rectangle it runs along the middle line. With a hole it runs one and a half laps round the hole.
- **Even count:** not needed. A layer ends on the lap beside the wall half a turn from where it started, so layers take turns: one starts at the seam and ends opposite, the next starts opposite and ends at the seam. The last always ends at the seam.
- **Step up:** beside the wall, inside the floor, never in the middle.
- **Clay:** 2 to 5 % more than A in the prototype. Coverage 0.41 to 0.52, the same as today.
- **For:** nothing ever stops or starts in the middle. Any layer count.
- **Against:** no clay source uses it. The way out lays a bead between two beads that are already there, which may ride up in clay (an inference, not a finding). Layers do not cross each other [R4]. On a floor that isn't round, the middle line gets one extra bead. A round hole in a floor that isn't round is not prototyped.

### C. Lines in pairs, turned 90°

As today: there on one layer, back on the next, a quarter turn apart.

- **To the middle and back:** lines do not visit the middle; they cross the floor. Two layers bring the path back to the seam.
- **Even count:** required to end at the seam without a longer walk.
- **For:** the layout the porcelain source calls critical against cracks [B1]; least under-fill in plastic [R4].
- **Against:** the most extra bead beside the wall (§3), and more with a hole.

### Considered and left out

- **Lines there and back within one layer** (every other line going, the ones between coming back): the turns along the wall are twice as long and overlap each other, which doubles the extra clay at the wall.
- **Double spiral with stepped laps** (the construction of [R4]): starts and ends side by side at the seam and adds almost no clay, but puts a slanting join on every lap in one band from wall to middle. The prototype left gaps there.

## 5. Recommendation

**A as the rule, and B as a fourth infill to print-test.**

A is what the one clay source that explains itself does, costs almost nothing to build and removes the start in the middle. B answers "get to the middle easier" best, but nothing supports it in clay and none of this has been printed, so it should sit beside the spiral as a choice, not replace it.

On choosing by aspect ratio: the measurements give no reason to take the spiral away from oval or rectangular floors. Setting the default by footprint (spiral when round or square, lines otherwise) is cheap; switching the infill when the footprint changes is not recommended until the owner says what goes wrong with the spiral there.

## 6. Open questions for the owner

1. **"Multiple of 2":** an even number of base layers (A), or an in-and-out inside every layer (B)?
2. **"Get to the middle easier":** what did you see? The print starting in the middle (odd counts today), the step up in the middle, or the route the path takes?
3. **Spiral on floors that aren't 1:1:** what goes wrong there? Should the app only set the default by footprint, or switch by itself?
4. **Lines:** keep the 90° turn and its extra clay at the wall, or go there and back the same way (no extra, no crossing)?

## Sources

- [B1] McNeel forum, "Spiral vase, 3D printed in porcelain": https://discourse.mcneel.com/t/spiral-vase-3d-printed-in-porcelain/133840
- [R1] Potterbot Grasshopper base tutorial: https://docs.google.com/document/d/1MW15IFhqI5kkSSS2SDpPldta68z6ITDmlH89cuqEXkc/export?format=pdf
- [R2] Prusa forum, WASP clay profiles: https://forum.prusa3d.com/forum/prusaslicer/print-profiles-for-wasp-clay-printer-elephant-foot-problems
- [R3] Prusa forum, first layer after the bottom layers (Lutum): https://forum.prusa3d.com/forum/prusaslicer/having-trouble-with-my-first-layer-after-the-bottom-layers-in-spiral-vase-mode/
- [R4] Zhao et al. 2016, "Connected Fermat Spirals for Layered Fabrication": https://www.cs.purdue.edu/homes/bbenes/papers/Zhao16ToG.pdf
- [R5] Hergel et al. 2019, "Extrusion-Based Ceramics Printing with Strictly-Continuous Deposition": https://gershon.cs.technion.ac.il/Seminar23_3DP/Papers/OtherApplications/ExtrusionBasedCeramicsPrintStrictlyContDeposition.pdf
- [R6] Cura setting definitions: https://raw.githubusercontent.com/Ultimaker/Cura/main/resources/definitions/fdmprinter.def.json
- [R7] Digitalfire, drying crack: https://digitalfire.com/glossary/drying+crack
- [R8] Ceramic Arts Network, S-cracks: https://ceramicartsnetwork.org/daily/article/Tips-for-Centering-and-Preventing-S-Cracks-in-Dinner-Plates

[R2], [R3], [R7] and [R8] were read through a summarising fetch, not word for word.
