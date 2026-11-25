# Vasecreator v2: the presets (audit and five new ones)

- **Date:** 2026-11-25
- **Status:** Built on `t3/vase-presets`, cut from `t3/pattern-studio` (`0403f10`), so the presets use design version 3. Pushed for the owner's review. The owner kept the five new presets on 2026-11-25 and agreed to leave the Classic vase as it is and to the builder's calls (§7).
- **The request:** "audit the preset defaults, build 5 unique high quality vases and audit the pr set default". Read as:
  1. Audit the three presets and the default design.
  2. Build five new presets.
  3. Audit the whole set again, together with the default print settings: the generic gantry (`core/printer.js` `defaultPrinter()`) and the Print step's defaults.
- **Builds on:**
  - [`v2-design-brainstorm.md`](v2-design-brainstorm.md) §8.3, §9.1, §9.2, §9.6, §11 and Q10.
  - [`v2-pattern-studio.md`](v2-pattern-studio.md): D52 (presets open with their Detailed morph and no Pattern) and §11.2 (the starters pass bead support on every preset).
  - [`v2-guided-journey.md`](v2-guided-journey.md) D30 (presets are shapes).
- **Code:** paths are relative to `v2/`.

## 1. How the audit was run

Each preset is checked as a shape (`shapeOnly`), as the Designs screen opens it, on the default printer:
- It normalises to itself.
- Its design checks and its Print checks give no warnings, and it can export.
- It writes G-code, a DXF and an STL.
- Each of the eight starter Patterns, applied with one tap (`setLayerPattern`), adds no warning.

Margins are measured by moving a rule until its check fires:
- **Worst lean:** the lowest overhang limit at which the overhang check stays quiet (limit 45°).
- **Worst support:** the lowest bead-support ratio at which the support check stays quiet for the worst starter (limit 0.5 bead).
- **Tightest curve:** the highest curve ratio at which the fineness check stays quiet (limit 0.5 bead).

The browser check ran in headless Chrome at 1280 × 800 and at 360 × 660 with touch:
- The Designs tiles each show a thumbnail.
- Each preset opens on Shape with its Detailed morph and Morph and no Pattern.
- The pot's projected beads are checked against every piece of chrome (D22).
- There are no console errors.

## 2. The first audit: the three confirmed presets and the default design

| Preset | Size (H × W × D) | Warnings | Print | Worst lean | Starters | Worst support |
|---|---|---|---|---|---|---|
| Classic vase | 170 × 130 × 130 mm | none | fits, exports | **44.6°** | 8 of 8 | 0.467 bead |
| Twisted column | 150 × 117 × 117 mm | none | fits, exports | 30.0° | 8 of 8 | 0.376 bead |
| Square planter | 110 × 127 × 127 mm | none | fits, exports | 35.5° | 8 of 8 | **0.496 bead** |

- **All three are sound.** Each one:
  - normalises to itself, warns about nothing, fits the bed and exports;
  - writes G-code, a DXF and a closed STL;
  - passes all eight starters;
  - looks right in its tile and on the stage.

  `defaultDesign()` equals the Classic vase, named "Design 1".
- **Process values are sensible for the bead.**
  - Every preset uses a 3 mm bead and 1.5 mm layers (ratio 0.5).
  - Every seam ramp is 15 mm.
  - The base is 3 layers (4.5 mm), or 4 on the planter.
  - Only the planter has a hole, 14 mm, which is more than two beads.
- **Finding 1: the Classic vase is 0.45° under the overhang limit,** at 14–15 mm.
  - There, the flutes fade in (10–16 mm) over a foot that already leans out. Growing about 0.75 mm a layer on top of the foot's lean comes to 44.6°.
  - A 6 % shorter vase (160 mm) warns "Leans past 45° at 14 mm". This is the check doing its job, but it is the first pot everyone sees.
  - No small change buys much:

    | Change | Worst lean | Side effect |
    |---|---|---|
    | Flutes from 6 mm | 43.8° | — |
    | Foot radius 42 → 44 mm | 43.3° | — |
    | Flutes 1.8 mm deep | 44.6° | the rib starters fail |
    | Flutes from 14 mm | 44.9° | the rib starters fail |

  - **Left as it is; owner decision (§7).**
- **Finding 2: the Square planter leaves 0.004 bead of bead support** for six starters:
  - Knit, Brick bond, Seed, Herringbone, Basket and Diamond, at 0.496 of 0.5.
  - The starters' 0.14 bead depth was chosen on this pot (pattern studio §11.2), so this is by design.
  - Left as it is.
- **Finding 3, a bug, fixed: opening a design from any step but Shape kept the old camera.**
  - The step change first asks for a preview of the old design. That result could arrive first and take the pending fit, so the new pot was never fitted.
  - With the three confirmed presets this hardly showed, since they are close in size. Opening the 210 mm Bud vase from Pattern after the Square planter put its neck behind the top bar and the chips (D22).
  - `main.js` now fits the camera only on a result of the design on hand.
- **Finding 4, a bug, fixed: a two-wall STL ignored "inner wall follows the pattern".**
  - `core/cad.js` tested `innerWall !== 'follow'`, but the value is `'followPattern'`, so the solid's inner skin was always smooth.
  - The test used `'follow'`, a value `normaliseDesign` never keeps.
  - The fix is one word. A new test checks that the following skin holds less than the smooth one.
  - The presets print one wall, so their files didn't change.
- **Seen, not changed (older behaviour):**
  - On a phone, the Detailed morph bracket's *From* and *To* labels sit over the edge of a wide pot (the Square planter, now also the Petal bowl). The bracket keeps inside the pot's region (`render/gizmos.js`).
  - On a phone, the Square planter's corners reach 2–7 px past the fit region. Nothing covers them.

## 3. The five new presets

Each new preset was drafted from a short spec and rendered in a contact sheet of white bead thumbnails (the renderer's own `thumbnail()`). It was then tuned until every check and every starter passed with some room to spare. Five rounds of about 40 variants led to these.

| Preset | Id | Silhouette and character | Size (H × W × D) |
|---|---|---|---|
| **Bud vase** | `preset:bud-vase@1` | Tall and slim. A small round bulb under a long neck, with a band of rings on the neck. | 210 × 91 × 91 mm |
| **Petal bowl** | `preset:petal-bowl@1` | Wide and low. A fluted bowl on a foot ring; its rim opens into six soft petals. | 90 × 191 × 172 mm |
| **Double gourd** | `preset:double-gourd@1` | Two bulbs that meet at a crisp waist. A smooth band winds once round through the flutes. | 200 × 119 × 119 mm |
| **Faceted flask** | `preset:faceted-flask@1` | Flat and angular. An oval cut into ten facets, with a sharp shoulder and a short neck. | 180 × 117 × 75 mm |
| **Drape vase** | `preset:drape-vase@1` | Organic, driven by the Morph. Soft folds drift round the pot as it rises, like draped cloth. | 176 × 127 × 125 mm |

| Preset | Profile | Footprint | Morph | Detailed morph |
|---|---|---|---|---|
| Bud vase | Smooth, 5 points | circle | — | A Plain, B Ribs (1 mm, tile 15 mm), **Middle**, 60–196 mm |
| Petal bowl | **Gentle**, 4 points (a 10 mm foot ring) | circle | **Lean** × 6, 8 mm | Flutes × 30, 1.5 mm, 6–86 mm |
| Double gourd | Smooth, 7 points, **a sharp point** at the waist | circle | — | A Flutes × 16, 1.5 mm, B Plain, **Diagonal**, 6–194 mm |
| Faceted flask | **Angular**, 4 points, sharp corners | circle, **depth 0.6** (an oval) | — | Pleats × 10, 1.5 mm, 10–168 mm |
| Drape vase | Smooth, 4 points | circle | **Swirl** × 5, 6 mm | none |

What else they share:
- They keep the house process: a 3 mm bead, 1.5 mm layers, a hidden seam with a 15 mm ramp, 3 base layers, one wall, a smooth inner wall and the default rules.
- None has a hole: they are vases and a bowl.
- None has a Pattern (D52), assets or an image, and the Morphs use built-in maps.

**Why these numbers** (each was found by a check failing first):
- **Bud vase.**
  - The rings sit on the upright neck. Moved down onto the shoulder (relief from 10 or 30 mm), the shoulder's inward lean plus a starter breaks bead support.
  - Ribs with a 9 mm tile were too steep for the starters; a 15 mm tile keeps the worst support at 0.444.
  - The neck dips to a radius of 17.5 mm between its points. The printer's minimum layer time slows it there (§5).
- **Petal bowl.**
  - Without a foot, the flutes faded in, and the Pattern started, on a wall that already leans out 27°. That gave an overhang and failed the rib starters.
  - The 10 mm foot ring (52 → 53 mm) puts both on an upright wall, as a thrown bowl's foot does.
  - 36 flutes were too sharp under a Pattern at the foot (fineness). 30, five per petal, pass and read finer than 24.
- **Double gourd.**
  - Two choices keep both ends of the default Pattern range on upright wall:
    - a 10 mm foot point (42 → 44 mm);
    - the relief running to 194 mm, so a starter Pattern ends at the narrowest neck (188 mm).
  - Without them the rib starters failed at 12 mm and at 189 mm.
  - The flutes are 1.5 mm deep: at 1 mm the winding smooth band barely read in the thumbnail.
- **Faceted flask.**
  - A 30 mm neck made the pleats too tight under a Pattern there (fineness at 159–164 mm). 33 mm passes.
  - An oval (a circle footprint at depth 0.6) reads as faceted. A rectangle at the same depth ratio looked boxier, and two starters failed fineness at its rounded ends.
- **Drape vase.**
  - Of the five built-in maps, Swirl reads clearly as intended. Five repeats at 6 mm drift a tenth of a turn from foot to rim.
  - Blobs looked like a lumpy egg and failed bead support even at 5 mm.
  - Lobes with a twist looked like a bag.
  - It has no Detailed morph, so the Morph speaks; one can be added in Shape.

**Features across the eight:**
- **Profiles:** Smooth, Gentle and Angular. One sharp point.
- **Footprints:** circles, an oval, a rounded square and a square.
- **Twist:** the Twisted column.
- **Morph:** two maps (Lean, Swirl).
- **Blends:** Fades up, Middle and Diagonal.
- **Hole:** the planter.

Even and Fades down are left for the user, and twist stays the Twisted column's own.

## 4. The second audit: all eight

| Preset | Size (H × W × D) | Features | Warnings | Starters passing | Worst lean | Worst support | Tightest curve |
|---|---|---|---|---|---|---|---|
| Classic vase | 170 × 130 × 130 | Smooth; flutes → Plain, Fades up | none | 8 of 8 | 44.6° | 0.467 | 1.11 bead |
| Twisted column | 150 × 117 × 117 | rounded square, 60° twist, pleats | none | 8 of 8 | 30.0° | 0.376 | 0.97 bead |
| Square planter | 110 × 127 × 127 | Angular, square, basket, 14 mm hole | none | 8 of 8 | 35.5° | 0.496 | 1.15 bead |
| Bud vase | 210 × 91 × 91 | Smooth; Plain + ribs, Middle | none | 8 of 8 | 31.3° | 0.444 | ≥ 1.5 bead |
| Petal bowl | 90 × 191 × 172 | Gentle; Lean × 6; flutes × 30 | none | 8 of 8 | 40.8° | 0.465 | 0.75 bead |
| Double gourd | 200 × 119 × 119 | Smooth, sharp waist; flutes + Plain, Diagonal | none | 8 of 8 | 35.1° | 0.462 | 0.72 bead |
| Faceted flask | 180 × 117 × 75 | Angular, oval 0.6, pleats × 10 | none | 8 of 8 | 33.2° | 0.379 | 0.85 bead |
| Drape vase | 176 × 127 × 125 | Smooth; Swirl × 5 | none | 8 of 8 | 30.0° | 0.471 | ≥ 1.5 bead |

- Sizes are the finished outer size in mm, as the size chip shows it.
- Every preset normalises to itself and gives no design warning and no Print warning: the bed check is "Fits the bed", and export is allowed.
- Every preset writes G-code, a DXF and a closed STL.
- Each preview takes 4–15 ms in Node, with 18–30 k points.
- Every new preset keeps at least 4° under the overhang limit (the Petal bowl, 40.8°) and about 0.03 bead under the support limit (the Drape vase, 0.471).
- **The browser check passes on both layouts:**
  - Eight tiles, each with a thumbnail, in the order above.
  - Each preset opens on Shape as "Opened: <name>", with its Detailed morph and Morph and no Pattern.
  - The preset shows no warnings, and no chrome covers the pot.
  - There are no console errors.
- **On a phone, close points overlap.** The handles of points 10–12 mm apart (the bowl's and the gourd's foot, the gourd's neck and lip) overlap at the stage's scale. On desktop they are clear. *Edit as numbers* and pinching in reach each one.

## 5. The default print settings

The generic gantry (`defaultPrinter()`, a draft, D4):
- **Machine:** a 300 × 300 mm bed, 400 mm high, Marlin.
- **Extrusion:** relative E, a 3.1 mm feed.
- **Prime:** 300 mm³ at (0, −130) from the bed centre, at 20 mm, lifting 50 mm.
- **Skirt:** one loop, 15 mm out.
- **End:** a 10 mm lift and a 10 mm wipe.
- **Speeds:** wall 25, base 20, travel 40 and Z 10 mm/s.
- **Layer time:** at least 20 s per layer, and never slower than 8 mm/s.
- **Refills:** no reservoir (0 ml), so no refill pauses.

The Print step's defaults come from the design: one wall, walls 2.7 mm apart when there are two, and a smooth inner wall.

| Preset | Bead path | Material | Time (of which layer-time pauses) |
|---|---|---|---|
| Classic vase | 40.1 m | ≈ 181 ml | ≈ 43 min |
| Twisted column | 39.8 m | ≈ 179 ml | ≈ 39 min |
| Square planter | 45.9 m | ≈ 206 ml | ≈ 36 min |
| Bud vase | 27.5 m | ≈ 124 ml | ≈ 49 min (6) |
| Petal bowl | 37.8 m | ≈ 170 ml | ≈ 29 min |
| Double gourd | 42.1 m | ≈ 190 ml | ≈ 49 min |
| Faceted flask | 32.1 m | ≈ 144 ml | ≈ 43 min |
| Drape vase | 44.5 m | ≈ 200 ml | ≈ 44 min |

How these were measured:
- Times come from the G-code: each move's length over its feed rate, plus the `G4` pauses.
- Material is the bead path × bead width × layer height.

Findings:
- **Everything fits.** The widest is the Petal bowl: its skirt reaches about 112 mm from the centre, against a 150 mm half-bed. The tallest is the Bud vase: 210 mm plus the 10 mm end lift, against 400 mm.
- **The prime park point limits the width more than the bed does.**
  - At (0, −130), the park check fails once the skirt reaches it: a pot about 225 mm wide, against about 265 mm for the bed.
  - The Petal bowl clears it by about 17 mm, so scaling it up past about 225 mm wide brings "The prime point is over the pot or the skirt".
  - This is fine for a draft. A named printer profile may want the park point further out.
- **The Bud vase's slim neck is the only place the minimum layer time adds pauses.**
  - Its layers there take about 15 s even at 8 mm/s, so each one ends with a `G4` pause of a few seconds: 6 minutes in all.
  - That gives the neck its drying time. Whether a pause at the seam leaves a mark is a question for the printer test (D4).
- **No preset needs a refill on a reservoir of 250 ml or more.** Every one stays under 210 ml.
- The remaining values (speeds, prime, skirt, end moves) are unchanged and untested on a printer, as the app says (D4).

## 6. Tests

- `test/presets.test.js`:
  - Names the eight in order, the confirmed three first.
  - Checks each preset's id (`preset:<slug>@1`), its one-line plain description (no clay, material, slicer or layer words, D7 and D15), and that it is a shape (no Pattern, no assets, a built-in morph map).
  - Checks that each previews and prints on the generic gantry with "Fits the bed" as its only Print check.
- The loops over `presets` in `design`, `checks`, `engine`, `issues`, `cad`, `layer-pattern`, `saved-patterns`, `stage`, `toolpath` and `starters` now cover all eight. `starters.test.js` holds every preset to "every starter adds no warning".
- **Golden G-code for every preset** (`test/gcode.test.js` names each file after the preset's id).
  - The five new files are 0.57–0.89 MB each (3.7 MB in all).
  - Between them they guard paths no golden covered: the Morph, the Gentle and Angular curves, a sharp point, an oval, and the Middle and Diagonal blends.
  - The four existing goldens are byte for byte unchanged.
- `test/cad.test.js` uses `'followPattern'` and checks that following holds less than smooth.
- 366 tests at the start, 428 now, all passing.

## 7. For the owner

**The owner's answers (2026-11-25):** 1 yes, the five stay; 2 the Classic vase stays as it is; 3 no answer, so the descriptions stay unshown for now; 4 agreed. Item 5 is information only.

1. **Do the five new presets stay?** Bud vase, Petal bowl, Double gourd, Faceted flask and Drape vase, after the three confirmed ones. Their names, forms and order are the builder's.
2. **The Classic vase's 0.45° margin (finding 1).** Recommendation: leave it.
   - The default pot passes every check.
   - The only real fix is a visibly different foot.
   - Widening the foot to 44 mm buys 1.2° (a 1.7° margin), and it would rewrite `defaultDesign()` and the Classic vase's golden file.
3. **The descriptions aren't shown anywhere.** Each preset has one, but the Designs screen shows only names. A tooltip on a preset tile is a small addition if wanted.
4. **Calls made, which can be undone:**
   - The flask is an oval, not a rectangle.
   - The Drape vase has no Detailed morph.
   - Morph blend is 1, not 0.8, so Strength is the real push.
   - Every preset has a golden file (3.7 MB more).
   - Two bugs were fixed in passing: the camera fit on opening (`main.js`) and the STL's inner wall (`core/cad.js`).
5. **Things that may look like problems but are by design:**
   - A starter Pattern on the Bud vase covers only the neck (63–193 mm), because a new Pattern runs over the Detailed morph's range (§3.4). Drag *From* down to cover the bulb.
   - On a phone, the foot and neck handles of the bowl and the gourd overlap (§4).
