Now I have a thorough understanding of CMspark. Here is my comprehensive external review.

---

# CMspark Browser Agent — External Product + Engineering Review

**Reviewer**: External Product+Engineering Expert (Pi)  
**Date**: 2026-07-26  
**Scope**: Full project — `companion/`, `chrome-extension/`, `docs/`, `scripts/`, CI, packaging, prior audit history  
**Prior Audits Reviewed**: 2026-06-16, 2026-07-09 (4.4/C), 2026-07-25 (5.8/C+)  
**Version Under Review**: 0.3.0 (HEAD ~06966a4)

---

## 1. What This Project Gets Right

Before I tear into the problems, let me acknowledge the genuinely good engineering here:

1. **Double-layer topology is the right call.** Browser Extension (Plasmo + React) ↔ WebSocket ↔ Local Companion (Node.js) is the correct architecture for a browser agent. It keeps LLM reasoning out of the Service Worker lifecycle and browser operations out of the Node runtime. This separation is non-trivial to get right and the project mostly does.

2. **Security engineering has real teeth.** HMAC challenge-response with constant-time comparison, origin-bound confirmation queues, domain whitelist pattern matching with PSL-aware rejection of `*.com` — these are not "checkbox security" moves. Someone on this team understands threat modeling. The `ws-auth.ts` handshake and the `security-policy.ts` token issuance are genuinely well designed.

3. **ADR discipline is rare and valuable.** 13 ADRs covering topology, protocol, storage, skills, cookie trust, defense layers, domain whitelists, Obsidian export, Mermaid rendering, privilege tiers, and NotebookLM import. Each one records `why`, not just `what`. Most projects at this stage have zero ADRs.

4. **Audit responsiveness is proven.** The July 9 audit found 4 Criticals — WS zero-auth, history never flush, CI `|| true`, critical npm vulns. By July 25, all four were `FIXED_VERIFY`. That is a one-sprint turnaround on foundation-level security issues. Many teams would still be debating.

5. **Test coverage is broader than typical for a pre-v1.** ~110 test files in companion alone. Coverage concentrates correctly on security gates, computer-use boundaries, Obsidian export, and MCP capability gating. The security-gates integration tests are testing the right things.

6. **Cross-platform thinking is real.** macOS Swift tray, Windows systray2/SEA exe, Linux systemd — this is not a "works on my Mac" project. The platform abstraction layers (`host-use/darwin/`, `host-use/win/`, `computer/darwin-*.ts`, `computer/win-*.ts`) show genuine multi-platform design.

---

## 2. What Is Concerning — Ranked by Impact

### 🔴 Critical Concern #1: The `server.ts` God-File (3941 lines)

This is the single biggest architectural liability in the codebase. `companion/src/server.ts` is 3,941 lines with ~79 functions/classes/interfaces/types. It contains:

- WebSocket server lifecycle
- Connection authentication state machine
- Tool execution with confirmation gating
- Tab URL cache management
- Config event broadcasting
- Computer-use task coordination
- Host-use biometric gate orchestration
- MCP lifecycle hooks
- Shutdown orchestration
- Health check endpoint

**Why this matters**: When L2 confirmations have inconsistent `originWs` binding (as noted in audit H15 / XC-Architecture-5), the root cause is that confirmation logic is scattered across this monolithic file rather than being a cohesive module. When `config.updated` events can leak to unauthenticated sockets (audit H2 / SRV-1), it is because the broadcast logic is embedded in a 3,941-line file where the auth check is easy to miss.

**What should happen**: Decompose into at minimum:
- `server/ws-server.ts` — WebSocket lifecycle, auth, connection tracking
- `server/tool-executor.ts` — unified tool execution with all security gates in one place
- `server/config-broadcast.ts` — authenticated config fanout
- `server/shutdown.ts` — graceful shutdown with ordered service teardown

The existing `message-router.ts` (1,715 lines) and `llm/adapter.ts` (1,077 lines) also need decomposition, but `server.ts` is the urgent one because it mixes security-critical auth decisions with tool dispatch with config fanout.

---

### 🔴 Critical Concern #2: Computer-Use Security Model is Self-Contradictory

The computer-use subsystem (`companion/src/computer/`, 35 files) is architecturally sophisticated — TinyClick OCR locator, session trust, Darwin estop, L2 preview images, UIA watch. But the security model has a fundamental contradiction:

**Session trust breaks the human-in-the-loop invariant mid-task.** Per audit COMP-2: after one L2 confirmation, `session-trust` auto-approves subsequent `danger-caution` and `TinyClick` G4 actions without re-confirmation. This means the user approves "click the Send button in WeChat" and the agent can subsequently *click anywhere* on the WeChat window without asking again.

The whole point of an L2 gate is that coordinate injection into a real desktop app is fundamentally dangerous in a way that page-automation is not. Session-trust should reduce friction for *read-only* actions (screenshot, describe) but NEVER skip re-confirmation for injective actions (click, type, key chord) that mutate real desktop state.

**Additionally**, audit COMP-1 confirms that macOS coordinates are treated as screen coordinates when they are window-relative — the `cuInject` function lacks `ClientToScreen` conversion. Combined with session-trust, this means: approve one click, and the agent can silently inject clicks at wrong screen coordinates for the rest of the session.

---

### 🟠 High Concern #3: Selector Injection via CDP Bypass

Audit SEC-1 is a genuine page-RCE vector. The `L2_GATE_TOOLS` list guards `evaluate` but NOT `get_page_html`, `wait_for`, or `click`. These tools pass CSS selectors to `Runtime.evaluate` in the page context:

```
L2_GATE_TOOLS guards: evaluate ✓
L2_GATE_TOOLS misses:  get_page_html(selector) ✗, wait_for(selector) ✗, 
                       click(selector) ✗, getElementCenter(selector) ✗
```

An attacker who can inject a selector string (via prompt injection, compromised skill, or malicious MCP server) gets arbitrary `Runtime.evaluate` execution **without triggering the evaluate confirmation gate**. The fix is simple — `JSON.stringify` the selector before interpolation — but it has been open since the July 25 audit.

---

### 🟠 High Concern #4: Chat State Machine Has Known Corruption Paths

Multiple audit findings (XC-Cor-1 through XC-Cor-4) describe a chat state machine that can corrupt LLM context:

1. **Orphan tool calls** (XC-Cor-1): When LLM streaming is interrupted mid-tool_call, `llm/adapter.ts` strips incomplete tool_calls from the OpenAI message but still pushes orphan tool result rows into the message history → next turn gets OpenAI 400 "tool message must follow assistant tool_call message."

2. **`shouldStop` only pops from memory, not disk** (XC-Cor-2): Aborted turns leave orphan tool messages in the persisted thread JSON. A thread reload will replay the corrupted history.

3. **Error + done double-submit** (XC-Cor-3): When `chat.error` fires, `useWebSocket` in the extension still submits a `chat.done` with whatever was in `streamingRef` → user sees a "half-finished" completion bubble.

4. **Stop doesn't kill computer tasks** (XC-Cor-4): `chat.abort` kills the LLM but `computer.task.abort` is never called → coordinate injection continues after the user thinks they stopped the agent.

These are not edge cases. Users *will* hit the Stop button mid-task, and when they do, the thread should stay clean and the agent should actually stop.

---

### 🟠 High Concern #5: Streaming Cross-Thread Contamination

Audit EXT-1: `useWebSocket.ts` does not compare `thread_id` on incoming streaming tokens. If Thread A is streaming and the user switches to Thread B, tokens from Thread A's stream continue rendering into Thread B's chat view. The `streamingRef` is not cleared on thread switch. This is a user-facing correctness bug that erodes trust in the thread isolation model.

---

### 🟡 Medium Concern #6: The Documentation Lag is Real

`docs/architecture.md` still describes phantom modules (risk-engine, privilege-manager, page-scanner) that were deleted in the June 16 audit. There is no ADR for the computer-use subsystem — a feature with 35 source files, its own task lifecycle, session trust model, TinyClick OCR pipeline, and L2 preview image system. The architecture document mentions none of it.

This matters because AI coding agents (the very tools building this project) read these documents to understand context. Stale architecture docs actively mislead them.

---

### 🟡 Medium Concern #7: Release Pipeline is Fragile for a Multi-Platform Product

Audit OPS-2: `scripts/package.sh` only issues a `WARNING` when `cmspark-host` is missing. The Windows `build-windows-exe.ps1` and macOS `package.sh` are separate pipelines. There's no single command that produces all platform artifacts and fails if any are incomplete. The release body still references `ws_secret` in an auth text that predates the pairing flow.

For a product that ships as a downloadable DMG/exe/zip, the packaging pipeline should be a hard gate, not a warning.

---

### 🟡 Medium Concern #8: Test Infrastructure Has Blind Spots

Despite ~110 test files, the audit notes (XC-Test-1 / TEST-3) that the security-gates test harness uses a "privileged `respond`" function that skips the real origin-binding path. This means the tests that verify "confirmations can only be resolved by the originating socket" are testing a mock, not the real `respondFrom`. Additionally, Windows-specific tests are skipped on Ubuntu CI (`skip WIN`), so the Windows host-use contract is never exercised in CI.

---

## 3. Architecture Scorecard

| Dimension | Score | Assessment |
|-----------|------:|------------|
| **Architecture** | **5.5/10** | Topology is correct but decomposition is behind. server.ts god-file (3941 lines) is the #1 technical debt item. |
| **Security** | **6.0/10** | Trust root (WS auth) is now solid. Selector injection, session-trust overreach, and config fanout auth are the remaining open gaps. |
| **Correctness** | **4.5/10** | Chat state machine corruption paths are systemic. Orphan tool calls, error+done double-submit, Stop incompleteness — these are daily-user-visible. |
| **Testing** | **5.5/10** | Good breadth, real integration tests for security gates. But harness bypasses real confirmation paths and Windows is untested. |
| **Maintainability** | **5.0/10** | ADRs are excellent. But server.ts, message-router.ts, and llm/adapter.ts are overdue for decomposition. Architecture docs are stale. |
| **Release** | **5.0/10** | Builds produce real artifacts. But packaging is fragile (warnings, not gates), version alignment is inconsistent, and dual pipelines diverge. |
| **Design** | **5.5/10** | The L0/L1/L2 capability mode system is well thought through. The Apps P1 launch-only design is appropriately conservative. Session-trust is the one overreach. |

---

## 4. What Would Make Me Say "Ship It"

### Must-Fix Before Any Public Beta (P0 — 1 week)

1. **Fix selector injection** (SEC-1): `JSON.stringify` selectors in `get_page_html`, `wait_for`, `click`, `getElementCenter` CDP calls. This is a one-line-per-site fix.

2. **Fix config fanout auth** (SRV-1): `configEvents` broadcast must only go to authenticated sockets, and MCP env/headers must be redacted from the payload.

3. **Fix chat state machine corruption** (XC-Cor-1/2/3): Orphan tool cleanup on abort, disk-memory consistency on `shouldStop`, and no `chat.done` after `chat.error`.

4. **Fix Stop → computer.task.abort** (XC-Cor-4): The Stop button must cascade to computer task abortion. A user pressing Stop must mean Stop.

5. **Fix cross-thread streaming contamination** (EXT-1): Gate streaming tokens on `thread_id` match and clear `streamingRef` on thread switch.

6. **Session-trust must not skip re-confirmation for injective actions** (COMP-2): Read-only actions (screenshot, describe) can be session-trusted. Click/type/key MUST re-confirm. Or if you want to trust them, make the user explicitly opt into "trust all injective actions in this session" as a separate, clearly-labeled checkbox.

### Should-Fix Before Public Beta (P1 — 2 weeks)

7. **Decompose server.ts**: Minimum viable split — extract tool execution with unified L2 binding into a single module where all originWs binding is visibly consistent.

8. **Fix macOS coordinate space** (COMP-1): `ClientToScreen` conversion in `cuInject`.

9. **Fix test harness origin bypass** (XC-Test-1): Security-gates tests must exercise the real `respondFrom` path.

10. **Update architecture.md**: Remove phantom modules, add computer-use section, add ADR-014 for computer-use.

11. **Hard-gate packaging**: Missing `cmspark-host` should be a build failure, not a warning.

### Nice-to-Have for v1.0

12. Full PSL for wildcard validation (currently ~10 multi-tenant eTLDs bypass the hardcoded set).
13. `god-mode` companion-side step-up (currently a boolean toggle with no confirmation).
14. Thread corruption auto-repair on load.
15. Code signing / notarization for macOS DMG.

---

## 5. Product Perspective

**What problem does CMspark solve?** Natural-language browser automation with SSO cookie reuse, multi-thread isolation, and a skill system for reusable workflows. This is a real need — think enterprise internal tools, data extraction, cross-system reporting.

**Is the UX coherent?** The Side Panel concept is excellent — always available, 320px companion panel. The L0/L1/L2 capability mode with escalating visual indicators is thoughtful. The Cockpit window for computer-use tasks (PR #75) shows good product instincts.

**What is missing?** The error experience is weak. When the chat state machine corrupts, users get raw OpenAI 400 errors or half-finished bubbles. First-time setup (extension load, companion start, pairing) is documented but still multi-step. The "it just works" bar is not yet met.

**Competitive landscape**: Browser agents are a hot space (Browser Use, Agent-E, etc.). CMspark's differentiator is the local-first companion model (privacy, no cloud dependency, SSO cookie access) and the multi-thread isolation. But the reliability gaps mean power users who try it will hit corruption and leave.

---

## 6. Verdict

CMspark has a correct architecture, genuinely thoughtful security engineering, and proven ability to respond to audit findings. The core loop — "user says do something → agent operates browser → results come back" — works. The skill system, multi-thread model, and knowledge base are differentiating features.

But the v0.3.0 expansion into computer-use has outpaced the codebase's ability to absorb complexity. The `server.ts` god-file, the chat state machine corruption paths, and the session-trust overreach are not "we'll fix later" items — they are regressions waiting to happen the moment real users hit edge cases.

The P0 list above is achievable in a focused sprint. The project is close — closer than the C+ score suggests — because the hardest problems (WS auth, history persistence, CI integrity) are already solved. What remains is consolidation: making the existing security model consistent, making the chat state machine resilient, and decomposing the monolith so the next feature doesn't add 500 more lines to server.ts.

### **APPROVE_WITH_CHANGES** — Confidence: **72%**

The changes needed are specific, achievable, and bounded. The architecture is sound. The team has demonstrated they can close critical findings in one sprint. The P0 fixes above should take no more than 1–2 weeks. Once those land, this is a ship-ready v0.4.0.

---

*Review based on static analysis of source code, architecture documents, ADRs, CI configuration, packaging scripts, and three historical audit reports. No runtime testing was performed.*
