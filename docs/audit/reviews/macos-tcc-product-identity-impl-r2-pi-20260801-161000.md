All checks complete. The branch diff is clean (patch file includes unrelated unstaged qwen/model-switch work, but all focus files are committed at HEAD and the live state matches). Writing the final review.

## Summary

This is a post-implementation re-review of the macOS TCC product identity fix (branch `fix/macos-tcc-product-identity`, 9 commits vs `main`), focused on verifying the round-1 **B1 REJECT** (packaged `MacOS/CMspark` SHA ≠ `CMSPARK_HOST_SHA256` after `codesign --deep` broke `spawnHostBin`/inject/host_read in the DMG) plus Tasks 0–6 and the rejection gates R1–R7.

**B1 is fixed and verified live** [executed]: `dist-package/dmg-staging/CMspark.app/Contents/MacOS/CMspark` is Mach-O arm64, `codesign -dv` → `Identifier=com.cmspark.agent` (adhoc,runtime), `Resources/cmspark-host` is a **symlink** → `../MacOS/CMspark` (single signed blob, shared CDHash `b186cf3d…`), full-bundle `codesign --verify --deep --strict` passes, and both B1 packaged tests pass against the live staged app (`reason=codesign-product`; `spawnHostBin security-check` returns `{"ok":true}`). 22/22 unit/integration tests and 49/49 package gates pass.

## Spec compliance (D1–D10)

| Lock | Status | Evidence |
|---|---|---|
| D1 unique TCC subject | ✅ | SCK denial / estop / inject / AX errors all say «CMspark»; rg scan of user paths has zero "enable node/cmspark-host" guidance |
| D2 no SCK in node | ✅ | SCK/inject/estop only in host.swift, packaged as `MacOS/CMspark`; node only launches tray agent [inspected] |
| D3 user copy | ✅ | `strings` scan of packaged binary: no `and/or node`, `cmspark-host if listed`, `enable cmspark-host` [executed] |
| D4 Mach-O main entry | ✅ | `file` → Mach-O arm64; bash `LAUNCHER` heredoc removed from create-dmg; file gate fails closed [executed] |
| D5 embedded identity | ✅ | `host-Info.plist` = `com.cmspark.agent`/CMspark; swiftc `-sectcreate` embeds; build gate (4c) asserts codesign `Identifier` [inspected+executed] |
| D6 resolve prefers main | ✅ | `resolveHostBinaryCandidates[0]` = `../MacOS/CMspark`; order test passes [executed] |
| D7 dev vs release names | ✅ | `dist/cmspark-host` still built (pin matches its SHA); user docs never make it an action object |
| D8 migration copy | ✅ | "fully quit and reopen… turn switch off/on after reinstall"; no ghost-process guidance |
| D9 ad-hoc honesty | ✅ | user guide: "ad-hoc 安装时系统可能要求重新授权" |
| D10 override security | ✅ | `CMSPARK_HOST_BIN` still requires `CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1`; both D10 tests pass [executed] |

## Packaging / identity (create-dmg, CDHash, symlink vs hardlink)

- bash launcher heredoc removed; `cp` of host Mach-O → `MacOS/CMspark`, then `Resources/cmspark-host` recreated as **symlink** to `../MacOS/CMspark`. [inspected] Correct deviation from the plan's "prefer hardlink": hardlinks break because `codesign --deep` rewrites the main executable to a new inode; the symlink survives deep-sign and the create-dmg comment documents this.
- DR-N2 CDHash-equality assert runs post-sign and passes live (both `b186cf3d…`) [executed]. R2 satisfied — capture resolves to a **single** signed blob with an A6 control enforced at package time.
- R4 satisfied: build-time (4c) gate asserts `Identifier=com.cmspark.agent` and rejects stale `com.cmspark.host` in source plist; DR-N1 followed (no `codesign -d --info-plist=-`, which fails on macOS 26.5).

## User copy scan

[executed] `rg` for `and/or node|cmspark-host if listed|enable.*cmspark-host|grant Accessibility permission to cmspark-host|permission for cmspark-host|not Accessibility-trusted` across `companion/src/computer`, user guide, TROUBLESHOOTING, scripts → zero matches. The single `cmspark-host` hit in the user guide is the deliberate negated migration note ("不要去找或勾选 node、cmspark-host…以 CMspark 为准") — verbatim from the plan's approved Step 5.2 template; it instructs users *not* to enable them, so R1 is not tripped. R6 satisfied: no-args/`tray`/`launch` → `launchAgentTrayAndExit` via `/usr/bin/arch -arm64` (DR-N4), subcommands (screenshot/inject/estop/security-check) retained.

## Security (D10, integrity)

- D10 preserved; TOCTOU machinery (realpath, open-fd hash, post-spawn re-stat) intact and exercised.
- **Nit (non-blocking):** the `codesign-product` fallback is forgeable — an ad-hoc signature with `Identifier=com.cmspark.agent` can be produced by anyone (`codesign -s - --identifier com.cmspark.agent`), so for the packaged path the gate is an identity/format sanity check, not cryptographic tamper detection. It only applies under `*.app/Contents/` and the dev SHA pin is unchanged; threat-model impact is bounded (attacker needs write access to the bundle, where the bundled JS is equally replaceable). Recommend P1: verify the enclosing bundle's sealed resources / nested CDHash, or Developer ID (already P1-1). Should be documented in `host-integrity.ts` — the header explains SHA drift but not the forgeability tradeoff.
- Pre-existing observation (not introduced here): `darwin-estop.ts:90` spawns `resolveHostBinary()` via `child_process.spawn` outside `spawnHostBin`, contradicting the host-integrity header's "authoritative spawn surface" claim; capture/window-list paths in `darwin-adapters.ts` also use raw `execFileAsync`. These predate this branch and are not part of this diff's semantics.

## Tests

[executed] `host-use-darwin-integrity.test.ts` 10/10 (incl. both live packaged B1 tests); `host-bin-resolve.test.ts` 4/4 (resolve order + D10 dual opt-in both directions); `computer-darwin-inject-contract.test.ts` green (22 total); `test-package-gates.sh` 49/49 (create-dmg static gates: no bash, `Contents/MacOS/CMspark` present, A6 CDHash assert). `tsc -p tsconfig.test.json` compiles. Nit: the two packaged B1 tests skip when `dist-package/dmg-staging` is absent (typical CI), so CI coverage of B1 relies on the create-dmg CDHash assert + build (4c) gate running on macOS package jobs — honest, but the packaged-path tests are effectively local-verification-only.

## Ready for human Task 7 DoD?

**Yes, code/packaging is ready.** `memory/session.md` S29 explicitly states "Task 7 未完：需用户安装新 DMG、只勾 CMspark、外 App 截图验收" — no over-claim (R7 ✓). Human steps (install DMG, enable only CMspark, verify non-Chrome capture, record privacy-list description) still required; DR-N6 is satisfied by the user guide's explicit DMG-only P0 scope note (install-daemon remains P1-4).

## Blocking

None.

## Nits

1. **ADR-020 capability declaration missing** from the implementer prompt. This is a Surface-L2 identity/packaging fix with no new tools/gates/primary-UI entry points, so per the checklist it is a nit, not blocking. Axes fit correctly; no new confirmations, no originWs surface, no god-mode/auto-approve changes, no experimental-layer write-path regression.
2. `codesign-product` fallback is ad-hoc-forgeable (see Security) — document the tradeoff in `host-integrity.ts`; P1: verify bundle seal/CDHash or Developer ID.
3. User guide names `node`/`cmspark-host` in the negated migration note — per plan template and design A7's "关闭并删除未知项" spirit; slightly more concrete than A7's "文案不提", but it does not instruct enabling. Optional: reword to "关闭未知项" only.
4. Internal diagnostics still say "from cmspark-host" (`parseComputerJson`, `darwin-evidence.ts`); internal-only, but inconsistent with the scrubbed user copy.
5. `darwin-estop.ts:90` / capture paths spawn outside `spawnHostBin` — pre-existing; consider routing through the integrity gate in a follow-up for consistency with the header's claim.

## Verdict confidence

92% — B1 verified live against the staged app (not just statically), all gates/tests executed, user copy scanned, and the only deviations (symlink vs hardlink, negated node mention) are plan-sanctioned. Remaining uncertainty: forgeability tradeoff severity and real-machine TCC list rendering (A5), which are explicitly human-DoD items.

VERDICT: APPROVE_WITH_NITS
