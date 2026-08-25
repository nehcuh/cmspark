# Dual external review: Overlay NSPanel restore (post HTML `--app` reject)

**Batch:** `overlay-nspanel-restore`  
**Stage:** Pi/Claude re-review of **independent four-lane adversary** + working-tree diff  
**Blast:** T2 L0 Surface (product IA + overlay file.upload)

```text
Surface:      L0 Darwin NSPanel restore + 📎/🎙; L0 Side Panel markdown/pack
L2-classes:   (none)
Compose:      overlay pack.apply rail (pre-existing); knowledge USE via thread ids
Autonomy:     n/a
Trust:        overlay ACL no-grow; no HTML getUserMedia; files via existing file.upload
Channel:      community
```

## What you are reviewing

**Not** the stale HTML Slice B (`overlay-dogfood-slice-ab-impl-verdict-20260825-142137.json` both AWN). User rejected Chromium `--app` as uglier than Raycast/uTools HUD. Current uncommitted tree **restored** Mac tray/hotkey to Swift NSPanel, unhid 🎙, added 📎 `NSOpenPanel` + `summoner.files`.

Read **full** adversary reports (not this summary):

- `docs/audit/reviews/overlay-nspanel-restore-adversary-product-20260825.md` → REJECT
- `docs/audit/reviews/overlay-nspanel-restore-adversary-impl-20260825.md` → REJECT
- `docs/audit/reviews/overlay-nspanel-restore-adversary-security-20260825.md` → APPROVE_WITH_NITS
- `docs/audit/reviews/overlay-nspanel-restore-adversary-external-20260825.md` → REJECT
- `docs/audit/reviews/overlay-nspanel-restore-eval-gate-20260825.md`

Locked (still on disk, **not SUPERSEDED**): `docs/superpowers/specs/2026-08-25-overlay-dogfood-slice-ab-design.md`

## Machine `[executed]` by orchestrator

- overlay/protocol/web/acl tests: **95 pass / 0 fail**
- chrome-extension `markdown-breaks.test.ts`: **2 pass**
- `validateWsMessage({files:[{type:""}]})` → invalid 「每个文件需要 name, type, content 字段」
- `SWIFT_TRAY_SHA256` == `companion/dist/cmspark-tray` == `5d17fe174b241491a0c1c1071f9dc6494a09aad3506a813d2544d5b170ecb44b`

Re-run those if tools allow. Do **not** treat green tests as 📎 DoD.

## Your task

Confirm or **reject** the adversary conclusions. Inspect real files. Look for incomplete fixes, over-claiming, missed BLOCKs.

### Confirm or falsify

1. Product: titled 640 + 200pt 对话/MCP/场景 rail is **not** Raycast/uTools HUD; comments that say 形态 are dishonest.
2. Impl: 📎 `"type":""` dies at `validate.ts`; `file.upload_error` unmapped in `mapChatMessageToSummonerCmd`; empty-thread path skips `claimOverlayIfLive`.
3. Security: no ACL growth / no HTML getUserMedia — AWN is the right *security* bar even if product/impl REJECT.
4. External: shipping under `142137` APPROVE would be a process lie; user override needs a **new** spec lock.

### REJECT if any

R1 overlay ACL growth (`knowledge.*` / `config.*` / `mcp.add` / confirm) or HTML `getUserMedia` / `voice.stt.*` on `SUMMONER_WEB_DISPATCH_ALLOW`  
R2 📎 path cannot upload a small text file **and** surface error/success in the NSPanel (empty MIME and/or unmapped `file.upload_error`)  
R3 Dual-approved HTML Darwin (`142137`) is treated as still describing HEAD  
R4 Reviewer rubber-stamps tests-green as merge-ready  

APPROVE is **not** expected unless you falsify the BLOCKs with file:line. APPROVE_WITH_NITS only if 📎 actually works and IA is honestly a workbench (not sold as Raycast) **and** you explain why Product/Impl REJECT were wrong.

Apply ADR-020 checklist. End with exactly one of:

VERDICT: APPROVE  
VERDICT: APPROVE_WITH_NITS  
VERDICT: REJECT
