## Summary

[executed] Round-2 verification on commit `d15a788` (HEAD) vs `main` (b926b66). B1 fix verified live: staged `dist-package/dmg-staging/CMspark.app` Mach-O passes the new `codesign --verify` + `Identifier=com.cmspark.agent` integrity path. All 10 integrity tests green (including the two new B1 packaged tests), all 4 resolve tests green, all 49 package-gate asserts green. Single CDHash `b186cf3d…` confirmed for both `MacOS/CMspark` and the `Resources/cmspark-host` symlink. Forbidden user-facing strings absent from packaged binary.

## Spec compliance (D1–D10)

- **D1/D3** user subject = CMspark: `[inspected]` `host.swift:1106-1110` SCK denial rewritten; `darwin-estop.ts:108`, `darwin-adapters.ts:350`, user guide §macOS 权限 all name CMspark only. `[executed]` `strings MacOS/CMspark | grep -E 'and/or node|cmspark-host if listed'` → empty.
- **D2** SCK not under node: `[inspected]` resolve order in `host-bin.ts:15-25` prefers `MacOS/CMspark`; spawn surface in `host-integrity.ts:186` unchanged.
- **D4** Mach-O main executable: `[executed]` `file MacOS/CMspark` → `Mach-O 64-bit executable arm64`; `create-dmg.sh:90` `file | grep -qiE 'script|text executable|ASCII text'` gate.
- **D5** embedded identity: `[executed]` `codesign -dv MacOS/CMspark` → `Identifier=com.cmspark.agent`; `host-Info.plist` CFBundleIdentifier/Name/DisplayName all `com.cmspark.agent`/`CMspark`.
- **D6** packaged resolve: `[executed]` `host-bin-resolve.test.ts` asserts candidates[0] = `../MacOS/CMspark`.
- **D7** dev filename kept: `build-host.sh:13` still emits `dist/cmspark-host`; SHA pin `07107459…` matches `dist/cmspark-host` exactly.
- **D8** migration copy: user guide §「macOS 权限（只认 CMspark）」 + error string "If you just reinstalled/updated, turn the switch off and on again."
- **D9** ad-hoc honest: code comment in `host-integrity.ts:14-18` + `host-integrity.ts:49-53` documents the packaged-binary SHA drift; user guide discloses ad-hoc reinstall behavior.
- **D10** dual opt-in: `[executed]` resolve test "CMSPARK_HOST_BIN without ALLOW throws" passes; override logic untouched (`host-bin.ts:40-48`).

## Packaging / identity (create-dmg, CDHash, symlink vs hardlink)

- `[inspected]` `create-dmg.sh:74-93`: copies `Resources/cmspark-host` → `MacOS/CMspark`, then `rm -f` + `ln -sf ../MacOS/CMspark Resources/cmspark-host`. Plan Task 4.1 said hardlink (`ln -f`); implementer deliberately switched to symlink with comment explaining codesign rewrites the main executable to a new inode, breaking hardlinks. Justified.
- `[executed]` CDHash equality: `MacOS/CMspark` CDHash=`b186cf3d5164560aaa8c8e6d01d96294585d14fa`; `Resources/cmspark-host` (symlink-resolved) CDHash=same. `create-dmg.sh:113-120` asserts equality at build time.

## User copy scan

`[executed]` Grep over `companion/src docs scripts/create-dmg.sh scripts/macos` for the DR-N3-extended pattern: only sanctioned matches remain —
1. `host.swift:1638` stderr warning "CMspark is not Accessibility-trusted" (names CMspark, false-positive of the regex tail `not Accessibility-trusted`).
2. `docs/computer-use-user-guide.md:117` migration line "不要去找或勾选 `node`、`cmspark-host`" (intentional sanctioned negative).
3. Plan/spec/audit files (exempt).

## Security (D10, integrity)

- D10 override preserved (above).
- `[inspected]` `host-integrity.ts:96-149` `checkHostIntegrity`: SHA pin still authoritative for non-packaged paths; codesign-product fallback fires only when `isPackagedAppHostPath(realpath)` is true (regex `\.app/Contents/`). Mismatch → throws with explicit "treat the binary as compromised" guidance.
- `[executed]` `spawnHostBin security-check` on packaged binary via codesign-product path returns `{"ok":true}` (92 ms).
- Weaker than SHA but matches platform trust model (ad-hoc + TCC). D9 honest.

## Tests

- `[executed]` `host-bin-resolve.test.ts` — 4/4 pass.
- `[executed]` `host-use-darwin-integrity.test.ts` — 10/10 pass, including:
  - "TCC B1: packaged MacOS/CMspark passes integrity via codesign product id" → `reason === "codesign-product"`.
  - "TCC B1: spawnHostBin security-check on packaged MacOS/CMspark" → `parsed.ok === true`.
- `[executed]` `scripts/tests/test-package-gates.sh` — 49/49 pass, including the new `create-dmg.sh` Mach-O / no-bash / CDHash-equality asserts.

## Ready for human Task 7 DoD?

**Code-ready: yes.** Manual TCC + non-Chrome capture (DoD §6.5–6.6) still pending and explicitly unclaimed. The plan's Task 7.1–7.5 checkboxes remain unchecked; round-1 verdict JSON stands. Tests do not over-claim — packaged integration tests skip cleanly when `dist-package/dmg-staging` is absent.

## Blocking

None. All seven rejection gates (R1–R7) pass.

## Nits

1. `host-integrity.ts:71-86 codesignProductIdentityOk` uses synchronous `execFileSync` + `spawnSync`, blocking the event loop ~67 ms per packaged spawn. Consider async for spawn-heavy flows.
2. codesign-product path weakens integrity from exact SHA pin to "any com.cmspark.agent ad-hoc signed binary inside `*.app/Contents/`". The header comment documents the SHA-drift rationale, but worth a one-line note that an attacker with write access to the installed bundle could re-sign as `com.cmspark.agent` and pass — D9 already covers this at the product level (P1 = Developer ID + notarize for stable CDHash pinning).
3. ADR-020 capability declaration (`Surface: L2 host_computer | host_read`, `Compose: none`, `Autonomy: n/a`, `Trust: integrity-gate + ad-hoc codesign`, `Channel: community`) is missing from the implementer prompt. The diff modifies an existing L2 integrity gate (no new tool/gate/UI), so this is a nit, not blocking.
4. rg gate regex tail `not Accessibility-trusted` false-positives on the new (correct) string `CMspark is not Accessibility-trusted`. Narrow to `cmspark-host is not Accessibility-trusted` to keep the gate honest.
5. `Resources/cmspark-host` symlink at `create-dmg.sh:88` is effectively dead for resolution (resolve order prefers `MacOS/CMspark` first), only kept for legacy callers / strings compatibility — worth a one-liner in `host-bin.ts:49-54` saying so to prevent future "why is this here" cleanups that could regress A6.

## Verdict confidence
88%

VERDICT: APPROVE_WITH_NITS
