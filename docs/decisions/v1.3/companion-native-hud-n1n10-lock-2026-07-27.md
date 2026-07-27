# Companion Native HUD — N1–N10 Grill Lock

| Field | Value |
|-------|--------|
| Date | 2026-07-27 |
| Status | **LOCKED for P3a spike planning** (post dual grill) |
| Brief | `companion-native-hud-brief-2026-07-27.md` |
| Claude grill | `docs/audit/reviews/native-hud-n1n10-grill-claude-20260727-180012.md` → **APPROVE_WITH_NITS** |
| Pi grill | `docs/audit/reviews/native-hud-n1n10-grill-pi-20260727-180012.md` → **APPROVE_WITH_NITS** |
| both_approve | **true** |

---

## Method

Claude Code and Pi Agent independently grilled each of N1–N10 against:

- three-mode redesign D8 / D10′ / D11′ / D12′ / D14 / D16  
- `SecurityConfirmationManager` / tray bridge real code  
- prior brief dual-review nits  

Each decision was forced to **LOCK | AMEND | OPEN**. Owner synthesis below merges both grills (prefer concrete defaults when both agree; call out residual OPEN only where both left product forks).

---

## Locked product law (final wording)

### N1 — Companion-owned; **one Swift binary** (AMEND → LOCK)

**Law:** Native HUD is a Companion capability, not an extension capability. **P3a ships one Swift binary** hosting both menu-bar tray (`NSStatusBar`) and HUD (`NSWindow`). Spawned by `menu-bar-agent`; same stdin JSON pipe as today’s tray. Existing `SWIFT_TRAY_SHA256` gate is **renamed** (e.g. `SWIFT_COMPANION_UI_SHA256`) and continues to hash-check that single binary.

| Detail | Default |
|--------|---------|
| Process model | 1 binary, 2 windows; HUD window **lazy** on first `hud.open` |
| §11 Q4 | **Closed for P3a**: one binary; revisit only if memory profiling forces split (P3c) |
| Reject | Two binaries / dual SHA256 gates for P3a |

**Depends on:** —  

---

### N2 — One **wide** L2 shell; Panel MinimalConfirm always (AMEND → LOCK)

**Law:** At most one **wide** shell per thread renders `ConfirmElevated` + full `TaskDock` + `DualTrack`. Companion tracks `activeShell: "hud" | "cockpit" | null` per thread. When switching active shell, Companion sends **`shell.standby` (NEW)** to the prior wide shell — it **must** hide ConfirmElevated/TaskDock, show status line (“任务进行中 — 在 HUD|确认台 查看”), keep LIVE reopen affordance. **MinimalConfirm stays Panel-only (D10′)** — standby wide surfaces do **not** show confirms.

| Detail | Default |
|--------|---------|
| “Active” definition | Last surface that received `security.confirmation.request` or `computer.task.event` for that thread |
| Panel SafetyStrip | Always available regardless of shell |
| Reject | Two full dual-tracks racing the same confirm |

**Depends on:** N5, D10′  

---

### N3 — Shell selection + health probe (AMEND → LOCK)

**Law:** On every `open_confirm_surface` (tray “打开确认台”, escalate, explicit open):

1. `hud.shell === "extension"` → Extension Cockpit immediately.  
2. `hud.shell === "native"` → try HUD; if unhealthy for **this** trigger, open Cockpit and **background-start** HUD for next time.  
3. `hud.shell === "auto"` (default on macOS) → HUD if healthy **and** last user shell choice was HUD or unset; else Cockpit.  

**Healthy** means all of:

| Check | Threshold |
|-------|-----------|
| PID alive | `process.kill(pid, 0)` |
| Heartbeat | last `hud.heartbeat` ≤ **3s** (Pi) / **2s** (Claude) → **lock 3s** |
| On-demand ping | `hud.ping` → `hud.pong` within **500ms** (Pi) / **250ms** (Claude) → **lock 400ms** |

**Cold start never blocks the user’s open:** first trigger after cold Companion opens **Cockpit immediately**; HUD boots in parallel; becomes preferred on the **next** escalate.

| Detail | Default |
|--------|---------|
| Setting key | `hud.shell`: `auto \| native \| extension` |
| Setting ships | **P3a** (not deferred to P3b); hidden until native binary present |
| Defaults | macOS: `auto`; Linux/Windows: `extension` |
| Reject | Wait up to 1.5s for cold HUD before any shell paints |

**Depends on:** N1, N8  

---

### N4 — Close ≠ stop (LOCK, with sub-clauses)

**Law:** Closing HUD window (red dot / 收起 / Cmd+W) does **not** stop, pause, or change CapabilityLevel. Process may stay alive for tray. **LIVE close** shows managed warning (D11′).  

If a **heavy** confirm arrives while **no** wide shell is open:

1. Render **Panel MinimalConfirm** + toast “宽确认台已关闭 — 请在侧栏确认（完整预览需重新打开确认台）”.  
2. If user reopens a wide shell **before** confirm timeout, **re-promote** same `confirmation_id` to ConfirmElevated on that shell.  
3. **Do not** auto-reopen HUD/Cockpit on next confirm (user closed intentionally; N8).

| Detail | Default |
|--------|---------|
| Close vs Quit | Close window ≠ quit app; Quit = process death → N8 crash path |
| Reject | Silent auto-reopen of wide shell |

**Depends on:** D11′, N8  

---

### N5 — Confirm single-writer + **broadcast NEW** (AMEND → LOCK)

**Law:**

1. **Existing invariant restated:** `SecurityConfirmationManager.respond|respondFrom` delete-on-first-resolve. Late callers get wire outcome **`unknown`** (brief prose may say “already resolved”; **do not rename the wire symbol**).  
2. **NEW for P3a:** fan-out `security.confirmation.resolved` / expired to **all** surfaces (all WS clients + HUD stdin + tray `cancelConfirm` belt-and-braces). Today originator-only `send` is insufficient for multi-surface UI.  
3. Confirm fan-in becomes **three-way race** where applicable: WS Panel/Cockpit promise ⊕ tray promise ⊕ HUD promise → first `respond` wins.

| Detail | Default |
|--------|---------|
| NEW APIs | `broadcastResolved` / fan-out hook on manager; optional `PendingConfirmation.origin` for crash scoping |
| Reject | Rename wire to `already_resolved` |

**Depends on:** N2 (routing which surface receives `request`)  

---

### N6 — Conductor = active wide shell, **server-enforced** (AMEND → LOCK)

**Law:** Task conductor is the **N2 active wide shell**, not OS key-focus. During LIVE L2:

- `chat.send` from **active shell Composer** → agent conductor.  
- `chat.send` from **Panel** (or non-active shell) → **follow-up queue** always.  

“Focused” is UI UX only; Companion routing is authoritative.

| Detail | Default |
|--------|---------|
| Reject | Key-window-as-conductor |

**Depends on:** N2, D12′  

---

### N7 — Tray “打开确认台” uses N3 (AMEND → LOCK; **amends D16**)

**Law:** Tray action **打开确认台** invokes the **N3 selector** (native when healthy + auto/native; else Cockpit).  

**This amends D16** on platforms where native HUD ships. Linux/Windows / `hud.shell=extension` keep original “open Cockpit” behavior.

| Detail | Default |
|--------|---------|
| Label | Stay 「打开确认台」 (one mental model) |
| **Still OPEN** | Whether tray **quick-confirm dialog** for L2 is retired when HUD is primary (see cross-cutting) — **not** blocked by N7 |

**Depends on:** N3, N1; three-mode D16 amendment  

---

### N8 — No silent switch **except** death / user setting (AMEND → LOCK)

**Law:** No silent active-shell switch during LIVE **except**:

1. Active shell **dies** or fails health probe → open fallback shell + **user-visible toast** (“HUD 不可用 — 已切换至确认台”); re-present pending confirms to fallback.  
2. User **explicitly** changes `hud.shell` while idle (or with confirm).  

Otherwise switches only at escalate / task-end / quiescence boundaries.

| Detail | Default |
|--------|---------|
| Crash handling | `child_process` exit → `rejectForOrigin("hud")` **NEW** (or re-present still-pending to fallback within timeout) + tray restart logic |
| Reject | Strict no-fallback (task stalls) |

**Depends on:** N3, N4, N5  

---

### N9 — macOS first + Cockpit parity CI gate (LOCK)

**Law:** P3a native HUD is **macOS-only**. Linux/Windows use Extension Cockpit.  

**Active process gate:** every HUD acceptance path has a **Cockpit counterpart** in CI on **all platforms** (including macOS fallback). Cockpit parity failure **blocks** HUD merge.

| Detail | Default |
|--------|---------|
| Reject | Parallel GTK/Qt HUD in P3a |

**Depends on:** —  

---

### N10 — Dual-track right rail N≤8 + internal scroll (AMEND → LOCK; **amends Cockpit IA**)

**Law:** HUD DualTrack **right rail**: last **N≤8** assistant conclusions (user turns ≤1 line). FIFO. **Fixed height with internal scroll** (not non-scrolling truncation). **No** full chat viewport.  

**Same N≤8 + fixed-height rule applies to Extension Cockpit** DualTrack right rail (amends three-mode Cockpit IA §5 for consistency). Full L0 history remains Panel-only.

| Detail | Default |
|--------|---------|
| Cap | `hud.dualtrack.conclusion_cap` default **8** |
| Height | ~30% of shell vertical, `overflow-y: auto` |
| Reject | Infinite scroll on HUD right rail |

**Depends on:** D7  

---

## Cross-cutting locks

### C1 — Confirm fan-in / fan-out

| Path | Behavior |
|------|----------|
| First valid respond | Wins; pending deleted (existing) |
| Late respond | Wire `unknown`; UI no-op |
| Fan-out after resolve | **NEW** broadcast to Panel, Cockpit, HUD, tray cancel |
| Race | Extend today’s WS↔tray `Promise.race` to include HUD promise when HUD active |

### C2 — D14 timeout ownership

Server hard timeout remains in `SecurityConfirmationManager` (today ~45s default). Only the **surface that received** `security.confirmation.request` (active wide shell, or Panel if no wide shell) may implement **optional** unfocused early-deny UI; server timer is always the backstop.

### C3 — Tray quick-confirm (L2)

| Platform / shell | Tray quick-confirm |
|------------------|-------------------|
| macOS + HUD active | **Retire L2 tray dialog** in P3b; P3a may keep as belt-and-braces |
| macOS + Cockpit fallback | **Keep** (Chrome focus/CGEvent issue) |
| L1 / browser confirms | **Keep** |
| Linux/Windows | **Keep** |

**Spike:** do **not** delete `showConfirmDialog` in P3a.

### C4 — Binary model

**P3a: one Swift binary** (see N1). Process death restarts binary; during restart window N8 routes to Cockpit.

### C5 — Crash mid-confirm

| Event | Action |
|-------|--------|
| HUD process exit | Companion re-routes pending heavy confirms to Cockpit or Panel MinimalConfirm; toast |
| HUD-side UI promise | Self-timeout `timeoutMs + 1000` (mirror tray bridge) |
| NEW | `PendingConfirmation.origin` + `rejectForOrigin` optional for clean scoping |

---

## Summary table (final)

| ID | Stance | One-line product law |
|----|--------|----------------------|
| **N1** | **LOCK** | One Companion-spawned Swift binary = tray + HUD; single SHA256 gate |
| **N2** | **LOCK** | One wide shell per thread; `shell.standby` for loser; MinimalConfirm Panel-only |
| **N3** | **LOCK** | auto/native/extension + PID/heartbeat/ping; cold start never blocks open |
| **N4** | **LOCK** | Close ≠ stop; no wide shell → Panel MinimalConfirm + toast; no auto-reopen |
| **N5** | **LOCK** | Existing single-writer; wire stays `unknown`; **broadcast resolved is NEW** |
| **N6** | **LOCK** | Conductor = active shell; Panel send always queued during LIVE (server) |
| **N7** | **LOCK** | Tray opens via N3; **amends D16** where native ships |
| **N8** | **LOCK** | No silent switch except death/health-fail (toast + fallback) or user setting |
| **N9** | **LOCK** | macOS native first; Cockpit parity CI on all platforms |
| **N10** | **LOCK** | N≤8 right rail + internal scroll on **HUD and Cockpit** |

**No OPEN product forks remain inside N1–N10** after grill. Residual OPEN items are **orthogonal**: tray L2 quick-confirm retirement timing (P3a vs P3b), enterprise opt-in for native, L1 native expand timing.

---

## Spike greenlight checklist

Before writing production HUD code:

- [x] Dual grill APPROVE_WITH_NITS  
- [x] N1–N10 locked with operational defaults  
- [ ] Owner sign-off (optional formal ack)  
- [x] Spike plan: one binary, hydrate, one confirm round-trip, abort, standby message stub → `docs/superpowers/plans/2026-07-27-companion-native-hud-p3a-spike.md`  
- [x] Spike **plan** dual-review (Task 0): Claude+Pi both `APPROVE_WITH_NITS` · `native-hud-p3a-spike-plan-verdict-20260727-181620.json` · nits folded into plan  
- [ ] Spike **implementation** dual-review (plan Task 7) before dual-track screenshot flood path  

---

## Author synthesis notes

Claude and Pi **strongly agreed** on:

- One binary  
- N5 restates existing single-writer + broadcast NEW  
- N3 background cold start  
- N8 crash exception  
- N10 cap on both shells  
- N6 server-side conductor  

Minor numeric differences (heartbeat 2s vs 3s, ping 250ms vs 500ms) → locked **3s / 400ms** as compromise.

---

*This document is the product-lock artifact for N1–N10. Update the parent brief §5.2 to point here as source of truth.*
