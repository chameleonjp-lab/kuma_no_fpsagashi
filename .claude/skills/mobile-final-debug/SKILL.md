---
name: mobile-final-debug
description: Final debugger review for Chameleon JP browser games.
disable-model-invocation: true
---

# Task

Review the current game as a debugger before release.

# Checkpoints

1. Game rules match `docs/game-spec.md`.
2. No old title, description, score label, or ranking text remains.
3. iPhone SE layout does not overflow horizontally.
4. Gameplay does not trigger unwanted zoom, selection, long press, or page scroll.
5. Buttons are tappable and not hidden by browser UI.
6. Game over cannot cause duplicate score submission.
7. Ranking status is visible and understandable.
8. Share text includes the game URL.
9. Home, retry, result, and lab links work.
10. No unused debug UI remains.
11. No secret keys are present.
12. The game is theoretically playable as intended.
13. Score balance is not obviously broken.
14. Loss, retirement, timeout, or failure cases are handled.

# Output

- 重大な問題
- 重要な修正
- 軽微な懸念
- 安全確認できた点
- 公開判断: OK / 条件付きOK / NG
