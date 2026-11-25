# Vasecreator v2: the design experience

- **Date:** 2026-11-23
- **Status:** Approved by the owner on 2026-11-23. This is the input for implementation planning.
- **Builds on:** [`docs/research/toolpath-foundation.md`](../research/toolpath-foundation.md), the "research" below. Section numbers such as §5.2 refer to it. This document doesn't repeat the research; it says what to build on top of it and where it departs from it.
- **Decisions:** D0–D5 are in research §11.1. New decisions start at D6 (§3). Calls I made without an explicit owner decision are listed separately (§17), so they can be checked.

**How to read this document**

- §1–§7 say what v2 is, who it's for and why, and what is fixed.
- §8–§12 describe the interface and how each part behaves. They are what a builder plans from.
- §13–§14 cover the data model and architecture changes against the research.
- §15 is the release order, §16 answers the research's open questions, §17 lists my calls, and §18 lists what is left to the builder.
- Sketches are in text. The clickable mockups made during the brainstorm are throwaway and not in the repository.

---

## 1. Summary

Vasecreator v2 is a free, browser-based design tool for 3D-printed clay vessels. It keeps what makes today's app pleasant: you shape the pot directly in a 3D view and fine-tune it in a sidebar. Underneath, it computes the real nozzle path, and the pot on screen is drawn from exactly that path, bead by bead, in a clean white. What you see is what prints.

The design is everything. While designing, nobody has to think about clay, layer counts, material or printers. You start from a tile (your last design, a preset or a saved design), shape the profile, click a seamless pattern swatch, blend it into a second pattern, and watch every change live. A history column lets you go back to any earlier step. Advanced options, such as exact profile points and the profile curve type, sit behind one button, so the main menu stays easy to follow.

Only at the end, in *Prepare print*, do printing matters appear: one or two walls, a generic gantry printer, a final check and the G-code download.

v2 is built next to today's app in its own folder, previewed at `vasecreator.com/v2`, and replaces today's app when the first release is complete.

---

## 2. Intent and the why

- **The product is the design step.** D4 put the weight on "a really good interface" before G-code. In the brainstorm the owner sharpened it: "in the end it's all about design".
- **Clay first, at high quality.** The first users have high-quality clay printers and expect the best possible result. Professionals using robot arms may follow later.
- **Free and open stays the strategy (D0).** The research found the free, browser-local, open-source slot empty (research §1, finding 2). Potterware gates export behind a subscription, and WASP App builds G-code on its server.
- **Toolpath-first is the foundation.** The research established why (research §1, §3.7): the printer runs a path, and texturing a mesh and slicing it fails for clay. This document is about the experience on top of that foundation.

---

## 3. Decisions

D0–D5 stand as recorded in research §11.1. These were added in the brainstorm. "Owner" means the owner said it. "Accepted" means I proposed it and the owner approved it, either outright or after seeing it in a mockup.

| # | Decision | Source |
|---|---|---|
| D6 | **Clay only for now.** FDM output is out of this round. This narrows D1, and the FDM half of D2, until a later release. | Owner |
| D7 | **Design in bead terms, never in "clay" terms.** Bead width and layer height are plain design settings (under *Layers & seam*). They drive the bead preview and the checks. The design view never mentions clay. | Owner (the setting itself: accepted) |
| D8 | **Overhang limit: 45° from vertical by default.** Going past it shows a warning and colours the affected beads. It never blocks designing, and the limit can be changed. | Owner (45°); accepted (how it shows) |
| D9 | **One generic gantry printer.** Output targets a Cartesian gantry printer with editable bed, origin and extrusion settings. Named printer profiles, robots and other output compatibility come later. | Owner |
| D10 | **Planar layers with a seam, plus a bottom infill.** The nozzle steps up at a seam ramp. There is no continuous-spiral mode. Non-planarity is out for now. | Owner |
| D11 | **Footprints: circle and rectangle.** Polygons and custom 2D outlines come later, under Advanced. | Owner |
| D12 | **Design in the 3D view, as today.** Profile points are dragged on the pot. The left sidebar is where everything is fine-tuned, and every number can be dragged or typed. | Owner |
| D13 | **A Designs screen of rectangular tiles:** your last design first, then three presets, then your saved designs. *Save design* adds a tile. | Owner |
| D14 | **History:** every change is kept and shown as a vertical column of thumbnails on the right, newest on top. Click one to go back. Undo and redo also work. | Owner |
| D15 | **Beads only.** No lines view, no layer-by-layer playback, and no layer count or material amount in the design view. | Owner |
| D16 | **Patterns start as small seamless swatches you click.** They come from a bitmap pattern generator (motifs such as out-in-out, arranged as stripes, brick and so on), and they always wrap round the pot a whole number of times. | Owner |
| D17 | **Two patterns, A and B, that blend.** *Even*, *Fades up* or *Middle* sets where B takes over, and an amount works as the multiplier. Transitions are always gradual. This replaces the research's curves over height and rules list. B can be *Plain*, which gives a fade to a smooth surface. | Owner |
| D18 | **No height rail.** Where the pattern starts and stops is two numbers. | Owner |
| D19 | **Advanced is a button under the history,** with the same width and colour as the history card. Switching it on adds the advanced sections to the sidebar: profile curve, exact profile points and footprint. **Reversed by D33** (issue #1). | Owner |
| D20 | **Everything updates live.** Every control, Advanced ones included, updates the pot while you drag. Editing never moves the camera. | Owner |
| D21 | **Visual style.** Pots and pattern swatches are a clean, professional white. The chips at the top right (warnings, size) use the same small corner radius as the buttons, and the size chip sits to the right of the warnings chip. | Owner |
| D22 | **Phone layout.** The pot gets the top 40 % of the screen and the controls a fixed 60 % below it. Nothing covers the pot. **The 40/60 split is revised by D31** (issue #1); the principle stays. | Owner (principle); accepted (40/60) |
| D23 | **Geometry morph** is an advanced feature in a later release: a bitmap, softened with a Gaussian blur, reshapes the whole form, with blend numbers. | Owner |
| D24 | **The pattern editor** (making your own patterns) comes right after the first release. | Owner |
| D25 | **Build v2 next to v1** in its own folder, served at `vasecreator.com/v2` as an open preview, and swap when the first release is complete (§7). | Owner |
| D26 | **After launch, every later item is written up as a GitHub issue,** clearly documented. §15.4 lists them ready to copy. | Owner |
| D27 | **With 2 walls, the inner wall is smooth by default,** set behind the outer wall's deepest groove so the walls never cross. A toggle makes it follow the pattern instead (fused, even thickness). | Owner |
| D28 | **Issue #1: five steps in a fixed order: 1 Shape, 2 Pattern, 3 Layers & seam, 4 Base, 5 Print.** Shape holds everything about the form (size, footprint, twist, profile curve, profile points, geometry morph). Print is Prepare print. Any step can be opened at any time; nothing is locked. The current step is dark, the others light grey. Each step ends with *Next*. See [the journey design](v2-guided-journey.md) | Owner (order, free movement, two shades); accepted (Print as step 5) |
| D29 | **Issue #1: in Shape the pot is shown plain;** the pattern comes back from step 2 on | Owner |
| D30 | **Issue #1: presets are shapes; patterns are picked in the Pattern step.** On the Designs screen the presets show as plain pots and open on Shape with no pattern. Your own saved designs open whole | Owner (separation); accepted (saved designs open whole) |
| D31 | **Issue #1: on a phone the steps are a bottom bar with an emblem per step.** The pot gets most of the screen; the controls sit in a compact area between the pot and the bar, one part of a step at a time, picked from a row of buttons. Revises D22's 40/60 split; nothing covers the pot | Owner |
| D32 | **Issue #1: on desktop the same five emblems sit at the top of the left panel,** and a step shows all its parts under small headings | Owner |
| D33 | **Issue #1: the Advanced button goes** (reverses D19). Profile curve, profile points and geometry morph become parts of Shape; Footprint appears once, in Shape | Accepted |
| D34 | **Issue #1: the Twisted column preset gets rounded square corners,** so its twist shows on the bare shape (revises C4) | Owner |
| D35 | **Pattern studio (issue #3): two kinds of surface detail.** *Detailed morph* is today's mm-scale relief (A/B, blend). *Pattern* is a new bead-scale bitmap matched to the layers. Morph stays as it is. See [the pattern studio design](v2-pattern-studio.md) | Owner |
| D36 | **Detailed morph moves to Shape, beside Morph; the Pattern step holds only the bitmap Pattern.** Phones get one dock tool with a *Large · Detailed* toggle. Shape shows Morph and Detailed morph (revises D29) | Accepted |
| D37 | **One bitmap row is one layer, always; one cell is one node (a single toolpath point),** with straight lines between nodes | Owner |
| D38 | **Cells are in, flat or out;** one Depth in mm, from 0 to ½ bead width | Accepted |
| D39 | **Pattern columns are aligned:** the same nodes on every layer in range, whole repeats, no seam | Accepted |
| D40 | **Density is one slider for the node spacing around** (½ to 3 bead widths, snapped to whole repeats), shown as mm spacing or points per layer; the face set last stays fixed. Rows never scale | Owner (slider, point count); accepted (details) |
| D41 | **The Pattern has its own From / To** (a second bracket); one Pattern, no A/B; it starts and stops sharply | Accepted |
| D42 | **Pattern filters that never change the drawing:** Fade (Even, Fades up, Fades down, Middle, Diagonal, plus an amount) and Soften (blur, 0–2 cells, default 0). Detailed morph's blend gains *Fades down* (extends D17) | Owner (idea); accepted (set) |
| D43 | **Bead-support rule:** warn where a node sits more than ½ bead width off the node below. The Pattern's own steps are exempt from the 45° and fineness rules. Warns, never blocks | Accepted |
| D44 | **The warnings card is the one place to set each rule** (overhang limit moved there, bead support, fineness) | Owner (idea); accepted (placement) |
| D45 | **One 2D editor for Pattern and Detailed morph:** node scale and crisp, or a coarse grid drawn soft. Motif layouts become quick fills, and the `motif` recipe kind goes (replaces D24) | Accepted |
| D46 | **The editor edits one tile** with cell, row, column and diagonal operations (Set, Invert). It never covers the pot: the lower half on phones, a wide panel on desktop, with repeats shown dimmed | Owner (operations); accepted (layout) |
| D47 | **A starter library of about 8 Patterns** (Knit, Rib 1×1, Rib 2×2, Brick bond, Seed, Herringbone, Basket, Diamond) | Accepted |
| D48 | **Patterns are saved apart from designs** (the whole setup except From / To) and apply to any design; the design keeps its own copy. Stored as a compact `bitmap` recipe of up to 64 × 64 | Owner (separate); accepted (details) |
| D49 | **App-wide: the *Next* buttons go** (reverses that part of D28); single-task buttons are icons with text as tooltip, long-press label and accessible name | Owner |
| D50 | **No backwards compatibility** for the pattern studio: old files, saved designs and the golden G-code may change | Owner |
| D51 | **Issue #3 folds into the pattern studio,** built on `t3/pattern-studio` from `t3/guided-journey` in six slices | Accepted |
| D52 | **Presets open with their Detailed morph** (narrows D30); only the Pattern is left off | Owner |
| D53 | **Detailed morph grids keep *Sharp, Soft, Round*** | Owner |
| D54 | **The Detailed morph's A/B blend gains *Diagonal*,** the Pattern Fade's winding band | Owner |

---

## 4. Who it's for

| Who | Priority | What "a really nice interface" means for them |
|---|---|---|
| **Demanding clay makers** with high-quality printers | Primary. They set the interface | **Exact:** every value in mm, typed or dragged, with the exact point table under Advanced. **Truthful:** the beads on screen are the path the printer runs, so nothing changes at export. **In control of quality:** seam ramp and position, base infill, one or two walls. **Fast:** every change shows while you drag. **Presentable:** a clean white render you can show a client. |
| **Beginners and students** | Served by defaults, not by a separate mode | **A quick start:** start from a tile and click a swatch, and you have a good pot. **Hard to break:** warnings in plain words ("Leans past 45° between 96 and 110 mm") instead of jargon. **Safe to experiment:** history and undo mean nothing is lost. |
| **Educators** | Served by what's already there | **Free, with no sign-up (D0).** It runs on students' Android phones. Designs save as files that can be handed in. The same design always gives the same G-code (research §8.3). |
| **Professionals with robot arms** | Later | Exact numeric control (Advanced) and deterministic output. Robot output itself is later (D9). |
| **FDM vase makers** | Later (D6) | The design is kept in mm and is independent of the process, so FDM output can be added without changing the design side. |

---

## 5. Goals, non-goals, anti-goals

**Goals**
- **The design experience is the product.** It must be pleasant, fast and precise on a desktop *and* on an Android phone (D3).
- **What you see is what prints.** The preview is drawn from the same toolpath buffer that the G-code is written from (research §5.4, §8).
- **Seamless, bead-true patterns** that look good from the first click.
- **A first release that replaces today's app** end to end: design, check and download G-code.

**Non-goals (for now)**
- FDM output (D6). Non-planar layers (D10). Named printers, robots and output compatibility (D9).
- Mesh import, multi-copy layout and shrinkage compensation (§16).
- Accounts, servers or cloud storage (D0). Share links come later and need no server (research §8.4).
- A lines view, layer playback, and material, time or layer-count statistics (D15).
- Curve editors over height, a rules list, and a height rail (D17, D18).

**Anti-goals: failures even if it technically works**
- **A crowded main menu.** Advanced exists to keep the four main sections simple (D19).
- **Making the user think about the process while designing:** clay, layers, material, printer (D7, D15).
- **A preview that differs from the print,** or estimates that change at export (research §3.7, mistake 3).
- **On a phone, controls that cover the pot,** or a pot so small the controls feel cramped (D22).
- **A visible seam in a pattern,** or a sudden, hard switch where patterns blend (D16, D17).
- **Anything gated, paid or account-bound (D0).**

---

## 6. Constraints

- **Free, GPL-3.0, static hosting (D0).** Dependencies must be GPL-compatible (research §8.6), and there is no paid backend.
- **three.js on WebGL 2, working on Android phones with touch (D3).** The budgets in research §10.3 apply, measured on a mid-range Android phone in Chrome.
- **Web only (D5).** No build step is required to run the app: ES modules and an import map, as today (research §8.8).
- **Walls and thickness only at the end (D2).** The live loop computes only the single centreline wall.
- **No printer verification (D4).** The generic printer profile ships labelled as a draft that hasn't been tested on a printer. The software checks remain as warnings in the interface. This confirms the "interpretation to confirm" in research §11.1, D4.
- **Determinism:** the rules in research §8.3. Same design, same G-code, in every browser.

---

## 7. Approaches considered

The tools were already settled: three.js on WebGL 2 (D3), plain JavaScript with no build step, and the research's engine (the toolpath is computed once in a worker, then drawn as beads and written as G-code from the same buffer; research §8.8, option A). The open question was how v2 gets from here to the live site.

| | **1. Build v2 next to v1, swap at release** (chosen, D25) | **2. Rebuild inside the live app, phase by phase** |
|---|---|---|
| **How** | v2 lives in its own folder in this repository and runs at `vasecreator.com/v2` as an open preview. v1 stays at the root, untouched. When phase 1 is complete, v2 moves to the root and v1 moves to `/v1`. | Split `script.js` into modules and replace parts in place. Each phase goes live, as research §9.4 originally planned. |
| **For** | Today's users never see half-finished screens. Every step can be tried on a real Android phone at a real address from day one. It starts clean: v1's 2,700-line `script.js` mixes design data with 3D objects (research §2.2), and almost every screen changes anyway. | One app, and visible progress. |
| **Against** | Two apps in the repository until the swap. Regular visitors see nothing new until phase 1 ships. | The public sees in-between states, such as the mesh view with a G-code button. Untangling v1 costs time that a clean start skips, and little of v1 survives the new interface. |

**Dropped:** a framework rewrite with a build tool, such as React with Vite. It works against keeping the app plain JavaScript that's easy to contribute to, and nothing in the design needs it.

**Why option 1:** it protects today's users, gives a real phone-testable address from the first commit, and avoids paying to untangle code the new interface replaces anyway.

---

## 8. Interface concept

### 8.1 Desktop layout

> **Revised by issue #1** (D28–D34): the sidebar, the phone tabs, the Advanced button and the Prepare print mode become five steps. See [the journey design](v2-guided-journey.md). The text below describes the first release.

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ ▣ Vase Creator    Created with ♥ by …          ↶  ↷   [Designs] [Save design] [Prepare print →] │
├──────────────────────┬─────────────────────────────────────────────┬──────────────┤
│ Shape            ▸   │                      [⚠ 1 warning] [160 × 124 × 124 mm]    │
│ Surface          ▾   │                                             │ History      │
│  ┌A▣ Diamonds┐┌B▣ Flutes┐                                          │ ┌──────────┐ │
│  [▦][▦][▦][▦][▦]     │                                             │ │ ▢  now   │ │
│  [▦][▦][▦][▦][+img]  │           ( white bead pot,                 │ │ ▢  1 min │ │
│  Depth    ──●── [2.5 mm]           drawn from the real path )       │ │ ▢  3 min │ │
│  Repeats       [12 ×]│                                             │ │ ▢  4 min │ │
│  From / to [8][150 mm]                                             │ └──────────┘ │
│  Blend [Even|Fades up|Middle]                                      │ [Advanced •] │
│  Amount   ──●── [1.0×]                                             │              │
│ Layers & seam    ▸   │                 ░░ bed outline ░░           │              │
│ Base             ▸   │                                             │              │
│ ── ADVANCED ──       │  (only when Advanced is on)                 │              │
│ Profile curve    ▸   │                                             │              │
│ Profile points   ▸   │                                             │              │
│ Footprint        ▸   │                                             │              │
└──────────────────────┴─────────────────────────────────────────────┴──────────────┘
```

- **Top bar.** v1's logo, title and credit stay. On the right: undo, redo, *Designs*, *Save design*, and *Prepare print →* as the primary button. *Prepare print* replaces today's *Download OBJ*.
- **Left sidebar.** It has four main sections, in the order you make a pot: **Shape, Surface, Layers & seam, Base.** Sections open and close; a closed section shows a one-line summary, such as "160 mm · circle · twist 0°". With Advanced on, an "Advanced" divider and the advanced sections follow below (§8.6).
- **3D view.** It fills the window behind the panels, like v1. Drag to orbit, scroll or pinch to zoom, right-drag or two-finger drag to pan, and double-click to reset the view. Profile points are handles on the pot's silhouette (§9.1).
- **Top right.** The warnings chip, with the size chip to its right (D21).
- **Right column.** The history card, with the Advanced button below it at the same width and in the same colour (D19).
- **Background.** v1's teal gradient as plain CSS, not a second WebGL context (research §9.2).

### 8.2 Phone layout

> **Revised by issue #1** (D28–D34): the sidebar, the phone tabs, the Advanced button and the Prepare print mode become five steps. See [the journey design](v2-guided-journey.md). The text below describes the first release.

```
┌──────────────────────────────┐
│ ▣              ↶  ↷ [Print →]│
│ ⚠ 1                   ┌────┐ │
│                       │ ▢  │ │  history: 3 newest,
│        ( white        │ ▢  │ │  tap to open the full list
│          bead pot )   │ ▢  │ │
│                       │Adv•│ │
│     ░░ bed ░░         └────┘ │  ← top 40 %
├──────────────────────────────┤  fixed split, nothing overlaps
│ [Shape][Surface][Layers][Base][Adv] │
│ ┌A▣ Diamonds┐ ┌B▣ Flutes┐    │
│ [▦][▦][▦][▦]                 │
│ [▦][▦][▦][▦]                 │  ← bottom 60 %, scrolls inside
│ [ Even | Fades up | Middle ] │
│ Amount   [−]  1.0 ×  [+]     │
└──────────────────────────────┘
```

- **Fixed split (D22).** The pot is drawn in the top 40 %, and the camera fits the pot into that area. The controls get the bottom 60 % and scroll within it. Nothing overlays the pot, unlike today's phone sidebar, which covers the whole view.
- **Tabs** replace the sidebar sections: Shape, Surface, Layers, Base, plus one *Advanced* tab when Advanced is on. That tab holds the advanced sections stacked. My call (§17).
- **Number fields** get − and + steppers, at least 44 px tall, and tapping a value opens the numeric keyboard.
- **History** is a narrow column beside the pot, showing the three newest steps. Tap it to open the full list in the controls area. The Advanced toggle sits under it.
- **The top bar** keeps undo, redo and *Print →*. *Designs* and *Save design* move into a menu behind the logo. My call.

### 8.3 Designs screen: opening, presets, saving

> **Revised by issue #1** (D30): presets show and open as plain shapes on the Shape step; patterns are picked in the Pattern step. See [the journey design](v2-guided-journey.md).

```
┌ Designs ─────────────────────────── Click one to start from it ──── × ┐
│ CONTINUE · PRESETS                                                    │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                   │
│ │  (pot)   │ │  (pot)   │ │  (pot)   │ │  (pot)   │                   │
│ │Last design│ │Classic   │ │Fluted    │ │Square    │                   │
│ │where you │ │vase      │ │cylinder  │ │planter   │                   │
│ │left off  │ │          │ │          │ │          │                   │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘                   │
│ SAVED                                                                 │
│ ┌──────────┐ ┌──────────┐ ┌ ─ ─ ─ ─ ┐                                 │
│ │Jar study │ │Ribbed    │ │ + Save   │                                │
│ │04        │ │bowl      │ │ adds one │                                │
│ └──────────┘ └──────────┘ └ ─ ─ ─ ─ ┘                                 │
└───────────────────────────────────────────────────────────────────────┘
```

- **When it opens:** from the *Designs* button (on a phone, from the logo menu). It no longer opens by itself (issue #2, C20): the app opens straight into the designer, on the first preset for a first visit and on the last design after that. A one-time tip at the top of the controls points at *Designs*, and the button gets a ring (on a phone, the logo). The tip goes for good once Designs has been opened or the tip is closed. On the very first visit, *Last design* is missing and the presets lead.
- **Tiles are rectangular,** with a white bead thumbnail of the pot and its name (D13). One click loads the design and closes the screen.
- **Three built-in presets,** suggested on 2026-11-23 and confirmed by the owner on 2026-11-24: **Classic vase** (flutes fading into a smooth neck), **Twisted column** (pleats with a 60° twist; a rounded square since issue #1, D34) and **Square planter** (basket weave on a square footprint, with a drainage hole). They are in `v2/library/presets.json` (§16).
- **Save design** asks for a name (default "Design 1", "Design 2"…) and adds a tile under *Saved*. Saving an already-saved design updates its tile. A *Save as new* option keeps both.
- **Tile menu (⋯)** on saved tiles: rename, duplicate, delete (with confirmation), and *Download design file*. The Designs screen also has *Open design file*, which adds a tile from a `.json` file. Design files are how designs move between devices and how students hand work in.
- **Storage.** Saved designs and their thumbnails live in the browser (IndexedDB, with `navigator.storage.persist()`). Because browsers may clear storage, the Designs screen reminds users once to download important designs (research §8.4).

### 8.4 History and undo

- **Every committed change is a step.** One drag is one step, not one step per mouse move. Typing a value commits on Enter or when the field loses focus.
- **The history column** shows a thumbnail per step with a relative time ("now", "1 min", "3 min"…), newest on top. It scrolls for older steps. It keeps about 200 steps.
- **Clicking a step restores it as a new step** ("Restored: 4 min"), so nothing is ever lost. Undo and redo (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y, and the ↶ ↷ buttons) walk the list one step at a time. My call (§17).
- **Opening a design from the Designs screen adds a step** ("Opened: Classic vase"), so the work you left is one click back.
- **History survives a reload.** Steps are small design snapshots (research §8.4: under about 20 KB each, images excluded), stored in the browser. *Last design* is simply the newest step.
- **Not in history:** the camera, the open or closed state of sections, the Advanced toggle, and the printer settings.
- **Thumbnails** are small renders of the bead preview, taken after the preview settles. They are made lazily, so they never slow down a drag.

### 8.5 The chips at the top right

- **Warnings chip.** It shows "⚠ n warnings", or a muted "No warnings" so the layout doesn't jump. Clicking it opens a small card that lists each warning in plain words. Clicking a warning colours the affected beads on the pot (§11).
- **Size chip.** Overall height × width × depth in mm, measured on the final outer surface, patterns included. It sits to the right of the warnings chip (D21). Clicking it opens a small *Outer size* card with the three numbers as fields (issue #5, C21). A typed or dragged number is the finished outer size: the form scales until the measured size matches. Height is exact to within half a layer, and depth stays read-only while it follows width.
- **Style.** The same small corner radius as the buttons (8 px), not pill-shaped (D21).

### 8.6 The Advanced button

> **Revised by issue #1** (D28–D34): the sidebar, the phone tabs, the Advanced button and the Prepare print mode become five steps. See [the journey design](v2-guided-journey.md). The text below describes the first release.

- **Where:** under the history card, with the same width and colour (D19). The on state shows a dark outline and a small green dot.
- **Off** (the default for new users): the sidebar shows only the four main sections.
- **On:** an "ADVANCED" divider and the advanced sections appear below the main ones. In phase 1 they are **Profile curve**, **Profile points** and **Footprint** (§9.5). Geometry morph joins them in phase 2 (§9.6).
- **The choice is remembered** in this browser. Switching it never changes the design or moves the camera (D20).

### 8.7 Visual style

- **v1's look carries over.** The teal gradient background, Inter, white translucent cards with 12 px corners, and buttons and chips with 8 px corners.
- **Pots are drawn in white beads (D21).** Soft studio lighting brings out the layer lines and patterns, with a gentle contact shadow on a faint bed outline. There are no real-time shadow maps; render only on change (research §9.2).
- **Swatches and thumbnails use the same whites and greys,** so a swatch looks like the surface it makes.
- **Colour means something.** Amber marks beads with a warning and red marks beads with an error. The accent green is kept for "on" states. Nothing else in the pot is coloured.

---

## 9. How each part works

### 9.1 Shape

**Main section:** height, width, depth, footprint (circle or rectangle), corner rounding (rectangle only) and twist.

- **Profile points in the view.** As in v1, the profile is drawn as handles on the pot's right-hand silhouette. The handles sit in a vertical plane through the pot's axis that turns to face the camera, so they can be dragged from any viewing angle. My call.
  - **Drag** a handle to change its height and radius. The pot updates live (D20).
  - **Add a point** by clicking or tapping the profile line where you want it.
  - **Remove** the selected point with Delete or Backspace, or with the × in the point table. On a phone, long-press a handle and pick *Remove*.
  - **Rules:**
    - The bottom point stays at height 0.
    - Points can't pass each other in height, and the editor keeps at least one layer height between neighbours. The wall therefore never folds under itself, and the form stays a single radius per height, as research §2.7 requires.
    - A radius can't drop below the minimum radius (§11).
  - **Allowed points:** between 2 and 12. v1 allows up to 10.
- **Height** (mm) scales all point heights in proportion.
- **Width** (mm) is the widest diameter of the profile. Changing it scales all point radii in proportion, so the curve keeps its character. My call.
- **Depth** (mm) defaults to the same value as width, with a lock. Unlocking it makes the footprint an ellipse or a rectangle that is longer in one direction. Internally depth is a ratio applied in plan, as in research §5.1 (A = diag(sx, sy)). The bead width never stretches (research §2.7).
- **Footprint:** *Circle* or *Rectangle*. The rectangle has a **corner rounding** from 0 to 100 %, shown in mm at the widest point. Because it is a fraction, the corners stay valid where the pot narrows. My call.
- **Twist** (degrees): the total rotation from bottom to top, spread evenly up the pot. The footprint, the patterns and the seam all follow the twist (research §6.3: twist only shifts u).

### 9.2 Surface: patterns

> **Being revised (D35–D51, 2026-11-25):** this section's slots, settings and blending become **Detailed morph**, which moves to Shape. A new bead-scale bitmap **Pattern** takes over the Pattern step. The motif recipe and the editor described below are replaced by one 2D editor. See [`v2-pattern-studio.md`](v2-pattern-studio.md).

**What the user sees:** two pattern slots, **A** (the main pattern) and **B** (the one that blends in), each showing a small swatch and a name. Below them is a grid of pattern swatches; clicking one applies it to the selected slot. Then come a few settings.

```
┌A ▣ Diamonds ─┐ ┌B ▣ Flutes ──┐      ← tap a slot to choose what the grid sets
 main pattern     blends in
[▦ Diamonds][▦ Out·In·Out][▦ Flutes][▦ Scales][▦ Weave]
[▦ Checker ][▦ Zigzag    ][▦ Dots  ][▦ Ribs  ][ + Image ]   ← Image: phase 2
Depth           ──●──   [2.5 mm]    ← per slot
Repeats around  seamless [12 ×]     ← per slot, whole numbers only
Tile height     ──●──   [22 mm]     ← per slot, snaps to whole layers
From / to       [8.0 mm] [150.0 mm] ← shared by A and B
Blend           [ Even | Fades up | Middle ]
Amount          ──●──   [1.0 ×]
```

- **The swatch library (D16).** About 12 small, seamless patterns. Each is a *recipe* for the pattern generator, not an image file:
  - The twelve, confirmed by the owner on 2026-11-24 (§16): **Flutes, Pleats, Ribs, Ripple, Spiral, Chevron, Diamonds, Out·In·Out (brick), Scales, Dots, Honeycomb and Basket.** They are in `v2/library/patterns.json`, each with starting values that pass the 45° and bead checks on a 90 mm pot.
  - Because the patterns are recipes made in-house, the library has no third-party image licences to track (research §8.6).
  - Selecting a swatch keeps the slot's depth, repeats and tile height, so switching patterns feels like trying a new texture, not starting over.
- **Slot B starts as *None*:** blending is off and only A shows, so a new design has one pattern. Picking any swatch for B turns blending on, with *Fades up* and amount 1.0 as defaults. *Plain* is a real choice for B, with no texture, so A fades into a smooth surface. *None* (blending off) is the first option in B's grid. My call (C18).
- **Depth** (mm): how far the pattern pushes the bead out and pulls it in. It is real millimetres, as research §6.5 requires: 2.5 mm is 2.5 mm wherever the pattern is fully on.
- **Repeats around:** a whole number, always (D16). The pattern therefore meets itself with no seam. The panel shows the resulting cell size at the widest point as information ("≈ 16 mm per repeat"), not as a control. My call.
- **Tile height** (mm): the height of one repeat. It snaps to whole layers so pattern rows line up with beads. My call.
- **From / to** (mm): where the surface pattern starts and stops. It applies to A and B together. Each end always gets a soft edge, so a pattern never starts with a hard step. The edge is at least two layers long, or 3 × the pattern depth in mm if that is longer, so the pattern grows by no more than half a layer height per layer (`v2/core/surface.js`). By default the pattern starts above the base (8 mm) and stops 10 mm below the rim.
- **Blend (D17).** Let *t* run from 0 at *From* to 1 at *To*, and *a* be the amount (0–1). The amount is B's peak share. Next to the slider, the panel shows the resulting split, for example "A 50 % · B 50 %".
  - **Even:** B's weight w = a everywhere. With a = 0.5 the surface is half A and half B, and with a = 1.0 it is all B. Switching to *Even* sets the amount to 0.5 if it was 1.0, so the first click shows a real mix.
  - **Fades up:** w = a · smoothstep(0, 1, t). A at the bottom changes gradually into B at the top.
  - **Middle:** w = a · sin²(π t). B is strongest halfway up and fades towards both ends.
  - **The displacement is** d = (1 − w) · d_A + w · d_B, where d_A and d_B are each slot's pattern times its own depth.
  - **A ⇅ swap button** swaps A and B, which turns *Fades up* into a fade downwards. My call.
- **Live preview.** Clicking a swatch, or dragging any value, updates the pot immediately (D20).

**How the generator works (behind the swatches).** A recipe describes one repeat tile as a function f(x, y) of position across the tile (x around, y up, each from 0 to 1). It returns a value from −1 (pull the bead in) to +1 (push it out). There are two kinds of recipe:

1. **Motif recipes.** A row of cells, each *out*, *middle* or *in* (for example out-in-out), arranged in a **layout**: stripes, diagonal, brick or checker. Each one has an **edge** setting: sharp, soft or round.
2. **Shape recipes.** Named analytic shapes with a few parameters, for diamonds, scales, dots and zigzag.

The core evaluates f exactly at every toolpath point (research §6.3 mapping, with whole repeats around and *u* computed on the unpatterned surface). It never rasterises an image, so the pattern is exact and seamless at any bead size. The swatch is simply f drawn as a small greyscale grid, one square per bead step around and one layer up. That is the "bitmap", and it shows what can actually print. Uploaded images (phase 2) feed the same pipeline as sampled rasters, with the prefiltering in research §6.3.

**Phase 2: the pattern editor (D24).** *Edit pattern…* opens the generator for the selected slot. You set the motif cells (out, middle or in; tap to cycle, + to add), the layout, cells per repeat, row height in layers, and edges. The tile preview updates live. The result can be saved as your own swatch. *+ Image* uploads an image as a swatch (research §6.2–§6.3: decoding in a worker, luminance, tiling, the printable-resolution readout).

### 9.3 Layers & seam

| Setting | Default | Notes |
|---|---|---|
| **Bead width** | 3.0 mm | The width of one bead. It drives the bead preview, the point spacing and the checks (D7). |
| **Layer height** | 1.5 mm | Advice for clay is 0.33–0.55 × the nozzle (research §3.4). Outside 0.3–0.6 × bead width, a warning appears. |
| **Overhang limit** | 45° | The per-clay warning threshold (D8). |
| **Seam ramp length** | 15 mm | The nozzle climbs one layer height over this length (research §5.2). |
| **Seam position** | Fixed angle (0°) | *Fixed angle*, *Follows twist*, or *Hidden*. *Hidden* places the seam in a rectangle corner, or else in the pattern groove nearest the chosen angle (research §3.6, item 4). |

- **While this section is open,** a faint vertical marker shows where the seam runs on the pot. My call.
- **No continuous spiral (D10).**

### 9.4 Base

| Setting | Default | Notes |
|---|---|---|
| **Base layers** | 3 | 0 makes a sleeve with no floor (research §3.6, item 5). |
| **Infill** | Spiral | The only pattern in phase 1. Rings, lines and crosshatch come later. |
| **Hole** | 0 mm (none) | A drainage hole diameter. A warning appears if it is under 2 × bead width (research §7, V13). |

Fixed behaviour, from research §5.4 stage 6: the infill alternates direction per layer, adds an outline ring, and **finishes at the seam**, so the wall starts cleanly. Line spacing is 0.9 × bead width. Patterns never apply to the base (research §11.3, Q5, option a).

### 9.5 Advanced sections (phase 1)

- **Profile curve.**
  - **Smooth** is a centripetal Catmull-Rom curve with a **tension** setting. **Gentle** is the monotone curve, which never bulges past the points (issue #6, C22). **Angular** is straight segments with a **corner radius** in mm. Smooth and Angular are v1's spline and polyline, with tension and fillet radius (research §2.7). Switching type keeps the points.
  - **Per point** (in *Profile points*): on Angular, each inner point can have its own corner radius, and the section's *Corner radius* sets every corner at once. On Smooth and Gentle, each inner point can be made **sharp**, a corner in an otherwise smooth curve. A sharp point splits the curve into two curves that meet there, so the rest keeps its shape. Corner points show as diamonds on the pot.
  - The angular corner is a **true tangent arc.** v1's fillet draws a notch and must not be copied (research §2.3).
- **Profile points.** A table of every point's height and radius in mm, editable, with × to remove a point. Selecting a row highlights the handle on the pot, and the other way round.
- **Footprint.** Circle and rectangle in phase 1, the same control as in Shape. Polygon and *Custom* (a 2D outline) appear here later (D11).

### 9.6 Geometry morph (phase 2, D23)

> **Note (D36, 2026-11-25):** Morph stays as described here. It gets a sibling in Shape, **Detailed morph** (the old §9.2 relief), and on a phone the two share one dock tool with a *Large · Detailed* toggle. See [`v2-pattern-studio.md`](v2-pattern-studio.md).

**What it is.** A soft greyscale map reshapes the *whole form* before patterns are applied. It makes lobes, a lean, a waist, a swirl or blobs, or follows your own image. Patterns then sit on top of the morphed form.

```
Morph map — click to apply
[▒ Lobes][▒ Lean][▒ Waist][▒ Swirl][▒ Blobs][ + Image ]
Softness        ──●── [24.0 mm]   Gaussian blur radius
Strength        ──●── [16.0 mm]   largest push, in or out
Repeats around   seamless [4 ×]
Blend           ──●── [0.80]      how much of the morph to apply
```

- **Map coordinates.** u runs around the pot, in whole repeats, and v runs over the **full height** (0 at the base, 1 at the rim), without repeating.
- **Softness** is a Gaussian blur in mm, converted to texels per axis as in research §6.3. Built-in maps are smooth already. Softness matters most for uploaded images, turning sharp pictures into gentle form changes.
- **Radial push:** morph = strength × blend × (map value from −1 to 1). It is added to the profile radius before patterns, so it changes the base surface that patterns are mapped on.
- **Checks apply to the morphed form.** The 45° overhang check and the minimum-radius check use it (§11). The size chip includes it.
- **In the data model,** morph is a form-level term in research §5.1. It goes inside B(z, θ), before D(z, θ). Forms stay single-valued per angle and height (research assumption A6).

### 9.7 The preview: beads only

- **The pot is always drawn as beads (D15),** with the vertex-pulled bead renderer in research §8.2. There is no lines mode.
- **No scrubber, no layer playback,** and no layer count in the view (D15). The "show a height" ideas from the brainstorm (height rail, height cursor) were dropped (D18).
- **During design,** the preview shows the single centreline wall plus the base (D2). In *Prepare print* it shows the final walls (§10).
- **Live:** every control change sends the design to the worker. The newest request wins, and older results are dropped (research §9.2). Budgets are in research §10.3. For a typical 160 mm pot at 1.5 mm layers and 3 mm beads, that's about 110 layers × 260 points ≈ 30 k points, well inside the 150 k budget.
- **Camera:** editing never moves it (D20). It fits the pot on loading a design, on double-click, and when the phone split changes size.

---

## 10. Prepare print (the finish step)

> **Revised by issue #1:** Prepare print is now step 5, *Print*, and its four steps are that step's parts; the top-bar button and *← Back to design* go. See [the journey design](v2-guided-journey.md).

*Prepare print →* swaps the sidebar for the Prepare print panel. On a phone it swaps the controls area. The pot stays in view, now showing the final walls. *← Back to design* returns to the sidebar. Nothing in Prepare print slows down editing, because it computes only on demand (research §11.3, Q4).

```
← Back to design                     PREPARE PRINT
1  Walls     ( 1 wall | 2 walls )    Wall spacing [2.7 mm]      ← 2 walls only
             Inner wall ( Smooth | Follows pattern )           ← 2 walls only
2  Printer   Generic gantry (draft, not tested on a printer)  ▸ edit
             bed 300 × 300 mm · origin front-left · max height 400 mm
3  Check     ✓ Fits the bed      ⚠ Leans past 45° at 96–110 mm (won't block)
4  Export    [ Download G-code ]   [ Download design file ]
             Size 160 × 124 × 124 mm
```

1. **Walls** (D2, clay).
   - **1 wall:** the centreline wall, one bead wide.
   - **2 walls:** a second wall inside the first. **Wall spacing** defaults to 0.9 × bead width, so the walls fuse where they meet; a larger value leaves a gap. With 2 walls, an **Inner wall** toggle appears (D27):
     - **Smooth** (the default). The inner wall follows the form and the morph, but not the surface pattern. On each layer it sits *wall spacing* behind the outer wall's deepest groove: inner(θ) = base(θ) + min over the layer of d − spacing. The walls therefore never cross. They fuse in the grooves and leave a gap behind raised parts, up to the pattern's full in-to-out depth. The Check step shows the largest gap as information ("walls fuse in the grooves; gaps up to 5.0 mm behind raised parts").
     - **Follows pattern.** The inner wall is the outer wall moved *wall spacing* inward along the radius, so it is fused at an even thickness everywhere. The pattern also shows on the inside.
   - **Later:** a linked double wall, with zigzag or ribs between the walls (§15.4).
   - The walls settings are saved with the design, so changing them is a history step.
2. **Printer (D9).**
   - **One generic gantry profile,** stored in the browser apart from designs (research §5.3). It is labelled "draft, not tested on a printer" (D4). It has a rectangular bed. Round-bed deltas such as the WASP 2040 wait for named printer profiles (§15.4). Users with a delta can set an origin at the centre and a square bed that contains the round one, at their own risk.
   - **It also holds every process setting** (my call, C19). The design stays free of printing concerns (D7, D15), and the research's `process` and `material` blocks move out of the design (§13). Editable fields:
     - **Machine:** bed width and depth, origin (front-left corner or centre), maximum height, and firmware (*Marlin*, *RepRapFirmware* or *Klipper*). The firmware choice sets the pause command and the E-mode command (research §3.5). The default is Marlin.
     - **Extrusion:** E mode (relative by default), feed diameter, and the E scale calibration factor (flow).
     - **Process moves:** prime (a stationary volume at a park point, then lift), skirt (offset and loops, 0 = none), lift and wipe at the end, and travel as `G1 … E0` (research §3.4, §5.3).
     - **Speeds:** wall, base and travel, plus a minimum layer time that slows the layer, then dwells.
     - **Reservoir** (ml, optional; 0 = no refill pauses). When set, a refill pause is inserted wherever the cumulative volume exceeds the usable reservoir (research §3.4, §7 V12).
     - **Templates:** start, end and refill G-code, with `{placeholders}`.
   - **Defaults** follow research §5.3. No heater codes are ever emitted.
   - Changing printer settings is not a design change, and it doesn't go in the history.
3. **Check.**
   - Live checks run again on the final walls and footprint (research §7: V1–V8 again; V9, V12, V13 and V16 at this point).
   - **Refill pauses,** if any, are listed here as information, for example "1 refill pause, at 96 mm". This is the only place a material-related fact appears, because it changes what happens at the printer.
   - Errors block export, in particular *off the bed* and the V16 G-code sanity checks. Overhang and the other warnings never block (research §7).
4. **Export.**
   - **Download G-code:** a parameter header with the design JSON and the profile hash, plus layer comments (research §5.4, stage 11), streamed in a worker with a progress bar.
   - **Download design file:** the design as `.json`.
   - **Size:** the only statistic shown. Material, time and layer counts don't matter to the user (D15), and they stay out unless asked for later.
   - **For CAD** (issue #7, C23): *Toolpath (.dxf)*, the nozzle path of the final walls as one continuous 3D polyline in mm, in print order (owner, 2026-11-24); and *Solid (.stl)*, a closed mesh of the finished pot (wall, rim, base and hole). The print checks don't block them.

**File names:** `<design name>.gcode`, `<design name>.vasecreator.json`, `<design name>.dxf` and `<design name>.stl`. My call.

---

## 11. Printability feedback

The checks run on the centreline during design (research §7 says which). They show up in the warnings chip and by colouring the beads. They never block designing.

| Shown as | Check | Default threshold | Research |
|---|---|---|---|
| "Leans past 45° between 96 and 110 mm" | Overhang per layer, on the final points including morph and patterns | 45° (D8), editable in *Layers & seam* | V2 |
| "Pattern finer than the bead can print" | Sampling and bead-scale curvature | λ < 4 × point spacing; curvature radius < w/2 | V5, V6 |
| "Too narrow for the bead at 142 mm" | Minimum radius | r ≥ 2 × bead width; clamped and reported | V7 |
| "Doesn't fit the printer bed" | Bed fit, against the current printer profile | outside the bed | V1 |
| "Layer height is unusual for this bead" | Layer height ÷ bead width | outside 0.3–0.6 | research §3.4 |

- **Clicking a warning** colours the affected beads amber, or red for errors, until the warning is closed or the problem is fixed.
- **Wording is plain** and gives a height in mm, never a layer number (D15).
- **Later:** in-layer slope (V3), turning angle (V4) and slenderness (V14), as issues after launch.

---

## 12. Presets, saving and persistence: a summary

| What | Where it lives | Survives reload | Moves between devices |
|---|---|---|---|
| Current design and its history | Browser (IndexedDB) | Yes | No, unless saved and downloaded |
| Saved designs (tiles) | Browser (IndexedDB) | Yes | Via *Download design file* / *Open design file* |
| Built-in presets | Shipped with the app (JSON) | Always there | Always there |
| Printer profile | Browser, separate from designs | Yes | Later (profile export) |
| Advanced on/off | Browser (localStorage) | Yes | No |

Share links in the URL fragment (research §8.4) are later (§15.4).

---

## 13. Data model: changes against research §5.2

The research's design JSON (§5.2) stays the basis: mm everywhere, a versioned schema, the printer kept apart and referenced, images by hash. Changes:

- **`form.plan`** becomes `{ "footprint": "circle" | "rectangle", "depthRatio": 1.0, "cornerRounding": 0.25 }`. `sides` and polygons come later.
- **`form.twist`** becomes `{ "degrees": 0 }`, spread evenly. The keyed curve in the research isn't exposed. The schema version allows adding it back later.
- **`form.morph`** (phase 2): `{ "map": "lib:lobes@1" | asset, "softnessMm": 24, "strengthMm": 16, "repeats": 4, "blend": 0.8 }`.
- **`surface`** replaces the effect stack, rules and curves (D17, D18):

  ```jsonc
  "surface": {
    "fromMm": 8, "toMm": 150,
    "a": { "pattern": "lib:diamonds@1", "depthMm": 2.5, "repeats": 12, "tileHeightMm": 22 },
    "b": null,                              // null = None, blending off; or a slot like "a" ("plain" allowed)
    "blend": { "shape": "even" | "fadesUp" | "middle", "amount": 1.0 }   // ignored while b is null
  }
  ```

  `pattern` is a library id, a user recipe id (phase 2) or an image asset (phase 2). A **pattern recipe** is a small JSON object (`{ "kind": "motif", "cells": [1,-1,1], "layout": "brick", "edges": "soft" }` or `{ "kind": "shape", "shape": "diamonds", … }`). The recipe schema is now defined by `v2/core/patterns.js` (`kind`: `shape`, `motif` or `plain`).
- **`layers`** replaces `slicing`: `{ "beadWidthMm": 3.0, "layerHeightMm": 1.5, "overhangLimitDeg": 45, "seam": { "rampLengthMm": 15, "position": "fixed" | "followTwist" | "hidden", "angleDeg": 0 } }`. There is no `layerChange` field (D10). `pointsPerLayer: "auto"` stays internal.
- **`base`** as in the research, with `pattern: "spiral"` only in phase 1.
- **`finish`** becomes clay only: `{ "walls": 1 | 2, "wallSpacingMm": 2.7, "innerWall": "smooth" | "followPattern" }` (D6, D27). The FDM block is dropped until FDM returns.
- **`process` and `material` (research §5.2) leave the design** (C19). Prime, skirt, lift, wipe, speeds, minimum layer time and flow live in the printer profile (§10). Density is only needed for weight statistics, which are out (D15). Shrinkage is later (§15.4).
- **Not in the design:** the printer profile (a separate document, one generic gantry profile, including the process settings), the camera, the Advanced toggle and history metadata.

---

## 14. Architecture and repository layout

Research §8.8, option A, stands. This section only adds what the design and D25 change.

- **Folder.** v2 lives in `v2/` at the repository root, served at `vasecreator.com/v2/` (D25). Inside it:
  - `v2/index.html`: the app shell, an import map with three.js r187 (research §8.1), and the CSS tokens carried over from v1.
  - `v2/core/`: pure, DOM-free and three.js-free. It holds design normalisation and migrations, the profile, footprint, morph and pattern evaluation, the layer grid and seam, the base, walls, checks and G-code emission. It uses deterministic arithmetic (research §8.3) and runs in a module worker.
  - `v2/render/`: the bead renderer behind the small interface in research §8.2. Only the `"bead"` mode is needed.
  - `v2/ui/`: sidebar sections, the Designs screen, history, chips, the Advanced toggle, Prepare print, and the phone layout.
  - `v2/store/`: design state, snapshot history and IndexedDB persistence.
  - `v2/library/`: preset designs and pattern recipes as JSON.
  - Tests are in `v2/test/` (or the builder's choice), as in research §8.5.

  The exact layout is the builder's call. The fixed points are: the core is pure and runs in a worker, and the renderer sits behind the research §8.2 interface.
- **The swap at phase 1.** v1 moves to `/v1/`. v2's files move to the root, with the SEO meta, favicon and manifest carried over from v1's `index.html`. Whether `/v1/` stays and for how long is the owner's call at that time. Until the swap, `v2/` must not change any v1 file.
- **The live loop** (research §5.4): stages 1–6 plus the design-level checks, then render. The renderer gets a fresh `Float32Array` per result, transferred and not copied. Prepare print adds walls, process moves, the full checks and emission on demand.
- **Hosting.** Checked on 2026-11-23:
  - GitHub Pages is **not** enabled for this repository (the Pages API returns 404).
  - vasecreator.com answers with Cloudflare Pages' default headers (`Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=0, must-revalidate`, `Referrer-Policy`, `X-Content-Type-Options`, plus a preconnect `Link` header).
  - An unknown path such as `/v2/` currently falls back to the root page.

  So the site is almost certainly on Cloudflare Pages, and a `v2/` folder will be served at `/v2/`. Everything is static and needs no `SharedArrayBuffer`.

  Under D25, `/v2/` is an open preview, so work-in-progress appearing there is intended. Cloudflare Pages' per-branch preview URLs are available as well, if wanted. **Confirmed by the owner on 2026-11-24:** deploys run automatically from `main` (Cloudflare Pages). Whatever reaches `main` is live, so the swap (phase 1 item 9) ships by merging it into `main`.
- **UI code** is plain JavaScript modules with a small store, from which views render. There's no UI framework (§7). Pointer Events replace v1's touch-*or*-mouse handler (research §9.2).

---

## 15. Release order (revises research §9.4)

Every phase must work on desktop and on a mid-range Android phone in Chrome before it counts as done (D3).

### 15.1 Phase 0: engine (nothing visible changes)

- The `v2/core` toolpath engine in a worker: profile, footprint, twist, the layer grid with a seam ramp, the base spiral, 1 or 2 walls, the generic gantry printer profile and G-code emission.
- Deterministic maths, golden G-code files and property tests (research §8.3, §8.5).
- A bare `v2/` page that loads a fixed design, draws it in beads and downloads its G-code. This proves the pipeline end to end and puts the phone-testable address live (D25).

### 15.2 Phase 1: first release, which replaces today's app

A user can do all of this, end to end, on desktop and phone:

1. Open the app to the **Designs screen** (last design, three presets, saved), and start from any tile (§8.3).
2. Shape the pot: **drag, add and remove profile points** in the view; **height, width, depth, circle or rectangle, corner rounding, twist** (§9.1).
3. Click **pattern swatches** (about 12) into **slots A and B**, set **depth, repeats, tile height and from/to**, and **blend** with *Even*, *Fades up* or *Middle* and an amount (§9.2).
4. Set **bead width, layer height, overhang limit and seam** (§9.3), and the **base** (§9.4).
5. Switch **Advanced** on for the **profile curve** (smooth or angular, tension, true corner radius), the **point table** and the **footprint** (§9.5).
6. See every change **live** on a **white bead** pot, with **warnings** that colour the beads (§9.7, §11).
7. Go back through the **history** column, use **undo and redo**, and **save** designs as tiles or files (§8.4, §8.3).
8. **Prepare print:** 1 or 2 walls (with the inner-wall toggle), the generic gantry printer with its process settings, a final check, and **download G-code** and the design file (§10).
9. Then **swap**: v2 goes to the root and v1 to `/v1/` (§14).

### 15.3 Phase 2: bitmap tools

- **The pattern editor** (D24, §9.2): motif cells, layout, edges, and saving your own swatches.
- **Images as swatches:** upload, tiling, aspect, and the printable-resolution readout (research §6.2–§6.3).
- **Geometry morph** (D23, §9.6), with the built-in maps and images as morph maps.

### 15.4 Later: each becomes a GitHub issue after launch (D26)

Each line is meant to become one issue. Its title is in bold, followed by its scope and the sources to start from.

- **Share links:** the design compressed into the URL fragment, with no server. Library patterns travel by id; uploaded images can't (research §8.4).
- **Polygon footprint:** N sides with corner rounding, under Advanced → Footprint (D11, research §5.1).
- **Custom footprint:** a 2D outline, drawn or imported as SVG, as long as it stays a single radius per angle (D11).
- **More base infills:** rings, lines, crosshatch and sunburst (research §5.4, stage 6).
- **Linked double wall:** zigzag or ribs between the two clay walls (research §11.3, Q3; WeaveSlicer [P33]).
- **Slight non-planarity:** up-and-down patterns and a wavy rim, within 0.5–1.5 × layer height (research §7, V11). Out for now (D10).
- **Named printer profiles:** PotterBot, WASP, LUTUM and Eazao drafts, plus profile import and export (research §3.5, §11.3, Q11).
- **Robot output** (D9).
- **FDM output:** vase mode, then the other thickness methods and the mesh build (research §11.3, Q3–Q4). It returns with D6 lifted.
- **More checks:** in-layer slope, turning angle and slenderness (research §7, V3, V4, V14).
- **Shrinkage compensation:** a per-clay scale, with "as printed" and "as fired" sizes (research §11.3, Q13).
- **WebGPU renderer:** when research §11.3, Q12's trigger is met.
- **Mesh import** and **multi-copy layout** (research §11.3, Q9, Q14).

---

## 16. The research's open questions (§11.3): recommendations

| Q | Question | Recommendation | Owner decision needed? |
|---|---|---|---|
| Q1 | Interface concept | **Resolved** by D12–D22 and §8–§11 of this document. | No, decided |
| Q2 | MVP scope | **Resolved:** phase 1 in §15.2. Images and the pattern editor move to phase 2 (D24). Budgets: research §10.3 stands, measured on a mid-range Android phone; the 1 M-point FDM case drops out with D6. | No, decided |
| Q3 | Thickness methods | **Resolved:** clay gets 1 or 2 walls. With 2, the walls are spaced 0.9 × bead width, and the inner wall is smooth by default (behind the deepest groove) or follows the pattern (D27). No link between the walls in phase 1. FDM methods are deferred with D6. | No, decided (D27) |
| Q4 | Finish step behaviour | **Resolved:** Prepare print shows the final walls in the same bead view, computes only on demand, and never slows editing (§10). The mesh build is deferred with FDM. | No |
| Q5 | Bitmaps on the floor? | **No (option a).** Floors stay functional infills. A "base stamp" can be an issue later. | No |
| Q6 | Non-planar in v2? | **Out for now** (D10). Listed in §15.4. | No, decided |
| Q7 | Default layer change | **Planar with a seam ramp** (D10). No spiral mode. | No, decided |
| Q8 | Any server component? | **None.** Everything is static and local. Share links later via the URL fragment. | No |
| Q9 | Mesh import | **Out.** Listed in §15.4. | No |
| Q10 | Pattern library | **12 in-house generator recipes,** so there are no third-party licences. Set and three presets in `v2/library/` (§9.2, §8.3). | No, decided: the owner confirmed the suggested 12 and the three presets on 2026-11-24. |
| Q11 | First printer profiles | **One generic gantry clay profile** (D9). Named drafts later. | No, decided |
| Q12 | When to adopt WebGPURenderer | **Keep the research's trigger.** WebGL 2 stays the guaranteed path. | No |
| Q13 | Shrinkage compensation | **Later** (§15.4). | No |
| Q14 | Multi-copy layout | **Later** (§15.4). | No |

Every open question is now decided. Q10 was the last; the owner confirmed it on 2026-11-24.

---

## 17. Calls I made (please check)

These were not explicitly decided by the owner. A builder should treat them as the plan unless the owner changes them.

| # | Call | Why |
|---|---|---|
| C1 | With 2 walls, the default **wall spacing is 0.9 × bead width**, so the walls fuse where they meet. The inner-wall behaviour is the owner's (D27) | A thick wall is the usual reason to choose 2 walls |
| C2 | Defaults: **bead 3.0 mm, layer 1.5 mm, seam ramp 15 mm, base 3 layers** | Mid-range values from research §3.4 and §5.2 |
| C3 | **Clicking a history step restores it as a new step;** about 200 steps; history survives reloads; opening a design adds a step | Nothing is ever lost, which matters when going back is the point |
| C4 | Presets **Classic vase, Twisted column, Square planter** (confirmed 2026-11-24, `v2/library/presets.json`; Twisted column became a rounded square in issue #1, D34) | Covers a smooth profile with a blend, a twist, and a rectangle with a drainage hole |
| C5 | **12 in-house pattern recipes** (confirmed 2026-11-24, `v2/library/patterns.json`) | No licence risk; swatches stay exact at any bead size |
| C6 | **Width** = widest diameter and scales the profile; **depth** is a locked ratio; rectangle **corner rounding** is a fraction | Width and depth read as overall sizes. The profile keeps its character, and the corners stay valid where the pot narrows |
| C7 | **Repeats** are the control, and cell size is shown as information; **tile height** snaps to whole layers | Whole repeats keep the pattern seamless (D16); rows line up with beads |
| C8 | **From / to** is shared by A and B, with a soft edge at both ends of at least two layers or 3 × the depth | One range keeps the blend simple; "always gradual" (D17); a two-layer edge on a 2 mm pattern used most of the 45° allowance on its own |
| C9 | The phase 1 warning set is the five in §11; the overhang limit sits under *Layers & seam* | Covers what the owner named (45°), plus the failures the research ranks highest |
| C10 | Prepare print replaces the sidebar with four numbered steps; **size is the only statistic** | Matches "layers and material don't matter" (D15) |
| C11 | On a phone, Advanced adds **one** extra tab holding all the advanced sections; *Designs* and *Save* move behind the logo menu | Keeps the tab row readable at 360 px |
| C12 | At the swap, v1 moves to `/v1/` | Nothing disappears suddenly for existing users |
| C13 | A faint **seam marker** shows while *Layers & seam* is open; *Hidden* = a rectangle corner or the nearest pattern groove | Makes the seam a design decision you can see |
| C14 | Saved designs in IndexedDB, plus **design files** (download and open) from the Designs screen | Works offline with no accounts (D0); files cover moving between devices and handing work in |
| C15 | The header keeps v1's logo and "Created with ♥ by" credit | Continuity with today's app |
| C16 | **A ⇅ B swap** button in Surface | Gives "fades down" without adding a fourth blend option |
| C17 | Profile handles sit in a plane through the axis that faces the camera | Dragging works from any viewing angle, which v1's fixed plane doesn't allow |
| C18 | **Slot B starts as *None*** (blending off). Picking a B swatch turns blending on (*Fades up*, 1.0). The amount is B's peak share, with the split shown, and *Even* starts at 0.5 | A new design shows one pattern, and the first click on each blend option shows something sensible |
| C19 | **Process settings live in the printer profile:** prime, skirt, lift and wipe, speeds, minimum layer time, flow, an optional reservoir for refill pauses, and firmware (Marlin by default) | Keeps the design free of printing concerns (D7, D15). These are machine habits, not design choices |
| C20 | **Issue #2, first visit:** the Designs screen never opens by itself. A first visit opens on Classic vase, and a later one on the last design. The nudge is a one-time tip at the top of the controls with *Show designs* and *Got it*, plus a ring on *Designs* (on a phone, the logo). It never covers the pot (D22) and never comes back once Designs has been opened or the tip closed. The "download your designs" reminder stays on the Designs screen. Presets in the top bar and "Start with Shape" wait for #1 | The owner asked to open straight into the designer and point to the top bar. A tip in the panel is the only place that doesn't cover the pot on a phone |
| C21 | **Issue #5, sidebar usability:** every number can be dragged by its label or its value, in whole steps (12.3 → 13 → 14), Shift ×10, Alt ÷10; a click on the value types. Only sideways drags scrub, so a phone panel still scrolls. Sliders snap to coarse steps with tick marks (5 %, 0.5 mm, 0.05), and Shift drags fine. − / + stay touch-only, because scrubbing and arrow keys cover desktop. Fields are spinbuttons for screen readers. The size chip opens an *Outer size* card rather than editing inline, which gives phones 44 px fields over the controls (D22) and keeps the chip compact. A chip edit sets the finished outer size, and Shape's *Width* stays the profile's widest diameter (C6) | The owner asked for stepped sliders, drag with steps and an editable chip. Two meanings of "width" stay apart by place: the chip is the outside of the finished pot, and Shape is the form you draw |
| C22 | **Issue #6, curve editing (first slice):** *Gentle* (monotone) joins Smooth and Angular; a corner radius per point on Angular; sharp points on Smooth and Gentle. Bézier handles, B-splines, a tension per point and a flat 2D editor are not built: each needs the rules in §9.1 revisited (Bézier handles can break one radius per height) | The core already had monotone curves and per-point corners; sharp points reuse them by splitting the curve. These add control without changing the rules or any existing design |
| C23 | **Issue #7, CAD export, lean:** no library. The toolpath goes out as **DXF** (R12 ASCII, mm) as one continuous 3D polyline through every point in print order, as the owner asked, which Rhino and Grasshopper open; a `.3dm` would need rhino3dm.js (several MB of WebAssembly). The solid is a closed **binary STL** mesh: the wall's centreline (the same function the toolpath uses) offset by half a bead each side in plan, sampled once per layer, with the rim, the base and its hole. Layer lines are not modelled. NURBS, STEP and 3MF are not built. A typical pot gives a 1.5–3 MB DXF and a 4–6 MB STL; the solid is capped at 600 000 triangles. Both sit under *For CAD* in Prepare print's Export step | The owner asked for CAD export without adding a library. DXF and STL are plain formats that every CAD and mesh program opens, and both are written in the worker in well under a second |
| C24 | **Issue #1: a step frame around the existing sections,** which tag their parts; controls stay mounted once (details: [the journey design](v2-guided-journey.md)) | Least churn; leaves Pattern thin for #3 |
| C25 | **Issue #1: `view.step` is the source of truth,** `view.mode` is derived from it, and the step is remembered in this browser (details: [the journey design](v2-guided-journey.md)) | Modules that test `view.mode` keep working; a reload returns to the step |
| C26 | **Issue #1: phone controls area `clamp(200px, 30dvh, 260px)` above a 64 px bottom bar** (details: [the journey design](v2-guided-journey.md)) | The pot gets about half the screen |
| C27 | **Issue #1: on desktop the step row stays at the top and *Next* at the bottom** while the panel scrolls; *More shape options* starts closed (details: [the journey design](v2-guided-journey.md)) | The steps and the way forward stay in sight |
| C28 | **Issue #1: the parts per step** follow the existing control groups (details: [the journey design](v2-guided-journey.md)) | No control moves to another step |
| C29 | **Issue #1: opening a preset sets slot A to Plain and slot B to none;** the first visit opens Classic vase that way; the preset files keep their patterns (details: [the journey design](v2-guided-journey.md)) | Presets become shapes while the golden G-code still tests whole designs |
| C30 | **Issue #1: a note under Twist** in Shape when it can't show (round footprint, no morph) (details: [the journey design](v2-guided-journey.md)) | A control that seems to do nothing feels broken |
| C31 | **Issue #1: undo, redo, Save design and restoring history stay off in Print** (details: [the journey design](v2-guided-journey.md)) | They would change the design under a computed print |
| C32 | **Issue #1: thumbnails of steps made in Shape come from a separate full preview** (details: [the journey design](v2-guided-journey.md)) | History shows the finished pot without slowing a drag |
| C33 | **Issue #1: emblems are inline SVG drawn in-house** (details: [the journey design](v2-guided-journey.md)) | No icon library joins the import map |
| C34 | **Issue #1: Pattern parts appear when they apply,** and on a phone the A/B slot cards show above every per-slot part (details: [the journey design](v2-guided-journey.md)) | An empty part looks broken, a greyed one locked |
| C35 | **Issue #1: on a phone, swatches are one sideways row,** and taller parts scroll inside the controls area (details: [the journey design](v2-guided-journey.md)) | Keeps the pot large, as in the approved mockup |
| C36 | **Issue #1: on a phone, the first-visit tip is one line with a close button** (details: [the journey design](v2-guided-journey.md)) | The old card would fill the controls area |

**The mobile stage (2026-11-24), a design iteration awaiting the owner's check.** The owner asked for the 3D view to become primary on a phone, with the menu optional, and for the pattern design to be elevated. My calls M1–M12 are in [the mobile stage design](v2-mobile-stage.md) §8. In short: the canvas fills the phone screen and the chips move into the top bar (M1, M2); a slim dock (tool chips, one ruler dial or option row or swatch carousel, and *Next*) replaces the controls area, and the full settings become an optional sheet (M3–M6); handles on the pot set the pattern's From / To and turn the seam (M7, M8, desktop too); the swatch carousel leads the Pattern step (M9–M11). They revise C26 and the journey's §6.1 and §7.5 for phones.

---

## 18. Left to the builder

- **Analytic functions for new patterns** added later. The requirements, as met by the first twelve: deterministic, evaluated per point, seamless with whole repeats, and giving values from −1 to 1.
- **The exact folder layout** inside `v2/`, module boundaries apart from the core/worker/renderer split, and the choice of test runner (research §8.5).
- **The store and rendering approach** for the UI: plain modules and a small store, with no framework (§7, §14).
- **Thumbnail capture:** size, timing and caching for history and tiles.
- **Interaction details:** the exact numeric limits per field, slider ranges, keyboard shortcuts beyond undo and redo, and focus handling.
- **Accessibility:** keyboard reachability of all controls, visible focus, sufficient contrast, and labels on icon buttons. Target WCAG 2.1 AA on the panels.
- **Default printer profile values** (bed size, speeds, templates), taken from research §5.3, and labelled as a draft.
- **The progressive preview strategy for large pots**, within research §10.3.
- **Wording of warnings and labels,** keeping it plain and in mm, with no clay or layer jargon in the design view (D7, D15).
