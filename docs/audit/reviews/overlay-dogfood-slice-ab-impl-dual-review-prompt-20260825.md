# Dual external review: Overlay dogfood Slice A+B **IMPLEMENTATION**

**Batch:** `overlay-dogfood-slice-ab-impl`  
**Stage:** impl on `feat/knowledge-honesty-wave0` after direction dual both AWN `140045`  
**Blast:** T2 L0 Surface

```text
Surface:      L0 overlay C-thin unify ; L0 Side Panel breaks + pack radio
L2-classes:   (none)
Compose:      pack highlight UI only
Autonomy:     n/a
Trust:        overlay ACL unchanged ; no HTML getUserMedia
Channel:      unchanged
```

## Independent adversarial

- Product AWN · External APPROVE · Security r2 AWN (src/dist pin lockstep)  
- Impl r2 REJECT claimed pin `367b3e29` is the old overlay-split hash — **false**: overlay-split pin was `77139e17`; `367b3e29` is `shasum` of `companion/dist/cmspark-tray` **after** `Tray.swift` jsonLine change. Confirm with `shasum -a 256 companion/dist/cmspark-tray`.

## DoD

A: `marked` `breaks: true`; meetingCard accent only if `meeting-minutes`; pack `itemActive`.  
B: Darwin menu/hotkey → `click action=summoner` → `openSummonerWebShell`; 📎 `label for=files`; no `knowledge.*` / `voice.stt.*` on `SUMMONER_WEB_DISPATCH_ALLOW`.  
SHA: src pin == dist JS pin == binary shasum.

## REJECT if

R1 overlay ACL growth or HTML getUserMedia  
R2 menu/hotkey still `summonerController.open`  
R3 pin ≠ live binary  
R4 knowledge admin in overlay  
R5 AppKit unfrozen as second user-facing 召唤器 (unhide 🎙 / NSOpenPanel)

VERDICT line required.
