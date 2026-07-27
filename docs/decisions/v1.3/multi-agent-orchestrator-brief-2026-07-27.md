# Product Brief: Multi-Agent Orchestrator + Dashboard + Tab Lock

**Date**: 2026-07-27  
**Status**: exploration / adversarial design (not approved for implementation)  
**Repo**: CMspark (Chrome Extension Side Panel ↔ WebSocket ↔ Companion)

---

## 1. Context

CMspark is a **browser-native AI agent**: Side Panel UI, CDP browser tools in the extension, LLM + state + skills + security in Companion.

**Already shipped (relevant):**

- Multi-**thread** conversations (user-managed parallel work, not orchestrated multi-agent)
- Mission Pack (composition: skills / tools / prompt → apply to Thread); enterprise modules (`shell`, `netsec`, workspace)
- L2 security confirmation for high-risk tools (`evaluate`, `osascript_eval`, `shell_exec`, `netsec_port_scan`, …)
- Computer Use / Cockpit track (host-level), separate from pure browser tools
- Dual-layer topology: Extension does browser ops; Companion owns agent loop

**Not shipped:** runtime sub-agents, orchestrator, worker dashboard, tab lease/lock.

## 2. Product intent (user)

1. For complex tasks, spawn **multiple agents** (by need or user instruction).
2. An **orchestrator** organizes and manages all workers.
3. Plugin has a **Dashboard** to see sub-agent status and **human-in-the-loop enter** a worker.
4. **Hard constraint (user-emphasized):** when a sub-agent is **operating a tab**, other agents **must not** operate that tab until the **tab operation lock is released**.

## 3. Working hypotheses (to attack)

| ID | Hypothesis |
|----|------------|
| H1 | Worker should be a **Thread** (or child Thread) with Pack as role template — not a new runtime. |
| H2 | Orchestrator should be **narrow-tool** (spawn/wait/collect/ask_user), not full browser freedom by default. |
| H3 | Tab lock is **required for correctness**, not optional polish. |
| H4 | Dashboard is first-class (possibly full-page), not only a Side Panel strip. |
| H5 | Spawn must be **explicit / user-approved** for cost and security; no silent fan-out of high-risk modules. |
| H6 | Workers inherit **downgraded** capability by default; elevation requires confirm. |

## 4. Tab lock — required discussion axes

Agents **must** address:

1. **What is locked?** tabId only? window? browser profile? entire CDP attach?
2. **What counts as “operating”?** mutate tools only (`click`, `type`, `navigate`, …) vs also read (`get_page_text`, `screenshot`)?
3. **Lock unit of time:** single tool call vs multi-tool “turn” vs “lease until worker releases / timeout”?
4. **Who holds the lock?** worker_id / thread_id / orchestrator run_id?
5. **Where is the lock enforced?** Companion (before tool dispatch) vs Extension BrowserBridge (must both?)?
6. **Deadlock / timeout / steal / user force-release**
7. **Orchestrator or human** navigates while worker holds lock?
8. **Pinned tabs / multi-tab workers** — one lock per tab, worker may hold multiple?
9. **Interaction with security.confirmation** queue (L2 while holding lock)
10. **Cross-feature:** Computer Use host tools vs browser tabs — same model or orthogonal?

## 5. Code anchors (read these; do not invent APIs)

| Area | Paths |
|------|--------|
| Browser tools / CDP | `chrome-extension/src/background/browser-bridge.ts` |
| Extension tool entry | `chrome-extension/src/background/index.ts` (message routing) |
| Companion tool loop + L2 | `companion/src/server.ts` (confirmation, tool execution) |
| Confirm manager | `companion/src/security-confirmation.ts` |
| Threads | `companion/src/threads/thread-manager.ts` |
| Packs | `companion/src/packs/pack-engine.ts`, ADR-014 |
| Architecture | `docs/architecture.md` § multi-thread examples, Mission Pack §7 |
| Usage / enterprise | `docs/mission-pack-usage.md` |

## 6. Non-goals (for this design round)

- Free multi-PTY swarm
- Unconfirmed parallel shell/netsec fan-out
- Replacing Mission Pack with a new agent OS
- Chrome Web Store default distribution of offensive multi-scanner swarms

## 7. Desired outputs from adversarial workflow

1. **Locked conclusions** (must-have product rules) with kill criteria if violated
2. **Tab lock model** (state machine sketch + enforcement point)
3. **Phased delivery** P0–P2
4. **Open questions** that need human product call
5. Explicit list of **rejected** alternatives and why

## 8. Second-round reviewers

After workflow synthesis: **Claude** and **Pi** independent adversarial design reviews on the synthesis artifact (same pattern as Mission Pack design reviews).
