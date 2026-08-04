# Adversary Synthesis — 运行态可见 + 子任务下钻

**Date**: 2026-08-04  
**SoT**: `docs/superpowers/specs/2026-08-04-run-state-and-worker-drilldown.md`  
**Agents**: Product/UX · Security/Trust · Compat/ADR · Impl architect  

---

## 1. Scoreboard

| Agent | Verdict | Core stance |
|-------|---------|-------------|
| Product/UX | **MAJOR_REVISE** | W0+W1 without busy map worse for drill path; ≤2-click SLA false under Confirm; hard-gate needs steer contract; chrome budget |
| Security/Trust | **PASS_WITH_CHANGES** | No Surface lift; floors F1–F7 for mis-approve / force-release / lease honesty |
| Compat/ADR | **PASS_WITH_CHANGES** | Lock RunBusy to pure fn; lock Q1–Q5; UIUX fleet click amendment |
| Impl | **PASS_WITH_CHANGES** | RunBusy ≠ idle workers; tool.* need `thread_id`; portal popover; W1 history-only honesty |

## 2. Conflict resolution (merge into SoT)

| Conflict | Resolution |
|----------|------------|
| Product: W1 needs W2-min busy map | **W0 + W1 + W2-min same ship** (thin `threadBusyById` + tool `thread_id`); full progress tails stay later |
| Product MAJOR vs others PASS_WITH | **Adopt all Product blocking B1–B6 as SoT floors** — not optional polish |
| RunBusy = fleet idle workers sticky | **Honest `deriveRunBusy`**: locks ∨ intents ∨ holding_tabs ∨ llm_active / threadBusyById — **never** `worker_count>0` alone |
| FocusBand fleet → Cockpit vs popover | **Lock Q2**: primary → worker popover (portal); Cockpit secondary; amend UIUX v2 note |
| Hard-gate vs mid-task steer | **Stop always on ThreadBusy**; placeholder steers Stop→re-instruct; no silent draft-trap |
| Security confirm wrong worker | **F1–F2 floors** in SoT + acceptance |

## 3. Mandatory floors (into SoT)

| ID | Floor | Source |
|----|--------|--------|
| F-UX1 | Always-visible RunBusy affordance when active (not only when FocusBand primary=fleet) | Product B2 |
| F-UX2 | ScopeBar ≤1 line (~28px); fake-end **or** Scope line, not both full stacks | Product B5 |
| F-UX3 | User-facing 2 states only: 本对话处理中 / 子任务还在跑(+可发送) / 就绪 | Product B4 |
| F-UX4 | Glossary: 停止本轮 · 停止该子任务 · 全停; CTA 进入子任务 not pure 查看进展 | Product B6 |
| F-UX5 | Today Panel「切入」effectively unmounted (focusBand only) — W1 is net-new nav | Product B7 |
| F-S1 | Confirm chrome stamped independent of activeThread; stop target never wrong-thread fallback | Security B1 |
| F-S2 | Worker composer hard-label 发送给子任务·{role} | Security B1/F2 |
| F-S3 | Force-release secondary; Pause≠Cancel≠全停 copy | Security B2 |
| F-S4 | Follow-up never transfers lease; force-release labeled blast | Security B4 |
| F-S5 | !ThreadBusy && RunBusy && locks → mandatory risk chrome | Security B3/F5 |
| F-S6 | Confirm primary unchanged; popover cannot bury MinimalConfirm | Security B5 |
| F-C1 | `RunBusy := deriveRunBusy(...)` pure + P0 scope documented (global vs per-run) | Compat B1 |
| F-C2 | Q1–Q5 **Defaults locked** | Compat B3 |
| F-C3 | UIUX §4.3 one-line: fleet primary → worker popover | Compat B2 |
| F-I1 | Companion `tool.start/result/progress` + `thread_id`; gate tool.* on active for transcript | Impl B2 |
| F-I2 | Portal popover outside FocusBand overflow:hidden | Impl B4 |
| F-I3 | W1 enter worker: history completed tools; live in-flight only after events / W2 | Impl B6 |
| F-I4 | threadBusyById delete on REMOVE_THREAD | Impl B5 |

## 4. Ship order (post-adversary)

```text
Spec patch (this synthesis → SoT) 
  → dual-review (Pi + Claude)
  → W0: deriveThreadBusy + Composer gate/stop + honest deriveRunBusy banner
  → companion: tool.* thread_id (+ optional llm_active)
  → W1: portal list + ScopeBar + enter
  → W2-min: threadBusyById (same PR as W1 preferred)
  → W3: Board/ThreadList (optional)
```

## 5. Dual-review readiness

| Gate | Status after SoT patch |
|------|------------------------|
| All blocking floors written into SoT | Required |
| Defaults Q1–Q5 locked | Required |
| No Surface/Trust elevation | Hold |
| Machine-checkable busy predicates | Required in § |

**Internal adversary gate for dual launch:** SoT revised to **LOCKED for dual-review** with floors above. Product MAJOR_REVISE is **resolved by patch**, not overridden.

## 6. Artifacts

- Design SoT (revised): `docs/superpowers/specs/2026-08-04-run-state-and-worker-drilldown.md`
- This synthesis: `docs/audit/reviews/run-state-worker-drilldown-adversary-synthesis-20260804.md`
- Dual prompt: `docs/audit/reviews/run-state-worker-drilldown-dual-review-prompt-20260804.md`
