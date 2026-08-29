# Post-Review Adversarial Fixes — Requirements (Autopilot deep-interview handoff)

> 日期：2026-08-29 · 来源：`a58b78fd..HEAD` 四路对抗评审 + 三路 grok 独立验证
> Issue-first 例外适用：全部为**已有行为的 bugfix**（AGENTS.md 例外条款），无新需求设计。

## 范围（in scope，按优先级）

### F1 · shell allowlist 回归（High · 安全）
- 位置：`companion/src/capability/shell.ts` `commandMatchesAllowlistEntry`（约 209-228 行）+ `INTERPRETER_BASENAMES`（约 163-173 行）
- 问题：裸 allowlist 条目（`bash`/`sh`/`zsh`/`pwsh`/`powershell`/`deno`/`bun`）的 `-c/-e` 拒绝只对 `isKnownInterpreter` 生效，而集合不含 shell 家族 → allowlist 含裸 `bash` 时 `bash -c '任意命令'` 被放行；错误文案仍写 "bare interpreters reject -c/-e"。
- 验收：裸 `bash`/`sh`/`zsh`/`pwsh`/`powershell`/`deno`/`bun` 条目的 `-c`/`--command` 等执行旗标被拒；`grep -c`/`wc -c` 等有意放宽保持放行；`python3 -c`/`node -e` 行为不变（仍拒）；有行为级测试。

### F2 · 「打开侧栏」假成功（High · 诚实锁）
- 链路：`summoner-web.ts` `/api/operate` → `handlers/ui-open-sidepanel.ts` → `chrome-extension/src/background/index.ts` `chrome.sidePanel.open()`
- 问题：WS push 上下文无用户手势，`sidePanel.open()` 必抛错且被空 catch 吞掉；companion 立即返回 accepted，页面显示「已请浏览器打开侧栏」——与同页诚实脚注「我们不能替你打开侧栏」矛盾。
- 验收：失败路径向 overlay 回传真实结果（不得假成功）；UI 文案与实际能力一致；扩展 SW 失败不再静默。

### F3 · Medium 批次
- F3a Swift `confirmPending` 永不复位（`companion/src/tray/SummonerOverlay.swift:739`）：触发一次 MCP_CONFIRM_PENDING 后 HUD CTA 永远停在「需要确认」模式。验收：确认解决/连接恢复路径有复位；Windows 上只能源码级修改 + source-grep 测试。
- F3b 附件 input 发送后不清空（`summoner-web.ts` `send()`）：旧附件随后续消息重复发送。验收：发送成功后 `fileEl.value=""`；有测试钉住。
- F3c 外泄许可按 caller_id 而非 grant_id（`outbound-grants.ts:331` + `facade.ts:58-95`）：与 grant-cli 承诺文案矛盾。**决策**：评审建议按"认证 grant 自身 allow_page_export"判定，或显式文档化 caller 级语义。取**按 grant 判定**（收紧方向，符合 CLI 文案），同步更新 `outbound-grant-cli.test.ts` 契约测试与文案。

### F4 · 行为测试补强
- F4a #252 握手 terminate 集成测试：extension Origin 声称 summoner / tray Origin omit surface → 连接被 terminate、`authenticated` 不置位。
- F4b #250 WS fanout 路由测试：非白名单类型不 fanout；summoner 消息不回流 summoner；白名单类型按 surface 正确分流。

## 非目标（non-goals）
- 协议版本 bump 决策（留决策记录，不在本批改协议号）
- thread-manager run_progress reseed 潜伏缺陷（无生产调用方，记录即可）
- mcp.toggle_server WS ACL 残留（#230 已知跟踪项）
- SSE 重连 grace、Windows hideSummonerWebShell（单路评审未交叉验证，下轮）
- companion-http HITL 断连后工具仍执行（fail-safe 方向，记录下轮）

## 约束
- 最小改动，匹配周边代码风格；每个修复配行为级测试（项目已有测试惯例）
- Swift 侧无法本机构建，仅源码 + grep 钉住
- `companion/package.json` 测试脚本为准；Node ≥22（nvm）
- 不做 git commit/push（除非用户显式要求）
