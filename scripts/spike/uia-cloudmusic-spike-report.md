# Spike 报告：UIA/SMTC 对网易云音乐的可操作性验证

> 日期：2026-07-18 · 分支：computer-use-w8-windows · 性质：只读探测（无 Invoke/SetValue/SetFocus/SendInput）
> 脚本：`uia-cloudmusic-probe.ps1` / `-v2.ps1` / `-v3.ps1`，原始结果存于同目录 `.result.json`

## 触发问题

App 页签（P1）能**启动**网易云音乐后，能否进一步**操作**它（输入歌名 → 搜索 → 播放）？

## 方法与证据

1. **v1**：按主窗口 pid 过滤枚举 UIA 树 → 仅 5 节点（Window×1 + Pane×4），无 Edit/Document，等待 4s 无水合
2. **v2**：枚举**全部** cloudmusic 进程（`#772`/`#1564`/`#16340`/`cloudmusic_reporter#20336`）的**全部**顶层窗口 → 只有 1 个顶层窗口，class = `OrpheusBrowserHost`，树仍 5 节点，两次探测均无水合；FromPoint 命中的 `Chrome_WidgetWin_1` 后经查证（v3）是**用户 Chrome 浏览器窗口（pid 25108, chrome.exe）压在上方**，非网易云内容窗口
3. **v3**：爬进该 Chrome 窗口验证 UIA 本身工作正常 → bilibili 页面 163 节点、Edit×2（弹幕框、地址栏）全部可读——**UIA 对 Chrome 完全可用**，反证网易云侧是宿主不暴露
4. **SMTC**：`GlobalSystemMediaTransportControlsSessionManager` 成功列出会话（当前为 Chrome，Paused，含曲名）——**系统级媒体控制通道可用**；网易云播放时会注册自己的会话

## 结论

| 层次 | 可行性 | 证据 |
|---|---|---|
| L1 播放控制（SMTC：播放/暂停/切歌/当前曲目） | ✅ 可行 | SMTC 会话枚举成功，网易云播放时即注册 |
| L2 UIA 语义自动化（读搜索框、填词、点播放） | ❌ 对网易云不可行 | OrpheusBrowserHost 单窗口离屏渲染（OSR），UIA 树 5 节点、不响应 a11y 水合；进程树无独立渲染窗口 |
| L2' 坐标化操作（截图 + 多模态/OCR 定位 + SendInput） | ⚠️ 通用兜底，未验证 | 不依赖应用配合，同 IL 无需 UIAccess/EV 证书；成本是脆弱性（DPI/多屏/前台态）+ 信任模型需单独设计 |
| L3 CDP 深度控制 | ❌ 不推荐 | 需带参启动（`--remote-debugging-port`），安全面失控 |

**意外收获**：UIA 对正规 Chromium/Electron 应用（Chrome 实测：163 节点、搜索框/地址栏可读）是可行的 → 应用可操作性是 **per-app 属性**，App 页签未来可挂一个 `uiaCapable` 探测位（枚举时顺手跑一次本 spike 的轻量版）。

## 对路线图的影响

- **SMTC 媒体控制**（原 P3 挂账）性价比最高，可提前：实现 ~1 个 WinRT 封装 + 工具描述，安全等级等同按媒体键
- **坐标化「真·computer-use」模式**是独立大方向（截图 → 多模态定位 → 模拟输入 → 逐步 evidence），值得单独立项做 规划→对抗 流程，不应混进 App 页签 P2
- App 页签 P2 的 CLI track / 参数模板不受影响，继续按 Issue #70 推进

## 复现

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\spike\uia-cloudmusic-probe-v2.ps1
# 前置：网易云音乐已启动且有主窗口；注意屏幕前方的其他窗口会干扰 FromPoint（v2/v3 已踩过）
```
