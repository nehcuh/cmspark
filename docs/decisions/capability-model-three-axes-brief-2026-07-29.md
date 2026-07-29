# Brief: CMspark Capability Model — Three Orthogonal Axes

| Field | Value |
|-------|--------|
| Date | 2026-07-29 |
| Status | **ACCEPTED** → [ADR-020](../adr/020-capability-model-three-axes.md) · [synthesis](capability-model-three-axes-synthesis-2026-07-29.md) · dual-review both APPROVE_WITH_NITS |
| Authors | Grok (synthesis of owner product map + existing L0/L1/L2 / Pack / Orchestrator) |
| Related | UI three-mode spec; ADR-014 Pack; ADR-015/016 multi-agent; ADR-017/018 CU/Host; GOAL G10–G14 |
| Non-goal | New runtime, new WS family, or UI rewrite in this ADR |

---

## 0. Why this document

Product surface has grown: CDP tools, Skills, Knowledge, MCP, Packs, enterprise modules, Computer/Host/Apps, multi-agent, Board, exports, NotebookLM, user-env secrets…

**Symptom:** features feel “many and mixed.”  
**Risk:** each new scenario invents a parallel concept (new panel, new agent type, new confirm dialect).  
**Intent:** lock a **stable ontology** so future work stacks along clear axes — same spirit as owner’s map:

> 主体（浏览器内 AI / 网页问答）→ 浅层（浏览器操作）→ 中层（MCP / Skill / Know 等整合）→ 深层（Computer Use + 前述能力）

This brief **affirms** that map as product narrative, and **refines** it into three **orthogonal** architecture axes so “中层” is not mistaken for a third runtime.

---

## 1. One-sentence product positioning

> **Default:** browser-native Agent (chat → page control).  
> **Opt-in deeper surfaces:** desktop host / enterprise modules.  
> **Scenario stacking:** Mission Pack (+ Skill / Knowledge / MCP) — **not** a new runtime.

---

## 2. Owner four-layer map → architecture mapping

| Owner product layer | Architecture home | Notes |
|---------------------|-------------------|--------|
| **主体** — 浏览器内 AI，网页问答 | **Surface L0** + read-only page context | Entry UX; low control blast radius |
| **浅层 Agent** — 截图、页签、浏览、页内操作 | **Surface L1** (CDP / tabs / cookies / evaluate-with-gate) | Browser sandbox only |
| **中层** — MCP、Skill、Know、外部 API | **Composition plane** (not a deeper Agent) | Assembles intent + tools + memory onto any Surface |
| **深层 Agent** — Computer Use + all prior | **Surface L2** (+ Host / Apps / enterprise modules) **×** composition | Wider world + stricter trust; same LLM tool-loop |

**Key correction (proposed normative rule):**  
Calling MCP/Skill/Knowledge a “中层 Agent” confuses **composition** with **surface depth**. Those are plugins/memory/method libraries that can attach to L0, L1, or L2.

---

## 3. Three orthogonal axes (normative)

### Axis A — Surface（作用面：能碰到哪里）

Physical / trust boundary. Monotonic: deeper ⇒ larger blast radius ⇒ stricter gates.

| Level | Product label | Can act on | Default UI |
|-------|---------------|------------|------------|
| **L0** | 聊 | Conversation, attached files, optional page extract as *data* | Side Panel |
| **L1** | 网页 | Tabs, DOM, navigation, screenshots, cookie trust domain, browser evaluate | Side Panel; user may open Cockpit workspace |
| **L2** | 计算机 | `host_computer`, host_read/write, host_app, shell/netsec (enterprise) | Cockpit (+ optional native HUD) required for live CU |

Rules:

1. **One tool-loop runtime** across surfaces (Companion LLM + tools). L2 is not a second agent framework.  
2. **Trust monotonicity:** L2 must not inherit L0 looseness (god-mode / auto_approve must not silently skip CU task L2 — already ADR-017).  
3. **Linux / incomplete host paths** stay documented as pending; do not pretend parity.

### Axis B — Composition（组合面：如何拼能力）

Assembly, not depth.

| Primitive | Role | Lives in |
|-----------|------|----------|
| **Skill** (Type A) | Method / prompt templates | `skills/`, thread `active_skill_ids` |
| **Knowledge** | Site / global / skill memory | `knowledge/`, injection into context |
| **MCP** | External tool servers | Companion MCP client; `mcp__…` tools |
| **user-env secrets** | Child-process env for shell/MCP | ADR-019 |
| **Mission Pack** | Scenario recipe: skills + knowledge + tool_whitelist + system_prompt_append + modules | ADR-014 — **not a runtime** |
| **Capability modules** | Install-level enable (appsec / workspace / shell / netsec) | config `capability_profile` |

Rules:

1. **Preferred stacking path for new scenarios:** Pack (+ optional one skill and/or one MCP server).  
2. **Pack must not** write `auto_approve_dangerous` / god-mode / other global relax keys (ADR-014).  
3. **Composition applies on any Surface** — e.g. Datayes research = mostly L0 + composition; AppSec black-box = L1 + Pack; desktop fill form = L2 + skills.

### Axis C — Autonomy（自主度：谁在跑、跑多久）

| Level | Meaning | Status |
|-------|---------|--------|
| **Single-thread tool loop** | One thread, sequential tools | Core |
| **Multi-worker + tab lease** | Orchestrator, exclusive tabs | P0 shipped (ADR-015) |
| **Mission Board** | Shared Fact/Intent/Hint | P0 shipped (ADR-016) |
| **Deferred** | shared-observer, auto-spawn, true `wait_workers` barrier, free-text ask_user | Explicitly deferred |

Rules:

1. **High autonomy ≠ deep surface.** Multi-worker page crawl can be L1-only.  
2. **Spawn remains L2 HITL** (explicit user confirm), not silent fan-out.

### Cross-cutting — Trust / Channel

Not a fourth “agent layer,” but mandatory labels on every capability:

| Dimension | Values |
|-----------|--------|
| Trust gate | none · domain confirm · L2 confirm · session-trust · biometric/nonce · enterprise session trust |
| Channel | `community` · `enterprise` |

---

## 4. Target mental model (diagram)

```text
                    ┌─────────────────────────────────┐
                    │      Composition plane          │
                    │  Skill · Knowledge · MCP        │
                    │  Pack · user-env · (Board*)     │
                    └───────────────┬─────────────────┘
                                    │ attaches to any surface
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
     ┌─────────┐              ┌─────────┐              ┌──────────┐
     │ L0 聊   │─────────────▶│ L1 网页 │─────────────▶│ L2 宿主  │
     │ Q&A     │   when needed│ CDP/Tab │    opt-in    │ CU/Host  │
     └─────────┘              └─────────┘              └──────────┘
          │                         │                         │
          └─────────────────────────┴─────────────────────────┘
                                    │
              Autonomy: single loop → workers → board
              Trust:    strictness rises with Surface; Pack cannot relax globals
```

\* Board is primarily Autonomy; may be listed under composition for “shared state” only if docs need one box — prefer Autonomy in ADR body.

---

## 5. Scenario placement (examples)

| Scenario | Surface | Composition | Autonomy | Notes |
|----------|---------|-------------|----------|--------|
| 网页问答 / 写作 | L0 | optional skill | single | Core entry |
| 填表、抓取、多 tab 浏览 | L1 | optional skill/knowledge | single or multi-worker | Shallow agent |
| **AppSec / 黑盒 checklist** | L1 | **Pack** + skills | single (or workers) | Advanced **reuse**, not new runtime |
| **Datayes 高级投研** | L0 (+ occasional L1) | **Skill + MCP/API + knowledge** | single | Advanced reuse on composition axis |
| 读 Mail / 开白名单 App | L2 host | optional | single | Host Use |
| 坐标点击自绘桌面应用 | L2 computer | optional skill | single | CU; experimental layers stay experimental |
| 并行调研多站点 | L1 | pack/skills | multi-worker + board | Autonomy up, surface still L1 |

**Normative claim:** “高级” often means **composition quality** (recipe, data contracts, checklists), not L2 depth.

---

## 6. Capability declaration checklist (for every new PR / Pack / module)

Required fields (doc comment, PR body, or pack.yaml `x-cmspark` notes):

```text
Surface:   L0 | L1 | L2 | host_read | host_write | host_app | shell | netsec | mcp
Compose:   skill | knowledge | mcp-server | pack | user-env | none
Autonomy:  single | multi-worker | board
Trust:     <gate>
Channel:   community | enterprise
```

**Anti-patterns (reject in review):**

1. New top-level Side Panel IA entry without Pack alternative.  
2. New confirmation dialect when existing L2 / domain / CU gates suffice.  
3. New “agent type” runtime when tool_whitelist + skill + pack would do.  
4. Treating experimental locators (e.g. TinyClick) as write-path success dependency.

---

## 7. Governance metrics (“杂”的止血指标)

Watch quarterly (or per major release):

| Metric | Intent |
|--------|--------|
| Count of **primary** UI entry points | Prefer BottomBar「更多」 / Pack over new permanent chrome |
| Count of **distinct confirm semantics** | Prefer reusing SecurityConfirmationManager families |
| Count of **new WS message families / runtimes** | Prefer Pack + tools |
| Docs: scenario guide vs architecture axis | User docs by scenario; arch by axes |

---

## 8. Relationship to existing artifacts (no contradiction if…)

| Artifact | Relationship |
|----------|----------------|
| UI three-mode L0/L1/L2 | **Axis A product labels** — keep ModeController semantics |
| ADR-014 Pack | Canonical **composition stacking** mechanism |
| ADR-015/016 | **Axis C** implementation |
| ADR-017/018 | **Axis A L2** + trust rules |
| ADR-019 user-env | Composition / secrets for shell·MCP |
| GOAL G10–G14 | Map deferred goals onto axes (SSO→L1+composition; Type B→Autonomy+composition; history replay→Autonomy; Type C skill shape≠orchestrator workers) |
| README capability matrix | Should be **reorganized by axes**, not flat “核心/已交付/进阶” only |

---

## 9. Documentation update plan (after ADR accepted)

| Doc | Change |
|-----|--------|
| **New ADR-020** | This model, normative rules §3–§6 |
| **README.md** | Replace/reshape “核心能力（分层）” with three-axis map + scenario examples; keep install/usage |
| **docs/README.md** | Link ADR-020 under 架构; fix stale “拟议 019 UI” note (019 = user-env already) |
| **docs/architecture.md** | New § “Capability model (three axes)” near top; cross-link surfaces |
| **docs/GOAL.md** | One paragraph: product ontology; tag G10–G14 with Surface/Compose/Autonomy |
| **docs/DESIGN.md** | One line: Mode badges map to Surface L0/L1/L2 |
| **CONTRIBUTING.md** | Checklist: capability declaration fields |
| **User guides** | Optional one-liner “This guide sits on Surface Lx + …” — no full rewrite |

**Out of scope this pass:** moving files into `docs/user/`; rewriting all ADRs; code renames (`CapabilityLevel` already exists in UI).

---

## 10. Proposed decision (for reviewers)

1. **Accept** three-axis capability model as project ontology.  
2. **Accept** owner four-layer story as **user-facing narrative** mapped to §2.  
3. **Reject** “中层 Agent” as architecture term; use **Composition plane**.  
4. **Accept** Pack-first stacking + declaration checklist + governance metrics.  
5. **Authorize** doc updates in §9 after dual APPROVE.

---

## 11. Questions for Claude & Pi (please answer each)

**Q1.** Is three axes (Surface / Composition / Autonomy) the right minimal set, or should Trust/Channel be a first-class fourth axis?

**Q2.** Should Mission Board live under Autonomy only, or dual-home under Composition?

**Q3.** Is the owner “主体→浅→中→深” narrative safe for README, or will it re-introduce the mid-layer-agent confusion even with a footnote?

**Q4.** Any missing primitive that must appear in Composition (e.g. Obsidian export, NotebookLM, Mermaid) — or should those stay “product features” outside the capability model?

**Q5.** Blocking issues before promoting to ADR-020?

**Q6.** README reorg: prefer (A) full three-axis table as primary, or (B) keep current deliverable matrix + add a short ontology section above it?

---

## 12. Review verdict format (required)

End with **exactly one** of:

```text
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```

Before the verdict line: answers to Q1–Q6, blocking issues (if any), non-blocking nits, and whether §9 doc plan is acceptable.
