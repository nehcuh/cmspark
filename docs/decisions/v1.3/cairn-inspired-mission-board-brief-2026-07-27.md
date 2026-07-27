# Brief: Cairn-inspired MissionBoard × CMspark AppSec / Multi-Agent

**Date**: 2026-07-27  
**Status**: discussion — seek Claude + Pi adversarial + constructive consensus on **next work plan only** (not implement yet)  
**Audience**: Claude Code CLI + Pi independent reviews

---

## 1. Context

### CMspark today
- Browser Agent: Extension ↔ WS ↔ Companion
- **Mission Pack** (ADR-014): skills + tools + prompt composition on Thread; AppSec pack exists
- **Multi-agent P0/P1/P2-lite** (ADR-015, branch `feat/multi-agent-p0`): worker=Thread, orchestrator narrow tools, tab exclusive lease, FleetStrip, L2 identity, spawn HITL
- Security: L2 confirms, enterprise modules, dual-channel; **not** default offensive tooling in Chrome Store path

### Cairn (https://github.com/oritera/Cairn) — what we extracted
- AGPL-3.0 general **state-space search** engine; validated on pen-test/CTF
- **Blackboard**: Fact (confirmed) / Intent (to explore) / Hint (human judgment)
- Tasks: Bootstrap / Reason / Explore; workers **stigmergy** via board (no agent-to-agent chat)
- Structured JSON contracts for outputs; claim + heartbeat on intents
- Origin + Goal explicit; graph visualization
- **Do not** copy wholesale: AGPL risk, Docker attack-lab default, “no roles” vs our Pack/modules model

### Product hypothesis (Grok / prior session)
Worth learning **protocol & structure**, not runtime:
1. Thread-scoped **MissionBoard** (`origin`, `goal`, `facts[]`, `intents[]`, `hints[]`)
2. Map Cairn Reason→Orchestrator, Explore→Worker with `intent_id`
3. `collect_handback` = Fact increments only (structured)
4. User messages can be **Hints** (run-visible)
5. Explicit **complete** when goal supported by facts
6. UI: FleetStrip / Dashboard show Fact vs Open Intent (later)
7. Stay inside Pack + L2 + tab lease + enterprise gates

---

## 2. Proposed next work plan (draft for debate)

### Non-goals
- Fork/vendor Cairn code under AGPL into CMspark
- Auto-spawn silent fan-out; free shell/netsec swarm
- Replace Mission Pack with pure search engine
- Full pen-test lab Docker default for community

### Phase A — Spec only (ADR + schema)
- ADR-016 draft: MissionBoard data model, lifecycle, security
- JSON schema for Fact / Intent / Hint / Complete
- Mapping to existing Thread / orchestrator_run_id / worker
- Compatibility with ADR-014 Pack and ADR-015 multi-agent

### Phase B — Companion kernel (thin)
- Persist board under `~/.cmspark-agent/` or thread metadata (choose one)
- WS: `board.get` / `board.patch_hint` / `board.set_goal` (or fold into tools)
- Tools: `board_read`, `board_add_fact`, `board_add_intent`, `board_complete` (whitelist per role)
- Orchestrator Reason step = tool or system prompt contract; Worker Explore bound to `intent_id`
- Handback validation: reject free-form-only handbacks when board mode on

### Phase C — AppSec Pack v2
- Rewrite/extend `appsec-prd-review` (or new pack) to use board:
  - origin = page/PR under review
  - goal = structured threat model + checklist + evidence-backed findings
- Skills/prompts: Reason vs Explore language
- No new high-risk tools in community

### Phase D — UI
- Minimal: Side Panel board list (facts / open intents / hints)
- Later: graph viz; FleetStrip badges “N open intents”
- Hint input affordance

### Phase E — Verify
- Unit tests for schema + board races
- Manual AppSec scenario
- Optional: Claude+Pi re-review of ADR before code freeze

### Order suggestion
**A → B (minimal) → C → E → D** (UI after protocol proves useful)  
Alternative: **A → C (prompt-only board in pack without persistence) → B** if we want faster UX demo.

---

## 3. Open forks for reviewers

1. **Persistence**: thread field vs separate board store vs knowledge docs?
2. **Who may write Facts?** Only worker after Explore? Orchestrator too? User?
3. **Board mode on/off**: per-pack flag vs always-on multi-agent?
4. **Prompt-only first** vs **hard schema enforcement** from day one?
5. **Complete authority**: orchestrator LLM vs user confirm complete?
6. **Priority vs remaining ADR-015 debt** (Dashboard full, WS E2E, shared-observer deferred)?
7. **License**: any risk if we only reimplement ideas (not code)?

---

## 4. Review charter (Claude + Pi)

Produce structured review in Chinese or English:

1. **Verdict on draft plan**: APPROVE / APPROVE_WITH_CHANGES / REJECT (+ confidence %)
2. **Attack the plan**: wrong order, missing security, over-scope, conflicts with ADR-014/015
3. **What to steal from Cairn** (ranked) vs **what to reject**
4. **Recommended phase order** (explicit sequence)
5. **P0 must-have for first mergeable slice** (smallest vertical)
6. **Must-not-do next 30 days**
7. **Concrete next 3 engineering tasks** (file-level if possible)

Read if available:
- `docs/adr/014-mission-pack-enterprise-modules.md`
- `docs/adr/015-multi-agent-orchestrator-tab-lock.md`
- `docs/decisions/v1.3/multi-agent-ship-summary-2026-07-27.md`
- This brief

Do **not** implement code. Output to:
- Claude: `docs/audit/reviews/cairn-mission-board-plan-claude-<timestamp>.md`
- Pi: `docs/audit/reviews/cairn-mission-board-plan-pi-<timestamp>.md`
