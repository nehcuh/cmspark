# 0.5.3 体检批 C — 四路合成 2026-08-29

> **GitHub:** [#247](https://github.com/nehcuh/cmspark/issues/247)  
> **状态:** 四路合成 PASS_WITH_CHANGES — **尚未** kimi+claude dual，**禁止实现**  
> **基线 strawman:** `docs/superpowers/specs/2026-08-29-post-diagnosis-batch-c.md`  
> **HEAD:** `origin/main` `e36176a5`

```text
Surface:      Operate companion tools
L2-classes:   shell | osascript (existing)
Compose:      mcp-server env
Autonomy:     spawn_worker HMAC
Trust:        L2 preview honesty ; token bind
Channel:      community
Blast:        T3
```

**产品句（修订）：** 确认台看到的，就是实际跑的。osascript 不能打错 tab；MCP 不能偷塞 loader env；shell allowlist 不能被引号绕过 `-c`；Windows 脚本覆盖要双 opt-in；工人 token 不能换一套 tool_allow 重放。

**实现是否允许开工：否。** 须 kimi+claude dual 都 APPROVE* 之后才允许写码/开 PR。本合成不是 dual。

## 1. 四路表

| 路 | verdict | 抽查后站得住的 BLOCK | 与 SoT 冲突需折 |
|----|---------|----------------------|----------------|
| Security | PASS_WITH_CHANGES | C1 预览无 URL + HMAC 只绑 JS + 末条 cache + `contains`；C2 禁整表 USER_ENV_DENYLIST；C3 解析后 argv + parse-null 不得 fail-open；C5 绑 allow/deny/intent 且执行用同一 params | 不拆 message-router；C4 是 Darwin 对齐非 Critical |
| Product | PASS_WITH_CHANGES | C2 键名诚实 / 无明文值 / 拒非整剥 / denylist 不含 PATH；C1 tabId 恢复 / catalog 暴露 tabId / 废 fragment 文案 / 预览含 URL | fail-closed 无 url **且**无 tabId 不过苛；C4 不打断 `npm run dev` |
| Impl | PASS_WITH_CHANGES | 缺文件地图；C1 规范 URL 未锁 + zod 不得 required url；C2 专用 loader helper；C3 clustered shorts；C4 测必须加 ALLOW；C5 sort+unique 且 `[]` vs missing 必须二选一 | schema 强制 url 会杀 adapter pinned_tabs 注入 |
| Skeptic | PASS_WITH_CHANGES | C1 exact 必须 keep-query drop-hash；C3 parse-null 仍扫 token；C5 顺序 DoS 不成立但仍须 sort+JSON；C2 复用 denylist 会误杀 PATH | 五项攻击都不推翻批次 |

**抽查（[inspected]，非执行）：**

- `companion-dispatch.ts` osascript：无 url 时 `tabId` → cache，再 Map 插入序最后一条 `http*`；AppleScript `URL of t contains pageUrl`。
- `security-policy.ts:50-53` `osascript_eval` HMAC = `expression||code`；`:94-95` spawn = `spawn|role|pack|alias`。
- `l2-admission.ts` osascript 预览只有 JS；spawn 预览有 `allow=` 无 deny/intent。
- `handlers/mcp.ts` L2 拼 command/args/cwd/enabled，不提 env。`mcp/transport.ts` `buildMcpStdioEnv` 原样抄 `config.env`。
- `user-env.ts` `USER_ENV_DENYLIST` 含 `PATH`/`HOME`/`NODE_ENV`；MCP 单测要求 `config.env.PATH` verbatim。
- `capability/shell.ts` `BARE_INTERPRETER_DENY_FLAGS` 打 raw suffix；`python3 '-c'` 不匹配；`tryParseSimpleArgv` 遇 `ENV=` 返回 null。
- `host-use/win/powershell.ts` `CMSPARK_WIN_SCRIPTS` 在 `NODE_ENV !== "production"` 时生效（空 NODE_ENV = 开）。Darwin `host-bin.ts` 已是双 opt-in。
- `orchestrator/spawn.ts` `roleAllow && length > 0` 把 `[]` 当 missing（默认浏览器集）；HARD_DENY 已剥 shell/host。
- Catalog `osascript_eval` 仍教 fragment `zhihu.com` + `contains`；zod url 保持 optional（adapter 注入）。

**被推翻/降级的针：**

- Skeptic「HMAC 数组顺序敏感 = DoS」→ **降级**：mismatch 只是再确认。修法仍是 sort+JSON（对齐 netsec），不是取消 C5。
- Skeptic「env 前缀让 python3 -c 进 allowlist」→ **部分假**：`FOO=1 python3` 已不 `startsWith("python3 ")`。残差是 parse-null 时跳过 deny —— **折进 C3**，不推翻 C3。
- Product vs Skeptic「整表复用 USER_ENV_DENYLIST」→ **折成专用 loader 表**。Skeptic 的「reuse plus extras」在 PATH 上与 Product/Security/Impl 冲突，以专用表为准。
- C4「同用户已拥有这台机器」→ **不推翻**。Darwin 已否决该口号；Batch C 做 Win 对齐。严重度 High 非 Critical。
- C5 不能解 HARD_DENY → **承认**；HMAC 绑的是非 deny 范围 + intent，不是 host RCE。

四路皆 PASS* 且 BLOCK 可折 → **overall_verdict = PASS_WITH_CHANGES**。任一未折的 BLOCK 会把路径打回 REJECT。
