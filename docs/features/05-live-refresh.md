---
id: live-refresh
number: 5
title: Live refresh
category: features
description: Edit a file in the project, and only the frames it changed repaint.
---

# Live refresh

- **What:** Flex watches the project folder. A quarter of a second after the last change it
  restarts its server (the reload takes about two seconds on circles-overview), keys every frame
  again, and repaints only the frames whose key changed, nearest the playhead first. Frames whose
  key didn't change keep their paintings; undoing an edit brings the old frames straight back.
- **Reach it:** Save any file in the project in any editor: a scene, `look.ts`, `hits.ts`, an
  asset. The window's subtitle says how many frames changed.
- **State:** Nothing to set.
- **Limits:** `node_modules`, `.git`, `build`, `.cache` and dot-files are ignored. A take
  recaptured into the pipeline's `takes/` isn't noticed (it is outside the project).
