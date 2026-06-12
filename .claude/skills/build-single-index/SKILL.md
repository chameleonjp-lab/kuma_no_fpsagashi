---
name: build-single-index
description: Build or update a self-contained index.html for a Chameleon JP smartphone browser game.
disable-model-invocation: true
---

# Task

Create or update a single-file `index.html`.

# Read first

- `docs/game-spec.md`
- current `index.html` if it exists
- `docs/ranking-spec.md` if ranking is enabled

# Hard rules

- Keep HTML, CSS, and JavaScript in one file.
- Do not add build tools.
- Do not add external libraries unless explicitly approved.
- Do not change the game specification.
- Preserve existing working behavior unless the spec says to change it.

# Requirements

- Mobile-first layout.
- iPhone SE support.
- No horizontal scroll.
- Touch controls must avoid browser interference.
- Result screen must include retry, share, home, and lab link.
- Ranking-enabled games must prevent duplicate submission.

# After editing

Provide:

1. What changed
2. Files changed
3. Risks
4. Manual test steps
