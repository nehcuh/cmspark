# Dual review: post-merge-198-201 adversarial fixes (voice / SSRF / file cage / panel probe)

## Context

`main` fast-forwarded `98bb586..2faaefa` (PRs #198–#201). A 4-lane independent adversarial review of that merged diff produced 1 critical / 2 high / 4 medium / 8 low findings; 4 parallel fix agents fixed them; 4 fresh adversarial verification lanes replayed the original attacks (all closed); one residual-fix agent closed the verification leftovers (N1 keyed-cache normalization divergence, N2 copy, MinimalConfirm host_write hint, kind/error consistency).

Full record: `docs/audit/reviews/post-merge-198-201-adversary-synthesis-20260819.md` (read it first).

The patch under review is the **uncommitted fix diff**: `docs/audit/reviews/post-merge-198-201-fix-diff-20260820-000801.patch` (working tree vs `2faaefa`; new test files included via intent-to-add).

## Capability declaration (ADR-020)

```text
Surface:      L2 (file: URL open admission — pre-existing gate, this batch tightens it)
L2-classes:   local-file open (one-shot, no token, no whitelist write)
Compose:      none new
Autonomy:     single
Trust:        no new grants; sensitive-path list extended (.git-credentials/.npmrc/.netrc/.docker)
Channel:      community
```

## What the fix claims (verify, don't trust)

1. **voice** (`chrome-extension/src/sidepanel/voice/local-stt-adapter.ts`, `companion/src/voice/stt-session-service.ts`): classic conflict retry no longer killed by its own abort ACK (swap to retry sid before abort+backoff; `reset()` bumps `loopGen`; `ensureSub()` before retry start); companion peer-matched/session-mismatched abort now aborts the peer's bound session (frees max-1 slot) with `dropBound` guarded against late `end()`; double-stop during drain ignored via `stopChainInFlight`.
2. **SSRF** (`companion/src/security.ts`, `settings-web.ts`): LLM endpoint guard now strips `[]`, expands `::`, recognizes dotted+hex v4-mapped, fe80::/10, fd00:ec2::254; settings-web DNS failure fail-closed again.
3. **file cage** (`companion/src/tool/file-url-admission.ts`): drive-relative `file:///C:…` hard-rejected pre-`path.resolve`; missing targets walk to deepest existing ancestor + realpath must stay in home; directories/symlinks fail-closed (`lstat.isFile()`).
4. **panel probe alignment** (`chrome-extension/src/sidepanel/components/vision-reuse-logic.ts`, `App.tsx`, `useWebSocket.ts`, `companion/src/message-router/handlers/config.ts`): `config.test` echoes tested `{base_url, model_name}`; panel keyed probe cache uses the SAME normalization as companion (model trim-only case-preserved; URL parse, lowercase scheme/host only, default-port normalized, path case preserved); unkeyed session flag still banned from routing.
5. Copy honesty: 「端点接受图片输入」; gate copy no longer overclaims credential blocking; MinimalConfirm trust hint only for tools that actually offer trust.

## Files in scope

Read full files, not only the patch. All files touched by the patch plus their direct callers.

## Tests claimed

- chrome-extension: `npm test` 769/769 (baseline was 755; includes rewritten protocol-faithful voice retry tests + new keyed-cache/guard/copy tests)
- companion: targeted suites all green (file-url-admission, security-gates, security-thread, llm-endpoint-url, settings-web, native-vision-probe-cache, vision-pipeline, config-test-probe-keyed, voice-stt-session-service); full suite has ~63 pre-existing Windows-only failures (chmod/symlink/daemon/POSIX paths) — CI runs on ubuntu.

You may re-run targeted tests. Do not require full monorepo green on Windows if targeted pass.

## Review focus (hostile)

1. Re-run the original attacks against the fixed code: `file:///C:Windows/…`; junction chains incl. chained/dangling; `[::ffff:169.254.169.254]` / `[fd00:ec2::254]` / `[fe90::1]`; classic STT `resource_conflict` → per-chunk `session_unknown` + abort ACK inside the 250ms window.
2. Attack the fixes themselves: does the retry-sid swap open a new race window? Does peer-level abort let one peer kill another's session? Does `normalizeIpLiteral` throw or fail-open on weird input? Do the two probe-cache normalizations REALLY agree (port/scheme/path-case matrix)?
3. Did the lstat `isFile()` fail-closed break a legitimate documented flow (design doc `docs/superpowers/specs/2026-08-19-file-scheme-l2-path-cage-design.md` §6.3)?
4. Do the new tests actually fail on the pre-fix code (or do they assert nothing)?
5. Trust monotonicity: any new auto-approve path, persisted grant, or whitelist write introduced by this batch?

## Output

Findings with file:line and severity, then **exactly one final line**:

`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
