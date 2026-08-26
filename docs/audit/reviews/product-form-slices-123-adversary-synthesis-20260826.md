# 切片 1–3 实现计划 — 四路对抗合成

> **日期**: 2026-08-26  
> **对象**: 落地计划（尚未写代码）  
> **SoT**: [product-form-deepening](../../superpowers/specs/2026-08-26-product-form-deepening-design.md)  
> **计划**: [2026-08-26-product-form-slices-123.md](../../superpowers/plans/2026-08-26-product-form-slices-123.md)  
> **车道**: Product · Impl · Security · External（独立）

| 路 | VERDICT | 一句话 |
|----|---------|--------|
| Product | **AWN** | 1+2 同一里程碑才叫五分钟；旧测试锁着错 UX，测试跟 SoT |
| Impl | **AWN** | 披露必须写进 grant 文件；`rejectAll` 会杀 unbound；等扩展用事件不是 poll |
| Security | **AWN** | CLI 不准 listen/POST disclosure；HUD 本切片不签发；overlay 不准加 confirm.response |
| External | **AWN** | mcp.md 必须实验声明 + 每份片段带 grant + Windows NSIS；禁叫 Handoff |

## 合成锁

1. **三 PR**：A 钥匙 CLI + `allow_page_export` 落盘 + 文档（**不算**五分钟完成）→ B Confirm L8 + 首次外泄 HITL（五分钟变绿）→ C 召唤器诚实。
2. **钥匙 = CLI**。Tray「给编程助手一把钥匙」**推迟**。Overlay / 新 HTTP `/grants` / CLI `listen()` **禁**。
3. **`--allow-page-export` 写 `outbound-grants.json`**。禁止在 CLI 进程里 `acceptOutboundDisclosure` 或 `POST /disclosure`。调用方 `acknowledge` 不够。缺 flag → `DISCLOSURE_NOT_GRANTED`，不准用确认台「点一下就变成 30 天外泄权」。
4. **L8**：overlay 永不 `originWs`；fan-out 排除 summoner；**改 `rejectAll`：带 ws 时只杀 `originWs===该 ws`，不杀 unbound**；托盘 map 不以 overlay 为 key；Win/Linux `attachChromeOnly` + 扩展 auth **事件**，超时失败永不批准。`url-cookie-admission.ts` 与 L2 **同一洞、同一修**。
5. **MCP 轨 hide-not-delete**。改锁旧文案的测试，不要为了绿而藏 CTA。
6. **mcp.md**：标题「5 分钟租手」；§8.1 声明原文；每份 json/toml/bash 含 `CMSPARK_OUTBOUND_GRANT`；Windows `%LOCALAPPDATA%\CMspark\node.exe` + `cmspark-agent.js`；Bake-off/TROUBLESHOOTING 去掉 `Bearer ws_secret`。

**Dual `20260826-150244`:** Claude Product/Impl/Security **AWN** · Pi **APPROVE**. nits 已折进计划（T2.7→Task 10；披露测试先 clear Map；CLI grep listen/fetch；overlay respond 钉 ACL 而非改 outbound 绑定）。

## 不推翻

Overlay 无 Allow/Deny · 无第二扩展 · `cmg_` ≠ `ws_secret` · `require_grant` 默认 true · 默认 profile 不扩 · F-I-4
