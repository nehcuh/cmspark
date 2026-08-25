# Adversary review (Security / Trust) — overlay files / STT unhide / ACL freeze

**Batch**: `overlay-nspanel-restore-20260825`  
**Role**: independent Security/Trust skeptic (did **not** implement)  
**Evidence**: `[inspected]` live tree  
**Blast**: T2 (same class as existing overlay/HTML `file.upload`) — **no T3 ACL growth found**

```text
Surface: L0 overlay
Trust: overlay ACL no-grow; no confirm; files via existing file.upload
```

---

## Verdict in one line

No overlay `knowledge.*` / `config.*` / `mcp.add` / confirm dialect, no HTML `getUserMedia`, no `voice.stt.*` on the C-thin web allowlist. Native 📎 is existing `file.upload` over the summoner WS. The new Swift path **fails closed** on empty MIME and **does not** skip the router lease/`run_active` gates — it just never claims lease itself and swallows most upload errors.

---

## 1. Overlay ACL — no-grow (F-UX-OVERLAY-1)

`SUMMONER_ALLOW` (`companion/src/ws/summoner-acl.ts`): no `knowledge.*`, no `config.*`, no `mcp.add`, no confirm. `file.upload` and `voice.stt.*` are **pre-existing** tray-origin, not Wave-0 adds.

`SUMMONER_WEB_DISPATCH_ALLOW`: **no** `knowledge.*`, **no** `voice.stt.*`, **no** `config.*`, **no** `mcp.add`. Tests in `summoner-web.test.ts` lock denials. Residual: `summoner-acl.test.ts` itself does not enumerate `knowledge.*`.

`file.upload` parses into the **thread** and starts chat; it does **not** call `importKnowledge`.

---

## 2. `summoner.files` decode

`protocol.ts:495-509`: count 1–8; `thread_id` required (may be `""`); `type` empty string is legal; **no** byte cap at decode. Extra keys dropped (no hostname smuggle). Count 0 or >8 drops the whole event with no overlay error.

---

## 3. Swift `attachFilesClicked`

User-picked `Data(contentsOf:)` follows aliases/symlinks — **expected** for NSOpenPanel, not a path-injection into Node. Bytes + basename only on the wire.

Nits: always `type: ""`; `try?` + size skip silent; no `allowedContentTypes`; 8 files vs WS 10; 8MiB vs 10MiB.

No overlay Allow/Deny chrome.

---

## 4. `handleSummonerFiles` — lease / busy

**Not a bypass.** Router still enforces `gateChatCreateOnLease` and `run_active`. What is skipped: **proactive claim**. Empty `thread_id` creates a thread then uploads without claiming → OVERLAY_STANDBY. Messy, not privilege growth.

`file.upload_error` unmapped — functional honesty, not a trust hole.

---

## 5. Empty MIME is fail-closed

`validate.ts:776-783` `!f.type` → invalid. **Do not** fix by making `type` optional on `file.upload` without UTI/allowlist. Empty type is not `image/*`; `allowed_types.includes("")` would still reject.

---

## 6. Mic unhide vs HTML mic

Swift 🎙 unhide = existing in-process `AVAudioEngine` + `voice.stt.*` on summoner WS with `privacy_ack_v2`. Origin fence: `cmspark-tray://local` and `surface === "summoner"`.

HTML: **no** `getUserMedia`; `voice.stt.start` not on web dispatch (test-locked). Token-in-URL + `unsafe-inline` — adding HTML STT here would be T3. They did not.

---

## 7. Confirm / monotonicity

Overlay cannot answer `security.confirmation.response` (ACL deny). HTML SSE drops `security.confirmation.request`. Companion still cannot open Side Panel from overlay attach.

---

## Findings

### BLOCK
None vs the security bar (ACL growth / HTML mic / confirm dialect / upload bypass).

### NIT
1. Empty MIME dead-end (fail-closed). Do not loosen validate.
2. Size/count mismatch; silent skip.
3. `file.upload_error` unmapped.
4. Lease not claimed on files path.
5. Privacy copy missing on native hint.
6. ACL test gap on `knowledge.*` in `summoner-acl.test.ts`.

VERDICT: APPROVE_WITH_NITS
