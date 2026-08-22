# Independent adversary — Chrome CU one-shot residual nits fold

You did **not** write this code. Do not rubber-stamp. Read real diff and source.

Worktree: `/tmp/cmspark-chrome-cu` branch `feat/chrome-cu-oneshot-l2` HEAD `f4a743e`.
Nits fold: `9a2a0f3..f4a743e`. Feature vs `origin/main` (`56a5973`).

Patch: `docs/audit/reviews/chrome-cu-oneshot-nits-diff-20260822.patch`
Prior dual (APPROVE_WITH_NITS): `docs/audit/reviews/chrome-cu-oneshot-claude-20260822.md` residual list.

## Blast
**T3 Trust.** One-shot Chrome pixel CU. Persistent `coordinateAllowed` still impossible on vault browsers. Unattended / 三旗 / G1 must never skip the dialog.

```text
Surface:      L2 host_computer (vault-browser one-shot)
L2-classes:   host_computer
Compose:      none
Autonomy:     single
Trust:        forceConfirm L2; NEVER skipped by unattended / cruise / G1;
              does NOT persist Apps coordinateAllowed; LOLBIN/PM/terminal/wallet STRUCTURAL
Channel:      community
```

## Claimed nits fold (verify each; missing = REJECT if it re-opens skip/persist)

1. Catalog `host_computer` **description** no longer requires persist `coordinateAllowed`; browsers = one-shot L2 never skipped.
2. User-guide checklist no longer says 浏览器 must 允许坐标.
3. Rule 7/8/9c no longer forbid Rule 12 one-shot (CDP fail ≠ silent CU; freeze/cap or explicit 模拟点击 MAY CU, ALWAYS confirm).
4. ADR-017 D3 cruise-waive has vault-browser exception; ADR-021 / GOAL / architecture synced.
5. Canary / `chromium.exe` vault-mapped (`canEverCoordinate` false; one-shot allowed).
6. HOST_CHROME matches Safari/Edge/Brave via **params.app only** (task text "knowledge" must not match).
7. hwnd Chrome-entry + powershell hwnd = `HWND_NOT_OWNED` (tested).
8. G1/unattended skip algebra **not entered** for one-shot (exported helper + test); relevantApps empty (no G1 checkbox).
9. win32 notepad.exe + pasted `com.google.Chrome` bundleId is NOT a vault-browser one-shot.

**Explicitly out of this fold:** compact Side Panel `MinimalConfirm` never renders preview.

## Machine (already run this session — re-run if you doubt)
`tsc -p tsconfig.test.json --noEmit` exit 0.
`tsx --test` computer-policy + l2-admission-pure + apps-guards + apps-coordinate + wave1 + orchestrator-tool-pregate + computer-preview + tool-schemas: **197 pass / 0 fail**.

## DoD
1. Named residuals from Claude 20260822 items 1–5, 7 (HOST_CHROME / Canary / chromium / notepad tamper) are actually gone in tree, not just claimed.
2. Unattended still cannot skip Chrome one-shot L2.
3. Persist bit still denied on Canary and chromium.exe.
4. powershell / 1Password still STRUCTURAL with one-shot flag.
5. WAVE-1 still NEVER default host_computer for DOM.
6. No new skip/persist hole from the fold (especially `canEverCoordinate` win-path identity).

## Job
Your lane is in the spawn prompt. Outcome / trajectory / component. file:line. [executed]/[inspected]/[assumed].
Write the full report to the path given in the spawn prompt.
Final line exactly:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
