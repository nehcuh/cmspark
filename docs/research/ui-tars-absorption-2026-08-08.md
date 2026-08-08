# Research: ByteDance UI-TARS vs CMspark Computer Use

> **Date**: 2026-08-08  
> **Status**: SoT research (absorption decision → multipath design)  
> **Sources**: [bytedance/UI-TARS](https://github.com/bytedance/UI-TARS) (model/research) · [bytedance/UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop) (Agent stack / Desktop) · paper arXiv:2501.12326 · UI-TARS-2 arXiv:2509.02544 · CMspark ADR-017 / `companion/src/computer/`  
> **License note**: UI-TARS stack is Apache-2.0; model weights on HF/ModelScope have their own terms — do not vendor weights or copy large code blocks without attribution.

---

## 1. What UI-TARS actually is

Two related products, often conflated:

| Repo | Stars (approx) | Role |
|------|----------------|------|
| **UI-TARS** | ~11k | **Native GUI VLM** research + open weights (1.5-7B etc.). Perception = screenshots; output = `Thought:` + `Action:` DSL. |
| **UI-TARS-desktop** | ~38k | **Product/infra monorepo**: UI-TARS Desktop (Electron) + **Agent TARS** (CLI/Web UI, MCP, hybrid browser). Operator layer + GUIAgent loop + event stream. |

**Claim accuracy (calibrated)**: On public GUI benchmarks (OSWorld, ScreenSpotPro, AndroidWorld, etc.) UI-TARS-1.5 reports competitive / SOTA-class numbers vs OpenAI CUA / Claude computer-use style agents. That is **model + training + pure-vision loop** strength — not automatically a superior **product security architecture**.

**Core loop (Desktop SDK `GUIAgent`)**:

```text
while not done:
  screenshot = operator.screenshot()
  prediction = VLM(history + image + system_prompt with ACTION_SPACES)
  parsed = action_parser(prediction)   # Thought + Action DSL
  operator.execute(parsed)             # nut.js / browser / ADB / AIO
  # status: RUNNING | PAUSE | CALL_USER | END | ERROR | USER_STOPPED
```

**Action space (COMPUTER_USE prompt)**: `click` / `left_double` / `right_single` / `drag` / `hotkey` / `type` / `scroll` / `wait` / `finished` (+ mobile variants). Coordinates often normalized or absolute depending on model family (`qwen25vl` uses smart_resize absolute path).

**Operator abstraction**: Agent never calls OS APIs directly — always through `Operator` (`NutJSOperator`, browser, ADB, AIO hybrid). Swap surface without rewriting the loop.

**Human control**: `pause` / `resume` / `stop`, plus internal action `CALL_USER` (hand back to human). Desktop UX: “Take control” / terminate.

**What they are not optimizing for (from open materials)**: fail-closed dual-switch, per-app whitelist, task-level L2 with type corpus binding, hard-deny payment/credential, multi-agent tab-lease isolation, evidence redaction — CMspark’s trust model is **much deeper** here.

---

## 2. CMspark Computer Use as-is (0.5.0)

| Layer | Mechanism |
|-------|-----------|
| **Entry** | Tool `host_computer` (batch `actions[]` + budget) inside main Companion tool-loop |
| **Surface** | L2 host (ADR-020); dual switch `coordinateEnabled` + `AppEntry.coordinateAllowed` |
| **Locate chain** | L0 UIA → L1 OCR → L2 Qwen3-VL experimental (always re-L2) → L3 cloud stub |
| **Safety** | Task L2, session-trust G1, unattended ADR-021, danger scan, estop, evidence, hard-deny |
| **Prefer** | Semantic `host_read` / `host_write` / CDP L1 **before** pixel inject |
| **Model role** | Chat LLM plans tools; **optional** local Qwen3-VL only for **pixel suggestions** |

CMspark is a **browser-first agent with opt-in desktop inject**, not a pure vision GUI agent. That is a deliberate product identity (confirm center, chat, packs, MCP).

---

## 3. Side-by-side comparison

| Dimension | UI-TARS / Desktop | CMspark | Who wins for us? |
|-----------|-------------------|---------|------------------|
| Grounding accuracy (benchmarks) | Strong native VLM | Hybrid UIA+OCR+opt Qwen | UI-TARS model *if* we only measure pixels |
| Hybrid structure (UIA/AX/DOM) | Secondary / hybrid browser in Agent TARS | First-class L0+L1+semantic Host | **CMspark** (reliability + audit) |
| Security / Trust | Demo/local; CAPTCHA success listed as capability | Dual-switch, L2, hard-deny, trust math | **CMspark** (non-negotiable) |
| Operator packaging | Clean SDK Operator interface | Adapters + executor (solid, less “SDK-shaped”) | Learn packaging clarity |
| Observe→Act loop | Explicit multi-turn screenshot history | Batch actions per tool call + mid re-L2 | Absorb **discipline**, not full loop rewrite |
| Thought visibility | Always in model output | Experimental `raw` exists but **not** shown in re-L2 caption | **Absorb** |
| Human takeover | pause / CALL_USER / Take control | estop + confirm + re-L2 (good, under-documented as “takeover”) | Docs + caption UX |
| Training flywheel / RL | Core research contribution | Out of product scope | Do **not** absorb |
| Docs | Action space + coordinate guides + quick start | Strong ADRs/user guides | Steal **action-space clarity** |

---

## 4. Absorbable knowledge (ranked)

### Must absorb (high value, low identity risk)

1. **Action-space literacy** — document `host_computer` action DSL as clearly as UI-TARS COMPUTER_USE table.
2. **Thought surfacing** — when experimental VLM returns free text / Thought, show a **sanitized** snippet on experimental re-L2 (human decides with more context).
3. **Robust coordinate parse** — accept UI-TARS-like `click(point='x y')` / `start_box='(x,y)'` in experimental raw, without abandoning clamp-only normalize (L-QW-3).
4. **Observe-act-observe playbook** for the **chat LLM** (not a second agent): plan short steps, prefer structure, re-screenshot/describe when unsure, aggregate same-app actions.
5. **Operator mental model** in architecture docs: map capturer/injector/uia ↔ Operator ports (documentation only unless refactor earned).

### Nice later (Phase 2 backlog)

6. Optional **UI-TARS-1.5-7B** as alternate experimental locator (download catalog + prompt template) — heavy weights, license UX, GPU; not blocking 0.5.x.
7. Sliding screenshot history into experimental locate (multi-frame) — cost + privacy; needs own dual-review.
8. Explicit `call_user` tool semantics — mostly covered by confirm/estop; only if UX research demands.

### Do **not** absorb

- Replace hybrid locate with pure-vision default.
- Skip L2 / hard-deny because “benchmarks go up when freer”.
- Port GUIAgent as parallel product agent that bypasses confirm center.
- Vendor large UI-TARS code without license attribution or as dependency of Companion core.

---

## 5. Architecture judgment

**UI-TARS architecture is excellent as a *native GUI agent research + SDK* stack.**  
**It is not a drop-in better architecture for CMspark’s product thesis.**

CMspark should:

- Keep **tool-loop + hybrid locate + trust gates**.
- Steal **loop discipline, parse robustness, Thought UX, docs clarity**.
- Optionally later **plug** UI-TARS weights into the existing experimental slot (same G4 re-L2).

---

## 6. Evidence levels

| Claim | Level |
|-------|-------|
| UI-TARS / Desktop repos exist and roles as above | [inspected] public README + tree + GUIAgent.ts |
| Action DSL + prompt templates | [inspected] `codes/ui_tars/prompt.py`, action_parser |
| CMspark locate chain / experimental re-L2 | [inspected] `locate-chain.ts`, `executor.ts`, ADR-017 |
| Benchmark numbers on README | [assumed] as published by upstream; not re-run locally |
| “raw not shown in re-L2” | [inspected] chain drops `outcome.raw`; caption hardcodes target only |

---

*Next: multipath product design → path lock → implementation.*
