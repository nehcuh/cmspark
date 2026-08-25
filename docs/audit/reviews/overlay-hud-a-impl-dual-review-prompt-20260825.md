# Dual external review: Overlay HUD A implementation

**Batch:** `overlay-hud-a-impl`  
**Spec:** `docs/superpowers/specs/2026-08-25-overlay-hud-a-design.md` (user chose A; SUPERSEDES Slice B HTML Darwin)  
**STALE:** `overlay-dogfood-slice-ab-impl-verdict-20260825-142137`  
**Blast:** T2 L0 Surface

```text
Surface:      L0 Darwin HUD（无标题条、无左轨）；Win/Linux 仍 C-thin HTML
L2-classes:   (none)
Compose:      overlay 不 apply pack；知识 USE 仅线程已挂 id
Autonomy:     n/a
Trust:        overlay ACL 不涨；无 HTML getUserMedia；📎 走既有 file.upload
Channel:      community
```

## Machine `[executed]`

- overlay/client/protocol/talk/web/acl tests: **152 pass / 0 fail**
- `SWIFT_TRAY_SHA256` == `companion/dist/cmspark-tray` == `6ce8f1d82297f663c8424ec42ad586d66eec287f2968410f5ead9d21b9199ebb`
- Binary contains `知识配置去侧栏` and `application/octet-stream`; does **not** contain `makeRail` or `Raycast/uTools 形态`

## DoD

1. Mac NSPanel: `.borderless`, no `makeRail`, Esc `hide()`, no overlay `summoner.pack.apply` chrome.  
2. 📎 Swift MIME non-empty (never `"type":""`); Node coerces empty → `application/octet-stream`; `handleSummonerFiles` `claimOverlayIfLive`; `mapChatMessageToSummonerCmd` maps `file.upload_error`.  
3. 6MiB cap; skip is visible.  
4. Hint has 知识配置去侧栏. No Raycast/uTools 形态 comments.  
5. ACL: no new `knowledge.*` / HTML `getUserMedia` / `voice.stt.*` on web dispatch.  
6. Do **not** loosen `validate.ts` truthy `type`.

## REJECT if

R1 ACL growth or HTML mic  
R2 📎 still `"type":""` or HUD still ignores `file.upload_error`  
R3 titled+rail workbench still the user-facing Mac shell  
R4 comments still claim Raycast/uTools 形态  
R5 pin ≠ live binary  

End with VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT
