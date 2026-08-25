# Adversary review (Implementation / correctness) — Mac 📎 NSPanel → overlay `file.upload`

**Batch**: `overlay-nspanel-restore-20260825`  
**Role**: independent Impl skeptic (did **not** implement)  
**DoD**: small text file from NSPanel lands in the **current overlay thread** and HUD surfaces success/error. Tests green ≠ DoD.  
**Blast**: T2 functional L0.

Machine (orchestrator `[executed]`, this lane `[inspected]` unless noted):

- `npx tsx --test tests/summoner-overlay.test.ts tests/summoner-protocol.test.ts tests/summoner-web.test.ts tests/summoner-acl.test.ts` → **95 pass / 0 fail**
- `validateWsMessage` empty MIME → `{ valid: false, error: "每个文件需要 name, type, content 字段" }` **[executed]**
- `SWIFT_TRAY_SHA256` pin == `shasum -a 256 companion/dist/cmspark-tray` == `5d17fe174b241491a0c1c1071f9dc6494a09aad3506a813d2544d5b170ecb44b` **[executed]**

---

## Hypothesis outcomes

| ID | Claim | Result | Severity |
|----|--------|--------|----------|
| H1 | Swift `"type": ""` fails `file.upload` validate | **CONFIRMED** `[executed]` | **BLOCK** (DoD) |
| H2 | empty `thread_id` creates thread without overlay lease | **CONFIRMED** | **BLOCK** (empty/new-thread path) |
| H3 | `file.upload_*` never mapped to HUD | **CONFIRMED** | **BLOCK** (DoD error/ack) |
| H4 | 8MiB raw × 4/3 > `WS_SOFT_MAX`; silent skip | **CONFIRMED** | **BLOCK** (cap lie); not small-file DoD |
| H5 | tests grep source strings; green while 📎 dead | **CONFIRMED** | **BLOCK** (test gap) |
| H6 | Darwin no longer `click action=summoner`; Win/Linux still web shell | **FALSIFIED as defect** | Mac HUD not stolen |

---

## BLOCK — H1: 📎 dies at WS validate

`SummonerOverlay.swift:646-664` always `"type": ""`.  
`protocol.ts:495-509` allows empty type.  
`menu-bar-agent.ts:1139` forwards as-is.  
`validate.ts:776-782` `!f.type` → invalid.  
`lifecycle.ts` stamps `file.upload_error` **before** the router.

HTML already knew File.type can be empty: `summoner-web.ts:670` `f.type||"application/octet-stream"`.

**[executed]** empty type rejected; `text/plain` valid.

---

## BLOCK — H3: HUD never sees upload success/error

`mapChatMessageToSummonerCmd` (`summoner/client.ts:282-367`) maps chat/error/tool/mcp.confirm.pending. **Zero** of: `file.upload_error`, `file.uploaded`, `file.upload_status`.

`handleSummonerFiles` only HUD-errors when `sendAppMessage` returns false (socket down). Swift does **not** locally append a “你: 📎 …” line.

---

## BLOCK — H2: empty/`new_thread` attach skips overlay lease

`handleSummonerFiles` (`menu-bar-agent.ts:1117-1142`): `createThread` + `bindSummonerThread` + hydrate, **no** `claimOverlayIfLive`. Contrast `handleSummonerSubmit` / `handleSummonerNewThread`.

Default lease holder is `panel`. Summoner-stamped `file.upload` then `gateChatCreateOnLease` → `OVERLAY_STANDBY`. First `open(threadId: "")` and 新对话 empty `threadId` until hydrate.

Hydrated current-thread path may already hold overlay (H2 not first kill there). Still a live attach path in the same function.

---

## BLOCK — H4: Swift 8MiB cap cannot survive WS

Swift cap 8MiB raw. Base64(8MiB) ≈ 11.18MiB. `WS_SOFT_MAX` = 10MiB − 256KiB = 10.22MiB. Files in (7.7MiB, 8MiB] pass Swift, die as oversized. `> 8MiB`: `continue` then empty → **no error**.

---

## BLOCK — H5: tests cannot fail a dead 📎

`summoner-overlay.test.ts:191-197` greps `attachFilesClicked` / `NSOpenPanel` / `summoner.files`. Protocol round-trip uses `type: "text/plain"`, never Swift’s `""`. `handleSummonerFiles` unexported; no HUD mapping test.

---

## H6 — not a defect

Darwin menu/hotkey → `summonerController.open` / `openFromHotKey`. Node `handleAction("summoner")` → `openSummonerWebShell` remains for systray2/readline. Mac HUD not stolen.

---

## Mic

Hold-to-talk is wired (`micHoldChanged` → `summoner.mic.*` → STT → `summoner.dictate`). **NIT:** hold `< 0.35s` returns without `finishMicCapture`.

---

## DoD reconstruction (small `.txt`, hydrated overlay)

1. 📎 → `type: ""`  
2. decode accepts  
3. `sendAppMessage` returns true  
4. validate rejects `[executed]`  
5. `file.upload_error`  
6. mapper returns `null`  
7. HUD: no error, no tokens  

**📎 does not upload. HUD does not surface the failure.**

VERDICT: REJECT
