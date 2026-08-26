# 用户椅子 · 产品形态（修订 08-26 策略）

> **日期**: 2026-08-26  
> **状态**: **LOCKED 脊柱** · Claude Code 三路 + Pi 均 AWN `user-first-form-*-20260826-140417`  
> **可实现身体**: [2026-08-26-product-form-deepening-design.md](./2026-08-26-product-form-deepening-design.md)（**LOCKED** · 四路 + Claude 三路 + Pi 均 AWN `144035`；用户面第四段 = **租手**，勿称 Handoff）  
> **修订**: 部分推翻 [08-26 策略](./2026-08-26-summoner-strategy-rethink-design.md) 的「捕获条冻结 / 插件降级」  
> **不推翻**: ADR-020 三轴、ADR-022 L3/L4/L5/L9、ADR-025、overlay 无 Allow/Deny、无第二 Chrome 扩展  
> **对抗**: [synthesis](../../audit/reviews/user-first-form-adversary-synthesis-20260826.md)

```text
Surface:      Capture=召唤器 ; Operate=侧栏或后台 CDP ; Confirm=确认台/托盘
L2-classes:   召唤器上无新类
Compose:      这轮 USE（pack/skill/knowledge pin）; 租手=Outbound MCP 一级 ; ACP 反向（勿称 Handoff）
Autonomy:     同一 tool-loop
Trust:        overlay 永不 Allow/Deny ; grant ≠ ws_secret ; F-S-10 用工作台修、不用 overlay 管 MCP 盖
Channel:      community ; 召唤器可关 ; outbound 非 default-on
```

---

## 0. 发心（用户语言，第一句）

> 热键说一句。要干活，用你**已经打开、已经登录**的 Chrome。人在侧栏就在侧栏看；人在 Codex 就在 Codex 里开同一只手。危险的事先弹确认台。不是第二套 Codex，也不是给每家 AI 再装一只扩展。

PRODUCT.md 的「Side Panel 是家」改为：**家是已登录的 Chrome + 硬闸**。侧栏是人盯着 Chrome 时的 Operate 面。人在别的 Agent 里时，Operate 是后台 CDP，确认台才弹出。

---

## 1. 吸收用户三点

### 1 召唤器随对话长大 — KEEP 意图，MAJOR_REVISE 边界

用户不会满足于问答。形态：

| 在召唤器里做（这轮活） | 不在召唤器里做（装配/放权） |
|------------------------|------------------------------|
| 说、贴、打断、切对话 | `config.set`、密钥、`mcp.add` |
| 已接线的技能/知识 **挂到本轮** | 知识 get/导入/改正文（CONFIGURE） |
| overlay-eligible、不升 Trust 的套场景 | 域白名单、CU 武装 |
| 发起要动网页的 tool-loop | 在浮窗点允许/拒绝 |

浏览器两条路（用户原话）：

- **(a) 后台驱页**：Chrome 可最小化，扩展必须连着 Companion。危险 → **确认台 / macOS 托盘**，不是浮窗按钮。  
- **(b) 打开/前置 Chrome**：已有 `open -ga Google Chrome` / `attachChromeOnly`。诚实：**不能替你弹出侧栏**（Chrome 手势物理）。要盯页、过验证码，走这条。

Win/Linux 无原生托盘确认时：(a) 的批准 = 打开 Chrome 上的确认台，**不许**因为没人能点就跳过。

### 2 给别人当浏览器手 — KEEP 为一级工作

上一轮把这降成「MCP 附录 / 别变成 BrowserSkill」是工程师椅子。用户要的是：

> 我的 Codex 要用我已经登录的 Chrome，用起来像 CMspark 自己用一样。危险的我还能拦。

形态 **仍是** Outbound MCP（一只扩展，多宿主走 stdio），**不是** CWS「CMspark for Codex」。Skill 只写何时用我们 vs Playwright vs DevTools MCP。

T1 bake-off 门 **面宽**（不准扩成无闸通用 Browser MCP），**不再门**「Handoff 算不算产品形态」。门面代码已在；5 分钟路径（mcp add + grant + 无侧栏确认）才是欠的身体。

### 3 先用户后形态 — KEEP 过程

08-26 文档第一句是 Surface/ACL。本文件第一句是发心。物理约束形态（浮层不可信 HTML、CDP 要扩展、确认台住在 Chrome 窗），不取消工作。

---

## 2. 四段形态（同一只手的出现时机）

```text
Capture  →  Operate  →  Confirm  →  租手
召唤器      侧栏或后台CDP   确认台/托盘    Codex 等租这只手（Outbound MCP；勿称 Handoff）
```

不是四套 App。召唤器展开文案改为 **「展开对话」**（禁止再写「展开工作台」）。本形态图里 **Confirm 段** 的「工作台」= 确认台/Cockpit+托盘。会议工作台、编程观察台保持原名，不在这张图的 Confirm 段。

修订 F-UX-OVERLAY-1：

- **USE**（list / set_active / 本轮挂载）可在召唤器 — 代码已有。  
- **CONFIGURE**（get 全文、import、update）不在 overlay socket。  
- **批准** 文案从「去侧栏」改为「打开确认台」。  
- Overlay **永不** Allow/Deny。  
- 代码里确认导体仍写「去侧栏批准」——本季要改到确认台/托盘；**今天还没改完**，规格不是现状。  
- Mac HUD 经 **tray stdin** 已有「添加 MCP / 导入知识」：本季 **冻结**（不是 overlay WS，也不当许可证再扩）。`mcp.toggle_server` / `skill.activate` 继续冻结，回滚票 `overlay-acl-rollback`。

---

## 3. NEVER（修订后仍成立）

1. 第二只 Chrome 扩展（CWS for Codex/Claude/Cursor）  
2. 召唤器五轨变成 WorkBuddy；第三聊天  
3. 侧栏 IDE；ACP `allow_exec`；静默 apply  
4. Overlay 确认方言；`knowledge.import/get` 进 summoner WS；`mcp.add`；`config.set`；HTML 麦  
5. 默认 outbound 放入 L2 / cookies / evaluate / shell  
6. `ws_secret` 当 MCP grant  
7. 因 overlay 不能点就跳过确认  
8. Jira/GitHub 当 CMspark 对象双向同步  
9. 默认 embedding / Companion 内嵌 Python matcher  
10. 用 overlay 管 MCP 掩盖 F-S-10  

**作废的上轮 NEVER：** 「给别人当插件整段降级」；「脱离扩展的一概不得在召唤器」；「T1 没跑就不能把 Handoff 当形态」。

---

## 4. 本季（用户可见）

1. **租手 5 分钟**：mcp add 片段 + grant 不必先翻侧栏设置 + Codex 驱动时确认台/托盘真的出现（身体见深化 SoT；L8 算同一里程碑）  
2. **Confirm L8**：overlay 起源的 L2/MCP 确认 fan-out 到确认台+托盘，origin 不绑 overlay  
3. **召唤器诚实**：Chrome 关着哪些会失败；「打开浏览器」按钮；「展开工作台」改为「展开对话」  
4. **T1 真人**：门面宽，不门形态存在  
5. 侧栏空态/作曲/启动（看山）  
6. 匹配诚实 / RunProgress 不挡 1–3  

---

## 5. 开放

- Mac HUD vs HTML 双壳是否并成一条展开面（本 SoT 不强制）  
- `knowledge.get` 是否允许走 **tray 原生窗**（非 overlay WS）只读查看  
- Win/Linux 托盘原生确认的工时 vs 强制打开 Chrome 确认台  
- 对外：grant 前缀 `cmg_` ≠ 工具名前缀 `cmspark__*`（文档勿混）  
