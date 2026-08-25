# Overlay dogfood Slice A+B — 方向锁（待 dual）

> **日期**: 2026-08-25  
> **状态**: SUPERSEDED（Slice B Darwin→HTML `--app` 已被用户否）· 继任 `2026-08-25-overlay-hud-a-design.md`  
> **Slice A 侧栏**（markdown breaks + pack radio）仍有效  
> **旧 dual**: 方向 `140045` / 实现 `142137` 对 HEAD 的 Darwin 壳 **STALE**  
> **触发**: 用户狗食 4 问 → 四路独立对抗合成  
> **坐标**: ADR-020 · C-thin 召唤壳 · Knowledge Honesty F-UX-OVERLAY-1

```text
Surface:      L0 overlay composer honesty ; L0 Side Panel markdown + pack radio
L2-classes:   (none)
Compose:      pack highlight is UI only ; knowledge USE via existing thread ids (no overlay knowledge.*)
Autonomy:     n/a
Trust:        overlay ACL does not grow ; no HTML getUserMedia ; no confirm
Channel:      unchanged
```

**Blast**: T2。

---

## 0. 用户 4 问 → 裁决（对抗后）

| # | 体验 | 分类 | 本切片 |
|---|------|------|--------|
| 1 | 快速对话框没有附件 / 语音按钮 | **双壳撒谎**（Mac 托盘开 Swift NSPanel，🎙/Chrome-attach 被 `isHidden=true`；C-thin HTML 才有 `<input type=file>`，无麦） | **Slice B**：收成一条 C-thin 壳；📎 看得见；**本刀不做 HTML 听写** |
| 2 | 对话 markdown 没有换行 | **侧栏 bug**：`marked.parse` 无 `breaks: true` | **Slice A** |
| 3 | 场景「会议记录」常亮 | **侧栏 bug**：`meetingCard` 永远 `accentSoft`，与 `mission_pack_id` 无关 | **Slice A** |
| 4 | 浮窗也要「使用和配置」知识库 | **拆动词**：USE 已有（`chat.create` → `active_knowledge_ids`）；CONFIGURE = overlay 知识管理 | **CONFIGURE = NO-GO**；copy 诚实「配置去侧栏」 |

---

## 1. 锁（不可破）

- **F-UX-OVERLAY-1** 不新增 `knowledge.*` / `config.*` / `mcp.add` / confirm。不假装 `sidePanel.open`。
- Overlay **禁止** loopback HTML `getUserMedia` / 把 `voice.stt.*` 加进 `SUMMONER_WEB_DISPATCH_ALLOW`（token 在 URL + `unsafe-inline`）。
- Swift NSPanel **冻增长**（C-thin 已锁）：本切片不给 Swift 加 NSOpenPanel、不 unhide 🎙 当第二条产品。
- 会议工作台 ≠ 场景单选；不要把工作台并进 pack radio。
- 知识 **USE** 只走线程已挂 id；新浮窗线程默认空挂载是诚实的。

---

## 2. Slice A — 侧栏狗食（无 overlay ACL）

1. `ChatView` `marked.parse`：`breaks: true`（GFM 单 `\n` → `<br>`）。不换 remark-gfm。测：含单个换行的正文渲染出 `<br>` 或等价硬断行。  
2. `PacksPanel`：`meetingCard` 默认与 `stateCard` 同底；**仅当** `activePackId === "meeting-minutes"` 才 accent。列表项 `isActive` 用互斥高亮（对齐 ThreadList 选中壳）。会议区仍是工作台入口，不是「已选场景」。

**验收**

- 侧栏助手消息 `行1\n行2` 可见两行。  
- 未应用会议场景时会议卡 **不** 看起来像选中。点其他场景，只有该行高亮。

---

## 3. Slice B — 一条快捷提问窗

**现状（Mac DMG）**：`Tray.swift` 菜单/热键 `summonerController.open` → Swift NSPanel。Node `handleAction("summoner")` → HTML `--app`（Win/Linux）。用户在 Mac 上看不见附件。

**本切片**

1. Darwin 托盘「召唤器」与热键改为打开 **同一份** C-thin HTML（`openSummonerWebShell` / `openLoopbackPage`），与 Win 对齐。Swift overlay **不再作为用户面快捷提问**（可留代码，不从菜单/热键进入）。  
2. HTML 把现有 `#files` 收成 📎 标签（`label for`），不新协议。忙时仍禁传。  
3. Hint：听写 / 知识配置 / 批准在侧栏。本切片 **不做**「本对话已挂知识」条（`thread.select` 不带 `active_knowledge_ids`；禁止为此加 `knowledge.list`）。  
4. Darwin **热键按下** 与菜单「召唤器」同一出口：`jsonLine click action=summoner` → Node `openSummonerWebShell`。热键 **登记** 仍可留在 Swift（现有 Carbon）；不要开第二套 Node 热键。热键「改组合」菜单可暂留 Swift picker。  
5. 改 `Tray.swift` 后必须 `bash companion/src/tray/build-tray.sh` 并更新 `swift-tray-bridge.ts` 的 `SWIFT_TRAY_SHA256`。不要让 Node 在 Mac 路径上干等 `summoner.ready`。

**验收**

- Mac 托盘/热键打开的页面含 📎/`<input type=file>`，不含 Allow/Deny，不含知识导入。  
- `SUMMONER_WEB_DISPATCH_ALLOW` 仍无 `knowledge.*` / `voice.stt.*`。  
- 召唤器 HTML 测仍匹配「去侧栏处理」「召唤器（实验）」。

---

## 4. 明确不做

HTML 麦克风、overlay `knowledge.import/preview/related`、overlay 知识勾选、companion 打开侧栏、会议工作台进浮窗、Raycast 重做、再给 `SummonerOverlay.swift` 加功能。

---

## 5. 实现顺序

Slice A 与 B 无共享写集，可并行；合 PR 前各跑相关测 + overlay ACL 锁。
