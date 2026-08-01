# HANDOFF — macOS TCC product identity (2026-08-01)

## Branch
`fix/macos-tcc-product-identity`

## Dual review (gate before impl)
- Claude + Pi: **both APPROVE_WITH_NITS** (`both_ok=true`)
- Synthesis: `docs/audit/reviews/macos-tcc-product-identity-dual-synthesis-20260801.md`
- Amendments DR-N1…N7 applied during execution

## Commits (this branch)
```
fix(darwin): embed com.cmspark.agent identity in host binary
fix(darwin): harden host identity gate via codesign Identifier
fix(darwin): CMspark main identity — tray launch, scripts path, user copy
fix(darwin): prefer MacOS/CMspark as host binary in app bundle
fix(packaging): native MacOS/CMspark replaces bash launcher
docs: Screen Recording UX only mentions CMspark
```

## Done (Tasks 0–6)
| Task | Status |
|------|--------|
| 0 baseline | done — was bash main + com.cmspark.host |
| 1 identity | done — com.cmspark.agent |
| 2 tray/copy/paths | done — arch -arm64 tray |
| 3 resolveHostBinary | done — MacOS/CMspark first |
| 4 create-dmg | done — Mach-O main; **symlink** Resources/cmspark-host → MacOS/CMspark (hardlink breaks A6 after codesign --deep); CDHash assert |
| 5 docs/copy | done — only CMspark; DisplayName CMspark |
| 6 tests | pass — host-bin 4, integrity 8, inject 8, adapter 30, package gates 49, self-ui 5 |

## Remaining — Task 7 human DoD (blocker for “fixed for users”)
1. Install **fresh** DMG built after this branch (`make package-macos` then `scripts/create-dmg.sh` preferred so host bytes match current build).
2. Completely quit old CMspark (tray + daemon).
3. Open new app → trigger non-Chrome window screenshot (L2 / host_computer).
4. Privacy list: enable **only CMspark**; no product UI must say node/host.
5. After grant + full relaunch: capture must succeed (not -3801).
6. Record acceptance under `docs/audit/reviews/macos-tcc-identity-acceptance-YYYYMMDD.md`.

If list still shows wrong name or -3801 after only CMspark enabled → **REJECT ship**, follow plan Task 7.6.

## P1 backlog
- Developer ID + notarize
- XPC in-process capture
- install-daemon.sh alignment

## Key paths
- Spec: `docs/superpowers/specs/2026-08-01-macos-tcc-product-identity-design.md`
- Plan: `docs/superpowers/plans/2026-08-01-macos-tcc-product-identity-impl.md`
