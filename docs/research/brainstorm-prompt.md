# Vasecreator v2: design brainstorm prompt

Paste the block below into a new Claude Code session opened in the Vasecreator repository, on a branch that contains `docs/research/toolpath-foundation.md`. The first line starts the `brainstorming` skill, which runs the conversation itself. The prompt only describes the goal.

```text
/brainstorming

I want to design the Vasecreator v2 design experience: everything a user does before G-code is generated. The goal is a design doc concrete enough to start implementation planning from. It should cover who the app is for, the interface concept (desktop and Android), how each part works, the finish step, and the MVP cut.

Context
- Vasecreator (this repo) is a free, GPL-3.0 vase configurator written in vanilla JS and three.js, live at vasecreator.com. Today it builds a mesh and exports OBJ. v2 is toolpath-first: the nozzle path is the single source of truth and G-code is the primary output.
- The research is done, in docs/research/toolpath-foundation.md. It covers:
  - the current code (§2);
  - other tools, and what to copy or avoid (§3);
  - the toolpath and data model (§5);
  - the pattern system (§6);
  - printability checks (§7);
  - architecture (§8);
  - open questions (§11.3).
  Build on it rather than redoing it.

Already decided (§11.1, not up for discussion)
- D0: The app is free for the public. No accounts, paywalls or gated exports.
- D1: Clay and FDM are both targets.
- D2: Walls and thickness are set at the end, never while designing.
  - Clay: 1 or 2 walls.
  - FDM: several thickness methods, applied at G-code export or by building a mesh afterwards.
  - While designing, only the single centreline wall is computed, so editing stays quick.
- D3: three.js. It must work on Android like the current app does, which means WebGL 2 and touch editing.
- D4: No printer verification for now. The focus is the design step before G-code, with a really good interface.
- D5: Web only.

What the design has to cover
- Who uses it (clay potters, FDM vase makers, beginners and students, educators), and what "a really nice interface" means for each of them.
- The interface concept, for desktop and for an Android phone.
- Shape editing: profile, plan shape and twist.
- The pattern system: effect stack, images, rules, and curves over height.
- The preview: bead and lines views, scrubber, heatmaps.
- Printability feedback, undo and presets.
- The finish step: choosing clay or FDM, the printer, the wall or thickness method, the stats, and export.
- The MVP, and the order of what follows. Revise the phases in §9.4 to match.
- A recommendation for each remaining question in §11.3, and which of them need my decision.

Ground rules
- Save the design doc as docs/design/v2-design-brainstorm.md, not under docs/superpowers/specs/. Number new decisions from D6.
- superpowers:writing-plans isn't installed. Once I approve the design, stop and summarise.
- If you use the visual companion, add .superpowers/ to .git/info/exclude, not to .gitignore.
- Write no implementation code, and don't change source files. In toolpath-foundation.md, update only §11, to mark questions as resolved.
- Git: commit only those docs, with a plain message. No Co-Authored-By trailers, no "Generated with" lines and no AI attribution anywhere.
```
