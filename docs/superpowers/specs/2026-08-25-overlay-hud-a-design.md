# Overlay HUD A — Darwin 一条输入条（SUPERSEDE Slice B）

> **日期**: 2026-08-25  
> **状态**: SUPERSEDED in part by `2026-08-25-overlay-hud-expand-design.md`（展开图标轨；收起仍是一条条）
> **仍 LOCKED**: borderless + canBecomeKey、📎 MIME/lease、无 HTML getUserMedia、无 overlay Allow/Deny  
> **SUPERSEDES**: `2026-08-25-overlay-dogfood-slice-ab-design.md` Slice B（Darwin → Chromium `--app`）  
> **STALE dual**: `overlay-dogfood-slice-ab-impl-verdict-20260825-142137` 只覆盖已否的 HTML Darwin，不描述 HEAD  
> **Slice A 侧栏**（markdown `breaks` + pack radio）：仍有效，不在本文件改  
> **触发**: 用户否 `--app`「更丑」→ 四路+Claude/Pi 均 REJECT 工作台冒充悬浮窗 → 用户选 **A**

```text
Surface:      L0 Darwin HUD（无标题条、无左轨）；Win/Linux 仍 C-thin HTML
L2-classes:   (none)
Compose:      overlay 不 apply pack；知识 USE 仅线程已挂 id
Autonomy:     n/a
Trust:        overlay ACL 不涨；无 HTML getUserMedia；📎 走既有 file.upload
Channel:      community
```

**Blast**: T2。

---

## 0. 产品锁

Mac 快捷提问是 **一条可输入的浮动条**：结果 / `#` 命中 / 转录 **掉在条下**，Esc 关。不是迷你侧栏，不是 Raycast/uTools 重做（注释与 UI **禁止**这两个品牌名，F-UX-NOUN-1）。

| 有 | 无 |
|----|----|
| 无标题 traffic-light；`NSPanel` `.borderless` + `.nonactivatingPanel` + `.floating` | 200pt 对话/MCP/场景轨 |
| 一条 composer；📎 🎙 在条上；「+」新对话 | 发送大按钮作主 CTA（回车发送） |
| `#` 搜标题切线程（已有） | overlay `knowledge.*` / pack.apply 按钮 / MCP 管理 |
| 知识 copy：**配置去侧栏**；本对话沿用已挂知识 | Allow/Deny；companion 开侧栏 |
| Esc / 再按热键 关闭 | 把 Chromium `--app` 当 Mac 用户面 |

Win/Linux：仍 `openSummonerWebShell`。本刀不把 HTML 收成 HUD。

---

## 1. 📎 必须形成闭环（Impl BLOCK 折叠）

1. Swift 每个文件 **非空 MIME**（扩展名映射，否则 `application/octet-stream`）。**禁止** `"type":""`。不放宽 `validate.ts` 的 truthy `type`。  
2. Node `handleSummonerFiles`：空 type 再 coerce 成 `application/octet-stream`；**`claimOverlayIfLive`**（与 submit/new_thread 同形）；空 `thread_id` 先建线程再 claim，禁止 hydrate 空 lines 冲掉已有转录。  
3. `mapChatMessageToSummonerCmd` 映射 `file.upload_error` → HUD `summoner.error`。  
4. Swift 单文件上限 **6MiB raw**（Base64 后低于 `WS_SOFT_MAX`）；跳过则 HUD 报错，禁止全 `continue` 静默。最多 8 个。  
5. 乐观转录 `你: 📎 filename`。  

🎙：保持按住听写（既有 tray `voice.stt.*`）。不把 STT 加进 `SUMMONER_WEB_DISPATCH_ALLOW`。

---

## 2. 验收

- Mac 菜单/热键打开的窗口：**无** `.titled` traffic-light、**无** `makeRail`、Esc 走 `hide()`。  
- 源码与注释 **无** Raycast/uTools 形态自称。  
- 小 `.txt` 📎：`type` 非空 → `file.upload` 能过 validate；失败时 HUD 有 `系统:` 行。  
- `SUMMONER_WEB_DISPATCH_ALLOW` / `SUMMONER_ALLOW` 不新增 `knowledge.*` / confirm。  
- SHA pin == `companion/dist/cmspark-tray`。  
- 测试能因空 MIME / 无 lease / 无 `file.upload_error` 映射而红（不是只 grep `NSOpenPanel`）。

---

## 3. 明确不做

HTML 麦克风；overlay 知识勾选/导入；overlay 套场景；companion 打开侧栏；Win HUD；Raycast 插件生态。
