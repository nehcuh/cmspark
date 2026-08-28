# Dual re-review synthesis — CMspark 0.5.3 deep diagnosis (2026-08-28)

Fanout: `docs/audit/deep-diagnosis-fanout-2026-08-28.md`  
Claude: `docs/audit/reviews/deep-diagnosis-20260828-claude-20260828-190219.md` → **APPROVE_WITH_NITS**  
Kimi: `docs/audit/reviews/deep-diagnosis-20260828-kimi-clean.md` → **APPROVE_WITH_NITS**  
Verdict: `docs/audit/reviews/deep-diagnosis-20260828-verdict-20260828-191251.json`  
`both_ok=true`. 诊断不是补丁，没有 merge 闸。

## 确认序

1. 12 子系统 + 6 横切 + 10 路 skeptic（9 真 / 1 假）合成报告  
2. 编排者机核抽查 5 条 P0  
3. Claude（带 Read/Grep/Bash 工具）独立复审  
4. Kimi（嵌入报告 + 源码摘录，`-p`；`--yolo`/`--auto` 不能与 `-p` 合用）独立复审  

Pi CLI 本机不在 PATH，按用户要求只跑 kimi + claude。

## 共同结论

| 项 | 结论 |
|----|------|
| Critical | **0**（两边 + 机核） |
| 总评 | **C+** 站住 |
| P0 五条 | 都是真的：XSS、hide 不释租约、Overlay 非 L0、知识截断保存、Darwin `/tmp` estop |
| 漏检 High+ | 两边都没找到必须新开的 High |
| 08-11 七条 Critical | 不复活 |

14 条 High 的代码存在性：两边全部确认。

## 分歧（定级，不是真假）

| 题 | Claude | Kimi | 合成处理 |
|----|--------|------|----------|
| computer-host-04 `CMSPARK_WIN_SCRIPTS`/`NODE_ENV` | High→Medium（同用户已控环境） | 保持 High | **仍进 P1**；High 计数保持 14，脚注 13–15 |
| overlay-token argv + 空 Origin | 保持 Medium | High 候选（与 estop 同「同用户本地」口径） | **保持 Medium / P1 #14**；与 XSS 叠加已在 High XSS 里叙述 |

取交集：13 条无争议 High。取并集：15。报告原文 14 可保留。

## 机核抽查（编排者，非自评放行）

| P0 | 证据 |
|----|------|
| XSS | `overlay-md.ts:32-34` 未属性转义；`summoner-web.ts:1413` `esc` 只 `&<>`；CSP `script-src 'unsafe-inline'` |
| hide 租约 | `hideSummonerWebShell` 358-361 只 SIGTERM Chrome；`handleSummonerClosed` 仅 Swift close |
| 知识截断 | `tooBigToExport` 只禁下载；Save 仍发截断 `body`；`updateKnowledge` 整文件写 |
| estop | `ESTOP_SOCK_PATH=/tmp/cmspark-estop.sock`；CONNECT-first 即 ok |
| Overlay L0 | `ChatCreateParams` 无 surface；`getToolDefinitions()` ∩ whitelist；SUMMONER_ALLOW 含 `mcp.toggle_server`/`pack.apply`/`skill.activate` |

## 下一刀（诊断建议，未开工）

P0：Capture markdown XSS → hide 释租约 → Overlay 真 L0（裁 CDP/MCP 变更、组合写入绑 overlay 线程）→ 知识截断 fail-closed → Darwin estop 拒绝匿名 `/tmp`。

不扩 #228 profile、#229 WorkBuddy 五轨、#230 F-S-10 overlay-acl 整票。
