# Actual model: deepseek-v4-pro

## Scope

R2 packet for #457 acceptance: a synthetic roundtrip rehearsal script, its recorded PASS artifact, the release-acceptance ledger, and the architecture doc — evaluated only against in-packet executable assertions and the stated narrowed limits.

## Correctness pass — claims vs. assertions

Checked every R2 preamble claim against the script's assertions; all roundtrip-specific ones hold:

- **Shared current deps** (md:5, md:152–155): both trees symlink `companion/node_modules` (md:40, 49, 64); JSON `dependencies` string and `not_verified:["historical dependency versions"]` (md:229, 246) disclose it. Accurate.
- **Temp cwd / minimal env / no sandbox / no homedir interception** (md:5, md:185, md:230): `cwd: workspace` (md:149), env = PATH/SystemRoot/TMP*/CMSPARK_DATA_DIR only (md:150), asserted equal to `data` (md:69) with a path-guard on the temp root (md:70). No sandbox/homedir-intercept API used. Accurate [inspected]. Nit below re HOME.
- **Old baseline lacks evidence API, asserted absent** (md:5): old phase asserts `business-evidence/service.js` absent from the compiled old dist (md:111) — an executed assertion. Nit below on breadth.
- **Old issue return stored + verified by both processes** (md:5): old writer result persisted to meta (md:117, 124), self-verified in old (md:123) and re-verified in current (md:126). ✓
- **Bytes must change / record must exist / raw rows equal** (md:5): `notEqual` (md:119), `rows.some(id === old_writer.id)` (md:121), `deepEqual` pre/post context row (md:122). ✓ (Nit below on the deepEqual guard.)
- **Frozen fixture, separate hash; procedure hash; single evidence file; excerpt presence + codepoint length** (md:5): fixture copied before compile (md:46), hashed (md:47); script self-hash (md:48); `files.length === 1` (md:94); `indexOf` presence (md:86) and `Array.from` codepoint start/end (md:87–88). ✓
- **Hashes in actual PASS result** (md:5): `candidate_source_sha256`/`fixture_sha256`/`procedure_sha256` present (md:224–226). ✓ (Nit below on hash scope vs. field name.)
- **No release approval** (md:5): ledger status "未达到发布条件", version stays 0.6.6 (md:167), blocking table (md:197–208), "本次机器检查不授权绕过" (md:212). ✓

Internal coherence: script baseline constant (md:23) = result JSON (md:221); Node v22.23.2 / darwin (md:227–228) match ledger (md:173); PASS result is consistent with the assertions (e.g., any failed `verifyOutboundGrantToken` or missing context row would propagate via the `catch` → `exitCode 1`, md:144).

**Security pass**: fixed argv, no shell interpolation (md:30); tokens/knowledge/meta written mode 0o600 (md:93, 100, 103) and never printed — stdout is captured by `execFileSync` and only the summary JSON is emitted (md:151–158); temp dir removed in `finally` (md:159); path basename guard (md:70). No injection/secrets/path issues [inspected].

## Findings

### MAJOR (blocks)

**M1 — R2 summary claims "Machine targeted MCP48/48/build ... PASS" (md:5), but the frozen packet contains no assertion, artifact, or even a ledger figure matching "48/48".** The only MCP row in the ledger states "11/11 档案测试… 默认 8 工具、新上下文 9 工具" (md:175). Likewise the ledger rows "4973 pass / 23 skip / 0 fail; settings 20/20" (md:173), "1277/1277" (md:174), "124 pass / 0 fail" (md:177) are presented as "可复核的机器证据" (md:169) yet the packet includes no reproduction commands or result artifacts for them — only the roundtrip row has a repro command (md:187–193) and artifact (md:216–249). Failure mode: an acceptance reviewer cannot independently re-derive or confirm the MCP/build/regression claims from this packet; the summary line overstates what the packet evidences. Fix: either attach the corresponding artifacts/repro commands, or reword the preamble to claim only the roundtrip PASS (which is fully evidenced) and mark the other counts as ledger references to be verified from their own packets.

### NITs (do not block)

- **N1 (md:122)** — `assert.deepEqual(rows.find(row => row.id === m.context.id), beforeContext)` passes vacuously (undefined ≡ undefined) if the context row was never persisted before the old write. The recorded PASS plus verify-phase dereference (`lookupContextGrant` md:128 → field access md:129–131, which throws on absence) closes the gap end-to-end, but the guard itself is weaker than the claim "raw context fields survive" states. Suggest asserting `beforeContext` exists before the comparison.
- **N2 (md:224)** — `candidate_source_sha256` covers only `companion/src` + tsconfig + package.json (md:58–60), not extension/src, scripts/, or docs/ in the same commit. The docs describe the hashed set (md:181) but the field name reads as whole-tree. Consider `candidate_companion_source_sha256` or a `covered` field.
- **N3 (md:111, md:183)** — "baseline has no evidence API" is asserted via a single path (`business-evidence/service.js`) in the compiled dist. If the baseline contained other module files under that directory, the assertion would not catch it. A directory-glob absence check would match the breadth of the docs' claim ("没有 evidence/draft 模块").
- **N4 (md:139–140)** — `assert.throws(() => future.read(), …)` assumes a synchronous throw. If `read()` were async-rejecting, the assertion would pass vacuously (Node 22's unhandled-rejection exit would still fail the run, so no false PASS is possible — but the check itself would not be doing the checking). Prefer `await assert.rejects(future.read(), …)`.
- **N5 (md:150, md:185)** — env omits `HOME` (POSIX). The claim "没有拦截 os.homedir()" is accurate — no interception API is used, and `os.homedir()` falls back to the passwd entry — but HOME is still *unset* for the child processes, which is a mild environmental narrowing distinct from non-interception. Worth one clause of precision if the ledger is reworded.
- **N6 (md:117–124)** — old-writer byte-change (md:119) proves *some* persistence happened but not semantic field preservation of the old-written record; this is adequately complemented by row-existence (md:121) and token verification (md:123, 126), so the claim set is sound — noted only for readers skimming the byte comparison alone.

## Verified-positive summary (no defects found)

New producer citations/revision survive old init (md:132–137); idempotent replay (md:133–134); old denies new context profile while accepting ordinary (md:109 vs 112); knowledge bytes preserved (md:108); future-schema file untouched by old init and refused by current (md:107, 139–141); `ready === false` honesty for synthetic drafts (md:138); `not_verified` list matches actual gaps (md:239–248).

## VERDICT

**/blocked: 1×MAJOR/** — the roundtrip rehearsal evidence itself is sound, internally coherent, and its narrowed-limit disclosures are accurate and honest; the block is solely on M1: the R2 summary's "MCP48/48/build" claim is not evidenced by anything in this frozen packet (no matching figure, artifact, or repro command), so the packet as a whole cannot be relied on for that portion of the summary. Fix M1 (attach artifacts/repro commands or narrow the wording to the roundtrip PASS) and the packet's evidenced scope becomes accurate; N1–N6 are non-blocking hardening suggestions.

```json
{
  "deepseek-v4-pro": {
    "inputTokens": 13606,
    "outputTokens": 54574,
    "cacheReadInputTokens": 33408,
    "cacheCreationInputTokens": 0,
    "webSearchRequests": 0,
    "costUSD": 1.449084,
    "contextWindow": 200000,
    "maxOutputTokens": 32000
  }
}
```
