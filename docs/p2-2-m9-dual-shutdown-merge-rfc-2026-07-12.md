# P2-2 M9 — 双 SIGTERM handler 合并（实现 RFC）

> 致 kimi：M9 设计 RFC，过设计后再动手。companion-only。
> 背景：`docs/optimization-plan-post-v0.3.0.md` P2-2 把 M9 列为优先项（影响数据完整性/资源泄漏）。

## 1. bug（grounding）

**两个独立 signal handler 注册在同一组信号上，racing：**

| # | 位置 | 注册 | cleanup | exit |
|---|---|---|---|---|
| A | `index.ts:163` → `daemon.ts:484 setupGracefulShutdown` | `process.on(SIGTERM/SIGINT)` (daemon.ts:505-506) | **同步** `cleanupPidFile(pidPath)` | **立即** `process.exit(0)` (daemon.ts:502) |
| B | `server.ts:2197-2198` | `process.on(SIGTERM/SIGINT)` | **异步链** `mcpManager.shutdown()` → `historyStore.close()` → `wss.close()` → `releaseLock()` (server.ts:2180-2195) | `.finally(() => process.exit(0))` |

[inspected] Node 按注册顺序依次调用同信号的所有 handler。A 先注册（index.ts:163 在 startServer:168 之前），其 handler 全同步——`cleanupPidFile` + `process.exit(0)` **在同一 tick 内完成**。B 的 handler 虽被调用（`mcpManager.shutdown()` 启动），但其 `.finally()`（history flush / wss close / lock release）依赖的 await 链**来不及 resolve**——A 的 `exit(0)` 先杀死进程。

**后果**：
- **MCP 子进程孤儿化**：`mcpManager.shutdown()`（mcp/manager.ts:68）的 `client.close()` 未完成 → stdio 子进程父进程已死，可能残留。
- **history.db 未 flush**：审计 C2 修复（server.ts:2187-2191 注释）的 `historyStore.close()` 被 preempt → 本次 session 的审计记录丢失（回归 C2 修复意图）。
- **wss 未优雅关闭** / **lock 未释放**（lock 自愈但 wss 客户端收到 abrupt close）。

注：A 的唯一职责是删 PID 文件。B 才是实质 shutdown。

## 2. 设计：startServer 拥有单一 handler（经 async-aware helper）

**核心**：去掉重复 handler，让 startServer 经 `setupGracefulShutdown` 注册**唯一** handler，cleanup = 完整有序异步 shutdown；index.ts 把 pidFile 清理作为 hook 传入。

### 改动 1：`setupGracefulShutdown` → async-aware（daemon.ts）

```ts
export function setupGracefulShutdown(cleanup: () => void | Promise<void>): void {
  let shuttingDown = false
  const handler = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[daemon] Received ${signal}, shutting down gracefully...`)
    try {
      await cleanup()                  // ← await（向后兼容：sync 回调也 OK）
    } catch (err: any) {
      console.error(`[daemon] Cleanup error: ${err.message || String(err)}`)
      process.exit(1)
    }
    process.exit(0)
  }
  process.on("SIGTERM", () => void handler("SIGTERM"))
  process.on("SIGINT", () => void handler("SIGINT"))
}
```

向后兼容（既有 3 测试传 sync 回调仍过）；新增 async 覆盖。`shuttingDown` 守重入不变（第二信号忽略）。

### 改动 2：`startServer({ onShutdown? })` 注册唯一 handler（server.ts）

```ts
export async function startServer(options: { onShutdown?: () => void } = {}) {
  // ... existing setup ...
  const shutdown = async (signal: string) => {
    console.log(`\n[cmspark-agent] Shutting down (${signal})...`)
    logger.info("server.shutdown", { signal })
    try {
      await mcpManager.shutdown()       // MCP 子进程先关（原顺序保留）
    } catch (err: any) {
      logger.warn("mcp.shutdown_failed", { error: err?.message || String(err) })
    }
    try { historyStore?.close() } catch (err: any) {   // C2 flush
      logger.warn("history.close_failed", { error: err?.message || String(err) })
    }
    try { wss.close() } catch { /* ignore */ }
    try { releaseLock(getLockFilePath()) } catch { /* ignore */ }
    try { options.onShutdown?.() } catch (err: any) {  // pidFile cleanup（daemon 模式）
      logger.warn("shutdown.hook_failed", { error: err?.message || String(err) })
    }
  }
  setupGracefulShutdown(() => shutdown("SIGTERM"))   // ← 唯一 handler，async
}
```

**删掉** server.ts:2197-2198 原来的 `process.on(SIGTERM/SIGINT, () => shutdown(...))`（重复 handler 移除）。改 `.finally` 链为 async/await（等价、可读）。

### 改动 3：index.ts 传 hook，不再自注册

```ts
// 删 index.ts:163-165 的 setupGracefulShutdown(...) 块
await initDataDir()
await startServer({ onShutdown: () => cleanupPidFile(pidPath) })   // daemon 模式
```

前台模式（index.ts:281 `await startServer()`）不传 onShutdown → 无 pidFile 可清，正常。

### 改动 4：index.ts 删 `setupGracefulShutdown` 的 import（若不再直接用）

index.ts:16 import 行移除 `setupGracefulShutdown`（仍保留其他 daemon 导入）。helper 本身不删（仍被 startServer 用 + 3 单测覆盖）。

## 3. 为什么这个方案（vs 备选）

- **备选甲**：daemon handler 不 exit，让 server handler 拥有 exit。—— 破坏 helper 既定契约（"cleanup 后 exit 0"）+ 反转 3 个单测的语义。否。
- **备选乙**：删 setupGracefulShutdown，server.ts 内联 `process.on`。—— 失去 helper 的重入守 + 删 3 测，扩 scope。否。
- **采用**：helper async-aware（通用改进，向后兼容），startServer 经它注册唯一 handler。最小 scope、保留 helper 契约与测试、消除 race。

## 4. fork —— 请 kimi 裁决

**Fork A：shutdown 超时硬退出？**
`mcpManager.shutdown()` 若 hang（stdio 子进程拒关），`await` 永不 resolve → 进程卡死，daemon 看似不退。
- (i) 不加超时——保持 scope 紧贴 race 修复（现状同 bug，不回归）。**我的倾向**。
- (ii) 加 5s 超时 `Promise.race([shutdown(), timeout(5000)])` 后强制 exit(1)——更健壮但超 M9 scope，且 hang 的 MCP 关闭属 M11（force-kill）范畴。

**Fork B：onShutdown hook 的形态**
- (i) `onShutdown?: () => void`（sync，pidFile 删除是同步）—— **我的倾向**，最小。
- (ii) `onShutdown?: () => void | Promise<void>`（async，预留）—— 过度设计，pidFile 删除无需 async。

## 5. 测试计划

- daemon.test.ts：3 个既有 `setupGracefulShutdown` 测保持绿（sync 回调兼容）；新增 1 个 async cleanup 测（await 后 exit）。
- 新增 server 层集成测（或扩展现有 shutdown 测）：SIGTERM → 验证 mcpManager.shutdown/historyStore.close/wss.close/onShutdown **都被调用且按序**（mock 各组件，断言调用顺序 + 全到齐），且 `process.on` 只注册一次（无重复 handler）。
- 手工/集成：daemon 模式下 SIGTERM 后 pidFile 被删（如已有覆盖则复用）。

## 6. 不做的事（scope）

- 不加 shutdown 超时（Fork A 倾向 i，留 M11）。
- 不改 uncaughtException/unhandledRejection（那是 M6）。
- 不动 MCP force-kill 逻辑（M11）。
- 不动 tray/readline 等其他 `.close()` 路径。

## 7. 请 kimi 过设计

- 方案（startServer 经 async-aware helper 拥有唯一 handler）是否 GO？
- Fork A（超时）选 (i) 还是 (ii)？
- Fork B（hook 形态）选 (i) 还是 (ii)？
- 有无遗漏的 exit path / signal handler？

裁决后我实现 + tsc + 全量 npm test + 既有 daemon 测绿，再 push 开 PR。
