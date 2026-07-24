# S-5 Spike 报告：同 IL SendInput / SetForegroundWindow 实证（方向门禁）

> 日期：2026-07-18 · 分支：computer-use-w8-windows · 关联：Issue #71、`docs/decisions/coordinate-computer-use-plan.md`（Amendment A1.5 / S-5 门禁）
> 性质：**只作用于自建测试窗口**（`s5-target.ps1`，WinForms 自绘），未触碰任何第三方应用
> 原始结果：`s5-result.json`；脚本：`s5-target.ps1` / `s5-actor.ps1`

## 结论：S-5 **PASS** —— 坐标化方向地基成立

**未签名、非管理员（medium IL）的进程，对同 IL 目标窗口做 SendInput 输入注入与 SetForegroundWindow 前台管理，在 Windows 11 26H1（build 28000）上全部实证可用。** Phase 0「需 EV 证书 + UIAccess」的结论不覆盖同 IL 桌面应用场景（且该 spike 当年从未执行，见对抗裁决史实修正）。

## 环境

| 项 | 值 |
|---|---|
| OS | Windows 11 26H1，build 28000 |
| actor | powershell.exe（Add-Type P/Invoke user32），PID 16172，**elevated=false** |
| target | 自建 WinForms 窗口（文本框 + 按钮 + WH_KEYBOARD_LL 钩子），同机 medium IL |
| DPI | 双方 SetProcessDpiAwarenessContext(PerMonitorV2) |

## 测试矩阵与结果

| # | 用例 | 结果 | 明细 |
|---|---|---|---|
| T1 | 后台进程 AttachThreadInput+SetForegroundWindow 夺回前台 ×10 | **10/10** ✅ | thief 窗口先在进程内抢焦点，actor 从外部恢复，10 轮全成 |
| T2 | SendInput 绝对坐标点击按钮 ×10 | **10/10** ✅ | MOUSEEVENTF_VIRTUALDESK\|ABSOLUTE 归一化坐标，落点 401,377 精确命中 |
| T3 | KEYEVENTF_UNICODE 输入「青花瓷 Hello123」 | **精确一致** ✅ | 逐字符 UTF-16 码元直发，无 IME 组合 |
| T4 | zh-CN 语言态下输入「青花瓷测试」 | **精确一致** ✅（有保留，见 C1） | 本机 zh-CN 仅有「美式键盘」布局，非组合型 IME |
| T5 | 注入事件 LLKHF_INJECTED 标记 | **400/400 全带标记**（信息项，见 C2） | 低层钩子确认事件全部可达且被标记为 injected |
| T6 | 200 键突发（无间隔 400 事件单批） | **200/200，0% 丢失** ✅ | 文本框实收 200 字符 |

## 保留事项（不推翻 PASS，但必须带往 WP1+）

- **C1 组合型 IME 未实测**：本机未安装微软拼音等真实 IME（T4 命中的是 zh-CN 美式键盘布局）。Amendment A1.5 的「目标应用 IME 激活态」用例只算半完成——在有真实 IME 的机器上复测列入 WP1 验收；KEYEVENTF_UNICODE 绕过 IME 组合的设计预期不受影响，但需实证。
- **C2 LLKHF_INJECTED 可被目标应用过滤**：所有注入事件都带 injected 标记（T5）。普通桌面应用不过滤，但**OSR 自绘应用（含网易云）可能选择忽略注入输入**——这是 per-app 属性，与 UIA 可用性一样需要在 App 页签加探测位，或 owner E2E 时实测网易云。
- **C3 n=1 单机的代表性**：单台 26H1 VM 一次通过；Win11 24H2 前台锁收紧（S-7 关注）在本机 26H1 上未复现，T1 的 10/10 是 AttachThreadInput 模式的结果——生产实现必须保留该模式 + 失败重试 + 诚实报错。
- **C4 本次未测**：跨 IL（目标以管理员运行）应按设计 fail-closed；UAC/安全桌面不可达；这俩是「必须不工作」的负向用例，列入 WP1 测试矩阵。

## 对路线图的影响

- **WP1 可以开工**：最小回路（截图 + OCR 定位 + 点击 + 自绘夹具）的全部前置门禁中，方向性门禁 S-5 已解除
- 仍有效的门禁：S-1（TinyClick ONNX 可导出）、S-2（onnxruntime-node 在 SEA 旁置布局可加载）——这两个只影响 WP5 本地模型层，不阻塞 WP1–WP4（UIA/OCR 层 + 注入 + 安全模型）
- S-7（前台焦点管理成功率）由 T1 部分覆盖（AttachThreadInput 模式 10/10），24H2 特定行为仍需独立观察

## 复现

```powershell
# 终端 1
powershell -STA -NoProfile -ExecutionPolicy Bypass -File scripts\spike\s5-sendinput\s5-target.ps1
# 终端 2（同机同会话）
powershell -STA -NoProfile -ExecutionPolicy Bypass -File scripts\spike\s5-sendinput\s5-actor.ps1
# 注意：s5-actor.ps1 含中文字符串，必须以 UTF-8 BOM 保存（PS 5.1 无 BOM 按 ANSI 解析会损坏引号）
```
