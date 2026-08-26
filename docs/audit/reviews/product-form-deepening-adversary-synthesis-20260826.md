# 产品形态深化 — 四路对抗合成

> **日期**: 2026-08-26  
> **触发**: 用户同意「多路独立对抗深化定位和设计，做好文档后再继续」  
> **脊柱**: [2026-08-26-user-first-product-form-design.md](../../superpowers/specs/2026-08-26-user-first-product-form-design.md)（LOCKED，115 行，**不够当实现 SoT**）  
> **本轮 SoT**: [2026-08-26-product-form-deepening-design.md](../../superpowers/specs/2026-08-26-product-form-deepening-design.md)  
> **车道**: Product · Impl · Security · External（独立、只读）

## Lane verdicts

| 路 | VERDICT | 一句话 |
|----|---------|--------|
| Product | **AWN** | 115 行是对的脊柱、错的 SoT；文案/轨/钥匙/旅程必须写死 |
| Impl | **AWN** | Overlay L2 确认仍绑召唤器；grant 只有侧栏设置；复制测试锁着「展开工作台」 |
| Security | **AWN** | L8 是 5 分钟租手的身体；L3+ 外泄必须人点，不能让 Codex 自签 |
| External | **AWN** | 用户面不要再说 Handoff（撞 ACP 编程接力）；公开配方必须写 T1 未跑 |

四路均 **APPROVE_WITH_NITS** 深化正文。**REJECT** 把 115 行当实现票。

**Dual-review `20260826-144035`：** Claude Product / Impl / Security + Pi 均 **AWN**。nits 已折进 SoT（hide-not-delete、L8 grace-kill 三条路径、披露可撤销、切片 2 带走 `mcp-confirm-target` 测试）。

## 合成锁（折进 SoT）

1. **用户面第四段 = 租手**（Outbound MCP）。「Handoff / 编程接力」只指 ACP。`cmspark__*` ≠ `cmg_` ≠ `acp_*` ≠ `ws_secret`。
2. **L8 是 5 分钟租手的 DoD**，不是后置 overlay 修 bug。Overlay 起源 L2 今天 `originWs=overlay`，关窗会杀确认。
3. **L3+ 页文/截图外泄 = 操作者 HITL**（签发钥匙勾选和/或首次外泄确认台）。`cmspark__accept_data_disclosure` 调用方自签 **不够**。
4. **HUD 五轨**：对话 KEEP；场景/知识 USE FREEZE；技能开关不陈列；**MCP 轨从展开铬拿掉**。协议不撕。Mac HUD stdin `mcp.add`/`knowledge.import` **冻结藏入口**。
5. **钥匙门 = CLI 默认**（`outbound-grant issue`）± Mac 托盘一次性窗；侧栏设置留作备用。**禁止** overlay WS 签发。
6. **双壳保持**；同一文案合同。`knowledge.get` 托盘窗本季 **否**。Win/Linux 原生确认本季 **否** → 打开 Chrome 确认台。
7. 公开租手配方：**实验 / 非产品 ship / T1 未跑**。T1 门面宽，不门形态存在。
8. 匹配 IDF / RunProgress **不挡** 切片 1–3。

## 实现者不准发明的洞（已在 SoT 写死）

- 「打开确认台」按钮做什么（fan-out + 扩展自己开 Cockpit + F-I-4）
- Chrome 关着：L0 能聊 / L1 CTA / 租手 fail-closed
- 复制测试会锁死旧文案，切片 3 必须改测试
- `confirm-target.ts` 在 `mcp/` 不在 `ws/`；MCP 重定向 ≠ overlay L2 已修

## 不推翻

ADR-020 · ADR-022 L3/L4/L5/L8/L9（L2 **叙事句**随 PRODUCT.md 改「家」）· ADR-025 · overlay 无 Allow/Deny · 无第二扩展 · grant ≠ `ws_secret`
