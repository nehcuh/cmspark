## PR #555 复审（第二轮）— 独立核实 `8c525b44`

先确认评审对象：`git rev-parse HEAD` = `8c525b44`，被审文件（`browser-bridge.ts` / `security.ts` / 两个测试文件）工作树无改动（`git status --porcelain` 只列未跟踪的 review 产物）。所有实验在我自己的临时目录里做（改动只落在 `.test-dist` 的**副本**上，已确认还原），未动仓库文件。

---

### 1. 实测复现：you（pi）的 BLOCKING ① 确实消除

用真实编译产物（`.test-dist/.../browser-bridge.js`）+ 我自己的时间基准 stub（两通道在 `heal` 前不可用，之后恢复），复跑上轮那组 heal 实验（`timeout: 8000, interval: 500`）：

```
heal=1200ms → success=true  elapsed=1513  attachFail=3  attachOk=1
heal=2000ms → success=true  elapsed=2030  attachFail=4  attachOk=1
heal=4000ms → success=true  elapsed=4074  attachFail=8  attachOk=1
```

与上轮记录的 main 基线（1509 / 2021 / 4029）在同一机制、同一量级（差 ≤ 1×interval）；上轮的 NEW 结果是 `success=false, elapsed≈1014/1027/1024`。**容错窗口已回到整个 deadline。** `MAX_WAIT_PROBE_FAILURES` 全仓 grep 无残留。

反向漏洞也堵住了（两通道全死、短超时）：

```
timeout=1000 interval=500 → CDP_ATTACH_FAILED（不再是 WAIT_TIMEOUT）
timeout=300  interval=100 → CDP_ATTACH_FAILED
timeout=500  interval=500 → CDP_ATTACH_FAILED
timeout=1500 interval=700 → CDP_ATTACH_FAILED
timeout=100  interval=500 → CDP_ATTACH_FAILED
```

（循环条件在探测前判断，`timeout ≥ 1` 时至少会探一轮，所以不存在「零探测却报超时」的空档。）

### 2. 实测复现：claude 的 BLOCKING ② 确实消除

- `companion/src/security.ts:1092-1093` 已登记 `wait_probe_failed` / `wait_timeout`。
- **端到端**（不是单点调 `classifyError`）：用上轮 pi 的 P0 场景（attach 成功、`Runtime.evaluate` 抛 `No target with given id`、`executeScript` 抛 `The extensions gallery cannot be scripted.`、URL=webstore）跑 `bridge.execute("wait_for", …)`，取真实 `r.error` / `r.data.error_code` 喂进真实 `companion/.test-dist/src/security.js`：

```
code=WAIT_PROBE_FAILED  classifyError → recoverable    ✅（上轮 non_recoverable）
另测 Detached while handling command. → WAIT_PROBE_FAILED → recoverable ✅
genuine timeout → WAIT_TIMEOUT → recoverable ✅
privileged origin → WRONG_ORIGIN → recoverable ✅
```

companion 新测试 **4/4 绿**（我本机重跑）。

### 3. 两家共同 NIT

- `exceptionDetails` 不再折成 `exists=false`：非法 selector 端到端得到 `INVALID_SELECTOR` + `suggested_action=refine_text_or_selector`，level=recoverable ✅（`security.ts` 早已登记 `invalid_selector`）。
- scripting 侧错误原文**部分**带出：`executeScript` **reject** 的路径已带原文（→ `INVALID_SELECTOR` ✅），但见 N2。

### 4. 新增/残留问题（我独立找到，均非本轮 BLOCKING）

**N1（新引入，建议立案）— 页面可控文本现在会进入 `classifyError`，可被恶意页面用来「杀掉一轮」。**
本提交为了修「把页面异常折成不存在」，把页面给的 `exception.description` 原样拼进错误串（`browser-bridge.ts:296-300`），而该串最终会进 `classifyError`。实测：

```
页面 patch document.querySelector 抛 "Uncaught Error: Security Block: page says halt"
+ scripting 通道同时不可用
→ code=WAIT_PROBE_FAILED，但 classifyError 返回 "security"
→ adapter.ts:2132-2152 shouldStop=true / terminal="security_halt"（整轮终止）
```

`classifyError` 的 `security block` / `blocked by user` / `user rejected` / `user denied` 子串检查在任何 `error_code` 早退之前生效，所以 `error_code` 救不了它。可达性窄（需两条通道同时失败，例如 Web Store 页 / 未开「允许访问文件网址」的 `file://`），影响是**单轮 DoS**（无越权，用户可继续），且同类暴露早已存在于 `evaluate`(`EVAL_THROWN`)。但 `wait_for` 是良性的、常态调用的工具，所以这是「良性工具 + 页面输入」新组合。便宜修法：探测错误里对页面原文做截断/剥离分类器 token，或让 `wait_for` 两条新码在 `classifyError` 里优先于 security 子串。**属 note，不阻塞**，但请按仓库 Issue-first 约定记账。

**N2 — kimi 的 NIT #9 只修了一半。** `scriptingProbeSelector` 只在**抛异常**路径记 `lastErr`；而 `InjectionResult.error` 与「有 frame 项但无 result」（正是 `hasUsableResult` 注释所说「injection 被挡却没抛」的形态）仍被静静丢成 `"no detail"`：

```
[{error: "Failed to execute 'querySelector' … not a valid selector."}] + CDP 死
→ CDP_ATTACH_FAILED（非法 selector 原文丢失）
```

分类仍是 recoverable，故只是精度问题。

**N3 — 测试/突变声明被高估（守行为的部分我逐个验了）：**

| 突变 | 实际变红 | 结论 |
|---|---|---|
| 遇错即 `break` | 1（慢恢复） | 钉住 ✅ |
| 去掉 `exceptionDetails` 抛 | 2 | 钉住 ✅ |
| 从不进 `failInteractive`（always WAIT_TIMEOUT） | 3 | 与 commit 声明的「3 条」一致 ✅ |
| `if (probeError)`（去掉 `anyProbeSucceeded` 守卫） | **0** | 守卫在已测路径上是等价突变 |
| `anyProbeSucceeded` 永不为 true | **0** | 同上 |
| 丢掉 scripting 原文 | **0** | NIT #9 的修复无用例守 |
| 注销两个新码 | companion **4 例里只有 1 例**变红 | 「3 正向 + 1 反证」失实：T2 靠通用 `timeout` 子串早已通过、T3 靠既有条目、T4 无论如何都通过 |

另外：`anyProbeSucceeded` 的唯一区分输入（**中途成功一次、之后持续失败**）无用例——我实测该场景 HEAD 报 `WAIT_TIMEOUT` + `probe_channel=cdp`（recoverable，与 main 语义一致，可接受，但窗口尾部失明这一事实未被声明）；`probeError = null` 重置对最终判定是死代码。`companion/tests/web-act-loop-wave1.test.ts:41` 的家族码表（上轮我点名的那张）没有把两个新码加进去，读者会以为家族清单完整（新文件另立了）。

### 5. 回归数字核实（全部我自己重跑）

- extension 全量 **1469/1469**（=1458+11）✅
- `tsc --noEmit` exit 0 ✅；`plasmo build` exit 0（10852ms）✅
- 打包门禁 **156 passed / 0 failed** ✅
- companion：新文件 4/4；全量 **68 条唯一失败**，逐条看全是 Windows 环境特异（`EPERM symlink`、0o600/0o700 POSIX 权限、macOS bundleId、packaged tray、fixture 逐字节生成），**无一条与 `classifyError`/`wait_for` 相关**；grep 全仓确认除新文件外无测试使用 `wait_probe_failed`/`wait_timeout`，且新增条目只可能把 `non_recoverable`→`recoverable`，故「零新增失败」成立。**诚实标注**：我没建 main 的 worktree 做逐字节 diff，用的是「失败集合构成 + 惰性论证」；我数到 68 条而 commit 写 70 条，差异应为计数口径/抖动，不影响结论。

### 6. 其他观察（不阻塞）

- 非法 selector 的等待现在会跑满 deadline（默认 15s ≈ 30 轮 × 最多 3 次探测调用），而 `f81c4fb3` 是 3 轮即放弃；这是「回到 main 的等到 deadline」语义的必然代价（main 同样空转 15s），但探测次数增多，可考虑对 `isInvalidSelectorMessage` 短路。
- `probe_channel` 下游仍无消费方 ✅（grep 确认）；ADR-020 能力声明在 commit body 中给出 ✅。

**总评**：两条 BLOCKING 都是真的修掉了（我用上轮的原始实验形态复现，非采信声明），回归数字属实，测试大多数真的在守行为。N1 是本轮 NIT 修复带来的新（窄）暴露面，N2 是同一 NIT 的半成品，N3 是测试声明的夸大——都应记账/写票，但不构成本轮阻塞。

VERDICT: APPROVE_WITH_NITS
PI_RECHECK_EXIT=0
