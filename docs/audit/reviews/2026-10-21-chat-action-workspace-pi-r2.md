## Rereview scope

**Commit reviewed:** `a7159117` (base `a3ecd5f2`), staged delta only: 5 files / +85 −7. One executable file (`chrome-extension/scripts/tests/acp-history-hosted-732.test.mjs`, +7/−7 after pairing), 4 truthful report artifacts. **No production file in the delta** — mechanically confirmed: `git diff --cached --name-only | rg -v '^docs/|^chrome-extension/scripts/tests/'` → none. So the T3 consent/auth/off-by-default/readback declaration from the full review is structurally untouched, not re-reviewed here.

## Correctness: is this closure adaptation or weakened acceptance?

**Adaptation, proven mechanically — not by assertion.**

- Real callback `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx:149`: `onView("chat"); dispatch({SET_ACTIVE_THREAD}); chrome.runtime.sendMessage({type:"thread.select"}); onNavigate()` — extracted by AST from the shipping file, not copied. `git show HEAD:…test.mjs | sed -n 323p | grep -c onView` → `0`, i.e. the pre-fix VM global omitted a dependency the real callback body references → `ReferenceError` is statically certain, no re-RED needed.
- Pair-wise character diff of the 7 old / 7 new lines: **pure-insertion-only, `True`** — every original clause survives verbatim; nothing deleted, softened, reordered, skipped. Inserted text is exactly: the `onView` stub, `viewChanges` capture, and 4 count assertions. `grep` for `.skip/.only/.todo/TODO/FIXME` in the file → none.
- New assertions are strictly stronger than the pre-change contract: parameter pinned to `"chat"` (a future `onView("board")` regression now fails), positive paths assert exactly `['chat']` (seeded single select, and all three fresh variants incl. late hydration + deferred close), delayed-close main-caller span asserts exactly `['chat','chat']`, negatives assert exactly `[]`.
- Independence/isolation checked: each loop iteration constructs a fresh `stockNavigationContract`, so `viewChanges` never leaks across `ready/deferClose/missing/disabled` variants. In `freshOwnerControl` only `dispatch`/`onNavigate` are overridden — the `onView` assertion closure is never replaced. Zero-call negatives are non-vacuous in `disabled` mode (row exists, seam refuses at the pre-click `disabled` guard), so no click ⇒ no view call.
- Consumer sweep: the only VM extractor of that `onClick` is this file. `test-sidebar-disclosures-ui.py` drives real Playwright DOM (`.cm-nav-thread` locators, lines 41/61); `chrome-extension/tests/thread-timeline.test.ts:739/749` only `read()`s source text — the CI doc's claim here is accurate, no second missing-global consumer exists.

**Security:** no new executable surface beyond a recorder; no secrets, paths, network, or fs writes added; `git diff --cached --check` clean. Report docs contain only a run URL and log sha256.

## Report-artifact honesty check
- `…-ci.md`: labels ACP as `FAIL` + "locally fixed 86/86", Windows sampler `SIGTERM` cause `UNKNOWN`, explicitly "不将失败称通过", gate budget/permissions untouched; `…-machine.md` ends "不宣称全 CI 绿或已合并". No overclaim.
- `…-machine.json`: arithmetic consistent (8512 + 178 = 8690, fail 0); `acp_hosted_controls` and `windows_census` both self-labelled FAIL. Retained `"ci": "PENDING"` is consistent with a not-yet-green gate.
- R3 report committed as-is, states its own bounds (did not re-certify product/desktop/model/notification, does not clear the Windows gate). Consistent with my read.

## Independent execution (bounded, same command)
`nvm use 22.23.2` → `v22.23.2`; `node --test acp-history-hosted-732.test.mjs cft-linux-supplier-732.test.mjs` →
`1..86 / tests 86 / pass 86 / fail 0 / cancelled 0 / skipped 0 / todo 0`, duration 1457 ms. Matches R3 and parent's post-fix run.

## Findings
**P0:** none. **P1:** none. **No new blocker.**

**P2 observations (non-blocking, no change requested — #756 remains the nit channel):**
1. `docs/audit/reviews/2026-10-21-chat-action-workspace-pi-r2.md` exists in the worktree as an **empty, untracked** 0-byte file. It is outside the staged delta and cannot overclaim anything, but if it was meant to hold this rereview it is blank.
2. The callback's *ordering* (`onView` before `thread.select`, `WorkspaceFrame.tsx:149`) is not asserted — only the argument value and per-path call counts are. Pre-existing scope, unchanged by this delta.

## Not claimed
Windows fixed-gallery sampler `SIGTERM` remains **UNKNOWN** — gate not edited, waived, or called green. No merge. CI is **not** green on the fixed head (the recorded remote run is the pre-fix head's). Native real capture/model/notification acceptance: **NOT_RUN**. Remote Companion 8690=8512+178+0 and extension 1,807 PASS are inherited from the parent/R3, not re-run by me (no credentials, no full suites, no live actions).

VERDICT: APPROVE
