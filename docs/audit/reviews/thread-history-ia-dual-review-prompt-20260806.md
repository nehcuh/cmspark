# Dual external review: Thread History IA product design

**Batch:** `thread-history-ia`  
**Stage:** Product / UX / architecture **design SoT only**（尚未实现；评审通过后再开发）  
**Date:** 2026-08-06  

## Capability declaration

```text
Surface:      L0 chat UX / thread navigation metadata only
L2-classes:   (none) — no CU/Host/Apps/shell/netsec tools
Compose:      none new — digest/tags are Thread index metadata, NOT Skill/Knowledge/Pack
Autonomy:     must align with multi-agent: worker threads display/cleanup policy
Trust:        batch_delete MUST preserve releaseTrustBeforeThreadGone (same as single delete)
Channel:      community | enterprise unchanged
```

## Documents (read these with tools)

1. **Primary SoT:** `docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md`（全文必读）
2. **Ontology:** `docs/adr/020-capability-model-three-axes.md`（§1–3 叠加纪律）
3. **Existing summary export:** `docs/adr/008-obsidian-export.md`（digest vs export 边界）
4. **Current UI:** `chrome-extension/src/sidepanel/components/ThreadList.tsx`
5. **Thread model / delete:** `companion/src/threads/thread-manager.ts`（list/delete/cleanupEmpty）
6. **Trust release on delete:** grep `releaseTrustBeforeThreadGone` in companion
7. **Summary pipeline (reuse candidate):** `companion/src/threads/summary-export.ts`（skim）
8. **Input popover pattern:** `chrome-extension/src/sidepanel/components/SlashCommandPopover.tsx`（@ 对称参考）

## Context

- Side Panel ~320px；ThreadList 目前是扁平列表 + 单删 + 清空白 + 生成标题 + Obsidian 摘要下载。
- 用户痛点：历史会话变多后 **找 / 连 / 清** 困难。
- 设计提案分期：
  - **P0:** 今日平铺 + 历史月/日折叠；层级多选批量删除；本地搜索
  - **P1:** ThreadDigest（tldr/tags/bullets）+ Tag 视图；定期抽取默认 off
  - **P1.5:** `@` 引用其他会话（默认 summary_card 注入）；规则清理助手；回收站
  - **P2:** AI 冗余建议；Related/脑图
- 设计主张：**时间是默认轴，标签是检索轴，图谱是探索轴**；AI 只建议不自动删。

## Your job

Independent senior **product + UX + architecture** review. **Do not rubber-stamp.**  
Ground claims in the design doc + real code paths above.

### Check dimensions

1. **User-job fit** — 找/连/清是否真正被覆盖；默认视图是否正确  
2. **Gaps / underspec** — 哪些交互、边界、失败态、空态没写清，会卡住实现  
3. **Architecture fit** — index digest 是否合理；与 ADR-008 export / Knowledge / Pack trust 是否冲突或双写  
4. **ADR-020 integrity** — 是否偷偷引入 Composition 原语或 L2；是否 Pack-first 违规  
5. **Security / privacy / cost** — 批量删、@ 注入、定时 LLM、敏感 tags  
6. **Multi-agent** — worker/orchestrator/board 线程在时间线、批量删、冗余扫描中的处理是否够  
7. **P0 scope realism** — 是否过大/过小；是否应把某项提前或后移  
8. **Narrow panel UX** — 300px 内多视图/多选/组头勾选是否可操作  
9. **Protocol & data model** — `batch_delete` / digest / trash / context_refs 是否可实现且可测  
10. **Open questions (§7)** — 是否有应在开发前强制拍板的项  

### Adversarial personas (at least touch each)

- Confused power-user with 200+ unnamed threads  
- Security-conscious user fearing silent AI deletion / cross-thread leak  
- Multi-agent user with orchestrator + many workers  
- Cost-sensitive user with expensive API keys  
- Implementer reading the spec cold tomorrow morning  

## Output format (strict)

```markdown
## Summary
(2–4 sentences)

## What holds
- …

## Gaps / underspec (would block clean implementation)
- …

## Product / UX issues
- …

## Architecture / ADR-020 / security
- …

## P0 scope verdict
(too big / right-sized / missing must-haves)

## Blocking (must resolve before coding P0)
- B1: …

## Nits (non-blocking; can fix in-spec or during impl)
- N1: …

## Recommended pre-dev decisions
- …

VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT
```

### Verdict guidance

- **APPROVE** — P0 可直接按文档开工，无必改项  
- **APPROVE_WITH_NITS** — 可开工，但 Blocking 为空；nits 应写入修订或实现 checklist  
- **REJECT** — 存在 Blocking：概念错误、安全漏洞设计、范围不可落地、与 ADR 冲突等；必须改 spec 后再审  

End with exactly one line: `VERDICT: …`
