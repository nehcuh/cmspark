All evidence gathered. Writing the final review.

---

## Summary

Reviewed the macOS TCC product-identity implementation on `fix/macos-tcc-product-identity` (base `main`, merge-base `b926b66`). The patch file matches the current branch diff for all 14 TCC-scope files (the patch also contains unrelated unstaged Qwen3-VL/Chrome-extension hunks — out of scope for this batch, flagged as a nit). Design intent is faithfully executed: D1–D10 implemented, all DR-N1…N7 amendments applied, user copy scrubbed, packaging is Mach-O with `com.cmspark.agent`, single-CDHash achieved, Task 7 honestly unclaimed. **However, the change introduces a P0 functional regression: in the packaged app, the S-P0-2 host-integrity gate now fails on every host spawn, breaking Computer Use inject and Host read/write in the shipped DMG.** I proved this against the real `dist-package/dmg-staging` artifact (fresh build, 15:47 today). Code is **not** ready for human Task 7 DoD.

## Spec compliance (D1–D10) `[inspected + executed]`

- **D1** — Only «CMspark» is user-visible. ✓ (error strings, estop, adapter, user guide)
- **D2** — SCK runs in `MacOS/CMspark` Mach-O, never node. ✓ (capture via resolved main binary)
- **D3** — Copy gate executed: zero user-path matches for "enable/tick node|cmspark-host". The only matches are the *sanctioned* migration line "不要…勾选 node、cmspark-host" (user-guide.md:117) and a dev-only stderr warning naming CMspark (host.swift:1638). ✓
- **D4** — `file MacOS/CMspark` → Mach-O arm64; script gate in create-dmg.sh + static gate in test-package-gates.sh. ✓ `[executed]`
- **D5** — `codesign -dv` Identifier=`com.cmspark.agent`; strings show only `com.cmspark.agent`, no `com.cmspark.host`. ✓ `[executed]`
- **D6** — `resolveHostBinaryCandidates` prefers `../MacOS/CMspark`; unit-tested. ✓ `[executed, 4/4]` — but see Blocking B1 (integrity gate).
- **D7** — Dev `dist/cmspark-host` retained as fallback. ✓
- **D8** — Migration copy present ("只开 CMspark…历史残留可关闭"). ✓
- **D9** — Honest ad-hoc reinstall note in error string + user guide. ✓
- **D10** — Dual opt-in preserved verbatim; tested (throw without ALLOW, return with ALLOW=1). ✓ `[executed]`

## Packaging / identity (create-dmg, CDHash, symlink vs hardlink)

`scripts/create-dmg.sh:80-88` copies `cmspark-host` → `MacOS/CMspark` and symlinks `Resources/cmspark-host → ../MacOS/CMspark` — a sound improvement over the plan's hardlink (hardlinks break when codesign rewrites the main executable's inode; the comment explains this correctly). DR-N2's CDHash-equality assert (create-dmg.sh:113-118) is present. Verified on the live artifact: `codesign -dv` on both paths → same `Identifier=com.cmspark.agent`, same adhoc CDHash. `[executed]` Note: hdiutil dereferences the symlink — the DMG contains two byte-identical regular copies (same CDHash, A6 still holds).

## User copy scan `[executed]`

`rg` with the DR-N3-extended pattern over `companion/src`, `docs/computer-use-user-guide.md`, `scripts/create-dmg.sh`, `scripts/macos` → only the two intended matches above. `strings` of the built binary → no `and/or node`, no `enable…cmspark-host`, no `grant Accessibility permission to cmspark-host`. ✓

## Security (D10, integrity)

D10 override preserved. **However, the S-P0-2 integrity control is silently broken in packaged mode** — see Blocking B1. This is a security/functional regression, not a weakening: the gate now *always* fails packaged, which in practice either bricks host ops or pushes operators toward the `CMSPARK_SKIP_HOST_INTEGRITY=1` escape hatch.

## Tests

- `host-bin-resolve.test.ts`: 4/4 pass (resolve order, D10). `[executed]`
- `host-use-darwin-integrity.test.ts`: 8/8 pass — but only against the **dev** `dist/cmspark-host`; nothing exercises the bundle-signed main executable. `[executed]`
- `computer-darwin-inject-contract.test.ts`: 8/8. `[executed]`
- `scripts/tests/test-package-gates.sh`: 49/49 (static bash-launcher ban + CDHash assert). `[executed]`
- **Missing**: no test runs `checkHostIntegrity` (or `spawnHostBin`) against the packaged `MacOS/CMspark` — the exact path that fails.

## Ready for human Task 7 DoD?

**No.** Blocking B1 means the packaged app's inject (click/type/key/scroll/drag) and Host read/write (mail/notes/files/biometric) paths throw on every call. Task 7's literal checklist (file / codesign / strings / resolve / copy-scan) would pass and even a capture-only test could succeed (screenshot path uses ungated `execFileAsync`), so a human could wrongly sign off while the product's core operations are dead.

## Blocking

- **B1 (P0, functional + security-control regression)** — `resolveHostBinary()` in packaged mode now returns `Contents/MacOS/CMspark` (host-bin.ts:17), but `codesign --force --deep` at create-dmg.sh:104 rewrites the main executable's bytes (empirically: SHA256 `0710745986…` → `c266bb24…`), while the pinned `CMSPARK_HOST_SHA256` (host-integrity.ts:40) and the bundled JS constant are the pre-sign dist hash (`0710745986…`, verified present in the packaged `cmspark-agent.js`). Result: `checkHostIntegrity(MacOS/CMspark)` → `ok:false`, so `spawnHostBin` throws on every gated spawn — inject at darwin-adapters.ts:721/750/776/788/806 and host read/write at host-use/darwin/adapter.ts:141. The old layout passed (nested `Resources/cmspark-host` was not rewritten by deep-sign — verified empirically), so this is a **new regression introduced by this branch**. Fix direction: make the integrity hash sign-invariant (e.g., hash the Mach-O with `LC_CODE_SIGNATURE` stripped) or pin/bake the post-bundle-sign hash at package time with the bundle re-sealed after the patch.

## Nits

- Plan Task 5.1's rg pattern would itself match the sanctioned "不要勾选 node、cmspark-host" migration sentence in user-guide.md:117 — the gate pattern should scope to positive "enable/tick" phrasing only.
- The patch file bundles a large unrelated Qwen3-VL surface (new settings UI variants, download-source selection, server-side locator wiring) with no ADR-020 capability declaration in the prompt — out of batch scope, but it adds UI entry points and deserves its own review + declaration.
- create-dmg.sh:113-118 CDHash check is trivially satisfied via symlink resolution (same file); consider asserting same-inode/symlink at staging so a future independent blob can't pass silently.
- TCC-scope ADR-020 declaration absent from the implementer prompt (nit only — this diff adds no tools/gates/UI entry points).

## Verdict confidence

92% — the blocking finding is backed by empirical reproduction against the real packaged artifact (hash mismatch, `checkHostIntegrity ok:false`, stale constant in bundled JS), and the old-layout pass case was reproduced with the identical codesign command.

VERDICT: REJECT
