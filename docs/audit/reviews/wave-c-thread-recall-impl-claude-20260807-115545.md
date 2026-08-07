All gates pass. Final review below.

---

## Independent senior review — Wave C `thread_recall` implementation

**Patch freshness:** Tracked diff (`git diff`) = 4 files / +86 lines, matches the patch file exactly. Two new files (`companion/src/threads/thread-recall.ts` 9.2 KB, `companion/tests/thread-recall.test.ts` 4.0 KB) are untracked but on disk; reviewed in full.

**Machine [executed]:**
- `npx tsc -p tsconfig.test.json` → exit 0, clean
- `node --test thread-recall.test.js` → 9/9 pass
- `node --test context-budget.test.js` → 13/13 pass
- Total 22/22 ✔ (matches plan claim)

**Capability declaration (ADR-020):**
- Plan declares full axes: `Surface=L0 / L2-classes=none / Compose=none / Autonomy=n/a / Trust=no elevation, F-S5 redact / Channel=community+enterprise unchanged`. Implementation matches.
- No new gate, no L2 forceConfirm, no new originWs caller. Pack-first honored via `isToolAllowed` (adapter.ts:655).

**Rejection gates:**
- **R1 cross-thread** — adapter.ts:993 forcibly overrides `__thread_id: threadId` for every tool dispatch; client-supplied value cannot survive the spread. server.ts:3833 reads it back. ✔
- **R2 cookie/shell leak** — `toCanonicalForRedact` (thread-recall.ts:134-214) synthesizes an assistant `{tool_calls:[{id,function.name}]}` for orphan tool rows so `redactMessagesForCompaction` resolves the name via `idToName` and hits `COMPACT_SENSITIVE_COOKIE_TOOLS` / `COMPACT_SENSITIVE_CODE_TOOLS`. Tests `orphan get_cookies` and `paired shell_exec` prove raw values do not surface (assert.doesNotMatch on `super-secret-cookie` and `root:x:0:0`). ✔
- **R3 L2/Trust elevation** — read-only same-thread search; no host/shell/code exec; no `securityConfirmations.request`. ✔
- **R4 query in logs** — server.ts:3851 logs only `{thread_id, hit_count, query_len}`. No query text, no terms, no excerpts. ✔
- **R5 tests red** — 22/22 pass. ✔

**Fail-closed verifications:**
- Tool with no name → `toCanonicalForRedact` returns `[]` → excerpt `null` → hit dropped (test "tool with no name is dropped").
- `reasoning_content` never enters scoring (`searchTextForMessage`) nor excerpt body (`toolContent` / assistant content). Verified by code read; no explicit test (see N2).

**Nits (non-blocking):**
- **N1:** Dual-review prompt echoes only `Surface` + `Trust`; the full axes (L2-classes/Compose/Autonomy/Channel) live only in the plan file. For self-contained future audits, echo all axes inline.
- **N2:** No defense-in-depth test asserting `reasoning_content` never appears in any excerpt. Current code is correct, but a regression test would harden it.
- **N3:** `redactHitExcerpt` lines 239-242 re-derive `names` from `asstR.tool_calls`, but `redactMessagesForCompaction` (context-budget.ts:185) does not preserve `tool_calls` on assistant outputs — so `names` is always `""` in that branch and the conditional collapses to `body`. Slightly dead, simplifiable.
- **N4:** `searchTextForMessage` (thread-recall.ts:111) slices `tc.result` to 800 chars for scoring with a `// slice only` comment. A one-liner explicitly stating "never reaches excerpt body" would prevent future confusion.

No blockers. No security regressions. Tests green. Capability axes correctly anchored on Surface (tool), not Composition or Autonomy.

VERDICT: APPROVE_WITH_NITS
