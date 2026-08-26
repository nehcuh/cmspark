# Outbound MCP — T1 自动预检（post-#226 · 2026-08-26）

| Field | Value |
|-------|--------|
| Operator | Grok Build (automated) |
| Host | macOS · repo `main` `bf03318` |
| Live Companion | PID 40169 · `ws://127.0.0.1:23401` · **packaged 0.5.2 CLI，无 `outbound-grant` 子命令** |
| Live `~/.cmspark-agent/config.json` | `outbound_mcp.require_grant=false` · `security.auto_approve_dangerous=true` |
| Full T1–T3 | **Not run** — 真人 SSO 任务 + Playwright 对照臂仍缺；本机配置也不允许诚实记分 |

---

## 0. Environment

| # | Check | Result | Evidence |
|---|--------|--------|----------|
| E1 | Companion 23401 | **PASS（旧二进制）** | `cmspark-agent daemon status` → running；`lsof` LISTEN 23401 |
| E2 | Side Panel 已连接 | **UNCHECKED** | 未读扩展；health `runner:"wired"` 只说明 HTTP 桥有 runner，不等于侧栏绿点 |
| E3 | Outbound health | **PASS 但配置偏航** | `GET /outbound-mcp/v1/health` → `200 {"status":"ok","runner":"wired","require_grant":false}` |
| E3b | 仓库 grant CLI | **PASS（源码）** | `npx tsx src/index.ts outbound-grant list` → `（没有租手钥匙）` |
| E3c | PATH/`CMspark.app` grant CLI | **FAIL** | `cmspark-agent outbound-grant` → `Unknown command: outbound-grant` |
| E4–E6 | Grok MCP / doctor / 新会话 | **SKIP** | 真人 / IDE |
| E7 | Playwright 对照 | **SKIP** | 真人 |
| E8 | 记分卡 | 本文件 | — |

代码默认仍是 `config.ts` `outbound_mcp.require_grant: true`。盘上被改成 `false`，所以 live health 与默认不一致。

---

## BLOCK（开 T1 记分前必须折）

1. **跑 #226 的 Companion**，不要用当前缺 `outbound-grant` 的 0.5.2 安装器。否则测的不是刚合的租手钥匙路径。
2. **bake-off 会话**把 `outbound_mcp.require_grant` 设回 `true`（测完可改回）。`false` 会让 `ws_secret` 当钥匙，违 ADR-022 / 切片 1。
3. **bake-off 会话**把 `security.auto_approve_dangerous` 设为 `false`。`true` 会跳过确认台，T1 的「确认台出现」条目无法证伪。
4. 操作者指定 **已登录非敏感（或已披露）SSO URL + 一句话任务**。Agent 不得编造目标站。

未折以上四条就填 T1 赢/输 = 假分。

---

## 不测什么（本预检）

- 不签发 `cmg_`（避免在旧 daemon / `require_grant=false` 下留下钥匙）
- 不调用 `get_page_text` / `navigate`（live `auto_approve_dangerous=true` 会污染确认路径）
- 不改用户 `config.json`

---

## 切片 5 机核（顺带）

Empty state **已在 main**：`ChatView.tsx` `EmptyState` = `CompanionMark` + `tokens.emptyTitle`（22）+ `emptyStateCopy` 句子邀请；作曲区 textarea 常驻；computer 空态有「打开确认台」。不把切片 5 再当未开工功能。
