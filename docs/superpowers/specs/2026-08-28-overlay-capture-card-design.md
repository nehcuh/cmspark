# 浮窗 Capture 卡片 — 问答 / 附件 / 听写 / 会议 / 去操作

> **日期**: 2026-08-28  
> **状态**: **draft · 用户已签设计节 §1–§6；待 dual**  
> **GitHub:** [#241](https://github.com/nehcuh/cmspark/issues/241)  
> **前序:** [#239](https://github.com/nehcuh/cmspark/issues/239) · [chat-shell-same-face-design.md](./2026-08-27-chat-shell-same-face-design.md) r2  
> **形态 SoT:** [2026-08-26-product-form-deepening-design.md](./2026-08-26-product-form-deepening-design.md)  
> **听写/会议:** ADR-023/024 · `voice_privacy_ack_v2` · `meeting_privacy_ack_v1`  
> **不推翻:** ADR-020 · overlay 永不 Allow/Deny · 无第二 Chrome 扩展 · `cmg_` ≠ `ws_secret` · 看山角色印记 · HUD 五轨 hide-not-delete · SUMMONER_ALLOW 不加 `list_tabs` / `tab.*` / confirm  
> **显式修正 F-I-4（仅④）:** Companion **进程**永不调用 `chrome.*`。用户在浮窗点「打开浏览器并打开侧栏」→ 扩展-only 帧 → 扩展 SW `chrome.sidePanel.open`。失败诚实。  
> **本文件不写代码。** 实现另开 plan + PR，`Closes #241`（可拆 PR）。

```text
Surface:      L0 Capture 卡片（overlay HTML）；侧栏视觉不动
L2-classes:   none
Compose:      file.upload；voice.stt；meeting.create/start/end；ui.open_sidepanel 仅扩展槽
Autonomy:     none
Trust:        overlay 永不 Allow/Deny；F-I-4 修正见上
Channel:      community
```

**Blast:** 本文件 = **T0 文档**。落地 = **T3**（overlay ACL 上涨 + F-I-4 修正）。不是 T4。引擎 Chrome 窗 vs OS HUD / Swift 重绘 = **另票**。

---

## 0. 产品句

弹出的小窗是一张 Capture 卡片：问答、加附件、听写、开始会议，都不必先开浏览器。要去页上动手，点「打开浏览器并打开侧栏」；打不开就请点工具栏 C。

不是 Chrome 里的 Gemini。家仍是**已登录 Chrome + 硬闸**。侧栏仍是 Operate 台，本票不换侧栏皮肤。

**可验收的椅子：** 点侧栏「弹出对话框」（#239 协议已通）看到约 400×520 `--app` 单栏卡，四件事入口都在。Mac 热键仍是 Swift 旧条。

---

## 1. 为何开这张票（#239 之后）

#239 把 copy 合同贴进旧 HUD，再 `setExpanded(true)` 撑成 720×520。狗食结论：通了，但是召唤器工作台。

用户四件事（签过）：

| # | 场景 | 本票 |
|---|------|------|
| 1 | 简单问答 | 单栏卡 + 作曲区 |
| 2 | 基于附件问答，不用开浏览器 | 📎 第一眼；已有 `file.upload` |
| 3 | 听写 / 开始会议，不用开浏览器 | 🎙 接通 `voice.stt`；「开始会议」+ 隐私 |
| 4 | 去页上操作 | 「打开浏览器并打开侧栏」；失败「请点工具栏 C」 |

---

## 2. 考虑过的路

| | 路 | 为何 |
|--|----|------|
| 否 | 只做空问答卡 | 用户 REJECT：缺 2/3/4 |
| 否 | 贴在网页上的浮层 | 引擎票；Chrome 一等公民特权 |
| 否 | 侧栏也换卡片皮肤 | 320px 停靠栏套浮卡假；侧栏空态 #239 已过 |
| 否 | CSS 涂 720×520 网格 | 轨还在，还是工作台 |
| **A 采用** | **原地改 `summoner-web` 成单栏卡** + 四件事接通 | 一份 HTML；Win/Linux 托盘同壳；Mac Swift 不动 |

---

## 3. 第一屏（layout）

`--app` 窗约 **400×520**（`shell-open.ts` `--window-size`）。系统标题栏还在。

```
[看山 26px] CMspark
            （flex）
        看山 52px
     要我帮你做什么？
   回车发送。附件和听写不用开浏览器。
            （flex）
 [📎]  问 CMspark…              [🎙]
 开始会议          打开浏览器并打开侧栏
```

- 单栏。`.body` 不再用 `rail | list | main` 占格。rail/list **DOM 仍在、hidden**（五轨冻结）。
- 空态**无**「这一页」芯片、无三条建议。
- 看山，不换 Gemini 星星。
- 黄条 `cta-box` **仅** Chrome 未挂上 / 需确认台时出现，不进第一屏。
- 默认整张脸。本票 HTML **不**再把收起条当第一眼（chevron 可留、hide-not-delete）。

---

## 4. 四件事接通

### ① 问答

已有 `chat.create` / SSE。无协议新类型。

### ② 附件

已有 `#files` + `file.upload`（`SUMMONER_WEB_DISPATCH_ALLOW`）。本票只把回形针抬到作曲区左侧、可点、第一眼。不经过浏览器。错误用现有 `file.upload_error` 原文。

### ③ 听写

**现状：** HTML `#mic` **disabled**，title「听写在侧栏」。`voice.stt.*` 已在 `SUMMONER_ALLOW`（Swift），**不在** `SUMMONER_WEB_DISPATCH_ALLOW`。

**本票：**

1. HTML dispatch / SSE 补 `voice.stt.start|chunk|end|abort|partial_request` 及对应事件（与侧栏 Path B 同协议）。
2. 第一次点 🎙 → **v2 六条**（`VOICE_PRIVACY_ACK_V2_CLAUSES` 原文）→「我已了解」才 `voice.stt.start` 且 `privacy_ack_v2: true`。
3. 浮窗不是扩展页，**不读** `chrome.storage`。每开一扇窗确认一次。
4. 组件/模型未就绪 → 「侧栏 ⋯ → 设置 → 听写 → 下载组件/模型」。不开假麦。
5. 麦权限是 **127.0.0.1** `--app` 窗，不是扩展页。失败句写清。
6. 识别结果进草稿，**不**自动发送。不是连续听写 v3。
7. **Supersede** HTML 文案 `SUMMONER_MIC_SIDEBAR`（「听写在侧栏」）**仅 overlay HTML 卡**。Swift HUD 本票不翻。

### ③ 会议

**现状：** `meeting.*` **不在** `SUMMONER_ALLOW` / HTML dispatch。

**本票：**

1. **只**把 `meeting.create` / `start` / `end` 放入 `SUMMONER_ALLOW` **和** HTML dispatch + 对应 SSE（`meeting.created` / started / ended / `meeting.error`）。不加 list/get，除非落地时 `start` 无 id 已自建会话（现有 handler：无 id 则内部 create）。
2. **不加** `meeting.generate_minutes` / `auto_diarize` / `import_text` 到 overlay（纪要仍在侧栏）。
3. 点「开始会议」→ 侧栏 MeetingPanel **五条原文** →「我已了解」→ `meeting.start` 且 `privacy_ack_v1: true`。voice v2 **不能**替代。
4. 每开一扇窗确认一次。卡上随后只有「结束会议」。
5. 未就绪与听写同一句。永不 Allow/Deny。Pack 不会自动开始录音。
6. **Origin：** 现网 `handleMeetingMessage` 只放行 `chrome-extension://`。本票对 **create/start/end** 扩到与 `voice.stt` 相同：`chrome-extension://` **或** summoner surface / `cmspark-tray:`。`generate_minutes` 等仍 **仅**扩展 origin。
7. 录音 mic 在 **overlay HTML** `getUserMedia`，分段走已有 `voice.stt.*`（与 MeetingPanel 同一协议，不新发明 meetingId 字段）。Companion `meeting.start` 不代开麦。

### ④ 打开浏览器并打开侧栏

**F-I-4 修正（写进 PRODUCT/DESIGN 落地 PR）：**

| 谁 | 做什么 |
|----|--------|
| Companion / 托盘 Node | **永不** `chrome.sidePanel.open`、永不 `openSidePanel()` 冒充已打开侧栏 |
| 浮窗按钮 | POST loopback（如 `/api/operate`） |
| 处理 | `attachChrome({ foreground: true })` + **无 id** 广播 `ui.open_sidepanel` |
| 扩展 SW | 已认证扩展槽接收 → `chrome.sidePanel.open({ windowId })` |
| `ui.open_sidepanel` | **不进** `SUMMONER_ALLOW` / HTML dispatch / overlay SSE（与 `overlay.shell.open` 同级：扩展-only） |

失败（无扩展 peer / Chrome 拒绝无手势 open）→ toast **「请点工具栏 C」**。Chrome 仍可能已被前置。不把失败写成侧栏已开。

**Supersede #239 pin 5 作为浮窗④的主路径：** 不再用「我们不能替你打开侧栏」当唯一 CTA。该句留作**失败**文案。成功路径是扩展 SW 打开。

---

## 5. 失败态

Toast 在卡片底，走错误条，**禁止** `SET_PROCESSING_STATUS` 当 toast（#239 已踩：会拆空态）。

| 动作 | 失败 | 用户看到 |
|------|------|----------|
| ④ | 扩展没连 / `sidePanel.open` 拒 | 请点工具栏 C |
| 打开 Chrome | 没有浏览器 | 现有 attach 失败原文 |
| 听写 | 未 ack / 组件未下载 / 麦权限 | §5 屏 / 设置路径 / 允许 127.0.0.1 麦克风 |
| 会议 | 未 ack / STT 未就绪 | §4 屏 / 与听写同一句 |
| 附件 | `upload_error` | 现有原文 |

---

## 6. ACL / 协议（锁文件）

**可进 overlay HTML dispatch + SUMMONER_ALLOW（本票新加粗）：**

- 已有：chat.*、thread.*（政策内）、file.upload、composer.lease.*  
- **新：** `voice.stt.start|chunk|end|abort|partial_request` 进 **HTML dispatch**（ALLOW 已有）  
- **新：** `meeting.create|start|end` 进 **ALLOW + HTML dispatch**（不加 list/get/minutes）

**禁止进入 SUMMONER_ALLOW / HTML dispatch / overlay SSE：**

- `list_tabs` / `tab.*` / `security.confirmation.response` / `mcp.add` / `config.set`  
- `ui.open_sidepanel` / `overlay.shell.open`（后者已是扩展槽）  
- `meeting.generate_minutes` / `auto_diarize` / `import_text`

**Tray→Companion RPC 新类型：** `ui.open_sidepanel`（无敏感 payload）。**请求方 origin = `cmspark-tray://local` 且 `surface !== "summoner"`**（tray 进程，不是 overlay WS）。**接收方 = 扩展 SW**（无 id 广播）。handler 读 `session.origin`，**不读** payload.origin。扩展 origin 发此类型 → `UI_OPEN_SIDEPANEL_ORIGIN`（与 `overlay.shell.open` **方向相反**，不要抄 overlay-shell 的 origin 检查）。summoner surface → `SUMMONER_ACL`。tray `onAppMessage` **忽略**无 id echo。lockstep：`validate.ts` key + `message-router` case。**禁止**该字符串出现在 `summoner-web.ts`（用 `/api/operate`，#239 `doesNotMatch(/ui\.open_sidepanel/)` 仍绿）。**禁止**进 tool catalog / `getToolDefinitions()`。

---

## 7. 测试锁（点名）

- `summoner-web.test.ts`：单栏（无 `grid-template-columns` 占轨）、空态无「当前页」/三芯片、📎/🎙 可点、无「听写在侧栏」作为 disabled title、无允许/拒绝控件、cta-box 默认 hidden  
- `summoner-acl` / overlay-shell 类：`meeting.generate_minutes` 仍拒；`list_tabs` 仍拒；`ui.open_sidepanel` 不在 SUMMONER_ALLOW  
- 新测：HTML dispatch 含 `voice.stt.start`；`meeting.start` 无 `privacy_ack_v1` 拒；mic 未 ack 不 start  
- 扩展：`ui.open_sidepanel` bulk-forward；forged origin → 错码；失败 toast「请点工具栏 C」  
- F-I-4 grep：**新文件**不得出现 Companion 调用 `chrome.sidePanel.open` / `openSidePanel(` 当成功路径  
- lockstep 路径同 #239：companion 测 ROOT 到 `chrome-extension` 的 copy 常量若有新字面量

Swift `展开对话` / 收起条 **不翻**。

---

## 8. NEVER

- overlay Allow/Deny  
- 第二扩展；`ws_secret` 当 grant  
- Companion 直接 `chrome.sidePanel.open`  
- 浮窗当前页 / `list_tabs`  
- 贴页浮层、标签栏药丸、锁引擎  
- 侧栏换卡片皮肤  
- 连续听写 v3；Swift HUD 重绘  
- Gemini 星星替换看山  
- 把 #230 整票当成本票  

---

## 9. 落地文档

实现 PR 必须改：

- `PRODUCT.md` / `docs/DESIGN.md`：Capture 卡片四件事；F-I-4 修正句；HTML 不再「听写在侧栏」  
- #239 spec 不改历史正文；本文件 **supersede** pin 5（④ 主路径）与 HTML mic 文案

---

## 10. 实现切分（仍 Closes #241）

可拆 PR，**不要**拆成互不认识的 Issue：

1. 单栏卡 + 📎 可见 + 窗尺寸  
2. HTML `voice.stt` + v2 隐私屏  
3. `meeting.create/start/end` + 五条隐私屏  
4. `ui.open_sidepanel` + 失败 toast  

先 1 也能狗食「不像工作台」；2–4 不做完不得宣称 C 已交付。
