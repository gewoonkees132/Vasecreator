# Vasecreator v2: design brainstorm prompt

Paste the block below into a new Claude Code session opened in the Vasecreator repository.

```text
# Brainstorm: the Vasecreator v2 design experience

## Context
You are working in the Vasecreator repository: a vanilla JavaScript + three.js vase configurator, live at vasecreator.com, GPL-3.0 and free for the public. Version 2 moves from mesh-based to toolpath-based design: the nozzle path is the single source of truth and G-code is the primary output.

Before anything else:
- Read docs/research/toolpath-foundation.md. Read these sections closely: §1 (summary), §2.7 (feature mapping), §3.6–3.7 (patterns to adopt, mistakes to avoid), §5 (toolpath model and data model), §6 (pattern system), §7 (printability checks) and §11 (decisions and open questions). Use the rest as reference.
- Look at index.html, style.css and script.js so you know the current interface, including how it behaves on phones.

## Decisions already made
Do not reopen these unless I ask.
- D0: The app stays free for the public. No accounts, paywalls or gated exports.
- D1: Both clay and FDM are targets.
- D2: Walls and thickness are chosen at the end, never during design.
  - Clay: 1 or 2 walls.
  - FDM: several thickness methods, applied at G-code export or by building a mesh afterwards.
  - The live design loop only evaluates the single centreline wall, so it stays fast.
- D3: three.js. It must work on Android like the current app: WebGL 2 baseline and touch editing.
- D4: Physical printer verification is deferred. The focus is the pre-G-code design step and a really good interface.
- D5: Web only.

## Goal
Design the v2 design experience, meaning everything before G-code, well enough that implementation planning can start. I want a concrete interface concept and an interaction spec, not a feature list.

## Agenda
Take one topic at a time, in this order.
1. Users and jobs. Cover potters with clay printers, FDM vase makers, students and beginners, and educators. Settle 2–3 primary personas, their top jobs, and what "a really nice interface" means for each.
2. Interface concept (§11.3 Q1).
   - Propose 2–3 clearly different layouts, for example tabbed panels as in Potterware, a single canvas with contextual panels, or a guided step flow.
   - Draw ASCII wireframes for desktop and for an Android phone.
   - Give the trade-offs and a recommendation, then let me choose.
3. Core interactions, for the chosen concept:
   - Profile editing: in 3D or as a 2D side profile, handles, numeric entry.
   - Plan shape and twist.
   - The effect stack: add, reorder, enable, mask.
   - Image mapping: placement, tiling, aspect lock, the printable-resolution readout from §6.3.
   - Rules: layer ranges, fades and bands, with chips showing layers, mm and %.
   - Curves over height: a vertical editor aligned with the model (§6.6).
   - The preview: bead and lines modes, scrubber, heatmaps.
   - Validation feedback (§7), undo/redo, presets.
   - Touch versions of all of the above.
4. The finish step (D2, §11.3 Q3 and Q4).
   - How the user picks clay or FDM, a printer profile and a wall or thickness method.
   - How they see the stats and export G-code or a mesh.
   - How the finish step avoids slowing the design loop.
5. MVP cut (§11.3 Q2). What is in the first release and what comes next. Revise the phases in §9.4 to match.
6. Remaining questions in §11.3. Give a recommendation for each one the earlier topics didn't settle, and flag the ones that need my decision.
7. Risks and the first prototypes, for example the bead renderer on a mid-range Android phone and the curve editor on touch.

## How to work
- This is a conversation. Ask me when a decision is mine, keeping to one topic at a time.
- Give options with your recommendation first, and keep them concrete: ASCII wireframes, interaction sketches, example values.
- Ground proposals in the research doc and cite its sections (for example "§6.4"). Label new assumptions as assumptions.
- Keep facts and recommendations separate. If you need a new fact, such as how another tool solves an interaction, verify it with a web search and cite it.
- If a brainstorming skill is available (for example product-management:product-brainstorming, or /brainstorm), you may use it for the divergent parts.
- Write no implementation code. Pseudocode and JSON sketches are fine. Do not modify source files.

## Output
- Create docs/design/v2-design-brainstorm.md, containing:
  - A decisions log, numbered from D6 onwards.
  - The personas.
  - The chosen interface concept, with desktop and Android wireframes.
  - An interaction spec per area.
  - The finish-step spec.
  - The MVP scope and revised phases.
  - The questions that are still open.
  - The prototype plan.
- In docs/research/toolpath-foundation.md, change §11 only: mark questions as resolved and link them to the brainstorm doc.
- Git: commit only those two docs, with a plain message. No Co-Authored-By trailers, no "Generated with" lines and no AI attribution anywhere (commits, PRs or documents).
- Finish with a short summary and the list of decisions that still need me.
```
