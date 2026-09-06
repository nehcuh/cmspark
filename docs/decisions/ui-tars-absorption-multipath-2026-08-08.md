# Multipath product design: UI-TARS absorption

> **Date**: 2026-08-08  
> **Research SoT**: [../research/ui-tars-absorption-2026-08-08.md](../research/ui-tars-absorption-2026-08-08.md)  
> **Status**: Path **C** **SHIPPED** (implementation + dual review)  
> **Blast tier**: T1–T2 (parse + prompt + docs + experimental caption; no new Surface, no L2 bypass)  
> **Reviews**: path Pi (path OK, impl REJECT then fixed) · impl Claude **APPROVE** · impl Pi r2 **APPROVE_WITH_NITS**  
> Artifacts: `docs/audit/reviews/ui-tars-path-c-*`

---

## 0. Capability declaration (ADR-020)

```text
Surface:      L2 Computer Use experimental locate only (no new tool surface)
L2-classes:   experimental re-L2 caption enrichment only (still force-interactive)
Compose:      none (no Pack/MCP change)
Autonomy:     single (no worker host_computer change)
Trust:        monotonic — more human context on experimental gate; never auto-inject
Channel:      community
```

---

## 1. Problem / JTBD

User asks: UI-TARS claims excellent computer-use — what should CMspark learn, and should we redesign?

| Actor | Pain | Desired |
|-------|------|---------|
| Product | Risk of cargo-culting pure-vision agents and eroding trust model | Clear absorb vs reject list |
| CU users | Experimental click suggestions opaque (“why this pixel?”) | Thought snippet + robust parse |
| LLM agent | Weak observe-act discipline vs GUI agents | Explicit playbook in system prompt |
| Maintainers | No map between Operator SDK and our adapters | Architecture note |

---

## 2. Four paths (adversarial)

### Path A — Swap / add UI-TARS-1.5 weights as experimental locator

- **Shape**: Catalog download + UI-TARS prompt + action_parser style → same G4 re-L2 slot as Qwen3-VL.
- **Pros**: Grounding SOTA-ish; brand narrative “we run UI-TARS too”.
- **Cons**: Large weights, GPU/RAM, license UX, dual model maintenance; Qwen3-VL already occupies the slot; **does not** fix hybrid/security identity.
- **Risk**: Users enable pure vision, skip UIA/OCR mental model, higher wrong-click rate on structure-rich apps if chain order changes.
- **Verdict score**: usefulness 6 / cost 8 / risk 6 → **later backlog**.

### Path B — Port GUIAgent loop as “Native GUI Mode”

- **Shape**: Parallel agent: screenshot history → VLM → Operator → UI; optional confirm overlay.
- **Pros**: Matches UI-TARS product shape; demo wow.
- **Cons**: Second runtime vs ADR-020 “one tool-loop”; high chance of trust regression; Cockpit/thread/MCP integration rewrite; multi-month.
- **Risk**: Critical — bypass or dilute L2/corpus/hard-deny.
- **Verdict score**: usefulness 5 / cost 10 / risk 9 → **REJECT for 0.5.x**.

### Path C — Pattern absorption (recommended)

- **Shape**: Keep architecture; ship:
  1. Research + multipath SoT (this family of docs)
  2. Robust experimental raw parse (UI-TARS-like action strings)
  3. Pass experimental `raw` → extract Thought → sanitized re-L2 caption
  4. Chat LLM CU playbook (observe-act-observe, structure-first)
  5. User guide + architecture “vs pure vision GUI agents” + Operator map
  6. Unit tests for parse/thought/sanitize
- **Pros**: High learning density; preserves trust; ships overnight; aligns ADR-017.
- **Cons**: No headline “we integrated UI-TARS model”; modest benchmark delta.
- **Risk**: Low — caption length/spoofing must reuse `sanitizeComputerCaption`.
- **Verdict score**: usefulness 8 / cost 3 / risk 2 → **SELECT**.

### Path D — Docs-only

- **Shape**: Research note only; no code.
- **Pros**: Zero risk.
- **Cons**: Leaves known gap (raw dropped; prompt weak).
- **Verdict score**: usefulness 4 / cost 1 / risk 0 → inferior to C.

---

## 3. Adversarial pressure on Path C

| Attack | Mitigation |
|--------|------------|
| Thought text forges system lines in confirm UI | `sanitizeComputerCaption` + length cap (~160 chars) + prefix label |
| Parsing wrong action injects without re-L2 | Parse only affects **point extraction**; inject still G4 + A1 |
| Relative 0–1000 rescale regression | Keep L-QW-3 clamp-only; UI-TARS smart_resize **not** ported as default |

> **⚠️ L-QW-3 已于 2026-09-07 修订（#423）**：本行描述的 clamp-only 裁决建立在「模型输出绝对像素」的错误前提上。官方 cookbook + 本机探针实证（always-map mean err 11.9px vs 绝对像素假设 364px）证明 Qwen3-VL **恒输出原图相对坐标 [0,1000]**——包括恰好落在像素界内的值。新裁决：恒映射 `px = round(v/1000·W)` 后 clamp（clamp 仅作 >1000/负值安全网，不再是空间判别器）。数组形态 `{"x":[x,y],"y":[y]}` 取 `(x[0], x[1])`（d9 反例钉死 y 拷贝不可靠）。同步点：`qwen-vl-worker.py::_normalize/_parse_point` · `qwen-vl-coords.ts::normalizeQwenVlPoint` · `gui-action-parse.ts::parseGuiClickPoint`。证据：`.tmp/lane-status/423-{empirical-grok,research-pi,spec-claude}.md`（评测门 0/10 → 6/10，余 4 例为模型感知误差）。
| Prompt bloat confuses non-CU tasks | CU playbook only in host_computer-adjacent rules; short bullets |
| Over-claim “we are UI-TARS class” | Docs state absorption ≠ model parity |

---

## 4. Path lock

**Selected: Path C — Pattern absorption.**

Phase 2 backlog (not this PR): Path A optional weights; multi-frame experimental history; explicit CALL_USER product study.

**Pi gate (path)**: confirm Path C selection and scope before code lands; if Pi REJECT path, stop and re-open multipath.

---

## 5. Implementation stages (do not stop mid-flight)

| Stage | Deliverable | Done when |
|-------|-------------|-----------|
| S1 | Research + multipath docs | Files in `docs/research` + `docs/decisions` |
| S2 | `gui-action-parse.ts` + tests | Parse Thought + UI-TARS-like points; no false 0–1000 scale |
| S3 | Worker `_parse_point` + chain/executor wire | raw→thought in experimental re-L2 caption |
| S4 | LLM adapter CU playbook | System prompt rules updated |
| S5 | User guide § + architecture §9 note | Cross-links to research |
| S6 | Pi completion review | APPROVE* |
| S7 | Dual Claude+Pi on diff | both APPROVE* |
| S8 | PR → CI green → merge main | merged |

---

## 6. Non-goals (this PR)

- New tools / new confirm dialects / god-mode changes  
- Replacing Qwen3-VL catalog with UI-TARS weights  
- GUIAgent second runtime  
- Linux CU expansion  

---

*Path C implementation follows immediately after Pi path confirmation.*
