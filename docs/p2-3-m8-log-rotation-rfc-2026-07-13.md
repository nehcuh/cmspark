# RFC · P2-3 M8 — 日志轮转（retention 扫除 + 大小轮转）

> **日期**: 2026-07-13 · **Finding**: M8 (`docs/remediation-plan-2026-07-09.md:246`)
> **状态**: ✅ 已闭环（PR #54）— kimi 裁决 + 终审 GO

## 0. 裁决与终审结果（kimi）

**设计裁决（D1-D4）**：
- **D1** `log_retention_days` 默认 **14**（history=30，log 是 JSONL 纯文本更低价值）。
- **D2** 大小轮转 **S1 per-write 实时**，`log_max_file_mb` 默认 **10MB**，保 **1 份** `.1.log`（current+.1 ≈ 20MB/日）。
- **D3** 覆盖 `mcp/logs`（按 mtime 做 retention）。
- **D4** `companion-YYYY-MM-DD.log → companion-YYYY-MM-DD.1.log`，单份覆盖。

**实现**（`companion/src/log-rotation.ts`，新模块）：`pruneOldLogs()`（`initDataDir` 末尾 dynamic-import 调用，破 config↔log-rotation 循环；按文件名日期删 `logs/`、按 mtime 删 `mcp/logs/*.log`、永不抛）+ `rotateLogFileIfNeeded()`（`logEvent` append 前 per-write `statSync` 大小检查，超限 `renameSync`→`.1.log`，ENOENT 即首次写直接 return，永不抛）。config.ts 加两字段+默认（14/10）；message-router 加 normalize。

**终审 NEEDS-FIX（2 项，均独立复现 + 修复）**：
- **[High] cutoff 时区 off-by-one**：`setDate(getDate()-N)` 带本地时刻→西时区第 N 天日志早删最多 ~24h。改 **UTC 零点**对齐（`setUTCHours(0,0,0,0)`+`setUTCDate`），与文件名 UTC 日期（`toISOString`）一致，确定性。复现：UTC 23:00 retention=7 时旧码删 `companion-(today-7).log`，新码保留至 UTC 日期翻过。
- **[Medium] normalize 丢 `0`**：`if(cfg.log_retention_days)` 对 `0` falsy→UI 无法 disable（后端 `<=0` 即关）。改 `!== undefined`。

**另加 refinement**（我独立审）：`pruneByMtime` 限 `.endsWith(".log")`，防未来 `mcp/logs` 非 log 文件被 mtime 误删（原实现遍历全文件）。

**验证**（独立复跑，非 kimi 沙箱）：tsc clean；focused 10/10（含 UTC 零点边界确定性测：文件名日期=today_UTC−retention 保留、−(retention+1) 删除，不依赖运行时刻）；全量 `npm test` **852 测 / 851 pass / 1 skip / 0 fail** + settings-web 15/15。

---



## 1. M8 原文

> "日志轮转 | M8 | initDataDir retention 扫除（默认 7/30 天）+ 大小轮转 | 1–2h"

## 2. Grounding

### 2.1 日志文件模型

- `logger.ts:108 getLogFilePath()`：**按日**文件 `~/.cmspark-agent/logs/companion-YYYY-MM-DD.log`（`now.toISOString().slice(0,10)`）。
- `logEvent`（logger.ts:120）：`appendFileSync(filePath, line, {mode:0o600})`——**每次写都 open/close**（无持久 fd），rename 活跃文件安全。
- 每条 entry 有截断（`MAX_STRING_LENGTH=2000`），但**无任何清理**——日志无限累积。
- 另有 `~/.cmspark-agent/mcp/logs/`（MCP server stderr，config.ts:176 创建）也无清理。

### 2.2 既存 retention 先例（镜像）

`history/store.ts:376 purgeOldRecords()`：
```ts
const days = config.history_retention_days || 30   // 默认 30
const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
this.db.run("DELETE FROM operations WHERE created_at < ?", [cutoff.toISOString()])
```
- `history_retention_days`：top-level config 字段（config.ts:88 接口 / :120 默认 30），在 `message-router.ts:90` `config.set` 时 soft-update（`if (cfg.history_retention_days) normalized...`）。
- **history 用 mtime/created_at 字段；log 用文件名内嵌日期**（`companion-YYYY-MM-DD`）更鲁棒（不受 touch/复制改 mtime 影响）。

### 2.3 initDataDir（启动钩子）

`config.ts:164 initDataDir()`：创建 dirs（含 `logs`/`mcp/logs`）+ chmod config.json + 拷贝 builtin skills。**自然插入 retention 扫除点**（镜像 history purgeOldRecords 在 init 跑）。

## 3. 设计分叉

### 决策 D1 — retention 默认天数

| 选项 | 值 | 理由 |
|---|---|---|
| 7 | 一周 | 应用日志常见默认；磁盘最小。但安全审计事件（`security.*`）可能需更长窗口回溯。 |
| **14**（推荐） | 两周 | 折中：覆盖 debug/安全回溯窗口，又不积压。history=30 但 history 是结构化 DB 更高价值；log 是 JSONL 纯文本更低价值。 |
| 30 | 一个月 | 与 history 一致；磁盘更大。 |

字段名：`log_retention_days`（镜像 `history_retention_days`）。**请裁决默认值。**

### 决策 D2 — 大小轮转策略

日志按日已天然分片，但**单日 chatty**（debug 开 / tool 跑飞 / 流式 token 刷屏）可撑大单文件。

| 选项 | 机制 | 优点 | 缺点 |
|---|---|---|---|
| **S1 per-write 实时轮转**（推荐） | `logEvent` append 前 `statSync(size)`；> `log_max_file_mb` 则 rename `companion-DATE.log`→`companion-DATE.1.log`（覆盖旧 .1）后写新文件 | **实时 bound**：单文件不超阈值（默认 10MB），长跑 daemon 也安全；rename 仅在越阈值时触发（非每写）；stat 每写一次（logger 低频，可忽略） | 每写一次 stat（实测可忽略——141 调用点，安全事件非 per-token） |
| S2 仅启动扫除 | initDataDir 扫除超大文件（rename .1） | 零运行时开销；贴合审计"initDataDir"字面 | **长跑 daemon 单日仍可无限增长**（重启间隔内 unbounded） |
| S3 不做大小轮转 | 仅按日 + retention | 最简 | 单日 chatty 可撑爆磁盘 |

字段名：`log_max_file_mb`（默认 10）。保留 `.1` 单份轮转（current + .1 ≈ 20MB/日上限）。**请裁决 S1/S2/S3 + 默认 MB + 轮转份数。**

### 决策 D3 — 是否覆盖 mcp/logs

`mcp/logs/<server>.log`（MCP server stderr，无日期分片，单文件追加）也无清理。
- 覆盖：retention 按 mtime（无日期名）+ size 轮转同 S1。
- 不覆盖：M8 仅 `logs/`，mcp/logs 作独立 follow-up。

**推荐覆盖**（一致性 + 同一无界增长风险），mcp/logs 用 mtime（无内嵌日期）。**请裁决。**

### 决策 D4 — 轮转文件命名与计数

- `companion-DATE.log` → `companion-DATE.1.log`（覆盖既有 .1）。
- 仅保 1 份轮转（.1），即 current + .1。是否需 .1/.2/.3 多份？**推荐单份**（proportionate，10MB×2/日足够诊断）。

## 4. 推荐方案（整体）

```
新增 config 字段：
  log_retention_days: number  (default 14)
  log_max_file_mb: number     (default 10)

initDataDir() 末尾调 pruneOldLogs():
  - logs/companion-*.log + *.1.log：解析文件名日期 < now - retention_days → unlink
  - mcp/logs/*.log：mtime < now - retention_days → unlink

logEvent() append 前：
  - if (statSync(filePath).size > log_max_file_mb*1e6) rename→.1.log (覆盖)
```

- 日期解析从文件名（`companion-YYYY-MM-DD.log` → 提取 YYYY-MM-DD → Date），非 mtime。
- 镜像 history 的 `try/catch skip`（retention 永不阻塞启动）。
- normalize：`message-router.ts:90` 旁加 `log_retention_days`/`log_max_file_mb` soft-update。

## 5. 测试计划

新增 `companion/tests/log-rotation.test.ts`（用 temp DATA_DIR + 注入旧文件）：
- `pruneOldLogs`：注入 7d/20d/无日期名文件 → 仅删 >retention 的日期文件；无日期名（mcp）按 mtime；解析失败文件保留。
- per-write size rotation：注入近阈值文件 + 连续写 → 触发 rename→.1，新写落 fresh 文件，size 不超阈值。
- 边界：空目录 / 无写权限（catch 不崩）/ today 文件不被 retention 删（即便名日期=今天）/ .1 被新轮转覆盖。
- 全量 `npm test` 绿（baseline 842）。

## 6. 非目标

- 不做压缩（gzip 旧日志）——proportionate，磁盘够用。
- 不做跨进程文件锁（logger 单进程 appendFileSync）。
- 不改 history retention（已健壮）。
- 不轮转 crash.log（crash-handlers 追加，低频，独立 follow-up 如需）。
