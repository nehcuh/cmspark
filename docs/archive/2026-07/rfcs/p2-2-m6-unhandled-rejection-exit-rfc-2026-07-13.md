# P2-2 M6 — unhandledRejection 应否对齐 uncaughtException 退出（fatal）

> **状态**: 🟡 待 kimi 裁决 · **日期**: 2026-07-13
> **范围**: companion-only · **风险**: 低（1 行改动 + 可逆）· **核心**: 一致性修复 vs 可用性顾虑

---

## 1. 当前状态（grounding，全 `[inspected]`）

`companion/src/index.ts:439-446`：

```ts
process.on("uncaughtException", (err) => {
  writeCrashLog("uncaughtException", err)
  process.exit(1)            // ← fatal
})

process.on("unhandledRejection", (reason) => {
  writeCrashLog("unhandledRejection", reason)
  // ← 不退出：吞掉 rejection
})
```

**不对称**：同步未捕获异常 fatal，异步未处理 rejection 仅写 crash.log 后继续运行。

**Node 默认行为**：Node ≥ v15（companion 跑 Node 24 / SEA bundle）默认 `--unhandled-rejections=throw`，即未处理 rejection 升级为 uncaughtException → 默认退出。**但**注册了 `process.on("unhandledRejection")` 监听器后，该 rejection 被视为「已处理」，**覆盖**了默认 throw 行为 → 故当前代码实际比 Node 默认**更宽松**（吞掉而非退出）。

进程启动方式：`node dist/index.js start`（见 `package.json:12`），**无** `--unhandled-rejections` 标志、**无** `NODE_OPTIONS`（已 grep 确认）。

## 2. supervisor 重启：跨平台均「不重启」（grounding）

| 平台 | 自启机制 | 重启策略 | 来源 |
|---|---|---|---|
| macOS | launchd plist | **`KeepAlive: false`** — 仅 `RunAtLoad`，崩溃/退出**不重启** | `menu-bar-agent.ts:229` |
| Linux | systemd user unit | `enable` only，**无 `Restart=`（默认 `no`）** → 崩溃不重启 | `menu-bar-agent.ts:247` |
| Windows | schtasks `/sc onlogon` | 仅登录时跑，**无崩溃重启** | `menu-bar-agent.ts:259` |

daemon 模式（`daemon start --daemonize`）：`daemonize()`（`daemon.ts:421`）spawn 一个 detached grandchild 后退出，**无内部 respawn 循环**。

**结论**：所有运行模式（foreground / daemon / login-autostart）下，companion 进程 `exit(1)` 后**都不会自动重启**，需手动重启或下次登录。

## 3. 设计 fork

| 选项 | 行为 | 优点 | 缺点 |
|---|---|---|---|
| **A. fatal-exit** | unhandledRejection → `writeCrashLog` + `process.exit(1)`，对齐 uncaughtException | 一致性；fail-fast 不在 corrupt state 运行；与 Node ≥v15 默认语义一致；1 行可逆 | rejection 即 companion 宕机（无 supervisor 重启）→ 可用性下降 |
| **B. status quo** | 保持吞掉仅 log | 对瞬态 rejection（如 WS 客户端断开、fire-and-forget 遥测）有韧性；不中断用户 | 异步错误后进程继续在**未定义状态**运行 → 可能静默 corrupt history.db / 返回错误 tool 结果（恰是审计 C2 类数据完整性风险） |
| **C. fatal + supervisor 重启** | A + 改 launchd `KeepAlive:true`(Crash) / systemd `Restart=on-failure` | fail-fast + 自动恢复 | scope 膨胀：触及 3 平台 supervisor 配置，且 Windows schtasks `/sc onlogon` **无法**崩溃重启（需换机制或接受 Windows 不自愈）；改变所有崩溃模式（含既有 uncaughtException）的用户可见行为 |

## 4. 我的推荐：**选项 A（fatal-exit，单独，不加 supervisor 重启）**

### 4.1 核心论点：supervisor 重启缺口是**既有**的，非 M6 引入

`uncaughtException` **今天已经** `exit(1)` 且无 supervisor 重启。所以「companion 宕机后不自愈」这个问题对 uncaughtException **早已存在**。M6 只是让 unhandledRejection **对齐** 一个已 fatal 的兄弟——它**不新增**可用性缺口，只是把两类语义等价的错误统一对待。

> 「是否加 supervisor 重启」是一个**正交、既存**的问题（已影响 uncaughtException），应作为独立 follow-up 整体评估，**不应耦合在 M6**。若 companion-down-on-crash 是问题，那它在 M6 之前就是问题。

### 4.2 fail-fast 优于 zombie（数据完整性优先）

CMspark 是单进程、单线程、持有 WS 连接 + history.db 句柄 + in-flight tool 回路的 agent。一个未处理 rejection 意味着「本该处理它的 catch 没跑」→ 某个副作用没发生（DB 写、锁释放、状态更新）→ 继续运行 = 在错误假设上操作。对**处理用户数据的 agent**，silent corruption 是最坏的失败模式（比审计 C2 更隐蔽）。dead-with-clean-state + crash.log 诊断 > live-with-corrupt-state。

### 4.3 与 Node 生态共识一致

Node 核心团队 v15 起把默认从 `warn` 改为 `throw`，正是认识到吞掉 rejection 会掩盖 bug。我们当前注册 handler 反向覆盖了这个默认——是**比 Node 默认更宽松**的退步。fatal-exit 恢复到生态共识。

### 4.4 反论与回应

- **「无 supervisor 重启 → fatal 即宕机中断用户」**：成立，但 (a) 该宕机风险对 uncaughtException 已存在且未被当作阻塞问题；(b) rejection 在**写得好**的服务里应**罕见**（每条 async 路径都该有 catch）——fatal 制造压力去修根因而非吞掉；(c) crash.log 提供诊断，用户重启后即恢复；(d) desktop agent（非 HA server）的可用性预期本就允许「崩溃后手动重启」。
- **「瞬态 rejection（WS 客户端断）杀进程过激」**：成立——这恰恰暴露**那是个 bug**（该路径缺 catch）。正确修复是给该路径加 `.catch`，而非全局吞掉。M6 fatal 让这类隐藏 bug 显形。

### 4.5 可逆性与 scope

- 1 行改动（加 `process.exit(1)`），trivially 可逆。
- 不触 supervisor 配置（C 的 scope 不进来）。
- 不改 daemon / shutdown 路径（M9 已闭环）。

## 5. 实现草案（采纳 A 时）

```ts
process.on("unhandledRejection", (reason) => {
  writeCrashLog("unhandledRejection", reason)
  process.exit(1)            // 对齐 uncaughtException
})
```

**测试**：现有 unhandledRejection 无测试。补 1 个集成测：spawn 子进程注入 `Promise.reject(new Error("boom"))`（无 catch），断言子进程 exit code 1 且 crash.log 含 `unhandledRejection` + `boom`。参照 `daemon.test.ts` 的 spawn 模式。

**文档**：optimization-plan M6 行标 ✅；remediation-plan M6 行标 ✅。

## 6. 待 kimi 裁决

**决策点**：unhandledRejection 应否 `exit(1)` 对齐 uncaughtException？

- **(A) ✅ 推荐** — fatal-exit 单独采纳（§4 论证）。supervisor 重启作独立 follow-up。
- **(B)** — 维持 status quo（吞掉）。需 kimi 给出为何 zombie-state 优于 fail-fast 的反论。
- **(C)** — fatal + supervisor 重启。若选此，请明确 scope 是否含 Windows（schtasks 无法崩溃重启，需文档化为已知局限或换机制）。

若选 A，请确认是否同时要我开一个 follow-up issue 记录「跨平台 supervisor 崩溃重启策略」独立评估（我倾向开，但不在 M6 PR 内做）。
