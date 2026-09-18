# B-DONE — #502 切片 B 归档 stub

**Worktree**: `/tmp/cmspark-502/b` · **Branch**: `feat/502-b-archive-stub`
**Plan**: `docs/superpowers/plans/2026-09-18-502-b-archive-stub.md` · **Spec §3** · **Blast: T2**
**Node**: 22.23.2 (`nvm use 22`) · main checkout `/Users/huchen/Projects/cmspark` untouched

## Goal (met)

默认磁盘只留 tool stub（名 + 成败 + len + sha256）；设置打开才写 redact 后的正文。**tool 行永不删**。cookie / shell / host / osascript / MCP 密钥始终 redact，开关加不开。

## Commits (5)

| commit | Task | 内容 |
|---|---|---|
| `e374ff2c` | 1 | `persist_full_tool_history`（默认 false）+ `archiveToolPayload()` + `createToolResultMessage` 写入时取配置 |
| `e53e5df6` | 2 | 设置开关（companion `config.set` 白名单分支 + extension 类型/normalize/UI + 守卫测试） |
| `454dc6d2` | 3 | `assistant.tool_calls.arguments` 默认收成 `{redacted:true,len}` |
| `7296860a` | 4 | 验收守卫（磁盘行 / rebuild 配对 / heal / 不回溯 / cookie / 文案锁） |
| 本次 | 文档 | `config.ts` SCOPE 注释 + 本文件 |

## 改动文件

```
 companion/src/config.ts                              | 新键 + SCOPE 注释（history.db / logs 不管）
 companion/src/security/tool-persistence-redact.ts    | archiveToolPayload() + args stub（options 对象）
 companion/src/llm/tool-batch-heal.ts                 | createToolResultMessage 读配置（fail-closed）
 companion/src/llm/adapter.ts                         | 透传 persistFull 到 args 路径
 companion/src/message-router/handlers/config.ts      | config.set 白名单分支（计划漏了，见 B-G2）
 companion/tests/{archive-stub-persist,archive-stub-args,archive-stub-acceptance}.test.ts   | 新增
 companion/tests/{adapter,security-thread,tool-persistence-redact,m2-untrusted-marker,
                   assistant-tool-args-redact,message-router-config-security}.test.ts        | 迁移/新增
 chrome-extension/src/sidepanel/{types.ts,utils/normalize-config.ts,
                                 components/SettingsSlideout.tsx}                          | 开关
 chrome-extension/tests/sidepanel-state.test.ts       | normalize 断言 + 文案锁
```

## 计划里没写、但必须做的四处

### B-G1: 默认翻转会打断 6 处既有断言（**计划未提**）

`redactAssistantToolCallsForPersistence` 一旦默认 stub，`assistant-tool-args-redact.test.ts` 里 5 条 + `security-thread.test.ts` 里 1 条断言（cookie `name`/`domain` 保留、shell `cwd` 保留、host `task` 前缀、evaluate `code`+`tabId`、`list_tabs` 非密参数、磁盘 `args.name==="sid"`）全部会红。计划只字未提，而这是**安全测试**文件，随手改测试是危险信号。

**处置**：把 `persistFull` 做成**显式 options 对象**（不是位置布尔），**默认 false（fail-closed）**，并把这 6 处迁移到 `{ persistFull: true }` —— 它们测的是「**脱敏**」，而脱敏现在正是开关打开时的路径。安全性没有减弱：每条被迁移的断言仍在跑，同时新增默认档的**更强**断言（正文整体不落盘）。`archive-stub-args.test.ts` 补一条源码锁，钉住 adapter 确实把配置读进来（否则开关会静默失效）。

### B-G2: `config.set` 不是「已有通用 patch」，是**显式白名单** —— 漏了就是静默 no-op（**计划判断错误**）

计划 Task 2 写「config.set 路径已有通用 patch」。**不成立**：`message-router/handlers/config.ts` 先构造一个空 `normalized`，只有被显式搬过去的键才会进 `saveConfig`（对照 `history_retention_days` 需要自己一行）。该文件头部**已经**为 ACP / coding_handoff 记录过同一个坑：*「previously dropped by this allow-list (silent no-op)」*。

**处置**：加分支（仅接受 boolean）+ 两条测试：双向持久化（先红后绿，红即复现静默丢弃）+ truthy 垃圾值不武装开关。

### B-G3: `createToolResultMessage` 读 `getConfig()` 会让既有测试读到真实 `~/.cmspark-agent`（**计划未评估**）

`tool-batch-heal.test.ts` 等文件调 `persistHealedToolRows`（内部走 `createToolResultMessage`），但**没有** `HOME` / `initDataDir()`。直接 `getConfig()` 会读开发机真实配置，测试结果将依赖本机设置。

**处置**：`persistFullToolHistory()` 用 lazy `require` + try/catch，任何读取失败**fail-closed 返回 false（stub）**。既保证确定性，也保证「读不到配置时少写盘」这个正确方向。

### B-G4: 第一版实现把**失败信封**也坍缩了 —— 两条真实功能回归（**自查发现，非计划范围**）

`plainErrorResult` 只覆盖「无 data 的错误行」。于是失败信封被当成普通 payload 坍缩成 `{redacted,len,sha256}`，实测撞红：

- `adapter-peek-refuse-breaker`：「envelope still feeds back to the model」——模型再也读不到**为什么**被拒。
- `site-op-auto-persist`：同型（`len:218` 的 `SITE_OP_BANNED` 信封）。

`SITE_OP_BANNED` 的形状是 `{success:false, error, data:{error_code, suggested_action, locator}}` —— 有 `data`，所以吃不到原 carve-out。

**处置**：把 carve-out 从「无 data 的错误行」放宽为「**`success === false` 一律逐字保留**」。理由（不是为凑测试）：
1. 失败信封是**模型诊断通道**，reload 后要重新喂给模型；坍缩它 = 让模型盲目重试，正是本票调研里点名的「造假事实」陷阱；
2. 信封已被 SoT 限界+脱敏（exec data 已坍缩、read-tier error 截 200、cookie value 已 hash），不是新泄露面；
3. 这使失败路径的行为与 #502 之前**逐字节相同** —— 保守选择。

替换后 `#59`/`#3430` 直接转绿，且 `adapter.test.ts` 的 empty-result 用例（`{success:false}`）无需迁移。

## 三档设计（落地形态）

```
live LLM 上下文      全量（未触碰；archiveToolPayload 只在落盘构造器里）
threads/*.json       默认 stub：result 与 params 皆为 {success?, redacted:true, len, sha256}
                     行本身（role/id/tool_name）永远保留
                     assistant 行 arguments → {redacted:true, len}，id/name 保留
                     success===false 信封逐字保留；invalid_json 仍是 {_redacted:"invalid_json", len}
设置打开             走既有 #255 gate（read-tier 前缀 ≤8000、exec 仍坍缩、cookie 仍 hash）
history.db / logs    本票不管（已在 config.ts SCOPE 注释 + 此处写明）
```

## 验收证据（全绿）

| 验收项 | 证据 |
|---|---|
| 新线程默认磁盘无 get_page_text 全文 | `archive-stub-acceptance` #1（真 ThreadManager 写真 threads/*.json，断言正文缺席 + 行存活） |
| 仍有 `role=tool` 行（rebuild / heal 不造 INTERRUPTED 假事实） | 同上 #1/#2/#3；#2 直接断言 rebuild 后 `tool_calls` 未被剥离且**无** `(tool call failed)` |
| cookie 两种开关都无 value 明文 | `archive-stub-acceptance` #5（磁盘层，两档）+ `archive-stub-persist` #9 + `archive-stub-args` #5（对象层） |
| 源码/文档注明 history.db 与 logs 本票不关 | `config.ts` `persist_full_tool_history` SCOPE 注释 + 本文件 |
| 不回溯改写已有 threads/*.json | `archive-stub-acceptance` #6（写一份 pre-#502 全文文件，读回后断言 `LEGACY_BODY_STAYS` 仍在） |
| 开关打开文案不承诺恢复旧正文 | `sidepanel-state.test.ts` 文案锁（必须含「默认关」/「不会因打开而恢复」/「脱敏」） |
| INTERRUPTED 竞态契约未破 | `archive-stub-acceptance` #4（压扁的 filler 仍可被真实结果 replace，且不追加孤儿行） |

**测试总量**
```
companion 全量:   5122 tests, 5098 pass, 0 fail, 24 skipped  (+ settings-web 20/20)
chrome-extension: 1341 tests, 1341 pass, 0 fail
companion tsc --noEmit: exit 0
```

**变异测试（证明守卫不是摆设）**：把 `if (persistFull) return safe` 改成恒真（功能失效）后，
`acceptance #1/#2`、`archive-stub-persist #2/#3/#14` 共 5 条立即转红；还原后 24/24 复绿。

## NEVER 遵守情况

| NEVER | 状态 |
|---|---|
| 删 `role=tool` 行 | ✅ 行始终保留（`archive-stub-acceptance` #1/#2 钉住），只压缩正文 |
| 放松 redact | ✅ 敏感类在 SoT 之前照跑；开关只决定**非敏感**正文写不写。cookie/shell/host 在**两档**都有断言 |
| overlay Allow/Deny | ✅ 未触碰确认代数 |
| 改 100 步 | ✅ 未触碰 `MAX_TOOL_CALL_ROUNDS` / G1 面 |
| 改 `history.db` / `logs` | ✅ 未碰（已文档化） |
| 回写旧 `threads/*.json` | ✅ 无迁移代码；#6 钉住 |
| 开关承诺恢复旧正文 | ✅ 文案明说不会，且有文案锁 |
| 改 main checkout / A/G1 worktree | ✅ 只动 `/tmp/cmspark-502/b` |

## 已知残留（不在本 PR）

1. **read-tier 失败信封仍可带正文**：`success===false` 的 read-tier 结果走 `releaseReadData`，理论上可落 ≤8000 字符。这是 B-G4 carve-out 的代价，且与 #502 之前行为一致。若要收紧，可只保留 `error` + `data.{error_code,suggested_action}` 的机器键——需要先确认没有消费方读其它键。
2. **`content` 与 `tool_calls[0].result` 冗余两份**：同一份 JSON 在 tool 行里存两次（既有行为，本票未改）。stub 档下代价已很小（~60 字符 ×2）。
3. `history.db`（30 天、`操作历史` 面板可查）与 `logs/*.log`（含 params）仍是工具操作的持久化 sink —— 本票按计划**不管**。只关 threads JSON，**隐私目标不算完全达成**，这一点必须在对外说明里讲清楚。
4. 切片 A（UI 折叠）与 G1 未触碰。
