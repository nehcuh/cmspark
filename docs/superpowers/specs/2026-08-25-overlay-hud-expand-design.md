# Overlay HUD Expand — 收起一条条，展开 Companion 工作台

> **日期**: 2026-08-25  
> **状态**: B0–B4 已落地（对话管理 / 场景 apply / MCP 开关 / 技能 / 知识 USE+导入 HITL）  
> **视觉世界**: 看山纸面（PRODUCT.md）· Operate · 拓扑对标 Codex / 千问办公 / WorkBuddy，**不**用紫粉 SaaS 调色  
> **SUPERSEDES**: `2026-08-25-overlay-hud-a-design.md` 里「无左轨 / 知识配置去侧栏 / overlay 不管 pack·MCP」  
> **保留**: HUD A 的收起形态、borderless + `canBecomeKey`、📎 MIME/lease 闭环、无 HTML getUserMedia  
> **视觉参考**: Codex 桌面（左导航 / 中对话 / 底输入）、千问办公、WorkBuddy（白底、分类任务、不大按钮堆）  
> **Mockup**: `docs/design/overlay-hud-expand-mockup.html`

```text
Surface:      L0 overlay HUD collapse + L0 overlay workbench expand
L2-classes:   (none on this surface)
Compose:      threads / pack / knowledge / skill / mcp — Companion-owned, not Chrome Side Panel
Autonomy:     n/a
Trust:        summoner ACL grows for composition read + overlay-safe write;
              confirm stays native tray panel; no overlay Allow/Deny dialect;
              no HTML getUserMedia
Channel:      community
```

**Blast**: T2 UI；`mcp.add` / `knowledge.import` 上 overlay = T3（须 dual）。

---

## 0. 产品锁

收起是召唤条。展开是 **同一扇窗向下变高** 的 Companion 工作台，**不是** 200pt 标签堆、不是 Chromium `--app`、不是「去侧栏」。

网页 CDP 仍要 Chrome 扩展。对话管理、场景、知识、技能、MCP **不经过扩展**。

手势：条右侧 **⌄ 展开 / ⌃ 收起**。Esc / 热键关整窗。

---

## 1. 布局（对标三家，不抄品牌）

| 区 | 规则 |
|----|------|
| **底栏** | 永远在；+ 输入 📎 🎙 ⌄。展开后仍在底（Codex / WorkBuddy / 千问同构），不要把发送做成主按钮。 |
| **图标轨 52pt** | 对话 / 场景 / 知识 / 技能 / MCP。图标 + tooltip，一次只高亮一个。禁止三块文案同时堆在左栏。 |
| **一类列表 ~220pt** | 只渲染当前分类（线程 或 场景 或 知识…）。行：标题 + 一行次要信息。选中 = 靛蓝浅底。 |
| **主列** | 当前对话全文（可滚动）。其它分类用一两句说明 + 列表已承担管理。 |
| **视觉** | 看山纸面：`--paper #fff` `--text #171717` `--canvas #f4f4f5` `--indigo #4F46E5` 只用于选中/焦点环。16px 卡片、8px 节奏、轨钮/列表行/底栏 ≥44px。导航用描边 SVG，不用 emoji。无浏览器徽章、无「去侧栏」、无标题 traffic-light。 |

反模式（已否）：titled 640 窗 + 200pt「对话 / MCP / 场景」竖堆 + 顶栏输入 + 发送大按钮。

---

## 2. 组合面（Companion WS，不经 Side Panel）

展开后各分类最低能力：

1. **对话**：列表、搜索、新建、切换、**重命名、移到回收站**。不经 Side Panel。  
   - 协议：`summoner.thread.rename` / `summoner.thread.trash`（stdin）；WS `thread.update` / `thread.delete`。  
   - Overlay-safe：`thread.delete` **只许 `mode:"trash"`**（省略/hard → `SUMMONER_ACL`，禁止默默改成 trash）。`thread.update` **只许 `alias`**，其它 key 剥掉；空 alias 拒绝。  
   - 回收站确认用原生 `NSAlert` / HTML `confirm`，**不是** overlay Allow/Deny，源码不得出现「确认/允许/拒绝」。  
   - 删当前对话后切到最近一条，没有则新建。本刀不做还原/硬删/批量。  
2. **场景**：列表 + 套到当前对话。`pack.list` / `pack.apply`（仍 overlay-eligible、不升 Trust）。  
3. **MCP**：列表、开关；添加走原生表单。需给 summoner 开 `mcp.toggle_*`（读已有 `mcp.list`）。`mcp.add` = T3。  
4. **技能**：`skill.list` 上 overlay ACL；开关/安装第二刀。  
5. **知识**：列表 + 挂到当前对话（USE）。导入 = `NSOpenPanel` + **托盘原生确认**（CONFIGURE，不经侧栏）。`knowledge.*` 上 overlay = T3。

批准 / Allow-Deny：**不**做进 HUD；沿用托盘确认窗。

---

## 3. 实现波次

- **B0** 展开骨架 + 对话列表/历史（协议已有）+ 本视觉  
- **B0.5** 对话重命名 + 移到回收站（Mac HUD + C-thin HTML；Companion 自管）  
- **B1** 场景 apply  
- **B2** MCP 列表/开关  
- **B3** 技能列表  
- **B4** 知识 USE + 导入 HITL  

Win/Linux HTML 本文件不改成 HUD；先 Mac。

---

## 4. 明确不做

把旧 `makeRail` 加回来；展开再开 `--app`；HUD 内 Allow/Deny；HTML 麦；Raycast/uTools 品牌自称；overlay 硬删 / `tool_whitelist` / 知识 id 写入。
