# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-09 (session-end)
- 用 Fuck My Shit Mountain skill（full 模式）对 cmspark 做 25 维度全量审计；5 个并行子代理按维度簇采证，主会话对 2 个 Critical（history 不落盘 / WS 无鉴权）直接读源码对抗复核
- 交付：`audit-report-cmspark-2026-07-09.md`（96k/1459 行，55 findings）+ `.claude/audits/audit-cmspark-2026-07-09-metadata.json`；`report_lint.py --modes full` → OK
- 总分 4.4/C。**4 Critical（发布前必修）**：C1 WS 控制面零鉴权（根因，`server.ts:1287` 无 verifyClient/Origin/握手，任何本地进程/恶意网页可连接驱动 agent）·C2 history.db 永不落盘（`record()` 不 flush + `shutdown` 从不调 `close()` → 每次正常关闭丢全部审计记录）·C3 CI 永久绿-on-red（`|| true` 吞失败+hang，5 个安全闸门测试静默红）·C4 2 critical npm 漏洞（decompress zip-slip 经 officeparser）。另 10 High
- 亮点：HMAC 常量时间+TTL+一次性 token、域白名单通配符（10 用例验证）、history 脱敏、settings-web 四重门、systray2 SHA256 进 CI、mermaid 纵深防御、companion tsc 干净、9 ADR、诚实 NOTE 注释
- 边界：**只审计出报告，未改任何源码**（技能规则）。修复建议在报告 §31 Fix Order + §32 Quick Wins（12 项 ≤1h：config 0o600 / evaluate validateToken / WS verifyClient / shutdown close / 默认模型改 deepseek-chat 等）
- Next: 用户可选——起 C1（WS 鉴权）或 C3（修 CI hang）修复方案；本次报告 + 记忆文件已 commit（未 push）

### 2026-07-03 (session-end)
- 审核并修复 cmspark config API key 同步问题：`DEEPSEEK_API_KEY` env var 强制覆盖用户通过 UI/Tray 设置的 key，导致 Tray 与 Extension 配置不一致
- 已推送到远程 main：commit `944dbea`。改动：`config.ts` 新增 `isUserProvidedApiKey()`+`resolveApiKey()`（优先级=新非 masked key > 当前用户 key > env var）；统一导出 `isMaskedApiKey()` 在 settings-web/extension 复用；`message-router.ts` 替换硬编码 `"***"`；`saveConfig` 对 vision.api_key 同样过滤；新增 `config.test.ts` 17 用例
- 验证：构建通过；相关测试 105/105
- Next: 无未决项
<!-- handoff:end -->
