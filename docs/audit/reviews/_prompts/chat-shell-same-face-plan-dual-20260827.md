# Plan dual — ChatShell #239

T2 implementation plan. You did not write it. Do not rubber-stamp. No code to ship.

## Blast
```text
Surface:      L0 ChatShell copy+layout
L2-classes:   none
Compose:      static chips fill composer
Autonomy:     n/a
Trust:        overlay never Allow/Deny; F-I-4; no tab.* on SUMMONER_ALLOW
Channel:      community
```

## Read (required)
1. `docs/superpowers/plans/2026-08-27-slice-239-chat-shell-same-face.md`
2. `docs/superpowers/specs/2026-08-27-chat-shell-same-face-design.md` (r2 LOCKED)
3. `docs/audit/reviews/chat-shell-same-face-spec-adversary-synthesis-20260827.md`
4. `docs/audit/reviews/chat-shell-same-face-spec-r2-verdict-20260827-153041.json`
5. `companion/src/ws/summoner-acl.ts`
6. `companion/src/summoner-web.ts` (`openLoopbackPage`, `placeWindow`, dispatch allow)
7. `companion/src/menu-bar-agent.ts` `openSummonerWebShell`
8. `companion/src/tray/companion-client.ts` appMessageCbs
9. `companion/src/ws/validate.ts` + `ws-router-validator-lockstep` pattern
10. `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## r2 pins the plan must not reopen
- No filled 贴回; overlay HTML = 无页; Mac Swift out of DoD
- `overlay.shell.open` on **extension** origin, not SUMMONER_ALLOW
- No `list_tabs` / `tab.*` / `ui.dock` / Companion `sidePanel.open`
- Copy contract, not shared ChatView
- Chips fill-not-send; no title/DOM inject

## Job
Lane in spawn prompt. Score: plan implementable? missing protocol? tests actually fail-then-pass? file:line.
Final line exactly:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
