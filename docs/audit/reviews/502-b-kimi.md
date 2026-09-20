# 502 B 归档省略 — Kimi 对抗复审

> 日期：2026-09-18 · 评审人：Kimi（READ-ONLY，未改任何文件）
> 对象：worktree `/tmp/cmspark-502/b`，diff `3ba0606a..32cdbb86`（5 commits：默认 stub → 设置开关 → assistant arguments stub → 验收守卫测试 → scope 注释 + B-DONE）
> 方法：两路独立对抗子代理（CORRECTNESS / SECURITY-SPEC，互不引用结论）+ 仲裁人亲证关键主张
> 总 verdict：**APPROVE-WITH-NITS**（两路一致；无 BLOCK；CORRECTNESS 路唯一的 MAJOR 是文档缺口，已被评审期间落地的 `32cdbb86` 闭合）

## brief 红线复核（仲裁人亲证）

| 红线 | 结论 | 亲证 |
|---|---|---|
| 不得删 tool 行 | **HELD** | `tool-batch-heal.ts:42/109` `role:"tool"` 行恒产出；stub 只换 payload（`tool-persistence-redact.ts:310-325` 用既有 `collapseResult` 形状 `{success,redacted:true,len,sha256}`）；失败信封（含 INTERRUPTED 回填）原样透传（`:319-320` 的 `isSuccessfulResult` 闸），heal 契约的 `error_code` 存活。验收测试钉：磁盘行在、rebuild 配对、无假 INTERRUPTED、无 `(tool call failed)` 退化 |
| cookie/shell 开关加不开明文 | **HELD** | `archiveToolPayload` 无条件先过 `redactToolPayloadForPersistence`（SoT），`persistFull=true` 返回的就是 #255 字节级原路径：cookie 只有 `value_hash`/`value_length`（`:42-62`）、shell/host/osascript 走 EXEC_FOLD collapse（`:220-248`）、MCP 走敏感正则/深 key 扫描（`:250-260`）。stub 模式下 sha256 是对**已脱敏**内容算的，无新 oracle |
| 不得改 overlay Allow/Deny | **HELD** | diff `--stat` grep overlay / SUMMONER_ALLOW / MinimalConfirm / security-confirmation / capability-audit：**0 命中** |

附加亲证：config 调用时读取（`tool-batch-heal.ts:21`、`adapter.ts:1183` 均 `getConfig()` 即时读，fail-closed）；默认关三处一致（`config.ts:495`、`normalize-config.ts:110` 显式 false、handler 只收 boolean）；设置文案逐字符合锁定稿（`SettingsSlideout.tsx:3468`，含「已经省略的正文不会因打开而恢复」）。

## 两路独立结论

**CORRECTNESS（APPROVE-WITH-NITS）**：rebuild 配对安全——stub arguments 是合法 JSON 且保留 `id`/`function.name`，rebuild 不 parse arguments（`adapter.ts:402-409` 透传字符串），全仓唯一 `JSON.parse(function.arguments)` 在 live 流（`:1549`），Anthropic 转换有 try/catch。reload 失忆契约诚实：模型看到 stub 信封本体（经 `wrapUntrusted`+truncate），行不丢、sha256 不被当正文喂。live 上下文零改动（折叠只在 persist 边界，`adapter.ts:2097-2108` 内存行仍全文）。无回溯迁移（测试钉 legacy 文件原样）。测试：companion **5098 pass / 0 fail**、extension **1341 pass / 0 fail**。

**SECURITY/SPEC（APPROVE-WITH-NITS）**：五条 plan NEVER 全 HELD。开关=true 时 read-tier 仍是 8000 字符闸前缀（不是 18k 全文）。history.db/logs 不管已按 spec §3.3 写入代码注释（`config.ts:357` SCOPE）+ B-DONE 残余 #3。两处计划外文件改动（`adapter.ts` 传 persistFull、`handlers/config.ts` 显式 allow-list——plan 声称「config.set 已有通用 patch」是**错的**，不加这个分支开关会静默无效）均必要且在 B-DONE 透明披露（B-G1/B-G2）。该路独立跑了 62+83+49 个相关测试全绿。

## 残余 NIT（均不阻塞）

1. **失败信封在 stub 模式仍留正文**（pre-existing，B-DONE 残余 #1 已披露）：`success===false` 原样落盘——敏感类仍折叠，但 read-tier 失败可留至多 #255 前缀上限的页面文本；设置文案「只留工具名、成败、内容指纹」对失败行略夸大。建议 follow-up 票决断。
2. **parse-error 文本嵌入原始 arguments**（pre-existing）：`adapter.ts:1559` 把 `tc.function.arguments` 拼进持久化错误串，经失败豁免两种模式都落盘。建议 follow-up。
3. `m2-untrusted-marker.test.ts:222-232` 切换 config 无 try/finally，抛异常会污染同文件后续测试（其他新测试都有）。
4. spec §3.2 小节名「对话档案」vs 实现「对话归档」——字面不一致，cosmetic。
5. `thread_recall`/markdown 导出对 compact 线程只能搜到 stub（设计如此，B-DONE 应写明——已随 `32cdbb86` 覆盖）。
6. `archive-stub-args.test.ts:108-116` 的源码正则守卫偏弱，但有真实接线测试兜底。

## 测试证据

- CORRECTNESS 路：companion 全量 5098 pass / 0 fail / 24 skipped（skip 为既有）；extension 全量 1341 pass / 0 fail
- SECURITY 路：archive-stub 三件套 + redact 两套件 62/62；security-thread/adapter/m2/config-security 83/83；extension sidepanel-state 49/49
