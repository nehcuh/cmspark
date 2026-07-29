I have enough grounding to deliver the verdict. The brief is a doc-only DRAFT (no code changes); I cross-checked it against ADR-014/015/016/017/018/019, the UI three-mode spec, `docs/architecture.md`, and `README.md`.

---

## 1. Executive summary

- The patch is **doc-only**: it adds `docs/decisions/capability-model-three-axes-brief-2026-07-29.md`, the review prompt, and a stale-diff snapshot file. No code, no test, no ADR-020 yet — brief self-declares `DRAFT for dual review → promote on consensus`.
- `git status` matches the patch file; patch is not stale.
- The brief is **architecturally sound and consistent** with shipped design: ADR-014 (Pack ≠ runtime), ADR-015 (worker = sub-Thread; tab lease; spawn = L2 HITL; `WORKER_HARD_DENY` list), ADR-016 (Board = shared Fact/Intent/Hint state), ADR-017 (`god-mode/auto_approve` never skips task L2; CU experimental locator not a write-success dep), ADR-018 (Host opaque TargetId, L2, vault blacklist), ADR-019 (user-env). All citations I checked resolve correctly.
- The three-axis ontology (Surface / Composition / Autonomy) does reduce "杂" better than the owner's flat four-layer story, because the latter conflates composition with depth (the brief's §2 correction is the right call).
- No blocking issues. Nits below.

## 2. Answers Q1–Q6

**Q1.** Three axes is the right minimal set. Trust is **not** orthogonal to Surface — brief §3 Axis A rule 2 itself says trust rises monotonically with Surface — so promoting it to a peer axis would create a 4-D matrix that mostly correlates with Axis A. Channel is a binary install-time label (`community` / `enterprise`) that rides on capability modules. Keeping both as mandatory **labels** (§3 cross-cutting) is the right call; do not promote either to a 4th axis.

**Q2.** Mission Board should **single-home under Autonomy**. Structurally it is shared state for coordinating workers (ADR-016 §1.3 — "单线程即可先用真板；多 agent Intent claim 后置"). It does not "stack onto" L0/L1/L2 the way Skill/Knowledge/MCP do. The §4 footnote offering dual-home "if docs need one box" is fine as a layout escape hatch, but the ADR body should keep it under Autonomy.

**Q3.** Safe **with a hard editorial rule**: the README may use 主体→浅→中→深 as a product *narrative*, but the word "中层 Agent" (mid-layer Agent) must never appear unqualified — every occurrence must be inline-corrected to "中层 = 组合面 (Composition)" or "中层 = Skill/Knowledge/MCP/Pack 的装配". A bare footnote is not enough; readers skim prose, not footnotes. If the team cannot commit to that editorial discipline, prefer the three-axis phrasing as primary and keep the four-layer map as a one-line aside.

**Q4.** Obsidian export / NotebookLM / Mermaid should stay **product features**, not Composition primitives — they are rendering/export affordances of the chat surface, not capabilities that assemble onto Surfaces. Nothing obvious is missing from the Composition list. (One could argue `tool_whitelist` is a primitive, but it's already bundled inside Pack — fine.)

**Q5.** No blocking issues. Doc-only DRAFT, citations verified, no topology change.

**Q6.** **(B) is safer for users.** Keep the current deliverable matrix (concrete "what can I do") and add a short ontology section above it. Option (A) forces users to learn abstract axes before they reach concrete features; that's an IA regression for a Side Panel product. The three-axis table belongs in `docs/architecture.md` and the ADR, not as the README hero.

## 3. Agreement with §10 proposed decisions (1–5)

1. **Accept** three-axis model — agree.
2. **Accept** owner four-layer story as user-facing narrative mapped to §2 — agree, conditional on Q3 editorial rule.
3. **Reject** "中层 Agent" as architecture term — strongly agree; this is the brief's most important correction.
4. **Accept** Pack-first stacking + declaration checklist + governance metrics — agree; §6 checklist is the actionable artifact.
5. **Authorize** §9 doc updates after dual APPROVE — agree, with one amendment (§9 row for `docs/README.md` should also remove the stale "拟议 019 UI" string at `docs/README.md:65`, not just the ADR-019 mislabel; the brief mentions ADR-019 but does not call out the "拟议" line explicitly).

## 4. Blocking issues

None.

## 5. Non-blocking nits

- **§3 Axis A — L0 row** says "optional page extract as *data*". The phrase "*as data*" is not defined; readers may read it as license to inject arbitrary page content into the LLM context. Suggest one clause: "page content enters as user-attached text, not via browser tool calls" — i.e. the L0 boundary is *no CDP tool calls*, not *no page content*.
- **§3 Axis A rule 3** ("Linux / incomplete host paths stay documented as pending") should name the authoritative source — cross-link `ADR-018 § Decision 6` ("linux 部分 RUNBOOK / nonce，写路径受限") so future readers don't have to hunt.
- **§5 scenario row "Datayes 高级投研 = L0 (+ occasional L1)"** is ambiguous. If a Skill/MCP drives a browser (e.g. Datayes web scraping), the active surface during the scrape is L1, not L0. Recommend phrasing: "L0 baseline; L1 only when a Skill/MCP issues browser tools."
- **§6 declaration checklist** mixes level and capability on the Surface line (`L0 | L1 | L2 | host_read | host_write | host_app | shell | netsec | mcp`). This conflates Axis A levels with L2 sub-capabilities. Cleaner: split into `Surface: L0|L1|L2` and `Surface-capabilities: host_read|host_write|host_app|shell|netsec|mcp|…` — or note explicitly that L2 carries the sub-cap list.
- **§8 row "ADR-017/018 | Axis A L2 + trust rules"** is accurate but slightly understates: ADR-017 also owns the **session-trust** label that §3 cross-cutting table lists ("session-trust · biometric/nonce"). Worth a one-word cross-reference so session-trust is visibly anchored.
- **§9 doc plan** marks `OUT OF SCOPE: CapabilityLevel already exists in UI` — verified (UI spec §3.1 `CapabilityLevel: chat | browser | computer`). Good. Add a one-liner that ADR-020 must explicitly state the L0/L1/L2 product labels *alias* the UI `CapabilityLevel` enum values, so a future UI rename does not silently desync the ontology from the code.
- **§7 governance metric "Count of new WS message families / runtimes"** — good, but no baseline number is offered. Suggest seeding it with the current count from `docs/architecture.md §1.3` so the metric is measurable from day one.
- Minor: the diagram in §4 puts `Board*` in the Composition plane box with a footnote that says "prefer Autonomy in ADR body." That dual placement visually contradicts the answer to Q2. Move Board out of the Composition box in the diagram and leave the footnote.

## 6. Doc plan §9

**Accept with the amendments above** (stale `docs/README.md:65` "拟议 019" line also removed; ADR-020 must alias `CapabilityLevel`; seed governance metric with a baseline).

VERDICT: APPROVE_WITH_NITS
