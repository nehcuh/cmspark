# Cairn inspiration note — CMspark MissionBoard

**Status**: binding paper trail for ADR-016 (AGPL hygiene)  
**Date**: 2026-07-27  
**Upstream**: [oritera/Cairn](https://github.com/oritera/Cairn) — **AGPL-3.0**

This document records **what CMspark took as product/protocol ideas** versus **what was explicitly rejected**. CMspark does **not** link, vendor, or copy Cairn source or schema text. MissionBoard schema and implementation are **reimplemented independently** under CMspark’s own Thread / Pack / multi-agent stack (ADR-014, ADR-015, ADR-016).

---

## Ideas adopted (portable protocol concepts)

These are high-level methods / product patterns, not code:

1. **Fact / Intent / Hint** trichotomy as a coordination vocabulary  
2. **Structured handback** instead of free-prose-only worker returns  
3. **Explicit origin + goal** on the shared task state  
4. **Stigmergy** — shared board preferred over worker-to-worker chat  
5. **Conditional complete** — model may not silently declare mission success  
6. **Intent claim / heartbeat / abandoned** as multi-agent scheduling concerns (deferred to ADR-016 Phase 3)  
7. **Graph visualization** of the board (post-P0; not Phase 1)

CMspark expresses these as `thread.mission_board`, Zod/TS schemas of our design, L2 Confirm Center completion, and fold into existing `collect_handback` — not as a Cairn runtime fork.

---

## Artifacts rejected (must not enter the tree)

| Rejected | Reason |
|----------|--------|
| Cairn source files / packages / git submodules | AGPL-3.0 copyleft / vendor risk |
| Verbatim Cairn schema JSON, field dumps, or pasted type definitions | Derivative gray zone; independence paper trail |
| Docker attack-lab defaults as community product surface | Store / liability surface |
| “Role-less” flat swarm as default | Conflicts with Pack + Orchestrator asymmetry (ADR-015) |
| Opening Cairn source **during** authoring of `companion/src/board/**` | Clean-room control (ADR-016 §2.7) |

---

## Clean-room instruction (implementers)

When implementing `companion/src/board/**` (or equivalent):

1. Work only from: ADR-016 (incl. Appendix A), this file, ADR-014/015, and existing CMspark kernel code.  
2. **Do not** open Cairn repositories, tarballs, or schema mirrors while writing production board code.  
3. **Do not** paste field names/types from Cairn into Zod “for compatibility.”  
4. If a contributor needs to re-read Cairn for research, that work must be **separated in time** from commits that touch board implementation; prefer a second person for review.

Recommended (non-blocking): CI fail if `Cairn` / `oritera` identifiers appear under `companion/src/board/**`.

---

## Notices

See also: `companion/THIRD_PARTY_NOTICES` — Cairn entry (not linked; protocol ideas only).

---

*Maintained under ADR-016 MF-4 / Appendix A G14.*
