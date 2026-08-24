# Adversary review (Product) — next workbench direction (not code)

**Batch**: `workbench-next-direction-20260824`  
**Role**: independent PRODUCT lane (did **not** implement). Hostile to Mac-only “workbench” theater and to a third runtime.  
**Prompt**: `docs/audit/reviews/_prompts/workbench-next-direction-adversary-20260824.md`  
**Repo**: `/Users/huchen/Projects/cmspark`  
**Date**: 2026-08-24  
**WIP cited**: PR #219 `feat/steer-nextrun-overlay-hub` (T2, not merged; code adversary REJECT on drain)  
**Evidence**: live files `[inspected]`. No Windows host, no hashed overlay click, no PR merge. This is a pick/kill, not a rereview of #219 chrome.

**Routing override.** Named PRODUCT direction adversary with a fixed write path. `vibe route` is not the work.

```text
Surface:      L0 default UI = Side Panel (ADR-020). Overlay = Mac capture channel, not L0 home.
L2-classes:   none this slice — overlay still not Allow/Deny; Win CU not claimed as parity (ADR-018)
Compose:      Pack/Skill/MCP attach to any Surface via Side Panel. Overlay pack.apply is not the workbench.
Autonomy:     existing single-loop steer/nextRun (panel-visible if isolated)
Trust:        monotonic — no overlay Trust write; no file.upload on summoner ACL
Channel:      community; summoner ACL stays capture-sized
```

---

## 0. Reflection — what holds, what is a category error

Owner + implementer reflection, scored as product claims a human can falsify.

| Claim | Holds? | Product reading |
|-------|--------|-----------------|
| Overlay cannot attach files; Side Panel has `file.upload`; summoner ACL does not | **Fact** `[inspected]` | `SUMMONER_ALLOW` has no `file.upload` (`companion/src/ws/summoner-acl.ts`). Overlay “attach” is `summoner.attach_chrome` (`SummonerOverlay.swift` `attachClicked`). Panel paste/click/drop **is** `file.upload` (`chrome-extension/src/sidepanel/App.tsx` composer). |
| Owner wants overlay attachments | **Want, not a hole in the workbench** | The workbench already ingests files. The hole is “Mac capture cannot ingest files.” Those are different products. |
| Enterprise workbench = overlay L0+Composition / panel L1 / CU L2 | **Category error** | ADR-020 Axis A: L0 **默认 UI = Side Panel**; L0 already includes **附件**. Overlay is a Channel, not the L0 slot. Composition “attaches to any surface”; it does not require a Swift rail. Mapping overlay → “quick workbench” is how a capture window becomes a third home. |
| Implementer: one tool-loop; overlay is not a full workbench yet | **Holds** | Keep it that way. “Yet” is the trap. |
| Companion+extension are cross-platform; summoner UI is Swift-only; systray2 summoner is no-op | **Fact** `[inspected]` | `systray2-bridge.ts` `sendSummoner` / `openSummoner` / `hydrateSummoner` are no-ops. Win tray has **no** 召唤器 menu item. |
| Owner: do not over-focus macOS | **Holds — and it kills B and #219 PR2** | Any slice whose user-visible delta is 0 on Windows is not P0. |

Push-back (once): **CMspark’s enterprise workbench on Windows already exists. It is the Chrome Side Panel.** Overlay is a Mac laptop capture accessory (OS-agent-shell S2: 不得称「家」). Treating “cannot NSOpenPanel from summoner” as the P0 workbench gap is Mac demo logic with an NSIS installer attached.

---

## 1. User-observable journeys (Windows vs Mac)

A slice is P0 only if a Windows user can **see** it without reading a Mac screenshot. “Invisible on Win/Linux” is not a documentation footnote; it is the kill criterion.

### J-Win-1 — First-run “workbench” (NSIS)

1. Finish page (`scripts/installer.nsi` ~41): load unpacked extension, click toolbar, Side Panel. English how-to. **Does not** contain the locked sentence 「Windows 仍用 Chrome 侧栏」 (OS-agent-shell **S15 fail**, already logged).  
2. Tray starts. Menu: 启动/停止、打开 Chrome、配对码、设置. **No summoner. No hotkey overlay.**  
3. 「打开 Chrome」 → `openChromeSidePanel()` (`menu-bar-agent.ts` ~596–601): activates Chrome and notifies *「请在 Side Panel 中点击 CMspark 扩展图标 🧩」*. Companion **cannot** open the Side Panel.  
4. User pins the puzzle, talks, pastes/drops files, applies Packs, confirms. That **is** L0+Composition+L1.

**Observable workbench: Side Panel.** Observable summon: scavenger hunt. Overlay rail / Shift+Enter / NSOpenPanel: **do not exist.**

### J-Win-2 — “I have a PDF on the desktop, ask the agent”

1. Tray cannot ingest the PDF.  
2. Side Panel: file input / drop / image paste → `file.upload` → same thread.  
3. No second window required. No third runtime required.  
4. If Chrome is quit: there is **no** L0 talk surface on Windows. That is S15, not an accident.

### J-Win-3 — Busy chat (the only #219 piece they can see)

- Today: field **locks**; Stop replaces Send; Enter does nothing.  
- #219 **PR1** (panel steer/nextRun): would unlock typing on **this** surface on Win+Mac.  
- #219 **PR2** (Swift rail, overlay Shift+Enter): **zero pixels** on Windows.

### J-Win-4 — L2 / confirm without panel

- systray2 `showConfirmDialog` is `Promise<never>` — fallback is Side Panel.  
- Outbound L8 without panel: `OUTBOUND_CONFIRM_REQUIRED` (health-fanout FEAT-004).  
- ADR-018: do not claim Host/CU parity. **Do not sell overlay as the missing confirm surface.**

### J-Mac-1 — Quick summon (today)

1. 菜单栏「召唤器（实验）」or opt-in hotkey → 420pt Swift capture.  
2. Type, Enter → `summoner.submit` → `chat.create` (busy = supersede). `#` title search. Transcript is lines, not a Side Panel.  
3. Mic: `听写暂未开放`. Attach buttons: Chrome, and even those are hidden in current `applyPhase`. **No paste, no drop, no NSOpenPanel.** `[inspected]`  
4. Chrome quit: L0 talk still works (S7). That is the only overlay job that Side Panel cannot do.

### J-Mac-2 — “I have a PDF”

Same as Windows: **open Side Panel**, paste/drop. Overlay does not help. Shipping NSOpenPanel (B) makes this Mac-only. Shipping HTML overlay (C) duplicates the panel composer to avoid clicking 🧩.

### J-Mac-3 — “Apply AI” (Composition)

- Side Panel: PacksPanel, including meeting **workbench** (record UI, privacy ack).  
- Overlay apply (if #219 PR2 ships): eligible composition only; meeting pack ≠ 打开会议工作台 (already REJECT’d by this lane on the hub spec). Windows still panel-only.

**Journey score.** Enterprise “talk + files + apply pack + confirm + L1” is **already cross-platform in Side Panel**. Overlay adds Mac-only talk-when-Chrome-is-quit. Growing overlay into a hub/files shell does not create a Windows workbench; it creates a second Mac product.

---

## 2. Kill A / B / C

### A — Finish #219 then stop overlay — **KILL as written**

#219 is two products glued with one PR number.

| Half | Windows visible? | Product |
|------|------------------|---------|
| PR1 panel steer/nextRun | **Yes** | Only honest leftover. Still has this lane’s send-chord objections on the hub spec; drain REJECT is a merge gate, not a direction. |
| PR2 Swift rail / overlay pack.apply / MCP chips | **No** | Workbench theater. Violates OS-agent-shell S2 (not 家) and S8 (overlay chrome ≤ composer + 检索 + badge). Prior PRODUCT review of the hub spec: **REJECT**. |

“Finish then stop” **ships the theater then freezes it**. Windows users funded an NSIS installer so Mac can get a 200pt rail they will never see. Stopping afterwards does not refund that.

If PR1 can be **isolated** after drain fold, it belongs in D, not in A.

### B — More Swift (NSOpenPanel, richer rail) — **KILL**

This is the named anti-pattern.

- User-observable delta: Mac overlay only.  
- IA collision: “attach” already means Chrome (S4). A paperclip that opens files teaches the wrong verb on a capture window whose CTA is browser attach.  
- Trust: native file paths on `cmspark-tray://local` + `file.upload` on summoner ACL is a **T3** file-path surface, not T2 chrome. Panel upload is extension-mediated. Do not pretend NSOpenPanel is “the same button.”  
- Owner attachment want is already served on J-Win-2 / J-Mac-2 via Side Panel.  
- Richer rail = mini Side Panel that still cannot Allow/Deny, add MCP, or open meeting workbench. Dishonest 工作台.

### C — Cross-platform HTML/WKWebView/companion window + `file.upload` — **KILL as P0**

Honest about Windows. **Wrong object.**

- This **is** a third runtime in the sense that matters to users and to ADR-020 §6: a new first-class window with its own composer, thread list, ingest, and then (inevitably) confirm, markdown, meeting, MCP add. Axis A already forbids inventing a home. OS-agent-shell **S18**: 证伪失败 → 召唤器=捷径, **不滑向 Electron**. C is that slide, just with WKWebView/WebView2 makeup.  
- Same tool-loop does not make it “not a runtime.” Outbound MCP and ACP were accepted as **门面** because they did not add a sitting window. A companion shell sits.  
- `file.upload` from a native/WebView window bypasses the extension ingest path that already has size/HMAC/sidecar rules. Blast becomes T3 the moment paths or bytes leave Chrome.  
- Windows enterprise users already live in Chrome. Building a second chrome so they do not click 🧩 is not L0; it is a new product.

C is the 2027 item **after** overlay is proven as capture-only **and** Windows panel reachability is not a scavenger hunt. It is not the next slice.

---

## 3. DIRECTION D — P0 slice

**Name: `D-panel-workbench-overlay-freeze`**

One sentence: **Side Panel is the enterprise workbench on all three OS. Freeze Swift overlay as Mac L0 capture. Land only the #219 half a Windows user can see. Do not add overlay files. Do not add a third window.**

### P0 (this slice, T2)

1. **Rewrite the story (docs + installer, no new surface).** Overlay = 捕获壳. Workbench = Side Panel. L2 = Cockpit/CU with honest Win/Linux limits. Kill any copy that says 悬浮窗工作台 / 会议不必开 Chrome / 管 MCP. Installer/about: locked 「Windows 仍用 Chrome 侧栏」 (S15).  
2. **#219: isolate or close.** Overlay rail / overlay `pack.apply` product story / MCP chip hub → **drop**. If panel steer/nextRun can be split and the drain REJECT folded → merge **that** T2 PR (cross-platform busy composer). If it cannot be split → close #219 and open a panel-only PR. Do not “finish the PR then stop.”  
3. **Freeze Swift.** Capture: talk, `#` title search, Chrome-missing badge, lease vs panel. No NSOpenPanel. No 200pt hub. No new summoner WS methods this slice. If this tree already added `pack.list`/`pack.apply` to `SUMMONER_ALLOW` as #219 WIP, that is freeze-scope **revert or keep inert** — not a user-facing overlay workbench.  
4. **`file.upload` stays panel-origin.** Do not add it to summoner ACL. Overlay “attach” remains Chrome attach (even if the buttons stay hidden). Owner attachment want: **redirect to Side Panel** (paste/click/drop already shipped).

### Immediate follow-on (not this P0, still not C)

**Windows summon without a window:** tray/hotkey that activates Chrome + the existing 🧩 notification (maybe pin reminder). Still cannot `openSidePanel()`. That is the real Win L0 friction. It is a tray copy/gesture slice, not a WebView.

### Why this is the workbench (ADR-020)

| Owner phrase | Honest mapping | Default UI |
|--------------|----------------|------------|
| Quick talk + apply AI + files | **L0 + Composition** | **Side Panel** (Win/Mac/Linux) |
| Mac talk while Chrome is quit | L0 capture **channel** | Swift overlay (Mac only, frozen) |
| Complex web work | L1 | Side Panel + optional Cockpit |
| Non-web deep work | L2 | Cockpit (+ HUD on Mac); **no Win parity claim** |

Composition does not need a Swift rail. Packs already apply in the panel. That is Pack-first (ADR-020 §6.1), not a new 一级入口.

---

## 4. Explicit non-goals (this P0 and the freeze)

- Overlay `file.upload` / NSOpenPanel / drag-drop on summoner  
- HTML / WKWebView / WebView2 / Electron / “companion window” shell  
- Overlay Allow/Deny, `mcp.add`, `config.set`, Trust B, meeting **workbench** UI  
- Shipping #219 PR2 (left rail as hub)  
- Win/Linux overlay “parity”  
- Win CU / Host parity theater (ADR-018 Decision 6)  
- Third tool-loop, third confirm dialect, fourth origin  
- Treating overlay pack.apply (even `allowTrust:false`) as “apply AI” for enterprise marketing  

---

## 5. Axes check

| Axis | This direction | Anti-pattern avoided |
|------|----------------|----------------------|
| Surface | L0 workbench = panel; overlay not deeper | Overlay as fake L1/L2 |
| Composition | Packs stay panel (and pack-first) | New 一级入口 for “场景” on a 420pt window |
| Autonomy | steer/nextRun on **panel** if isolated | Steer on unlabeled overlay Return as a Mac-only verb |
| Trust | No overlay Trust; no summoner file paths | NSOpenPanel + ACL hole; C’s native ingest |
| Channel | Swift = Mac adapter frozen; systray2 stays menu | Pretend Win has summoner via no-op |

Blast: **T2** (copy + PR split + freeze). `file.upload` on summoner or a new window host would force **T3** — that is why they are non-goals.

---

## 6. Nits on D (do not reopen A/B/C)

**N1 — #219 is mixed; isolation is the merge risk.** Drain REJECT is a correctness gate on PR1. D is not “rubber-stamp panel steer.” Send-chord hijack (busy Enter = steer) remains this lane’s objection from the hub spec. If PR1 still binds unlabeled Return to steer, land it only with the remap already required: busy send-chord = enqueue or keep field locked; steer = labeled button. That is a PR1 nit, not a reason to keep PR2.

**N2 — S15 copy is still missing.** Installer finish page teaches Side Panel (good) but never says overlay is Mac-only (bad). Cheap, user-visible, Windows-honest. Include in P0 docs, not a feature PR.

**N3 — ACL already lists `pack.list`/`pack.apply` in this tree** `[inspected]`. If that is unmerged #219, freeze means do not advertise it. If it already shipped, product copy must still not call overlay a 工作台; eligible apply ≠ meeting workbench.

**N4 — Owner will hear “no attachments.”** Say the true sentence in UI if anyone asks from overlay: **「附件请在 Chrome 侧栏粘贴或拖入」**. Do not gray a fake paperclip.

---

## Verdict rationale

The reflection is **half right**. Cross-platform discipline and “overlay is not a workbench yet” are right. The L0 slot is **wrong**: ADR-020 already put talk **and files** on Side Panel. Overlay file attach is Mac capture completeness, not the enterprise workbench. A ships Mac hub theater then freezes it. B is the theater. C is a third sitting runtime dressed as parity.

D is the only slice a Windows user can observe that does not invent a home: **panel is the workbench; overlay stays a Mac capture; stop digging.**

DIRECTION: D-panel-workbench-overlay-freeze

VERDICT: APPROVE_WITH_NITS
