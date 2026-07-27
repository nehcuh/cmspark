# P3 Design Brief — Companion Native HUD

| Field | Value |
|-------|--------|
| Status | **Draft — dual-reviewed** (Claude + Pi APPROVE_WITH_NITS; nits folded below; not implemented) |
| Date | 2026-07-27 |
| Reviews | `docs/audit/reviews/native-hud-brief-claude-20260727-175147.md` · `…-pi-…` · `…-verdict-…` |
| Scope | Product UX / IA / surface topology for a **native Companion-owned** L2 (and optional L1) HUD |
| Supersedes | “Companion native HUD = roadmap” note in three-mode redesign (D8 non-goal for v1) |
| Upstream | [UI three-mode redesign](../../superpowers/specs/2026-07-26-ui-three-mode-redesign.md) · [Confirm Center guide](../../confirm-center-user-guide.md) · [Tray adapter](../../../companion/src/tray/tray-adapter.ts) · [menu-bar design](../../menu-bar-service/design-final.md) |
| Not in scope | Line-by-line code; Computer Use SPI redesign; full multi-window product |

---

## 1. Context

### 1.1 What we ship today (post P0–P2 + R1–R4 + S1)

| Surface | Owner | Role |
|---------|-------|------|
| **Chrome Side Panel** | Extension | L0/L1 chat; L2 SafetyStrip (chip + abort + MinimalConfirm); mode pin; `/` +「更多」 |
| **Extension Cockpit** | Extension `chrome.windows` (~720×560) | ConfirmElevated (heavy preview/nonce/whitelist); CU dual-track; task conductor input |
| **Tray / menu-bar** | Companion (Swift / systray2 / readline) | Start/stop, pairing, status; **TrayConfirmRequest** parallel channel for L2 confirms |
| **Companion** | Node process | Source of truth: threads, tools, confirms, computer tasks, fleet |

Locked product law (three-mode **D8**): **L2 requires a wide surface**; v1 chose **Extension Cockpit**, not native.  
Panel remains the always-on companion; closing wide surface **must not stop tasks** (D11′).

### 1.2 Why “native HUD” is now a real product question

Extension Cockpit works, but has hard limits:

1. **Lifecycle**: MV3 service worker death / multi-profile / window reclaim is fragile even after session-id persistence (R1).
2. **Chrome dependency**: User must keep Chrome running; CU often spans **desktop apps outside the browser**.
3. **Focus UX**: Confirm-focused wide window competes with browser focus; OS-level always-on-top / Space mobility is limited for extension pages.
4. **Tray already half-lives as a native channel**: pairing window + tray confirms prove Companion can own UI; HUD is the missing **wide** native surface.
5. **Security theater gap**: Nonce / biometric / host_* confirms feel more legitimate in a **native** trusted UI than in an extension popup (users equate extension chrome with “web”).

### 1.3 Explicit non-goals for this brief

- Replacing Side Panel chat as the default surface for L0/L1.
- Electron full-app rewrite.
- Shipping multi-monitor multi-HUD in v1 of native.
- Redesigning Computer Use success contracts or SPI.
- Deciding MCP-as-mode (separate fork).

---

## 2. Problem statement

**We need a Companion-owned, OS-native wide surface for L2 (and optionally L1 expand) that:**

- Survives Chrome SW death and does not require the Side Panel to be open;
- Preserves three-mode content-split (minimal on Panel, heavy on HUD);
- Reuses one **state truth** in Companion (not a second agent runtime);
- Does not regress tray pairing / tray confirm;
- Has a clear story on macOS first, with a degradation path on Linux/Windows.

Without native HUD, L2 remains “Chrome extension window as OS app,” which is the wrong trust and lifecycle model for **desktop** control.

---

## 3. Goals

### 3.1 User goals

| Priority | Goal |
|----------|------|
| P0 | See **live CU steps / screenshots** without hunting for an extension window |
| P0 | **Approve high-risk tools** with full preview even when Side Panel is closed |
| P0 | **One-click abort** always reachable while a task runs |
| P1 | Keep working in other apps while HUD sits in a predictable OS place |
| P1 | Same mental model as today’s 确认台 (no third parallel “control app”) |

### 3.2 Product / engineering goals

| Priority | Goal |
|----------|------|
| P0 | Single source of truth: Companion; HUD is a **view + input** client |
| P0 | Honor D10′ content-split, D11′ close≠stop, D12′ input ownership, D14 timeout |
| P0 | No dual-write of confirm responses (race with Panel / tray / HUD) |
| P1 | macOS-native path (Swift) aligned with existing Tray.swift toolchain |
| P1 | Linux/Windows: native **or** explicit degraded surface (documented) |
| P2 | Optional: replace Extension Cockpit as primary L2 shell; keep as fallback |

---

## 4. Options

### Option A — **Native HUD as primary L2; Extension Cockpit = fallback**

```
Companion ──WS──► Extension Panel (always)
         └──IPC──► Native HUD (macOS Swift window)
         └──WS──► Extension Cockpit only if native unavailable
```

| Pros | Cons |
|------|------|
| Correct lifecycle for CU | Build cost (Swift window + state bridge) |
| Best trust / OS integration | Linux/Windows lag unless planned |
| Tray + HUD can share process | Must carefully kill dual-confirm races |

### Option B — **Native HUD = “focus assist” only (not full Cockpit)**

Native window shows: LIVE chip, abort, last screenshot, open-extension-cockpit deep link. Heavy confirm stays in Extension Cockpit.

| Pros | Cons |
|------|------|
| Smaller build | Does not solve Chrome dependency for confirms |
| Faster ship | Two wide surfaces → user confusion |

### Option C — **Tray popover expansion (no separate window)**

Grow Tray.swift pairing-style UI into a large popover HUD.

| Pros | Cons |
|------|------|
| Reuses tray binary | Poor dual-track / screenshot density |
| One binary | macOS menu-bar popover size limits; weak multi-monitor |

### Recommendation

**Option A (phased):**  
- **P3a**: Native HUD shell = ConfirmElevated + TaskDock + dual-track (parity with Extension Cockpit IA).  
- **P3b**: Prefer native when healthy; Extension Cockpit remains automatic fallback.  
- **Reject B** as end-state (acceptable only as intermediate spike).  
- **Reject C** as primary L2 surface.

---

## 5. Proposed product model

### 5.1 Surface roles (extends three-mode)

| Surface | Capability focus | Layout role |
|---------|------------------|-------------|
| **Panel** | L0 / L1 default; L2 **safety only** | Chat-first; MinimalConfirm; mode pin |
| **Native HUD** | L2 primary; optional L1 expand | Dark HUD; ConfirmElevated; dual-track; conductor input |
| **Extension Cockpit** | L2 **fallback** when native down | Same IA as HUD; may share protocol |
| **Tray** | Always-on entry / pairing / optional quick-confirm | Not a dual-track surface |

### 5.2 New / extended decisions (proposed IDs)

| ID | Proposal | Notes |
|----|----------|--------|
| **N1** | **Native HUD is an optional capability of Companion**, not of the Chrome extension | Binary lives beside tray (macOS); started by menu-bar-agent |
| **N2** | **One active L2 shell at a time** (native **or** extension cockpit) | Avoid two full dual-tracks; allow MinimalConfirm everywhere |
| **N3** | **Shell selection policy**: prefer native if process healthy + last user preference; else extension | User setting: `hud.shell = auto \| native \| extension` |
| **N4** | **Close HUD ≠ stop task** (same as D11′) | Managed warning when LIVE |
| **N5** | **Confirm response single-writer**: Companion accepts first valid response (Panel / tray / HUD / cockpit); others get `already_resolved` | Critical for races |
| **N6** | **Input ownership**: when L2 task active and HUD focused → HUD is conductor; Panel remains follow-up queue | Aligns D12′ |
| **N7** | **Tray “打开确认台”** opens preferred shell (native first if auto) | Replaces chrome-only open path |
| **N8** | **No silent shell switch** during active LIVE task | Switch only on next escalate or user setting change when idle |
| **N9** | **macOS first**; Linux/Windows document degraded path in same brief | See §8 |
| **N10** | **HUD does not host L0 chat history as primary** | Dual-track **right rail only**: fixed-height, non-scrolling pane of last **N≤8** assistant/user **conclusions** (match Cockpit slice). **No** full chat viewport / infinite scroll in P3a (anti scope-creep) |

### 5.3 Relationship to Extension Cockpit

```
                    ┌─────────────────┐
                    │   Companion     │  state truth
                    └────────┬────────┘
           WS / events       │
     ┌───────────────────────┼───────────────────────┐
     ▼                       ▼                       ▼
 Side Panel            Shell selector            Tray
 MinimalConfirm        (N3 auto/native/ext)
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
       Native HUD                      Extension Cockpit
       (preferred)                     (fallback)
```

**Parity requirement:** Native HUD v1 must implement the same vertical IA as Cockpit §5 (TitleBar → ConfirmElevated → TaskDock → DualTrack → ContextBar? → Composer). ContextBar (Tabs/Apps/MCP) may be **deferred to P3b** if native embedding of tab lists is costly — then HUD shows link “在浏览器侧栏打开 Tabs”.

---

## 6. Information architecture (Native HUD)

### 6.1 Vertical priority (must match Cockpit mental model)

1. **TitleBar** — `CMspark 确认台` · `L2 · LIVE` · thread id · connection · **急停** · 收起  
2. **ConfirmElevated** — if queue non-empty (always above TaskDock)  
3. **TaskDock** — goal, progress, budget, layer, app  
4. **DualTrack** — left: steps + screenshots; right: compact U/A conclusions  
5. **Composer** — task conductor (D12′)  
6. *(P3b)* Context strip for tabs/apps — or deep-link to Panel

### 6.2 Empty state

- No confirm + no task: purpose copy (same as Cockpit emptyGuide) + “Side Panel 仍负责日常对话”.  
- Do **not** re-home full L0 chat into HUD.

### 6.3 Visual language

- **Dark HUD** by default for L2 (inherits three-mode L2 dark direction).  
  **Milestone note (dual-review nit):** three-mode **D6** placed “full dual-skin dark HUD” at **UI P2** for *Extension* surfaces. Native HUD is a **P3a** surface that **adopts** that L2-dark language; it does **not** claim to be the UI P2 deliverable.  
- Tokens: align with `sidepanel/ui/tokens.ts` dark\* family (export a shared design tokens JSON if Swift needs a mirror).  
- Risk never color-only (text label + color).  
- Abort always enabled while LIVE.

### 6.4 Multi-agent / Fleet

- Show fleet summary (worker count, locks, pending confirms) in TitleBar or a thin strip — parity with Cockpit fleet strip.  
- Enter-worker deep link may open Side Panel thread select (native need not embed full chat).

---

## 7. Protocol & state sync

### 7.1 Preferred architecture

```
Companion (Node)
  ├─ existing WS → Extension (panel + optional cockpit)
  └─ local IPC → Native HUD process
       transport candidates (pick in spike):
         A. Unix domain socket JSON-lines (same envelope as WS messages)
         B. stdin/stdout to Swift child (like tray bridge today)
         C. localhost HTTP/WS on loopback only (127.0.0.1, token-bound)
```

**Recommendation for spike:** **B for macOS v1** (reuse tray stdin JSON pattern), evolve to **A** if message volume (screenshots) blows stdin.

### 7.2 Message classes HUD must handle

| Direction | Types (illustrative) |
|-----------|----------------------|
| Companion → HUD | `computer.task.event`, `security.confirmation.request`, `security.confirmation.resolved/expired`, `fleet.status`, `connection.state`, hydrate snapshot |
| HUD → Companion | `security.confirmation.response`, `computer.task.abort`, `chat.send` (task conductor), `hud.ready`, `hud.closed` |

### 7.3 Hydrate on open

On HUD start: request `hud.hydrate` → Companion returns:

- active thread id  
- computer task snapshot  
- pending confirmations  
- fleet summary  
- preferred shell setting  

Same spirit as extension `cockpit.hydrate`.

### 7.4 Confirm race (N5) — mandatory

Any surface may show MinimalConfirm / tray confirm / HUD elevated. Companion:

1. Accepts first valid response for `confirmation_id`.  
2. Broadcasts `security.confirmation.resolved` to all surfaces.  
3. Late responses → structured error, no double-exec.

---

## 8. Platform strategy

| Platform | P3a (must) | P3b (should) | Degrade |
|----------|------------|--------------|---------|
| **macOS** | Swift native window (share Tray.swift toolchain / codesign story) | Always-on-top option; Space pinning | Extension Cockpit |
| **Linux** | Document-only **or** minimal GTK/Qt later | — | Extension Cockpit + tray |
| **Windows** | Document-only **or** WinUI later | — | Extension Cockpit + tray |

**P3a ship criteria do not require** Linux/Windows native parity — but **must** keep Extension Cockpit healthy as default off-macOS.

---

## 9. Security & privacy

| Topic | Requirement |
|-------|-------------|
| Trust | HUD binary is Companion-signed / hashed like tray (SHA256 gate) |
| Loopback | If WS/HTTP used: bind 127.0.0.1 only; require shared secret / capability token |
| Screenshots | Same redaction rules as today; no extra disk write without user path |
| Nonce | Type-to-confirm only (no paste) remains HUD-side |
| Logging | Never log secrets / full previews at info level |
| Permissions | Native HUD must not request broader OS permissions than CU already needs |

Threat note: native HUD **reduces** “evil extension UI” risk but **raises** “malicious local process spoofing HUD IPC”.

**Transport security (dual-review nit, binding for spike):**

| Transport | Peer identity | Acceptable when |
|-----------|---------------|-----------------|
| **B stdin pipe** (child spawned by Companion) | Parent owns process | **macOS P3a default** |
| **A UDS** | `SO_PEERCRED` / `getpeereid` + binary hash | Preferred if screenshot volume forces out of stdin |
| **C loopback HTTP/WS** | **No** OS peer-cred — only 127.0.0.1 + shared secret / capability token | Only if A/B blocked; never “open port” |

**Screenshot / redaction:** Companion remains the **sole redaction gate** for pixels and previews sent to HUD. Extension-side redaction does not apply when frames never traverse the extension.

---

## 10. Migration / coexistence

### Phase P3a — Spike + shell (recommended first ship)

1. Spike: Swift window receiving mock task events + one real confirm round-trip.  
2. Implement dual-track + ConfirmElevated parity for L2.  
3. Wire tray “确认台” → native if up, else extension.  
4. Keep Extension Cockpit fully functional.  
5. Dual-review gate before defaulting any user to native.

### Phase P3b — Preference + polish

1. Setting `hud.shell = auto | native | extension`.  
2. Optional ContextBar / tab tools in native or deep-link.  
3. Always-on-top, multi-monitor placement memory.  
4. Linux/Windows plan or permanent degrade doc.

### Phase P3c — Optional consolidation

1. Consider deprecating Extension Cockpit for L2 **only if** native reliability metrics pass (crash rate, open latency, confirm success).  
2. Do **not** remove Extension Cockpit until metrics + dual-review.

---

## 11. Open questions (for dual review / grill)

1. **Should tray quick-confirm remain** when native HUD is primary, or always elevate to HUD for high/critical?  
2. **Screenshot bandwidth**: stdin vs UDS vs shared-memory temp files under `~/.cmspark-agent/`?  
3. **L1 expand**: does 「展开工作区」open native HUD (light skin) or stay Extension Cockpit forever?  
4. **Single binary vs two**: tray + HUD one Swift process with two windows, or separate binaries?  
5. **Enterprise**: does native HUD become a `capability_profile=enterprise` opt-in?  
6. **Accessibility**: VoiceOver / keyboard path for ConfirmElevated — parity with web Modal?  

---

## 12. Success metrics (P3a)

| Metric | Target |
|--------|--------|
| Open latency (cold) | < 1.5s to first paint |
| Confirm from HUD while Panel closed | 100% of L2 confirms reachable |
| Double-response rate | 0 (N5 enforced) |
| Fallback rate to Extension Cockpit (macOS) | < 5% of L2 sessions after P3b |
| Crash of HUD during LIVE | < 1% sessions; task continues |

---

## 13. Risks

| Risk | Mitigation |
|------|------------|
| Two HUDs confuse users | N2 one full shell; clear tray label |
| Confirm races double-exec | N5 single-writer in Companion |
| Swift cost / codesign drag | Reuse tray build + SHA256 gate |
| Feature skew vs Extension Cockpit | Shared IA checklist; parity tests on protocol |
| Linux/Windows neglect | Explicit degrade; never block CU on those platforms |
| Scope creep into “native chat app” | N10; L0 stays Panel |

---

## 14. Deliverables of this design track

1. **This brief** (review artifact).  
2. Dual external review (Claude + Pi) → synthesis.  
3. Optional grill / ADR-0xx if N1–N10 lock.  
4. Spike plan (Swift window + hydrate + one confirm).  
5. Implementation only after dual-review **APPROVE / APPROVE_WITH_NITS**.

---

## 15. Suggested dual-review prompt (copy)

```
Review docs/decisions/v1.3/companion-native-hud-brief-2026-07-27.md
against three-mode redesign D8/D10′/D11′/D12′/D14/D16 and current
Extension Cockpit + tray confirm reality.

Check: option choice, N1–N10, protocol single-writer, platform degrade,
migration, security. End with VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT.
```

---

## 16. Author recommendation (pre-review)

- **Ship Option A phased** (P3a native L2 shell + extension fallback).  
- **Lock N2/N5/N8 early** — they prevent the worst failure modes.  
- **Defer L1 native expand** until L2 native is stable (L1 stays ContextStrip → Extension Cockpit).  
- **Do not** kill Extension Cockpit in P3a.

---

## 17. Dual-review amendments log (2026-07-27)

| Source | Nit | Resolution in brief |
|--------|-----|---------------------|
| Claude | D6 milestone vs native P3a | §6.3 milestone note |
| Claude | Transport C ≠ peer-cred | §9 transport table |
| Claude | Redaction owner for screenshots | §9 Companion sole gate |
| Pi | Right rail scope creep | N10 fixed-height N≤8, no full chat |
| Both | APPROVE_WITH_NITS, no blockers | Status → dual-reviewed; spike may be greenlit after N1–N10 product lock |

---

*Dual-reviewed draft — product lock of N1–N10 still requires owner sign-off / optional grill before spike code.*
