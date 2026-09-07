# Actual model: deepseek-v4-pro

# Independent Review — #457 Bounded Acceptance Packet

**Scope (one line):** Frozen packet containing the synthetic source/data rehearsal script, its machine result, the release-acceptance ledger, and the enterprise architecture doc — assessed only for rehearsal isolation, real-producer assertions, honest limits, and absence of installer/model/enterprise overclaim. Read-only; no other files.

---

## BLOCK

None. The packet's headline claims are honest: release status stays **not approved**, version stays 0.6.6, machine evidence is scoped to "current dev snapshot / macOS / Node 22.23.2", and the ledger explicitly refuses to treat machine checks as installer, real-model, or enterprise acceptance. No core/MCP/release/real-pilot approval is smuggled in (#456 and batch reviews are referenced as external and not presumed).

## MAJOR

**MAJOR-1 — Baseline dependency fidelity undisclosed (script:38,43,55-58; acceptance.md:153,158).**
The "fixed 63b449d9 baseline" is source-pinned only. The extracted 0.6.6 tree compiles and runs against the *current* repo's `node_modules` via symlinks (`oldCompanion/node_modules`, `workspace/node_modules`, `currentTree/node_modules`). TypeScript version, runtime deps, and their transitive versions are all whatever is installed today, not what 0.6.6 shipped with. Failure mode: a dependency bump changing runtime behavior (or tsc emit) silently alters the "old version" exercised, invalidating the roundtrip conclusion while the ledger's "固定…→ 当前源码 → 固定…" wording implies a fully pinned baseline. Fix: either disclose in the script output / ledger ("baseline deps = current node_modules; dependency drift not rehearsed") or install the baseline's lockfile into the temp tree before compiling.

**MAJOR-2 — Verified-list claim without a matching assertion (script:104; roundtrip-result.json verified[2] "old grant writer preserves new permission fields").**
I can map five of the six `verified` items to real assertions:
- citations/revision preserved → lines 115–116 ✓
- idempotent replay → deepEqual of `m.reply`/`m.updated` at lines 112–113 ✓
- old denies new context profile → line 102 ✓
- knowledge bytes → line 99 ✓
- unknown schema preserved/refused → lines 118–120 ✓

The old-writer item does **not** map. The old phase issues a grant (line 104) but discards the return value; it is never written into `meta`, and the verify phase never reads an old-written grant. Every observable cross-version grant assertion is new-writer→old-reader (line 100) and new-writer→new-reader (lines 106–110). Unless `issueOutboundGrant` internally verifies-after-write (not provable from this packet), the machine-evidence artifact lists a verification that does not occur. Failure mode: audit trail overstates coverage — precisely what an acceptance ledger must not do. Fix: capture the old-writer grant into `meta` and verify it in the new phase, or reword the claim to what is asserted ("old reader accepts new-written ordinary grant; old writer smoke-issues").

## NIT

**NIT-1 — Fixture outside the frozen hash (script:127).** `page-read-v1.json` is read from the live working tree at run time and is not covered by `candidate_source_sha256`. A concurrent fixture edit changes create-phase evidence bytes without changing the recorded hash. `candidate_head` mitigates re-runs at HEAD, but the hash should include the fixture or the fixture should be copied into `currentTree` first.

**NIT-2 — Fragile single-file assumption (script:86).** `fs.readdirSync(evidenceDir)[0]` silently picks an arbitrary file if the directory ever contains more than one and crashes cryptically on zero. Assert `length === 1` to fail loudly.

**NIT-3 — Phase processes run with cwd = repo root (script:28,129).** The three producer processes inherit `cwd: root`, so `initDataDir` and any relative-path logic run with the live repo as working directory — an unnecessary side-channel in an isolation-focused rehearsal. Run phases with `cwd: data`.

**NIT-4 — "合成负例已测" uncited in this packet (acceptance.md:177).** The blocking table asserts synthetic negatives are tested, but the packet contains no negative-case script/result beyond future-schema refusal and `ready === false`. Cite the specific artifact that proves it, or drop the clause; the packet alone cannot substantiate it.

---

## What passes

- **Isolation:** temp workspace with guarded basename assertion; minimal env (no HOME, no model credentials, no production data dir); `finally` cleanup deletes workspace and all tokens; tokens never printed.
- **Freeze correctness:** current src + tsconfig + package.json copied before compile and hashed with sorted, path-qualified tree walk — no compile/run race with repo edits; `candidate_uses_working_tree: true` and `candidate_head` are honestly recorded.
- **Real producers:** genuine `BusinessEvidenceService`, `EvidenceStore`, capture path (BrowserBridge-recorded fixture), and grant producer run in three fresh node processes; byte-preservation re-asserted across processes; 0o600 modes on synthetic artifacts.
- **Honest limits:** `not_verified` covers real enterprise, installer, mixed versions, other OSes, production model; ledger keeps every real-scenario gate blocked with issue references and forbids writing example domains/empty pilots as pass. Architecture doc likewise refuses to imply MCP/exit or release acceptance.

## VERDICT

**Blocked: 0×BLOCK, 2×MAJOR.** No overclaim of installer/model/enterprise acceptance — that check passes. The packet must fix or disclose MAJOR-1 (baseline dependency drift) and MAJOR-2 (verified-list item lacking an assertion) before its machine evidence can be accepted as claimed. NITs do not block.

```json
{
  "deepseek-v4-pro": {
    "inputTokens": 12333,
    "outputTokens": 10750,
    "cacheReadInputTokens": 6912,
    "cacheCreationInputTokens": 0,
    "webSearchRequests": 0,
    "costUSD": 0.33387100000000003,
    "contextWindow": 200000,
    "maxOutputTokens": 32000
  }
}
```
