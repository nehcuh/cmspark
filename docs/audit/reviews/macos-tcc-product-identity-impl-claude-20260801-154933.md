I have sufficient evidence. All gates tested, binary inspected, tests run. Here's my adversarial review.

---

## Summary

Independent post-implementation review of the macOS TCC product-identity branch (`fix/macos-tcc-product-identity`, 6 commits, main...HEAD). The diff realizes Scheme D from the design SoT: replaces the bash launcher at `MacOS/CMspark` with the existing host Mach-O, embeds `com.cmspark.agent`, scrubs user-facing copy, hardens packaging gates, and rewrites `resolveHostBinary()` to prefer the main binary — while preserving the `CMSPARK_HOST_BIN` dual opt-in (D10) verbatim. I read the design SoT, impl plan + DR-N1…N7, all focus files, prior design dual review (context), and the live built binary. Tests executed: 4/4 host-bin-resolve, 8/8 host-integrity, 49/49 package gates. The implementer is honest in `memory/session.md` that Task 7 (manual TCC + non-Chrome capture) remains outstanding. **Recommend APPROVE_WITH_NITS.**

## Spec compliance (D1–D10) `[inspected + executed]`

- **D1/D2/D3** user subject = CMspark only: `host.swift:1106-1109` and `host-skylight.swift:988-991` rewrite the SCK denial string to "enable «CMspark»" with no node/host; `darwin-estop.ts:108` and `host.swift:1601` rewrite estop/AX strings; `docs/computer-use-user-guide.md` adds a "只认 CMspark" section. Binary strings scan: only `com.cmspark.agent` + `com.cmspark.evidence` (a Keychain tag, not a TCC id). `[executed]`
- **D4** Mach-O main: `create-dmg.sh:71-93` deletes the bash heredoc and `cp -f` from `Resources/cmspark-host`, then asserts non-script via `file | grep -qiE 'script|text executable|ASCII text'`. Static gate `test-package-gates.sh:88-89` adds `assert_file_lacks "${CREATE_DMG}" 'env arch -arm64 /bin/bash'`. `[inspected]`
- **D5** embedded identity: `host-Info.plist` rewritten to `com.cmspark.agent` / `CMspark` / `CMspark`. Verified on built binary: `codesign -dv` reports `Identifier=com.cmspark.agent`, `Info.plist entries=8`. `[executed]`
- **D6** resolve prefers main: `host-bin.ts:11-23` adds `resolveHostBinaryCandidates(fromDir)` with `../MacOS/CMspark` first. Test `host-bin-resolve.test.ts:14-37` asserts the packaged layout picks main over legacy. `[executed]`
- **D7** dev filename retained: `dist/cmspark-host` still produced by `build-host.sh:14`; last 4 candidates in `resolveHostBinaryCandidates` keep dev paths. `[inspected]`
- **D8/D9** migration + ad-hoc honesty: user guide explicitly says "若列表里有历史残留项，可关闭它们" and "ad-hoc 安装时系统可能要求重新授权". `[inspected]`
- **D10** dual opt-in preserved: `host-bin.ts:39-50` keeps `CMSPARK_HOST_BIN` + `CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1` exactly. Two tests `host-bin-resolve.test.ts:42-77` cover both directions. `[executed]`

## Packaging / identity (create-dmg, CDHash, symlink vs hardlink) `[inspected]`

- **Symlink, not hardlink** — Plan Task 4.1 said "hardlink/copy"; implementation uses `ln -sf "../MacOS/CMspark" "${HOST_SRC}"` with an honest code comment: "Hardlinks also break because codesign rewrites the main executable to a new inode. Symlink survives deep-sign, verifies cleanly, and shares one CDHash." This is a justified deviation; symlink resolves to the same inode/CDHash as the target, satisfying A6/A18. `[inspected]`
- **CDHash equality gate** (DR-N2): `create-dmg.sh:113-119` extracts `CDHash=` from both `MacOS/CMspark` and `Resources/cmspark-host` and asserts equality. The gate runs AFTER `codesign --force --deep`, so it sees the final signatures. `[inspected]`
- **`host-integrity.ts:40`** SHA256 constant bumped to `07107459…216e83` and `build-host.sh:140-160` auto-rewrites it post-build — keeps the runtime integrity check from falsely rejecting the new binary. `[inspected]`

## User copy scan `[executed]`

```
$ strings companion/dist/cmspark-host | grep -iE 'cmspark-host|and/or node|enable.*node'
(no output)
```

Binary has zero forbidden user-facing strings. The rg Task-5.1 gate scan turns up two matches but both are **false positives**:
- `host.swift:1638` "CMspark is not Accessibility-trusted" — matches `not Accessibility-trusted` pattern but `cmspark-host` is gone; this IS the fixed wording.
- `docs/computer-use-user-guide.md:117` "不要去找或勾选 `node`、`cmspark-host`" — matches `勾选.*node` literally but is anti-recommendation (D8 migration copy).

## Security (D10, integrity) `[inspected + executed]`

- D10 dual opt-in intact (above). Override path covered by tests in both directions.
- `host-integrity.ts` SHA256 gate still enforced; new SHA matches built binary; test `host-use-darwin-integrity.test.ts` 8/8 green. `[executed]`
- No new env vars or attack surface introduced. The tray launcher at `host.swift:491-528` uses `/usr/bin/arch -arm64` (DR-N4) to wrap node, matching the prior bash launcher's `exec arch -arm64 node` semantics — no privilege change, no new PATH injection surface (env passed through unchanged).

## Tests `[executed]`

- `tests/host-bin-resolve.test.ts` — 4 tests, all pass. Covers packaged-order preference, dev-path fallback, and both D10 directions.
- `tests/host-use-darwin-integrity.test.ts` — 8 tests, all pass (binary present + new SHA).
- `scripts/tests/test-package-gates.sh` — 49/49 pass, including new static asserts `assert_file_lacks "${CREATE_DMG}" 'env arch -arm64 /bin/bash'` and `assert_file_has "${CREATE_DMG}" 'A6 OK: single CDHash'`.
- Built binary verified: `file` = Mach-O arm64; `codesign -dv` `Identifier=com.cmspark.agent`, `Signature=adhoc`, `Info.plist entries=8`.

## Ready for human Task 7 DoD?

**Yes — code + package are ready.** `memory/session.md` S29 entry explicitly states: "Task 7 未完：需用户安装新 DMG、只勾 CMspark、外 App 截图验收" and "Recorded: yes — 代码+包就绪；真机 DoD 等人". No over-claiming. R7 satisfied.

The remaining manual verification per spec §6 (clean TCC, install new DMG, fire non-Chrome window screenshot, confirm system prompt names CMspark only) is correctly deferred to the human.

## Blocking

None. All seven rejection gates (R1–R7) verified unsatisfied.

## Nits

1. **False-positive rg gate patterns** — The Task 5.1 rg gate matches its own fixed wording (`host.swift:1638` "CMspark is not Accessibility-trusted"). Tighten the pattern to require `cmspark-host.*not Accessibility-trusted` adjacency, or accept the false positive in CI logs.
2. **Internal ComputerError strings still name `cmspark-host`** — `darwin-adapters.ts:68,71,211,854` and `darwin-evidence.ts:21,24` throw `ComputerError` with messages like "invalid JSON from cmspark-host" / "cmspark-host crashed". These propagate as `tool_result` to the LLM and can surface to users via error bubbles. D7 allows internal logs to use `host_bin`, but these are *user-visible tool errors*, not logs. Recommend renaming to "host binary" or "CMspark host" in a follow-up.
3. **DR-N1 mechanism deviation** — Plan prescribed `otool -s __TEXT __info_plist` + plutil. Implementation uses `codesign -dv` Identifier + source plist check instead. Functionally equivalent (verified: ad-hoc signing of Mach-O with embedded plist does derive Identifier from `CFBundleIdentifier`), and the deviation is documented in the comment citing DR-N1. Acceptable, but worth noting that the implementation does NOT directly extract `__TEXT,__info_plist` from the sealed binary — a future regression that breaks the plist-embedding linker step but keeps the source plist correct would slip past.
4. **docs/computer-use-user-guide.md:117 literal D3 match** — Borderline. The wording "不要去找或勾选 `node`、`cmspark-host`" contains the forbidden literal tokens. D8 migration wording permits this (telling users to ignore ghosts), but a stricter reader could call it a D3 violation. Consider rephrasing to "若列表里有其他历史进程名（无需操作）" to fully avoid the literal tokens.
5. **ADR-020 capability declaration missing from implementer prompt** — Per checklist, this is a nit for diffs that are docs/test/refactor + packaging-rewrite (no new LLM tools, no new UI entry points, no new confirm dialects). The change adds Swift tray-launch behavior to replace the deleted bash launcher — behavior preservation, not new surface. Non-blocking.

## Verdict confidence

90% — Implementation correctly addresses D1–D10, R1–R7, and DR-N1…N7 (with documented deviations). 10% haircut for: Task 7 manual verification still pending (expected, not a code defect); ad-hoc signing instability across rebuilds (acknowledged in spec §8); install-daemon.sh path still uses bash launcher (P1, deferred per DR-N6 with user-doc disclosure).

VERDICT: APPROVE_WITH_NITS
