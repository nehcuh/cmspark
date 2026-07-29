# Dual review: Capability Model three axes (architecture ontology)

## Role

You are an independent senior architecture reviewer for **CMspark** (Chrome Side Panel Agent + local Companion). You are reviewing a **product/architecture ontology brief**, not a code patch. Ground claims in the real repo where possible (`docs/architecture.md`, UI L0/L1/L2, ADR-014/015/016/017/018/019, README).

## Primary document (must read fully)

`docs/decisions/capability-model-three-axes-brief-2026-07-29.md`

## Context (optional skim)

- UI modes: `docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md`
- Pack: `docs/adr/014-mission-pack-enterprise-modules.md`
- Multi-agent: `docs/adr/015-multi-agent-orchestrator-tab-lock.md`, `016`
- Computer/Host: `docs/adr/017-computer-use.md`, `018`
- Live architecture: `docs/architecture.md` §1 topology, §7 Packs, §9 Computer
- User pain: features proliferating; want “outer → inner” stacking without new runtimes

## What to evaluate

1. Correctness vs shipped design (do not invent alternate topology that breaks Extension↔Companion).
2. Whether three axes reduce “杂” better than owner’s four-layer-only story.
3. Risks of adopting this as ADR-020 and reshaping README.
4. Explicit answers to **Q1–Q6** in the brief §11.
5. Blocking issues vs nits only.

## Output structure

1. Executive summary (≤8 lines)
2. Answers **Q1–Q6** (numbered)
3. Agreement / disagreement with §10 proposed decisions (1–5)
4. Blocking issues (if any) with concrete fix
5. Non-blocking nits
6. Doc plan §9: accept / amend
7. Final line **exactly one of**:
   - `VERDICT: APPROVE`
   - `VERDICT: APPROVE_WITH_NITS`
   - `VERDICT: REJECT`
