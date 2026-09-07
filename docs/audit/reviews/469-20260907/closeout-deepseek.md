**VERDICT: APPROVE** — no new P0/P1/MAJOR.

Scope: Escape-dispatch scoping for history/menu/trigger in ThreadList + aria-current semantics + inactive `WebkitBackdropFilter` removal; four new fixture/test scripts; nothing else (confirmation files, tokens.ts comments-only).

**Correctness pass [inspected, diff read end-to-end]**
- Escape handler now early-returns without consuming when target ∉ history ∪ trigger ∪ menu — outside Escape propagates (window-level context handler may act; menu untested-unaffected, asserted by `menu.is_visible()` test).
- Inside history: `preventDefault + stopPropagation` at `document` stops the `window`-level context handler → context retained; fixture asserts "Escape must close only history".
- Inside menu: closes menu only, dialog + focus-return asserted.
- `input[type="search"]` fixes the prior selector (old alternatives don't match `type=search`); focus assertion on aria-label 搜索线程 confirms.
- Effect-keyed `menuOpenRef` sync is the idiomatic replacement for render-phase mutation; no concrete failure path surfaced in the diff.

**Security pass** — no new trust boundaries; fixture scripts use argv-list `subprocess`, isolated `CMSPARK_DATA_DIR` cleaned in `finally`, no secrets injected.

**Closures**
- **P1 Escape-history-plus-context → CLOSED.** `stopPropagation` + browser row-Escape context-retention test (`Escape must close only history`, context visible).
- **N1 residual Webkit blur → CLOSED.** Inert property removed; opaque `darkElevated` surface made it a no-op.
- **N2 global Escape with menu open → CLOSED.** `historyMenuRef.contains` gating replaces the old `!menuOpenRef` global trigger; composer-focus Escape no longer consumed (test-asserted).
- **N3 one-way aria-pressed → CLOSED.** `aria-current="true"` replaces toggle-typed `aria-pressed`; CSS selector updated in lock-step, matching the existing `aria-current="page"` pattern.

**Tests/contracts** — new Playwright tests cover exactly the P1/N2 behaviors plus viewport/keyboard matrix; machine greens per report [assumed: ext build+1281 pass / companion 4996 pass / UI matrix], no confirmation or downstream contract changes.

Optional P2 note (non-blocking): outside-Escape-with-menu-open now leaves the menu open while the window-level handler may close the context — intentional per test spec, not a defect.