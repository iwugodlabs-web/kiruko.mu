---
name: no-cosmetic-refactors
description: User only wants changes backed by a concrete finding — no cosmetic/speculative refactors
metadata:
  type: feedback
---

Don't move/rename files or restructure code unless it's backed by a concrete finding (fixes a real bug or requirement). The user rejected moving `web/ivor-web/` → `web/` once it was clear it was cosmetic and wouldn't change the Railway deploy (shared/ stays at repo root, so repo-root build context is still required).

**Why:** They value low-risk, targeted changes over churn; a 349-file move that fixes nothing is not worth the risk.

**How to apply:** Before proposing a rename/move/restructure, verify it resolves a concrete problem. If it's only stylistic or speculative, say so and don't do it. Related deploy context in [[railway-deploy-topology]].
