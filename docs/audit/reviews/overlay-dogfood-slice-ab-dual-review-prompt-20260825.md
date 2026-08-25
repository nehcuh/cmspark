# Dual external review: Overlay dogfood Slice A+B **DIRECTION**

**Batch:** `overlay-dogfood-slice-ab`  
**Stage:** **direction lock** (no impl yet) after four-lane adversary on user dogfood  
**Blast:** T2 L0 Surface

```text
Surface:      L0 overlay composer honesty ; L0 Side Panel markdown breaks + pack radio
L2-classes:   (none)
Compose:      pack highlight UI only ; knowledge USE via existing thread ids
Autonomy:     n/a
Trust:        overlay ACL does not grow ; no HTML getUserMedia ; no confirm
Channel:      unchanged
```

This is a **DIRECTION** review. Inspect **current code** + the spec. Do not rubber-stamp. If Darwin→C-thin is the wrong honesty fix, REJECT and say stay-on-Swift instead.

## Read

- Spec: `docs/superpowers/specs/2026-08-25-overlay-dogfood-slice-ab-design.md`
- C-thin: `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md`
- Overlay lock: `docs/superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md` F-UX-OVERLAY-1
- `companion/src/tray/Tray.swift` ~374 (Mac menu opens Swift locally)
- `companion/src/menu-bar-agent.ts` `openSummonerWebShell` / `handleAction("summoner")`
- `companion/src/tray/SummonerOverlay.swift` `micButton.isHidden = true`
- `companion/src/summoner-web.ts` HTML file input; DISPATCH_ALLOW
- `chrome-extension/.../ChatView.tsx` `marked.parse` (no breaks)
- `chrome-extension/.../PacksPanel.tsx` `meetingCard` always accentSoft

## Proposed slices

- **A**: Side Panel `breaks: true`; meeting card accent only if `activePackId === "meeting-minutes"`; pack list exclusive highlight.  
- **B**: Mac tray/hotkey → same C-thin HTML as Win; 📎 on existing `#files`; **no** HTML STT; Swift NSPanel frozen/unreached from menu.  
- Knowledge CONFIGURE in overlay = **NO-GO**. USE = already `chat.create` + thread ids.

## REJECT if

R1 Direction grows overlay `knowledge.*` / confirm / HTML `getUserMedia` / `voice.stt` on SUMMONER_WEB_DISPATCH_ALLOW  
R2 Treats 会议工作台 as the selected pack (merge workbench into radio)  
R3 Unfreezes AppKit overlay (NSOpenPanel / unhide 🎙 as a second product) **while also** shipping C-thin as the user-facing 召唤器  
R4 Companion `sidePanel.open` or fake-open  
R5 Raycast remake / Project / graph

## Approve means

You agree Slice A+B as written is the right **next** work, or AWN with nits that are not forks.

VERDICT line required:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
