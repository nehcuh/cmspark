# Summoner · 编程面 · 匹配 · 清单 — 四路对抗合成

> **日期**: 2026-08-26  
> **输入**: 用户 9 点（召唤器轻重、外部插件、审美对标 Gemini、编程 Agent 更深、Jira/GitHub 双向、Kimi 解读、vibesop-py 匹配、复杂任务清单）  
> **车道**: Product · Impl · Security · External（独立 subagent）  
> **Kimi 报告**: https://d7phdydeqde2a.ok.kimi.link/ （本机 curl 读到 HTML+data.js；web_fetch 因 198.18 私网被拦）

## Lane verdicts

| 路 | VERDICT | 一句话 |
|----|---------|--------|
| Product | **MAJOR_REVISE the bundle** | 四个产品粘在一起。召唤器=可淡化的热键捕获条。 |
| Impl | **点 2 REJECT；点 3 MAJOR_REVISE** | Overlay ACL ≠ tool-loop。插件已经是 Outbound MCP。 |
| Security | **REJECT the bundle** | Overlay 扩面恶化 F-S-10；插件走 tray WS 等于把 Companion 交出去。 |
| External | **REJECT THE BUNDLE. KEEP THE BET.** | 已登录 Chrome 的 HITL Agent。T1 未跑，不许用 UX 补偿。 |

## 合成脊柱

```text
KEEP     主叙事 = 已登录 Chrome 里的 Side Panel Agent
召唤器    L0 捕获条（说/贴/打断/续）；不是第二侧栏、不是 Codex
对外      编程 Agent 只经 Outbound MCP 租浏览器（adoption，不是他们再装一个扩展）
对内      ACP 把网页活派给本机编程 Agent（不是 Side Panel IDE）
审美      学 Gemini 的启动与空态语法；不学 Connected Apps / 消费聊天
匹配      在现有 TS tokenizer 上补 IDF / 显式 / Pack 场景；不塞 Python
清单      可见、可长、完成要有证据；不是 Mission Board，也不是模型自勾
NEVER    扩 overlay 确认/知识 CRUD/mcp.add；Jira 产品；默认 embedding；第二 runtime
```
