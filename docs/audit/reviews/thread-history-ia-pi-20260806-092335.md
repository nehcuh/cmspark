## Summary

设计文档质量高：现状锚点与真实代码一一对得上（`ThreadList.tsx` 扁平 300px、`index.json` 无 digest/trashed 字段、`thread.delete`/`cleanup_empty` 已接 `releaseTrustBeforeThreadGone`、`summary-export.ts` 的 `buildSummaryTranscript`/`parseSummary` 可复用），分期与 ADR-020 纪律扎实。P0（时间树 + 本地搜索 + 层级多选 + `batch_delete` + trust 释放）范围适中、可落地，无概念错误或安全设计漏洞；发现若干会卡实现的欠规格点（history.db 硬删语义、运行中线程删除、worker 时间线放置规则、不存在的"空闲调度 daemon"），均可在修订/实现清单内解决，不阻塞开工。

## What holds

- **"找"** 用 `updated_at` 归桶"今天"正确（对应代码 `addMessage` 每次 bump `updated_at`）；本地搜索不依赖 LLM，P0 无 tags 时过滤 alias/id 仍可用。
- **"清"** 的 `batch_delete` 协议与既有代码路径对齐：`withIndexLock` 强制（`thread-manager.ts` 已有该原语）、单次上限 50、`thread.batch_deleted` 广播（镜像 `cleanup_empty` 的 `session.broadcast` 模式）、每个 id 走 `releaseTrustBeforeThreadGone`（`message-router.ts:1080` 单删已这么做，S46 测试 `packs-engine.test.ts:441` 可作验收锚点）。
- **ADR-020 完全合规**：能力声明齐全且正确（Surface L0 / L2 无 / Compose 无 / Autonomy 多线程对齐 / Trust 保持 / Channel 不变）；附录 B 显式拒绝 digest-as-Knowledge 隐式双写；无新确认方言（删除确认仍是 UI modal，非 companion `securityConfirmations.request`，故 originWs 不适用）；是既有 ThreadList 入口的再设计，非新增一级常驻入口，无 Pack-first 违规。
- **成本护栏到位**：digest 手动优先、定时默认关、`max_per_day: 20`、≤800 tok out、`@` 合计 ≤1500 tok、规则清理零 LLM、禁止默认全库扫描。
- **多代理与安全**：worker 默认折叠 + 删父级联提示 + 冗余扫描默认排除 worker；`@` 注入走 data 段 fence、禁止默认 full；tag 归一化规则（小写/去重/≤8/长度/控制字符）可测。

## Gaps / underspec (would block clean implementation)

- **`batch_delete` "硬删" 语义漏了 SQLite op-history**：`history/store.ts` 无按 thread_id 的删除/清理方法（仅 30 天 TTL `purgeOldRecords`），`thread.delete` 也不清它。P0 若宣称"硬删"，`history.db` 仍保留该线程操作记录 30 天——对安全敏感用户是隐性留存。需在 C.2/D 明示：硬删是否按 thread_id 清除 ops 行（或明确"审计日志保留"是有意为之）。
- **运行中线程可被批量删**：正在跑 LLM 循环的 worker/orchestrator 若被 `batch_delete` 命中，`addMessage` 会重建一个孤儿 `{id}.json` 且 index 无条目（现有单删同样存在，批量放大）。规格应规定：拒绝/排除正在运行的线程（前端置灰 + 后端防护）。
- **worker 折叠与时间轴冲突**（§7 Q2 建议"折叠于 orchestrator 下"）：时间树按 updated_at 归桶，而 worker 常比 orchestrator 新——"nest 到父下"和"按时间入桶"二者矛盾，放置规则未写。删父时用户拒绝级联后，孤儿 worker 也无政策（显示何处/是否可单独删）。P0 至少需一条最小规则（如 P0 平铺+worker 徽标，P1.5 再折叠）。
- **"companion 空闲调度（daemon 已有）"与事实不符**：`daemon.ts` 是 UDS 锁/PID 管理，非空闲任务调度器；companion 中无 idle-job 机制。定时抽取（P3）与回收站 30 天 TTL 清理（P1.5）都没有承载点——需新增轻量调度或"列表打开时惰性清理"，规格未定。
- **`extract_digest` 失败态未写**：LLM 超时/降级时 UI 行为、重试、并发同名线程重复抽取（`on_at_ref` 两次触发）；前端需镜像 `summarizingThreadId` 的行内 spinner 模式。
- **`@` fallback 顺序**："先同步跑轻量 digest"会给发送路径加 2–10s LLM 延迟；应改为"先 fallback（title + 首末 user 消息）发送，异步补 digest"。
- **REMOVE_THREADS store action 必须复刻单删逻辑**：`agentStore.tsx` 的 `REMOVE_THREAD` 处理了 active 线程回落 + `threadBusyById` 清理 + pinnedTabIds 重置，批量版需一致，否则删活跃线程后 UI 悬空。

## Product / UX issues

- 200+ 未命名线程场景下，P0 搜索按 alias 几乎无效（全是"未命名 · xxxx"）。建议把 P0.5 的"首条 user 消息预览"提到 P0，并在 P0.5 加规则型批量起名（首条 user 消息截断为 alias），成本极低、收益最大。
- 300px 头部将挤进：搜索 + `[时间|标签]` + `选择` + `+新建` + `⋯`——设计已把 生成标题/清理空白 收入 `⋯`，方向对；需验收触达目标 ≥28px 且长按/勾选图标不与行点击手势冲突（现有 `ThreadList.tsx` 有 `userSelect`/selection 防误触逻辑，多选模式要保住）。
- 组头（今天/日/月）勾选 + 计数 + 展开箭头同排，indeterminate 态需 ARIA 语义；"昨天"建议从"可选"改为 P0.5 必做（成本≈0，高频价值）。
- digest stale 规则与"今天"组冲突：`addMessage` 每次 bump 消息数/指纹 → 今天组内几乎所有线程即时 stale。需定义展示规则（如仅 Tags 视图标 stale，或选中线程时才提示），否则 P3 的"灰标"在默认视图天天满屏。

## Architecture / ADR-020 / security

- 无 Blocking。Composition 面零引入（digest = L0 索引元数据，ADR-008 先例）；无新确认方言；trust 单调性保持（batch 逐 id 释放与单删一致，建议 P0 加一条镜像 `packs-engine.test.ts:441` 的批量释放测试）。
- digest 内容（tldr/tags）会被 `@` 注入与 AI 清理建议送进 LLM——属于用户发起的 L0 数据流，合理，但建议在 D 段显式写明"digest 默认仅在用户触发时出本地"，闭环隐私叙事。
- 成本、敏感 tag 正则、0o600 index（实测 `-rw-------`）均 OK。

## P0 scope verdict

**right-sized**。Timeline + 搜索 + 多选 + `batch_delete`（含 trust 循环、限 50、广播）+ store + 测试 ≈ 一次迭代，无过载项；搜索保留在 P0 合理。唯一建议：首条 user 预览提入 P0（0.5 成本，未命名场景刚需）。

## Blocking (must resolve before coding P0)

- 无。

## Nits (non-blocking; can fix in-spec or during impl)

- N1: 硬删时 `history.db` 操作记录的去留需在 C.2/D 明示（purge by thread_id 或注明"审计保留 30 天"）。
- N2: `batch_delete` 排除/拒绝运行中线程（前端置灰 + 后端校验）。
- N3: 写清 worker 的时间线放置与孤儿政策（P0 最小规则：平铺 + 徽标；P1.5 折叠 + 级联确认）。
- N4: 修正"daemon 已有空闲调度"表述；为定时抽取/回收站 TTL 指定承载（companion interval 或惰性清理）。
- N5: `@` 无 digest 时先 fallback 发送、异步补抽取，避免阻塞发送。
- N6: `REMOVE_THREADS` 复刻 `REMOVE_THREAD` 的 active 回落 + busy 清理。
- N7: 定义 digest stale 展示规则（避免默认视图满屏灰标）。
- N8: `extract_digest` 失败/重试/并发幂等 + 行内 spinner（镜像 `summarizingThreadId`）。
- N9: 首条 user 预览提 P0；规则型批量起名进 P0.5。
- N10: 补空态（搜索无结果 / 回收站空 / 无 tag）+ restore 确认文案。
- N11: "昨天"组定为 P0.5 必做。

## Recommended pre-dev decisions

1. `batch_delete` hard 模式对 `history.db` 的处理策略（写进 C.2/D）。
2. 运行中线程删除防护（拒绝 vs abort）——P0 前定，牵涉协议层校验。
3. §7 Q2 的 worker 放置规则给出具体算法（P0 先用"平铺 + 徽标"过渡）。
4. 定时抽取/回收站清理的承载机制（不依赖不存在的 daemon 调度）。
5. `@` fallback 顺序（fallback-first）与 digest 失败重试策略。
6. 未命名线程批量起名是否进 P0.5（建议进）。

VERDICT: APPROVE_WITH_NITS
