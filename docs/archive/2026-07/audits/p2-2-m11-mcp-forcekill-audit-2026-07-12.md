# P2-2 M11 — MCP 子进程 force-kill：CLOSED as 误报（SDK 已覆盖）

> **状态**: ✅ Closed as 误报（Case M11）· **裁决**: kimi GO (A) · **日期**: 2026-07-12
> **结论**: 无需 code change；MCP stdio 子进程 force-kill 已由 SDK `StdioClientTransport.close()` 完整覆盖。

## 1. M11 原始关切（docs/optimization-plan-post-v0.3.0.md P2-2）

> "SDK `client.close()` 不保证 stdio 子进程已死；需 close 后宽限期 `kill(pid, SIGKILL)`。但拿 pid 要读 SDK 内部（kimi 之前对触达 SDK 内部有 push-back）。需确认 SDK 暴露的稳定 API。"

## 2. grounding：SDK `^1.0.4`（实际解析至 1.29.0）已实现完整 force-kill 阶梯

[inspected] `companion/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js:137-169` —— `StdioClientTransport.close()`：

```js
async close() {
  if (this._process) {
    const processToClose = this._process
    this._process = undefined                    // 先摘引用
    const closePromise = ...once('close')...
    processToClose.stdin?.end()                   // ① 优雅关 stdin
    await Promise.race([closePromise, timeout(2000)])   // 等 ≤2s
    if (processToClose.exitCode === null) {
      processToClose.kill('SIGTERM')              // ② SIGTERM
      await Promise.race([closePromise, timeout(2000)]) // 再等 ≤2s
    }
    if (processToClose.exitCode === null) {
      processToClose.kill('SIGKILL')              // ③ SIGKILL（不可捕获）
    }
  }
}
```

**SDK 自带 stdin-close → 2s grace → SIGTERM → 2s grace → SIGKILL**。SIGKILL 不可捕获/不可忽略 → 子进程必死（ESRCH=已回收，被 catch 忽略，无泄漏）。M11 要求的"close 后宽限期 force-kill"**SDK 已做**。

## 3. 自己再 force-kill 既冗余又 race

若按 M11 字面在 `client.close()` 之后再 `kill(pid, SIGKILL)`：

- **冗余**：重复 SDK 已有的 SIGTERM→SIGKILL 阶梯。
- **race + 无 pid 可杀**：`extractPid(transport)`（transport.ts:196）读 `transport.pid`；SDK close 在 stdio.js:140 **立即** `this._process = undefined`，故 `get pid()`（stdio.js:120）在 close 后返 null —— 我们的 force-kill 拿不到 pid。要拿 pid 得在 close **前**缓存，然后自己 kill —— 但那样就与 SDK 自带阶梯竞态（双 SIGTERM/SIGKILL）。 messy 且无收益。

## 4. transport 覆盖

- **stdio**：SDK close 已 force-kill（上述）。✅
- **HTTP**（StreamableHTTPClientTransport）：无本地子进程（远端 HTTP server），N/A。

## 5. 结论

M11 的前提（"SDK close 不保证子进程已死"）对 **SDK `^1.0.4`（解析至 1.29.0）不成立**。M11 = **doc-only close（误报）**，处理方式同 M5（cookie 误报）/M19（模型名误报）。

**唯一真实前置依赖已就绪**：M9（PR #49）已让 `mcpManager.shutdown()` 被 await —— 即 SDK 的 close() 阶梯（含 SIGKILL）**确实会完整跑完**才退出。M9 修复前，daemon 的同步 `exit(0)` 会 preempt 这个阶梯，那才是孤儿化的真因；M9 已堵。

## 6. kimi 裁决

- **(A) ✅ 已批准** doc-only close M11（标注 SDK `^1.0.4` 已覆盖 + M9 已保证阶梯跑完），更新 optimization-plan + remediation 记录。—— 采纳。
- **(B)** 仍实现一个"防御性"force-kill（接受冗余/race）。—— 不采纳。
- **(C)** 升 SDK 版本兜底（若未来 SDK 退化为不 SIGKILL，加回归测）。—— 不采纳。
