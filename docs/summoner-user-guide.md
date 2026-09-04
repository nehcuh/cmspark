# 召唤器（Capture 卡）— 用户指南

> 产品 **0.5.9** · 产品句：[PRODUCT.md](../PRODUCT.md) · 设计：[DESIGN.md](DESIGN.md)  
> 听写/会议细节：[meeting-and-dictation-user-guide.md](meeting-and-dictation-user-guide.md) · 外部热键：[summoner-launcher-plugins.md](summoner-launcher-plugins.md)

### 能力坐标

| 轴 | 本指南位置 |
|----|------------|
| **产品面** | **Capture**：热键开口，不是 Side Panel，也不是确认台 |
| **Trust** | 卡上 **永不** Allow/Deny；Companion **从不** `chrome.sidePanel.open` |
| **规范** | [PRODUCT.md](../PRODUCT.md) 四面 · [ADR-020](adr/020-capability-model-three-axes.md) |

---

## 1. 一句话

召唤器是一张 **360×420** 的 HTML Capture 卡：说话或打字把活交出去。人盯着 Chrome 时用侧栏 Operate；危险只在确认台。

Mac 菜单 / 已配置热键 / 工具栏 **C** / 侧栏顶栏 **弹出对话框** 打开的是**同一张卡**。

## 2. 怎么打开

| 入口 | 说明 |
|------|------|
| 托盘 / 菜单栏「召唤器」 | Companion 已在跑时打开 HTML `--app` 窗 |
| 已配置的全局热键 | 以托盘设置为准；Raycast/uTools 只当分发，见 [launcher 插件](summoner-launcher-plugins.md) |
| Chrome 工具栏 **C** | 扩展图标；也是打不开侧栏时的退路 |
| 侧栏 **弹出对话框** | 从 Operate 面弹出同一张卡，不是第二个产品 |

打不开侧栏时 toast **请点工具栏 C**。Companion 不调用 `chrome.sidePanel.open`；扩展 Service Worker 才开侧栏。

## 3. 卡上有什么

- 问答（HTML 卡跟 `chat.token` **流式出字**；Swift 旧条本已流式，未改）
- 📎 附件、听写、开始/结束会议
- **打开浏览器并打开侧栏**

**没有：** Allow/Deny、装配（技能/知识/MCP/任务包）、WorkBuddy 五轨、「去侧栏批准」。

## 4. 和另外三面怎么分

| 面 | 不在这张卡上 |
|----|----------------|
| **Operate** | Side Panel ~320px；空态「要对这页做什么」 |
| **Confirm** | 确认台 / Mac 托盘。Win/Linux 必须开 Chrome 确认台 |
| **租手** | Outbound MCP + `cmg_`，见 [mcp.md 5 分钟租手](mcp.md#outbound-mcp) |

## 5. 失败与诚实边界

- 卡没出来：Companion 没起来，或扩展未配对。先托盘 / `cmspark-agent daemon start`。
- 「请点工具栏 C」：没有用户手势，扩展开不了 Side Panel。点工具栏，不要等悬浮卡自己开。
- 听写失败：本机模型不可用时默认**当次会话**回退浏览器听写并出横幅（可关）。见听写指南。
- 不是 tab 条旁边的药丸；不要声称 CMspark 坐在标签栏旁。

禁止：在悬浮卡上做确认；把 `ws_secret` 当租手钥匙；把 Raycast/uTools 做成第二套 CMspark。
