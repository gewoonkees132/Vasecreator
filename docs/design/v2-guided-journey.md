# Vasecreator v2: the guided design journey (issue #1)

- **Date:** 2026-11-24
- **Status:** Approved by the owner on 2026-11-24. This is the input for building it.
- **Issue:** [#1 Guided design journey: Shape → Pattern → Layers & seam → Base](https://github.com/gewoonkees132/Vasecreator/issues/1) (label *brainstorm*).
- **Builds on:** [`v2-design-brainstorm.md`](v2-design-brainstorm.md), the "design" below (§ numbers without a prefix point there). It revises §8.1, §8.2, §8.3, §8.6, §10, D19 and D22. The owner's decisions from this brainstorm go into the design's §3 as D28–D34, and my calls into its §17 as C24–C36.
- **Code:** everything lives in `v2/`. Paths below are relative to it.

---

## 1. Intent and the why

The owner believes a pot turns out best when people finish its **shape first**, and only then design the pattern, then the layers and seam, then the base. Today's app doesn't say that. The desktop panel opens on *Surface* (patterns), so a new visitor lands on patterns before touching the form. Shape options are scattered: Geometry morph, Profile curve, Profile points and a second Footprint sit under a global *Advanced* button far from Shape.

The owner wants the journey **strongly guided but never blocking**: a clear order of steps, the controls of one step at a time, and a *Next* button, while every step stays one tap away. Mobile matters most: the owner expects most people to use the app on a phone, so on a phone the steps become an app-style bottom bar. The pot gets most of the screen, and most of the designing happens on the pot itself.

## 2. What the owner decided

Recorded as D28–D34 in the design's §3.

| # | Decision | Source |
|---|---|---|
| D28 | **Five steps in a fixed order: 1 Shape, 2 Pattern, 3 Layers & seam, 4 Base, 5 Print.** Shape includes everything about the form: size, footprint, twist, profile curve, profile points and geometry morph. Print is today's Prepare print. You can go to any step at any time; nothing is locked. The step you're on is dark, the others light grey, with no lock icons and no "visited" marks. Each step ends with *Next*. | Owner (order, free movement, two shades); accepted (Print as step 5) |
| D29 | **In Shape the pot is shown plain.** The pattern is hidden while you're in step 1 and comes back from step 2 on. | Owner |
| D30 | **Presets are shapes; patterns are picked in the Pattern step.** On the Designs screen the presets show as plain pots, and picking one starts you on Shape with no pattern. Your own saved designs open whole (they're your finished work). | Owner (separation); accepted (saved designs open whole) |
| D31 | **Phone: the steps are a bottom bar with an emblem per step.** The pot gets most of the screen, and the controls sit in a compact area between the pot and the bar. Each step is split into small parts, picked from a row of buttons, and only that part's controls show. This revises D22's 40/60 split; its principle stays: nothing covers the pot. | Owner |
| D32 | **Desktop: the same five emblems at the top of the left panel** (the "Concept 1" layout). A step shows all its parts at once, under small headings. | Owner |
| D33 | **The Advanced button goes** (reverses D19). Profile curve, Profile points and Geometry morph become parts of Shape; Footprint appears once, in Shape. | Accepted |
| D34 | **The Twisted column preset gets rounded square corners,** so its 60° twist shows on the bare shape. It was round, and a twist on a round pot only shows through a pattern. This changes C4's preset and its golden G-code. | Owner |

Also accepted in the conversation (my proposals, which the owner approved after seeing them):

- **Where you land.** A preset, a saved design or an opened design file opens on Shape. A page reload returns you to the step you were on. The *Last design* tile keeps the step you're on.
- **The plain pot in Shape (D29) has consequences.** In Shape, the size chip and the warnings describe the bare form. From Pattern on they include the pattern, so 124 mm can read 129 mm once a 2.5 mm pattern is on.
- **History always shows the finished pot**, pattern included, also for changes made in Shape.
- **Each step shows only its own aids on the pot.** The profile points (drag handles) show in Shape only. The seam line shows in Layers & seam only (as C13 already says). The bed and the final walls show in Print (as today's Prepare print).
- **"Surface" is called "Pattern"** everywhere on screen.
- **On a phone, the controls area keeps one height,** so the pot never jumps when you switch steps or parts. A long part (the printer settings, the list of profile points) scrolls inside it. Each step remembers which part you last had open.
- **The first-visit tip** (issue #2) sits at the top of the controls until it's closed.
- **A preset keeps its layer and base settings** (the Square planter keeps its drainage hole) but loses its pattern.

## 3. Goals, non-goals, anti-goals

**Goals**

- A new visitor sees, without reading anything, that designing goes Shape → Pattern → Layers & seam → Base → Print, and starts on Shape.
- On a mid-range Android phone in Chrome, the pot is about twice as tall as today. The first controls of each part show without scrolling; a longer part scrolls inside the controls area, never the page.
- One layout to learn: the same five emblems, in the same order, on a laptop and a phone.
- Every control still updates the pot live (D20); switching steps never moves the camera.

**Non-goals**

- The pattern studio pop-up (#3) and base design (#4). The Pattern and Base steps host today's controls; those issues rework them later. Keep the Pattern step a thin host for that.
- Any change to the engine, the G-code writer, the design file or the data model. Saved designs and history stay valid as they are. The one data change is the Twisted column preset (D34).
- A guided tour, coach marks or onboarding screens.
- A landscape-phone or tablet layout. Today's breakpoint (≤ 760 px wide = phone) stays; see §9 for the one guard against a broken landscape phone.

**Anti-goals** (failures even if it works)

- **Anything that feels locked.** No step, part or control may refuse a tap or nag before letting you through.
- **Covering the pot on a phone** (D22's principle).
- **Losing a drag or a field you're typing in** when the layout or step changes. Controls are built once and moved, never rebuilt (today's sidebar rule).
- **A slower phone.** Switching steps may cost one preview; nothing may add work to a drag.
- **A new dependency.** Emblems are inline SVG drawn in-house; nothing joins the import map.

## 4. Constraints

- **D0:** free for everyone; no accounts, no gated features.
- **D3:** must work on desktop and on a real mid-range Android phone in Chrome, within research §10.3's budgets.
- **D20:** everything updates live; editing never moves the camera.
- **D22 (principle):** nothing covers the pot on a phone.
- **ARCHITECTURE.md rules:** plain ES modules, no build step, no framework, only `render/` imports three.js, v2 changes no v1 file. Update ARCHITECTURE.md in the same commit as any contract change.
- **WCAG 2.1 AA on the panels** (design §18). The light-grey steps must still read: labels at least 4.5:1 and emblems at least 3:1 against their background. The mockup used `rgba(18,47,45,.66)` for labels and `.5` for emblems on white, which meets both.

## 5. Approaches considered

1. **A step frame around the existing sections (picked).** A new module replaces today's cards, phone tabs and the separate Prepare print mode. Each section keeps its single mount and only labels which part each of its control groups belongs to. On desktop a step shows all its parts with headings; on a phone the part row shows one part at a time by hiding the others. Least churn, and it keeps the rule that controls are built once and moved, never rebuilt.
2. **Split every section into separate part modules.** Each part is its own `{ mount, update }`. Tidiest long term, but it rewrites `ui/sections/surface.js` (546 lines) and `ui/print.js` (428 lines) now, and #3 will rework Pattern anyway.
3. **Parts as jump links on the phone.** Steps show whole sections, and a part button scrolls to its heading. Least code, but the phone shows several parts at once in a scrolling list, which the owner didn't want ("each subsection shows this cleanly").

The owner talked about outcomes and left the how to me; I picked 1.

For D29 (plain pot in Shape) there was one sensible way: `main.js` sends the engine a copy of the design with the pattern switched off. The engine doesn't change. A separate "plain" flag in the engine would add plumbing for the same result.

## 6. How it looks

The throwaway mockups from the brainstorm are not in the repository. These sketches carry what was approved.

### 6.1 Phone (≤ 760 px wide)

```
┌──────────────────────────────┐
│ ▣                  ↶  ↷      │  top bar: logo (menu: Designs, Save design), undo, redo
│ No warnings  170 × 124 × 124 │  chips, top left
│                       ┌────┐ │
│                       │ ▢  │ │  history: 3 newest, tap for the full list
│      ( white bead pot,│ ▢  │ │  (no Advanced button)
│        drag points    │ ▢  │ │
│        in Shape )     └────┘ │
│                              │  pot: about half the screen
├──────────────────────────────┤
│ Shape          [Next: Pattern →]  header: step name, Next
│ [Size] Footprint  Twist │ Curve  Points  Morph   part row (scrolls sideways)
│ Height   [−] 170 mm [+]      │
│ ──────────●─────────         │  one part's controls; a long part scrolls here
│ Width    [−] 124 mm [+]      │
│ ────────●───────────         │
├──────────────────────────────┤
│ (◉)    ▥      ≡      ◎     ⊥ │  bottom bar: emblems + labels
│ Shape Pattern Layers Base Print   current: dark; others: light grey
└──────────────────────────────┘
```

- **The top bar** keeps the logo menu, undo and redo. The *Print →* button goes: Print is step 5.
- **The bottom bar** has five equal buttons, each an emblem over a short label: Shape, Pattern, Layers, Base, Print. The current one has a dark rounded indicator behind a white emblem and a bold dark label. The others are light grey, with no locks or dots.
- **The controls area** sits between the pot and the bar and never overlaps the pot. It holds a header (the step's full name and *Next*), the part row, and the current part's controls.
- **The part row** is a row of buttons, one per part, scrolling sideways when it doesn't fit. In Shape, a thin divider separates the everyday parts (Size, Footprint, Twist) from the finer ones (Curve, Points, Morph). The current part is marked (dark outline, light tint, bold).
- **Next** sits at the right of the header with the next step's short name ("Next: Pattern →", "Next: Layers →", "Next: Base →", "Next: Print →"). Print has no Next.

### 6.2 Desktop

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ▣ Vase Creator   Created with ♥ by …          ↶  ↷   [Designs] [Save design]   │
├──────────────────────┬──────────────────────────────────────────┬─────────────┤
│ (◉)  ▥   ≡   ◎   ⊥   │                  [No warnings] [170 × 124 × 124 mm]    │
│ Shape Pattern Layers Base Print         │                         │ History     │
│ ──────────────────── │                                          │ ▢ now       │
│ SIZE                 │         ( white bead pot,                │ ▢ 1 min     │
│ Height  ──●── [170 mm]          plain in Shape,                 │ ▢ 2 min     │
│ Width   ──●── [124 mm]          drag points on its edge )       │ ▢ 4 min     │
│ Depth   ──●── [124 mm] 🔒                                       │             │
│ FOOTPRINT            │                                          │             │
│ [Circle | Rectangle] │                                          │             │
│ TWIST                │                                          │             │
│ Twist   ●──── [0°]   │                                          │             │
│ ▸ More shape options │                                          │             │
│   curve · points · morph                                        │             │
│ [   Next: Pattern →  ]                                          │             │
└──────────────────────┴──────────────────────────────────────────┴─────────────┘
```

- **The step row** is at the top of the left panel and stays there while the panel scrolls. Same emblems, order and two shades as the phone; the emblems are a little smaller.
- **A step shows all its parts,** each under a small uppercase heading with the part's name. In Shape, Curve, Points and Morph sit behind a *More shape options* disclosure, closed by default and remembered in this browser.
- **Next** is a full-width button at the bottom of the panel and stays visible while the panel scrolls.
- **The top bar** loses *Prepare print →*: Print is step 5.
- **The right column** keeps the history card and loses the Advanced button.

### 6.3 The steps and their parts

| Step (bar label) | Header | Parts, in order | Comes from |
|---|---|---|---|
| Shape | Shape | **Size** (height, width, depth with its lock) · **Footprint** (circle or rectangle, corner rounding) · **Twist** · ┊ · **Curve** · **Points** · **Morph** | `sections/shape.js` split into three parts; `curve.js`, `points.js`, `morph.js` whole. `footprint.js` is dropped |
| Pattern | Pattern | **Swatch** (slots A and B, the swatch grid, My patterns, + Image) · **Depth** · **Repeats** (repeats around, tile height) · **From / to** · **Blend** (blend and amount) | `sections/surface.js`, its existing element groups tagged |
| Layers | Layers & seam | **Seam** (position, angle, ramp length) · **Bead** (bead width, layer height) · **Overhang** (overhang limit) | `sections/layers.js` |
| Base | Base | **Base** (base layers, infill) · **Hole** | `sections/base.js` |
| Print | Print | **Walls** · **Printer** · **Check** · **Export** | `ui/print.js`, its four cards; its header and "← Back to design" go |

On desktop, *More shape options* holds Curve, Points and Morph. On a phone they're ordinary parts after the divider.

**Pattern parts on a new design (C34).** A new design has slot A Plain and slot B empty (D30), and `surface.js` already hides depth, repeats and tile height for a Plain slot and blend for an empty slot B. So the Pattern parts appear when they apply: *Depth* and *Repeats* once the chosen slot has a pattern, *From / to* once either slot has one, and *Blend* once slot B has one. A new design's Pattern step therefore shows only *Swatch*, and the row grows as you pick. Nothing is greyed out or locked: a part that doesn't apply simply isn't there yet, as today. On desktop the matching headings follow the same rule.

**The A/B slot cards (C34).** *Depth* and *Repeats* edit whichever slot is chosen, so on a phone the slot cards show above *Swatch*, *Depth* and *Repeats* alike. The cards are one element, tagged with all three parts. On desktop they show once, at the top of the step.

**Swatches on a phone (C35)** are one row that scrolls sideways, as in the approved mockup: the library, then My patterns, then *+ Image*, with the pattern actions (*Edit pattern…*) under the row. On desktop the grid stays.

### 6.4 Emblems

Inline SVG, 24 × 24 viewBox, 1.8 px round strokes in `currentColor`, drawn in-house:

- **Shape:** a vase outline.
- **Pattern:** a rounded square with three wavy vertical lines.
- **Layers & seam:** three horizontal lines, the middle one with a small step (the seam ramp).
- **Base:** two nested ellipses with a dot (the base spiral seen from an angle).
- **Print:** a nozzle above two lines.

## 7. How it behaves

### 7.1 Moving between steps

- Tapping any step opens it, at any time. *Next* opens the following step. Nothing is ever disabled because of the step order.
- Switching steps never moves the camera (D20) and never adds a history step.
- **Where you land:** opening a preset, a saved design or a design file sets the step to Shape. The *Last design* tile keeps the current step. A reload restores the step you were on (`localStorage`, like today's open sections). The very first visit starts on Shape.
- **Each step remembers its part on a phone** for the session: going Pattern → Shape → Pattern comes back to the part you had open. On a reload every step starts on its first part.
- **Leaving Shape** clears the selected profile point, so Delete can't remove a point you can't see.
- **Undo, redo and restoring history never change the step.** An undone pattern change made while you're in Shape shows in the history column (its thumbnails show the full pot), not on the plain pot. Jumping to another step on undo would be more surprising than the quiet pot. (My call.)

### 7.2 What the pot shows per step

| Step | Pot | Drag points | Seam line | Bed and final walls |
|---|---|---|---|---|
| Shape | plain (pattern off), morph and twist on | shown | – | – |
| Pattern | full | – | – | – |
| Layers & seam | full | – | shown | – |
| Base | full | – | – | – |
| Print | final walls (as today's Prepare print) | – | – | shown |

**The plain pot (D29).** In Shape, `main.js` sends `engine.preview` a copy of the design with slot A set to *Plain* and slot B to none. That copy also drives the size chip and the warnings in Shape: they describe the bare form, so pattern-only warnings (fine pattern, a missing pattern, overhangs caused only by the pattern) don't show until step 2. A useful side effect: a plain preview needs far fewer points per layer, so dragging in Shape gets lighter on a phone.

**Twist on a plain round pot** changes nothing you can see: it twists corners, the morph and the pattern. In Shape, when the footprint is a circle and there's no morph, a one-line note under Twist says it shows once there's a pattern, a corner or a morph. (My call, C30.)

### 7.3 History and thumbnails

- History steps always show the finished pot. While the pot on screen is plain (Shape), the step's thumbnail comes from `thumbnailFor(design)`, a separate full preview that waits until the live preview is idle, instead of from the canvas. Outside Shape it's taken from the canvas as today.
- The same goes for the thumbnail *Save design* makes (`currentThumb` in `ui/designs.js`): in Shape, use `thumbnailFor`.
- As today: no thumbnails are taken in Print, history steps can't be restored while in Print, and undo, redo and *Save design* are off in Print, because they would change the design under a computed print.

### 7.4 The Designs screen

- The "Continue · Presets" row keeps its *Last design* tile and shows the three presets as **plain pots**: their thumbnails are rendered from the shape copy described below.
- **Opening a preset** opens a copy with slot A set to the plain slot (`{ pattern: 'plain', depthMm: 0, repeats: 1, tileHeightMm }` with the preset's own tile height) and slot B set to none. Everything else stays: form, layers, base (the Square planter keeps its 14 mm hole), finish. The first swatch picked in the Pattern step then gets that pattern's own defaults, as `surface.js` already does when switching from Plain.
- **The first visit** opens Classic vase the same way, as a shape, on the Shape step.
- **Saved designs and design files** open whole, on the Shape step.
- The shape copy is made in the UI; the presets in `library/presets.json` keep their patterns, so the golden G-code tests still cover them. The one preset change is D34: Twisted column becomes `footprint: 'rectangle'`, `depthRatio: 1`, `cornerRounding: 0.3` (the Square planter's rounding), with its twist, profile and pleats unchanged. Its golden file, `test/golden/twisted-column.gcode`, is rewritten with `UPDATE_GOLDEN=1 npm test` after reading the diff. Its seam keeps following the twist.
- The first-visit tip's wording changes to match: on desktop, "Want a head start? Pick a shape or one of your saved designs under Designs in the top bar." On a phone, "Want a head start? Shapes and saved designs are in the menu behind the logo."

### 7.5 Phone layout numbers (revises D22's 40/60)

> **Revised by the mobile stage** ([`v2-mobile-stage.md`](v2-mobile-stage.md), M1–M5, awaiting the owner's check): on a phone the controls area below is now an optional sheet (`clamp(220px, 34dvh, 300px)`), and by default a slim dock above the bar replaces it, so the pot gets about 370 px of a 360 × 660 viewport.

- **The bottom bar** is 64 px plus `env(safe-area-inset-bottom)`.
- **The controls area** is `clamp(200px, 30dvh, 260px)` tall, fixed per screen size, so the pot never jumps. On a 360 × 660 px Chrome viewport that leaves the pot about 320 px, against about 190 px today.
- **The pot** gets everything between the top bar and the controls area, clear of the chips and the history column (`viewportRect` in `main.js` as today).
- **The warnings list and the full history** still open over the controls area and the bar, never over the pot. They get less room than before and scroll.
- **When the screen is short** (a landscape phone, under about 520 px tall), the controls area may shrink to 160 px so the pot keeps some room. Landscape isn't designed beyond that (non-goal).
- **What fits.** At 200 px, after the header and the part row, about two 44 px controls show; Size (height, width, depth), Footprint with a rectangle, Seam, Base, Curve, Blend, Points and Morph are taller and scroll inside the area (C35). The builder may make the phone controls more compact (for example a slider and its value on one row) as long as touch targets stay 44 px and desktop doesn't change.

### 7.6 The first-visit tip (issue #2)

It stays at the top of the controls: on desktop between the step row and the first part, as today's card. On a phone the controls area is too small for today's card (about 100 px of 200), so there it shrinks to **one line with a close button** (C36): the phone text from §7.4 and a × that does what *Got it* does, at the top of the controls area, scrolling with the part's controls. The logo keeps its ring, and *Show designs* goes on a phone (the logo menu is the way in). It hides in Print, as it hides in Prepare print today.

### 7.7 Keyboard and screen readers

- The step row (desktop) and the bottom bar (phone) are a `tablist` labelled "Design steps", with one `tab` per step and the step's content as the `tabpanel`. Arrow keys, Home and End move between steps, as today's phone tabs do. Each tab's accessible name is the full step name ("Layers & seam").
- The part row on a phone is a second `tablist` ("Shape parts") controlling the part shown. On desktop the parts are headings.
- Each step's tab gets the section's existing `summary` as its description (`title` on desktop, `aria-description` or a visually hidden span), for example "Shape: 170 × 124 mm · circle · twist 0°".
- *Next* is a button named after where it goes ("Next: Pattern").

## 8. Where it touches the code

- **New `ui/steps.js`** replaces `ui/sidebar.js`. It holds the step list (id, title, short label, emblem, sections and parts), renders the step row (desktop) or the bottom bar and part row (phone), mounts each section once in a host element it moves between layouts (as `sidebar.js` does today), shows the current step's sections, and on a phone hides every part but the current one. It mounts the print panel as the Print step's content.
- **Sections** keep `{ id, title, summary, mount }`, drop `advanced`, and mark their control groups with `data-part="<part id>"` on the elements they append (for example `shape.js`: height, width and depth → `size`; the footprint controls → `footprint`; twist → `twist`). Sections that are a single part (curve, points, morph) need no tags. Update the "UI contracts" section of ARCHITECTURE.md.
- **`ui/sections/footprint.js`** is removed (Footprint lives in Shape). **`ui/sections/surface.js`** gets the title *Pattern* and its summary wording follows. Its id `surface` can stay; the design's `surface` key doesn't change. It tags its groups per §6.3 (the slot row with several parts, C34), tells the step frame which parts currently apply, and on a phone shows the swatch grid as one sideways row (C35, CSS only if possible).
- **`ui/print.js`** loses its header and "← Back to design"; its four cards become the Print step's parts. Its `visible()` test becomes "the step is Print".
- **Store view state (`store/store.js`):** add `view.step` (`'shape' | 'pattern' | 'layers' | 'base' | 'print'`, remembered as `vc2.step`) and `view.parts` (current part per step, session only). `view.mode` stays as a value derived from the step (`'print'` on Print, else `'design'`), kept in sync inside `setView`, so `topbar.js`, `history.js`, `designs-tip.js` and `main.js` keep working. Remove `view.advanced`, `view.openSections` and `view.phoneTab`, and stop reading `vc2.advanced` and `vc2.openSections`.
- **`main.js`:** the plain-copy preview in Shape; handles visible only in Shape (`handles.setVisible`); seam marker only on the Layers step (`applySeam`); thumbnails per §7.3; clear `selectedKnot` when leaving Shape. `ctx.resultDesign()` must keep returning the **store's** design object the shown result belongs to, not the plain copy, because `ui/chips.js` matches results by identity. Add a way to tell that the shown result is plain (for example `ctx.resultIsPlain()`), so the size card and the thumbnails can act on it.
- **`ui/topbar.js`:** remove the *Prepare print →* / *Print →* button.
- **`ui/history.js`:** remove the Advanced button and its phone styles.
- **`ui/designs.js`:** preset tiles and preset opening per §7.4; `openDesign` sets the step to Shape, except for the *Last design* tile; the save thumbnail per §7.3.
- **`ui/designs-tip.js`:** new wording; inserted into the step frame's top as §7.6 says; one line with a close button on a phone (C36).
- **`index.html`:** `#panel` holds the step frame. The separate `#design-panel` / `#print-panel` pair can go if the step frame owns both.
- **`styles/app.css`, `styles/panels.css`:** the phone layout numbers (§7.5), the bottom bar, the step row, the part row, the controls area header; remove the card, tab, Advanced divider and Advanced button styles.
- **`library/presets.json` and `test/golden/twisted-column.gcode`:** D34.
- **Docs:** design §3 (D28–D34), C4 (the Twisted column's footprint), §8.1, §8.2, §8.3, §8.6, §10 (point here), §17 (C24–C36); ARCHITECTURE.md (status, folder layout, UI contracts, the layout sketch).

## 9. Left to the builder

- The exact emblem paths, spacing and font sizes, within §6 and the visual tokens.
- How `ui/steps.js` is organised inside, and whether `#design-panel` / `#print-panel` survive.
- How the subsection tags are read (a `data-part` attribute, a returned list of groups, or similar), as long as every control is still mounted once.
- Focus handling when the step changes: move focus to the step's content only when the change came from *Next* or the keyboard, never on a tap that leaves focus on the bar.
- Whether *More shape options* animates (respect `prefers-reduced-motion`).
- The checks before calling it done: no tests cover the UI, so verify by hand in a browser at desktop width and at a 360 px phone width (touch emulation), then on a real mid-range Android phone in Chrome (D3). Check at least: each step and part; drag a point in Shape; switch to Pattern and back during a typed edit; the size chip in Shape and in Pattern; the history thumbnails after editing in Shape; Print's checks and downloads; the first-visit tip; opening each preset and a saved design. `npm test` must still pass, with every golden G-code file unchanged except `twisted-column.gcode` (D34).

## 10. My calls (please check)

Recorded as C24–C36 in the design's §17.

| # | Call | Why |
|---|---|---|
| C24 | **A step frame around the existing sections,** which tag their parts (§5 approach 1) | Least churn; keeps the "mounted once, moved never rebuilt" rule; leaves Pattern thin for #3 |
| C25 | **`view.step` is the source of truth;** `view.mode` stays, derived from it; the step is remembered in `localStorage` | Every module that tests `view.mode === 'print'` keeps working; a reload returns to the step |
| C26 | **Phone controls area `clamp(200px, 30dvh, 260px)`, bottom bar 64 px** (160 px minimum on short screens) | Two controls plus the header and part row fit; the pot gets about half the screen |
| C27 | **Desktop step row stays at the top and Next at the bottom while the panel scrolls;** *More shape options* starts closed and is remembered | The steps and the way forward are always in sight |
| C28 | **The parts per step** as in §6.3 | They follow the existing control groups, so no control moves to another step |
| C29 | **Opening a preset sets slot A to Plain and slot B to none** and keeps everything else; the first visit opens Classic vase the same way; the preset files keep their patterns | Presets become shapes (D30) while the library, and the golden G-code that tests it, still hold whole designs |
| C30 | **A note under Twist** in Shape when it can't show (round footprint, no morph) | Twist is invisible on a plain round pot, and a control that seems to do nothing feels broken |
| C31 | **Undo, redo, Save design and restoring history stay off in Print,** as in today's Prepare print | They would change the design under a computed print |
| C32 | **Thumbnails of steps made in Shape come from a separate full preview** after the live preview is idle | History shows the finished pot without slowing a drag |
| C33 | **Emblems are inline SVG drawn in-house** (§6.4) | No icon library joins the import map |
| C34 | **Pattern parts appear when they apply** (Depth and Repeats with a pattern in the chosen slot, From / to with any pattern, Blend with a pattern in B), and on a phone **the A/B slot cards show above every per-slot part** | `surface.js` already hides those controls then; an empty part would look broken, a greyed one locked. Depth and Repeats edit the chosen slot, so it must be in sight |
| C35 | **On a phone, swatches are one sideways row,** and parts taller than the controls area scroll inside it | Matches the approved mockup and keeps the pot large; the alternative, a taller area, costs the pot its room |
| C36 | **On a phone, the first-visit tip is one line with a close button** | Today's card would fill the whole controls area on the very first screen |
