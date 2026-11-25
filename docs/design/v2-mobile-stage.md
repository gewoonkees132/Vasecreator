# Vasecreator v2: the pot as the stage (mobile design iteration)

- **Date:** 2026-11-24
- **Status:** Built on branch `t3/guided-journey` as a design iteration, for the owner to try and check. My calls are M1–M12 in §8; none are owner decisions yet.
- **Asked for:** "The 3D view should become primary, with the menu only optional, really allowing the user to design using the 3D view. Also elevate the patterns design."
- **Builds on:** [`v2-guided-journey.md`](v2-guided-journey.md) (the "journey" below: D28–D34, C24–C36) and [`v2-design-brainstorm.md`](v2-design-brainstorm.md) (the "design"). It revises journey §6.1, §7.5 and C26 for phones. Desktop keeps the journey layout; it only gains the on-pot handles (M7, M8).
- **Code:** everything lives in `v2/`. Paths below are relative to it.

---

## 1. Intent

The journey gave the pot about half of a phone screen. The other half went to a controls area: a step header, a part row and room for one or two controls. You designed *in a form under the pot*. The owner wants the opposite: **the pot is the stage, and you design on it.** The full settings are still there when you want them, but you no longer need them.

The Pattern step gets the most from this. Today it opens on two slot cards, and the patterns themselves sit below the fold. Patterns are the most visual choice in the app, so on a phone they should be the first thing you see in that step, large and drawn at the pot's own bead scale, and a tap should put one on the pot.

## 2. Goals, non-goals, anti-goals

**Goals**

- On a 360 × 660 phone viewport the pot's region grows from about 285 px to about 380 px tall. On a 412 × 780 one it reaches about 500 px.
- Every design step (Shape, Pattern, Layers & seam, Base) can be worked from the stage alone: a tool row, one big thumb control for the chosen tool, and handles on the pot.
- In the Pattern step the swatches are the first thing you see, and one tap puts a pattern on the pot.
- The full settings stay one swipe or tap away and keep everything the journey built (parts, headings, tables, the print step).

**Non-goals**

- Drawing your own bitmap pattern (issue #3). It still needs its own brainstorm about storage and printability. The stage leaves room for it: a *Make your own* tile in the carousel opens today's motif editor.
- Any change to the engine, the G-code, the design file or history. No new dependency.
- A tablet or landscape layout beyond today's short-screen guard.

**Anti-goals** (failures even if they work)

- Anything that covers the pot (D22's principle). The dock and the sheet sit below the pot's region, and the pot is fitted above them.
- A gesture on the pot that fights orbiting. One finger on empty canvas always turns the pot; only the handles take other drags.
- Two sources of truth. The dock edits the same design fields through the same core functions as the sheet's controls, and both echo the store.
- A slower drag. Dials use `store.change` and `store.commit` like every other control; handles redraw only after a render.

## 3. Approaches considered

1. **A tool dock with a ruler dial (picked).** This is the photo-editor pattern on phones (adjustments row plus a dial). Each step's controls become a row of tool chips that show their values. The chosen tool gets one large control: a ruler dial for a number, big option buttons for a choice, the swatch carousel for a pattern slot, or a short hint with a button that opens the full settings at that part. It is about 140 px tall, against today's 230 px, and it is the same height for every tool, so the pot never jumps.
2. **Gestures on the canvas itself** (for example, swipe sideways anywhere to change the value, as some photo apps do). This is the purest "design on the view", but one-finger drags already orbit the pot, and two-finger gestures already pan and zoom. Taking either over would make the 3D view worse, not better.
3. **Collapse the journey's controls area to a peek height.** The least work, but a peek of the existing form shows half a control, so it doesn't change how you design.

## 4. How it looks (phone, ≤ 760 px wide)

```
┌──────────────────────────────┐
│ ▣  ✓ 170 × 127 × 127   ↶  ↷  │  top bar: logo · chips (compact) · undo, redo
│                       ┌────┐ │
│                       │ ▢  │ │  history: 3 newest (unchanged)
│        ( the pot,     │ ▢  │ │
│          full stage,  │ ▢  │ │
│          handles on   └────┘ │
│          it per step )       │
│                              │
├──────────── ━━━ ─────────────┤  grabber: tap or swipe up for all settings
│ (−)       170 mm         (+) │  the chosen tool's control: a ruler dial,
│  ·|····|····|··▼··|····|···  │  option buttons, the swatch carousel or a hint
│ [Height][Width][Twist]… [Next›]  tool chips with their values · Next
├──────────────────────────────┤
│ (◉)    ▥      ≡      ◎     ⊥ │  step bar (unchanged)
└──────────────────────────────┘
```

- **The stage.** The canvas fills the whole window. The top bar and the dock float over it, but the pot is fitted into the free region between them (`viewportRect` in `main.js`), clear of the history column, so nothing covers it.
- **Chips in the top bar (M2).** On a phone 360 px or wider, the warnings chip and the size chip sit in the top bar between the logo and undo, where there was empty space. The warnings chip shows ✓ when there are none, or the count with its colour. The size chip drops "mm" there (its label and card still say it). This frees the 40 px row under the top bar. Below 360 px they stay under the top bar, as today.
- **The dock (M3)** sits right above the step bar. From the top down it holds:
  - the **grabber**;
  - the **adjuster**: one control for the chosen tool, always 72 px tall;
  - the **tool row**: chips that scroll sideways, each with its name over its value ("Height / 170 mm"), the chosen one dark;
  - ***Next***, pinned at the right, named after the next step.
- **The ruler dial (M4).** The value sits large in the middle, with − and + at the ends. Under it is a tick ruler that you drag sideways: the ticks move under a fixed centre mark, one tick per step, with numbers on every tenth. A flick carries on and slows down. Tap the value to type one. On a keyboard it is a slider (arrows, Page Up/Down, Home, End). An angle dial wraps around (seam angle).
- **The settings sheet (M5)** is the journey's controls area, unchanged inside: header, part row and the part's controls. It opens over the dock when you tap or swipe up the grabber, or when a tool needs more room (Points, Morph). It closes with its ⌄ button or a swipe down on its header. Whether it is open is remembered in this browser (`vc2.sheet`). It starts closed: the stage is the default. Print always shows the sheet, because its content is a checklist and downloads, not something you design on the pot.
- **The first-visit tip (issue #2)** goes at the top of the dock while it's there. The pot refits when it closes.

### 4.1 The tools per step

| Step | Tools (in order) | On the pot |
|---|---|---|
| Shape | **Points** (a hint: drag the dots, tap the line to add one, hold to remove; a button opens the points table) · **Height** · **Width** · **Depth** (with its lock) · **Footprint** (Circle, Rectangle) · **Corners** (rectangle only) · **Twist** · **Curve** (Smooth, Gentle, Angular) · **Morph** (opens the sheet) | the profile points, as in the journey |
| Pattern | **A** and **B** (each opens the swatch carousel for that slot, with its swatch on the chip) · **Depth** · **Repeats** · **Tile** · **From** · **To** · **Blend** (Even, Fades up, Middle) · **Amount** | the From / To bracket (M7) |
| Layers & seam | **Seam** (Fixed, Follows twist, Hidden) · **Angle** · **Ramp** · **Bead** · **Layer** · **Overhang** | the seam grip (M8) |
| Base | **Floor** (base layers) · **Hole** | – |
| Print | – (the sheet) | the bed, as in the journey |

Tools follow the journey's C34 rule: a tool that doesn't apply isn't there yet (Depth, Repeats and Tile need a pattern in the chosen slot; From and To need any pattern; Blend and Amount need slot B; Corners needs a rectangle). Depth, Repeats and Tile edit the chosen slot, and their chips say which one ("Depth B") once B is in use. Each step remembers its tool for the session (`view.tools`). Values use the same limits, snapping and core functions as the sheet (`setHeight`, `setWidth`, `setDepth`, whole-layer tile heights, wrapped seam angles).

### 4.2 Patterns (M9–M11)

- **The carousel** is the adjuster of the A and B tools. It shows large swatches (60 px) drawn on this pot's bead grid at each pattern's own default size, so what you see is what prints. In order: *None* (slot B only), the twelve library patterns, *Plain*, then My patterns, then *+ Image* and *Make your own* (the motif editor). The chosen swatch gets the accent ring, and the row scrolls to keep it in view. A tap applies it at once, with the same defaults and rules as the sheet's grid (one shared module, M11).
- **The slot chips** show each slot's swatch, so "A Diamonds → B Ribs" reads at a glance in the tool row.
- **Where the pattern runs** is a bracket on the pot (M7): a dashed line beside the wall from *From* to *To*, with a handle at each end. Drag a handle up or down. It shows only in the Pattern step, and only when there is a pattern.

## 5. How it behaves

- **Switching tools** changes only the adjuster; the dock keeps its height, so the pot never moves. Switching steps keeps the camera (D20), as before.
- **Opening or closing the sheet** refits the pot into the new region and keeps the angle you turned it to. Opening it from a sheet tool (Points, Morph) opens that part.
- **Undo and redo** apply to dock edits like any other edit: one history step per dial gesture, per tap on an option or a swatch, and per handle drag.
- **Keyboard and screen readers.** The tool row is a `tablist` ("Shape tools") controlling the adjuster. The dial is a `slider` with `aria-valuetext` ("170 mm"); its − and + are buttons; the typed value is a text field. The grabber is a button ("Show all settings", `aria-expanded`). The on-pot handles are sliders with arrow keys, like the profile points.

## 6. Constraints

D0, D3, D20, the principle of D22, the ARCHITECTURE.md rules (plain ES modules, no build step, only `render/` imports three.js) and WCAG 2.1 AA on the dock: text at least 4.5:1, ticks and handles at least 3:1, touch targets 44 px.

## 7. Where it touches the code

- **New `ui/dial.js`:** the ruler dial (`createDial`), plus pure helpers for its math (`dialValue`, `wrapNear`) that are unit-tested.
- **New `ui/dock-tools.js`:** the tool list per step. Each tool has a get and set on the design, its limits and a short value text; the module is pure apart from the store calls, and is unit-tested on real designs.
- **New `ui/dock.js`:** mounts the dock (tool row, adjuster, Next) and the swatch carousel.
- **New `ui/pattern-actions.js`:** the pattern logic `surface.js` had inside its mount. It finds an entry, applies a pattern to a slot with its defaults (images included), snaps to whole layers, imports an image and opens the editor. `surface.js` and the carousel both use it.
- **New `render/gizmos.js`:** the From / To bracket and the seam grip, as DOM handles over the canvas like `render/handles.js`.
- **`ui/steps.js`:** mounts the dock on a phone, owns whether the sheet is open (`openSheet(part)`), and adds the grabber and the sheet's ⌄. It moves the tip slot between the sheet (desktop) and the dock (phone).
- **`main.js`:** the phone viewport runs from the top bar to the top of the dock or sheet, and it refits when their height changes. It also shows the gizmos per step and wires them to the store.
- **`ui/chips.js`:** short phone labels. **`store/store.js`:** `view.tools`.
- **Styles:** the stage and top-bar chips in `app.css`; the dock, dial, carousel, grabber and handles in `panels.css` and `render/gizmos.js`.

## 8. My calls (please check)

| # | Call | Why |
|---|---|---|
| M1 | **The canvas fills the phone screen**, and the pot is fitted into the free region | The stage reads as one space; turning or zooming the pot shows it behind the floating chrome instead of cutting it off |
| M2 | **Chips move into the phone top bar** (✓ or a count; the size without "mm"), from 360 px wide | The bar was half empty; this gives the pot a 40 px row |
| M3 | **A dock replaces the controls area:** tool row, one 72 px adjuster, Next | One big thumb control is easier on a phone than a form, and it uses about 90 px less height |
| M4 | **A ruler dial for numbers**, with − / +, typing, flick and wrap | The phone-native way to set a number precisely with a thumb, without covering the pot |
| M5 | **The full settings are an optional sheet,** closed by default, remembered; Print always shows it | "The menu only optional"; nothing the journey built is lost |
| M6 | **Tools that need room open the sheet at their part** (Points' table, Morph) | Rebuilding them small would duplicate them badly |
| M7 | **The pattern's From / To as a bracket on the pot** | Where the pattern runs is spatial; you see it and drag it where it shows |
| M8 | **The seam grip on the pot**, dragged around the wall (it changes the angle) | The seam is a place on the pot; dragging it there is direct |
| M9 | **The swatch carousel leads the Pattern step,** with big bead-scale swatches and a tap to apply | Patterns are the most visual choice; they belong first and large |
| M10 | **Slot chips carry their swatch** | The A → B blend reads at a glance |
| M11 | **One pattern module for the sheet and the dock** (`ui/pattern-actions.js`) | Picking a pattern behaves the same everywhere |
| M12 | **Desktop keeps the journey layout,** plus the two on-pot handles | The request was the phone; the handles help everywhere |
