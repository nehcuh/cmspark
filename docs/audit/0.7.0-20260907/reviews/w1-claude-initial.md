## CMspark W1 Review — packet.md snapshot (baseline 63b449d9, branch codex/0.7.0-enterprise-workflows)

Reviewing only the immutable snapshot and supporting source contained in packet.md. Findings below reference the packet's line numbers and patch-relative file paths.

### MAJOR-1 — Legacy read-through migration gate silently drops non-conforming legacy auto docs
`companion/src/skills/site-experience-identity.ts` (packet lines 394–403), consumed by `companion/src/llm/adapter.ts` (packet lines 346–347 hydrate; 357–361 persist).

**Trigger:** any pre-upgrade auto-persisted site doc whose frontmatter lacks the `site-op-memory` tag (e.g., created by an earlier version that wrote only `["auto"]`) or lacks a `site` field. The old hydrate path (packet line 346, pre-patch) read `skillEngine.get(siteSkillName)?.entries` with **no metadata checks at all**; the new `readSiteExperienceEntries` → `isOwnedSiteExperience` (packet lines 407–421) requires `type === "site_knowledge"` **and** `tags` containing both `"auto"` **and** `"site-op-memory"` **and** a `site` frontmatter field before any legacy entry is accepted.

**Consequence:** after upgrade, accumulated user-taught locator experience for such sites silently stops hydrating into machine bans — the agent re-probes known-bad locators with no warning. Files are not destroyed (read-through only), but the migration contract claimed in the change description ("retains legacy files unchanged, reads only matching auto documents") fails for these docs. The snapshot contains no evidence of the historical tag set written by the old persist path (the pre-existing test at packet line 194 asserts only `tags?.includes("auto")`; the new unit-test fixture models the legacy doc *with* `site-op-memory`, which is the author's model, not history).

**Suggested resolution (one of):** (a) verify from repo history / installed-user data that every auto doc carries `site-op-memory`; or (b) relax the predicate for the **legacy id only** to `type === "site_knowledge" && tags.includes("auto") && site-host match` (manual docs are still excluded because they carry `["manual"]`, and the collision test at packet lines 742–764 would still pass), keeping the strict gate for the v1 hash id. Note the `site-op-memory` requirement is also not needed for the manual-exclusion goal — `"auto"` already distinguishes.

### NIT-1 — `get_page_html` query scope widened from `<html>`-descendant to document-wide
`chrome-extension/src/background/browser-bridge.ts` (packet lines 114–115). Old expression: `document.querySelector('html').querySelector(sel)`; new: `document.querySelector(sel)`. For selectors that match `<html>` itself (`"html"`, `":root"`, `"*"`) results differ materially: `"html"` previously returned `""`, now returns the whole page; `"*"` previously returned `<head>` outerHTML, now returns the whole document. Consequence: a caller passing such a selector now receives a full-page read (larger disclosure/context). Unlikely selectors, but the scope change is real and unmentioned.

### NIT-2 — `captureVisibleTab(activeTab.windowId, …)` availability regression in multi-window sessions
`chrome-extension/src/background/browser-bridge.ts` (packet line 82). Previously `captureVisibleTab(undefined, …)` captured the OS-focused window; now it captures the verified tab's window. If that window is not focused/visible (background-window automation), `captureVisibleTab(windowId)` can throw where the old call succeeded. The change also *fixes* a wrong-window disclosure (capturing the focused window's contents while verifying a different tab), so it's a net improvement; flagging the availability regression for awareness.

### NIT-3 — `getOuterHTMLViaDom` error semantics changed for all callers
`chrome-extension/src/background/browser-bridge.ts` (packet line 33): `throw` → `return ""` on `!result.nodeId`. In this snapshot the only caller is the `getPageHTML` DOM fallback, where `""` is the desired contract (matches Runtime/scripting empty-on-no-match). Any other present or future caller that relied on the "Element not found" throw will now report a successful empty read.

### NIT-4 — Executor live-config read now depends on call-site coverage
`companion/src/computer/executor.ts` (packet line 325). The previous per-re-L2 `require("../config").getConfig().security` live read is replaced by `deps.currentSecurity?.() ?? deps.config.security`. Both production dispatch sites shown (packet lines 430, 438) pass `currentSecurity`, so live mid-task revocation is preserved in the shipped paths; but any other production caller of `runComputerTask` that omits the provider silently degrades to a dispatch-time snapshot of `deps.config` — if `saveConfig` disables the cruise flags mid-task, re-L2 would still auto-approve. Confirm there are no other production call sites.

### NIT-5 — Nested-runner test asserts a contract it doesn't actually exercise
`companion/tests/test-data-dir.test.ts` (packet lines ~847–860). The test sets `CMSPARK_TEST_RUN_DIR=root`, but `run-tests.mjs` ignores the inherited value and always `mkdtemp`s under `os.tmpdir()` (packet lines ~76, ~63), overriding it for children. Consequently the "runner data lives under root" claim and the `fs.existsSync(path.join(root, "caller")) === false` assertion pass vacuously; only the direct-preload test (packet lines 791–822) genuinely exercises the isolation contract. Minor test-design gap.

### NIT-6 — Cleanup-error log prints pre-assignment exit code
`companion/scripts/run-tests.mjs` (packet lines ~86–89). On cleanup failure after a green run, the log line prints `code: 0` before `code = code || 1`. Cosmetic.

### NIT-7 — Legacy filename coverage: www/port-named legacy docs are unreadable by design
`companion/src/skills/site-experience-identity.ts` (packet lines 384–385). `legacyId` is the normalized (www-stripped, lowercased) host with dots→hyphens, matching the old *read*-side key. Docs written by the old *persist* path from origins like `https://www.x.com/…` or `https://x.com:8443` produced names `www-x-com` / `x-com:8443` that neither the old hydrate nor the new migration will ever find. This is a pre-existing read/write key mismatch, not a regression — but the W1 narrative claims "retains legacy files unchanged, reads only matching auto documents," and these orphans are a silent part of that story worth documenting.

---

**Overall assessment:** The patch is otherwise strong — the `get_page_html` scoping fix closes a real silent over-disclosure path (the old `bodyHtmlExpr` prefix match widened scripting-fallback reads to full HTML even when a selector was supplied); the cruise/currentSecurity change preserves live revocation in production and removes real-config writes from tests; the v1 SHA256 identity plus occupied-ID check fixes a genuine cross-site append bug (auto-persist appending into a user's manual doc named like the legacy id); the per-process data-dir preload with nested-runner and failure-path coverage is well-constructed. All unconditional defects found are NIT-grade. The single MAJOR is the legacy read gate: the snapshot cannot rule out silent loss of previously accumulated site experience on upgrade, and backwards migration is an explicit axis of this review. That unknown is release-blocking for this pilot until it is resolved by history verification or a legacy-specific predicate relaxation.

VERDICT: REJECT
