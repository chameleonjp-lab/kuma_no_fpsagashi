---
name: supabase-ranking
description: Implement and review Supabase ranking integration for a Chameleon JP browser game.
disable-model-invocation: true
---

# Task

Prepare or review Supabase ranking integration.

# Rules

- Publishable key can be used in public client HTML.
- Never use service_role key in client code.
- SQL must be output as copy-paste text in chat, not as a file.
- Confirm game_slug, score_order, score_unit, score_scale, score_decimals, and top_ranking_type.
- Confirm whether top ranking is first score or best score.
- Confirm if lower score is better or higher score is better.
- Prevent duplicate score submission.
- Show sending, success, and failure states.

# Required output

1. Required games table row
2. Required RPC or function
3. Required client-side send data
4. Required display conversion
5. Error cases
6. Copy-paste SQL when requested
