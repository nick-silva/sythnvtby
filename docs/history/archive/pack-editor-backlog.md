---
status: living
last-reviewed: never
covers: tools/editor.js
---

# Pack editor: backlog (future requirements)

The pack editor (`tools/editor.html`) exists and works for the manifest → .vbcolor path, but is **not** ready to ship. We are **prioritizing the paint-on-game editor (Phase 1C)** first.

This doc is a **backlog** for pack editor improvements and requirements. Add notes, UX ideas, and "how it should work" here so we can revisit when we focus on making the editor ship-ready.

---

## Backlog items (to be filled in)

*(Add your requirements and thoughts below. No implementation until after paint-on-game is in place.)*

- 

---

## Current state (reference)

- Load tile-manifest.json → grid of tiles (mono red preview).
- Select tile → sidebar: color picker + "Apply to tile" (33%/66%/100% shades).
- Game ID field, Export .vbcolor.
- No load existing .vbcolor to extend; no batch color; no per-pixel painting; minimal UX.

---

## When we return to the editor

- Revisit this backlog and phase2-and-next-detailed-plan.md § Phase 2.
- Align with paint-on-game: same .vbcolor format, optional "load pack" to extend from manifest or from paint session.
