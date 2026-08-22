# Dual rereview (Claude + Kimi) — Chrome CU one-shot nits fold

You are a **second judge**. Confirm or reject independent adversaries. Do not rubber-stamp.

Worktree `/tmp/cmspark-chrome-cu` branch `feat/chrome-cu-oneshot-l2` HEAD `ec65d92`.
Feature vs `origin/main` (`56a5973`). Nits fold `9a2a0f3..f4a743e`. Identity fold `f4a743e..ec65d92`.

## Blast
**T3 Trust.** Vault-browser one-shot L2. Persistent `coordinateAllowed` impossible on browsers. Unattended / 三旗 / G1 never skip.

## Adversary reports (read FULL, not summaries)
- `docs/audit/reviews/chrome-cu-oneshot-nits-adversary-trust-20260822.md` **REJECT** (darwin Chrome bundleId + dummy.exe un-vaults → persist + skip algebra)
- `docs/audit/reviews/chrome-cu-oneshot-nits-r2-adversary-trust-20260822.md` **APPROVE_WITH_NITS** after `ec65d92` platform-native identity
- `docs/audit/reviews/chrome-cu-oneshot-nits-adversary-product-20260822.md` APPROVE_WITH_NITS (TAB_ATTACH_FROZEN phantom code; ADR-021 §4 re-L2 wording)
- `docs/audit/reviews/chrome-cu-oneshot-nits-adversary-runtime-20260822.md` APPROVE_WITH_NITS (HOST_CHROME still needles not `isVaultBrowserEntry`)

Prior dual residuals that this fold claimed to close: catalog description, checklist, Rule 7/8/9c, ADR-017 D3, Canary/chromium, HOST_CHROME app-field, hwnd chrome→powershell, skip-algebra pin, notepad tamper.

## Fold after Trust nits REJECT (verify in `ec65d92`)
`isVaultBrowserEntry` / `canEverCoordinate` take `platform` (default `os.platform()`):
- win32 → exe path only
- darwin → bundleId wins when present (dummy.exe cannot un-vault Chrome)

Tests: darwin hybrid stays vault; win32 notepad+bundleId not vault; handler Chrome+dummy.exe STRUCTURAL_DENY.

## Machine (this session)
`tsc -p tsconfig.test.json --noEmit` exit 0.
Named suite (policy, l2-admission-pure, apps-guards, apps-coordinate, wave1, tool-pregate, preview, tool-schemas): run again if you doubt; last full run before r2 was 197 pass / 0 fail; after r2 policy 46 + apps-coordinate 28.

## Job
1. Is Trust REJECT (`dummy.exe` un-vault) actually folded? If persist still works on darwin hybrid → you REJECT.
2. Can unattended still skip Chrome one-shot L2 on a stock vault-browser entry?
3. Confirm or reject each adversary. Over-loose APPROVE → REJECT.
4. Named prior residuals: gone or still live? (catalog, Rule 7/8/9c, D3, Canary, HOST_CHROME, skip algebra)
5. ADR-020 checklist (Surface / Compose / Autonomy / Trust monotonic / Channel).
6. Product nit `TAB_ATTACH_FROZEN` vs real `CDP_ATTACH_FAILED` / volume cap — blocking skip hole or prompt nit?

End with exactly:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
