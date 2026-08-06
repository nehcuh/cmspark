# Dual-review synthesis: Thread History IA product design

**Date:** 2026-08-06 · **Batch:** `thread-history-ia`  
**Reviewers:** Pi (`pi -p`) · Claude (`claude -p`)  
**Stage:** Design SoT only（无实现代码）

## Artifacts

| Role | Path |
|------|------|
| Prompt | `docs/audit/reviews/thread-history-ia-dual-review-prompt-20260806.md` |
| Spec SoT | `docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md` |
| Claude | `docs/audit/reviews/thread-history-ia-claude-20260806-092335.md` |
| Pi | `docs/audit/reviews/thread-history-ia-pi-20260806-092335.md` |
| Verdict JSON | `docs/audit/reviews/thread-history-ia-verdict-20260806-092335.json` |

## Lane verdicts

| Lane | Verdict | Blocking |
|------|---------|----------|
| **Claude** | **APPROVE_WITH_NITS** | 无 |
| **Pi** | **APPROVE_WITH_NITS** | 无 |
| **Synthesis (stricter wins)** | **APPROVE_WITH_NITS** | 无 |
| **both_ok** | **true** | — |

## Agreement (both hold)

1. **方向正确** — 时间默认轴 / 标签检索轴 / 图谱探索轴；P0 = 时间树 + 多选 + batch_delete + 本地搜索。
2. **ADR-020 合规** — L0 only；digest 非 Composition；无 L2；无 Pack-first 违规。
3. **Trust 单调性** — batch 必须 per-id `releaseTrustBeforeThreadGone`（对齐单删）。
4. **安全姿态** — AI 永不自动删；`@` 默认 summary_card；定时抽取默认 off。
5. **P0 范围 right-sized** — 无概念错误或安全设计漏洞；可开工。
6. **复用路径真实** — summary-export / llmExtract / ThreadList / cleanup_empty 广播模式。

## Consensus pre-dev pins（开发前写入规格）

双方分别以 nits 提出，合成后 **必须在 P0 开工前钉死** 的决策：

| ID | Topic | Synthesis decision |
|----|-------|-------------------|
| **P1** | Worker 时间线 | **P0：平铺 + 角色徽标**（orchestrator/worker）；折叠进 P1+。删父时提示是否级联，拒绝级联则孤儿 worker 仍可单独删 |
| **P2** | 运行中线程 | **batch_delete 拒绝** 忙碌线程（前端置灰 + 后端校验）；返回 `failed[]` reason=`thread_busy` |
| **P3** | batch 失败语义 | **best-effort 顺序执行**：每 id `releaseTrust → delete → next`；收集 `ok[]` + `failed[]`；**每成功 id 广播 `thread.deleted`**（对齐 cleanup_empty） |
| **P4** | indexLock | **为 batch_delete 引入** `withIndexLock`；不假装 create/delete 已用锁 |
| **P5** | history.db | **硬删不清 ops**（审计保留，靠现有 30 天 TTL）；规格明示，避免「完全抹除」误解 |
| **P6** | 活跃线程被删 | 复刻 `REMOVE_THREAD`：active 回落到剩余列表首项 / 无则空；清 busy / pinned |
| **P7** | P0 搜索范围 | **alias + id + 首条 user 预览**（无 tags）；首条预览 **提入 P0** |
| **P8** | 面板高度 | 多选激活时 panel **maxHeight ≥ 480** 或改 full-height 抽屉；禁止挤在 320 里 |
| **P9** | 时间分桶 | P0：`今天` + `更早按月→日`；「昨天」**P0.5 必做**；不做「本周」层 |
| **P10** | 多选入口 | **主路径 = 列表头「选择」**；长按/行勾选为可选增强 |
| **P11** | 定时调度 | 纠正「daemon 已有空闲调度」— **无**；P1.5+ 用「打开列表惰性清理」或 companion 轻量 interval，另定 |
| **P12** | fingerprint | `content_fingerprint = ${messages.length}:${lastMessageId \|\| "empty"}` |
| **P13** | `@` 注入（P1.5） | fence 固定；无 digest 时 **fallback-first 发送**（title+首末 user），异步补 digest；合计 ≤1500 tok |
| **P14** | tag 密钥形 | 规范化时拒匹配 `/(sk-|api[_-]?key|password|bearer\s|secret|token)/i` 的 tag 片段 |

## Shared nits（可在实现 checklist，非阻塞）

| ID | Source | Item |
|----|--------|------|
| N-a | Claude | 时区午夜边界单测（`groupThreadsByCalendar`） |
| N-b | Claude | 验收锚点：`threads.batch-delete.test.ts` trust per-id + continue-on-fail + broadcast |
| N-c | Pi | digest stale 仅 Tags / 选中时灰标，避免今天组满屏 |
| N-d | Pi | extract_digest 失败/重试/并发幂等 + 行内 spinner |
| N-e | Pi | 规则型批量起名（首条 user→alias）进 P0.5 |
| N-f | Both | 空态文案：搜索无结果 / 无 tag / 回收站空 |
| N-g | Claude | 整理入口收入 `⋯`，与线框一致 |

## Blocking union

**无。** 双方 Blocking 均为空。

## Synthesis recommendation

| Question | Answer |
|----------|--------|
| 设计方向是否可进开发？ | **是** |
| 是否需再开一轮外审？ | **否**（修订 pins 进 SoT 后即可） |
| 开工前必做 | 将上表 P1–P14 写入设计 SoT §「Pre-dev pins」 |
| 建议首切片 | **Slice A = P0**：Timeline + 首条预览 + 多选 + batch_delete（含 trust/busy/broadcast） |

## Next steps

1. ~~双路外审~~ ✅ both `APPROVE_WITH_NITS`
2. 规格并入 Pre-dev pins（本合成后立即）
3. 用户确认 → 开工 Slice A
4. Slice A 完成后可再 dual-review **实现**（非设计）

---

*Generated from Claude + Pi independent reviews, 2026-08-06.*
