Write permission wasn't granted, so the review stands in-chat (the file `workbench-next-direction-claude-20260824.md` is still the empty placeholder — write it yourself or re-run me with write access if you want it persisted).

## Claude lane review — judging C-thin

**Test 1 — C-thin is Electron/third runtime? No.** `[inspected]` Explicitly not Electron (non-goal; 2026-07 TCB rejection stands). WKWebView/WebView2/WebKitGTK are OS components rendering one local HTML bundle on the **existing** summoner WS protocol; Companion stays the only tool-loop — that passes ADR-020's one-runtime test. Product lane's "third runtime in the sense that matters" is a window-sprawl risk, not a runtime fact, and it's contained fail-closed: overlay stays L0 capture, every sprawl item is a non-goal, and the Trust T3 tripwires make any overlay Allow/Deny or Trust write an automatic PR REJECT.

**Test 2 — `file.upload` a Trust hole as specified? No — ordering is load-bearing.** I verified the hole exists today: `message-router.ts:598–1056` has no `gateChatCreateOnLease`/`gateChatCreateOnConductor` (only at :333/:582/:1210) and `:821–825` unconditionally aborts the running loop; `summoner-acl.ts` omits `file.upload` and treats omitted `surface` as ungated tray. The synthesis's order (gates → `run_active` → then ACL → bytes-only) matches Trust §4 exactly and closes it — provided gates and ACL land in one PR (nit N1, a gate not a style point).

**Test 3 — D clearly safer with owner goals met? No.** D fails both owner asks by construction: attachments redirected to Side Panel, Win/Linux summon stays "open Chrome + 🧩" — the `systray2-bridge.ts:176–179` no-ops I verified stay no-ops, just documented. Lower blast, yes; goals unmet, so the REJECT bar ("safer **and** goals met") isn't reached. C-thin correctly absorbs Product's containment nits (AppKit freeze, PR2 rail dropped, S15 copy, no fake paperclip).

**Nits that must reach the spec:** N1 gates+ACL atomic; N2 handshake `surface:"summoner"` stamping tests (omit ≠ overlay); N3 refuse/ignore client `hostname` on overlay upload; N4 kill `openSummoner` no-op in-slice (menu is the Win/Linux discovery path); N5 upload status mapper round-trip; N6 identical caps/budgets; N7 host binaries in NSIS/zip staging (biggest schedule risk — honest degrade keeps it shippable); N8 AppKit freeze starts now; N9 don't build C on unmerged #219 WIP (drain fix 4b7c816 + PR1 isolation first).

DIRECTION: C-thin
VERDICT: APPROVE_WITH_NITS
