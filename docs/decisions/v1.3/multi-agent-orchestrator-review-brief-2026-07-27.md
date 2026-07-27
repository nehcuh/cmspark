# External Review Brief: Multi-Agent Orchestrator + Tab Lock

**Date**: 2026-07-27  
**For**: Claude Code CLI + Pi (independent adversarial design reviews)  
**After**: Grok workflow `multi-agent-tab-lock-adversarial` synthesis

## Materials to read

1. Product brief: `docs/decisions/v1.3/multi-agent-orchestrator-brief-2026-07-27.md`
2. Workflow synthesis (primary): path filled after workflow completes — typically  
   `docs/decisions/v1.3/multi-agent-orchestrator-synthesis-2026-07-27.md`  
   and/or workflow scratch `multi-agent-tab-lock-synthesis.md`
3. Code anchors (spot-check, do not re-design from vacuum):
   - `chrome-extension/src/background/browser-bridge.ts`
   - `companion/src/security-confirmation.ts`
   - `companion/src/threads/thread-manager.ts`
   - `docs/architecture.md` (message flow + multi-thread)
   - ADR-014 Mission Pack dual-channel (`docs/adr/014-mission-pack-enterprise-modules.md`)

## User hard constraint

When a **sub-agent is operating a tab**, **no other agent** may operate that tab until the **tab operation lock is released**.

## Review charter (adversarial / constructive)

Produce a structured review in **Chinese or English**:

1. **Verdict** on synthesis overall: APPROVE / APPROVE_WITH_CHANGES / REJECT (with confidence %)
2. **Attack tab lock model**: missing states, TOCTOU, who enforces, read vs write, lease vs per-tool, deadlock, L2 while holding lock
3. **Attack orchestrator model**: Thread-as-worker fit; silent spawn; capability elevation; confirm storms
4. **Attack Dashboard**: Side Panel 320px vs full page; HITL enter; confirm center
5. **Must-fix before any P0 code** (ordered)
6. **What synthesis got right** (do not only criticize)
7. **Open product calls** only human can decide

## Non-goals for this review

Do not implement code. Do not expand into free PTY multi-shell platform. Do not require Chrome Store distribution of offensive swarms.

## Output path convention

- Claude: `docs/audit/reviews/multi-agent-orchestrator-claude-<timestamp>.md`
- Pi: `docs/audit/reviews/multi-agent-orchestrator-pi-<timestamp>.md`
