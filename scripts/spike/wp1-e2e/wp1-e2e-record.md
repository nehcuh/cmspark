# WP1 缺口 6：真机夹具端到端集成测试留痕

> 日期：2026-07-18 · 分支：computer-use-w8-windows · 执行人：父 Agent（本机手工驱动真实 ps1 链）
> 性质：只作用于自建夹具 `companion/tests/fixtures/self-drawn-window.ps1`（UiaMode=off，纯自绘，模拟 OSR「UIA 自闭」应用），未触碰任何第三方应用
> 门禁依据：`coordinate-computer-use-wp1-review.md` 缺口 6、`coordinate-computer-use-wp1-adversary.md` Y9/X1–X3 复审触发条件

## 环境

Win11 26H1 build 28000，DPI 150%（144），actor = powershell.exe 未提权。夹具两模式均测（DialogMode=window / inwindow）。

## 结果矩阵（全部实跑，命令与输出留档）

| # | 用例 | 结果 | 关键证据 |
|---|---|---|---|
| 1 | computer-capture 对自绘窗口出图 | ✅ | PrintWindow 直出（fallbackUsed:false）、black:false、560×400、dpi:144、sha256 元数据齐 |
| 2 | computer-ocr zh-Hans 文本锚点 | ✅ | 「确」「定」两词块命中按钮区（bbox 中心与按钮 client 中心偏差 <20px）；zh-Hans 语言包本机可用（S-6 顺带解除） |
| 3 | computer-input click 真实点击 | ✅ | client(150,168)→screen(461,413)，fixture clicks 0→1 |
| 4 | type「青花瓷」（KEYEVENTF_UNICODE） | ✅ | fixture text 精确等于「青花瓷」（owner-draw KeyPress 通道） |
| 5 | 越界坐标拒绝 | ✅ | (9999,9999) → `OUTOFBOUNDS:(9999,9999) outside client rect 538x344` |
| 6 | **对话框遮挡时点击必须拒绝（X2 复验）** | ✅ | popup 打开态点击 → `OCCLUDED:point (461,413) lands on hwnd 3081492, not target hwnd`，clicks/dialogClicks 保持 0；关闭对话框后点击恢复（0→1） |
| 7 | **inwindow 自绘对话框像素检测（X1 复验）** | ✅ | 弹出前后帧 imgdiff：整窗 diffRatio=0.1494（<0.3 旧阈值，**旧指标必然漏检**，实证 X1 成立）；maxZoneRatio=0.7812（≥0.5 ✓）、maxBlobRatio=0.1257（≥0.05 ✓）双通道命中 |
| 8 | seal 往返 + raw 删除 | ✅ | protect：blurred:1、sha256 输出、**原 after.png 已删除**；unprotect 解密回 PNG 成功 |
| 9 | 凭证区域模糊目检 | ✅（附保留） | 解密图对话框区域已像素化；大字（确认删除按钮）仍隐约可读——马赛克强度属对抗 Y 类建议，非 MUST-FIX |

## 测试中发现的两个真实缺陷（已修）

1. **夹具 window 模式对话框永不弹出**（`self-drawn-window.ps1:152`）：`New-Object Drawing.Point($form.Location.X + 120, ...)` 参数模式把 `+` 拆成独立参数（op_Addition 报错被 timer 静默吞掉）→ 已修为双括号。影响：X1 的 window 模式此前从未被真实弹窗验证过；修复后第 6 项复验通过。**若本次手工测试缺位，此 bug 会带伤进入 WP2。**
2. **5 个 ps1 缺 UTF-8 BOM**（Edit 工具会丢 BOM；含 CJK 的 ps1 在 PS 5.1 下按 ANSI 解析即损坏，S-5 已踩过一次）→ 已统一补 BOM（fixture + computer-capture/input/ocr/windows）。seal/imgdiff 原本有。

## 未覆盖（明示）

- 提权窗口 ILDENIED 负向探针：需触发 UAC，VM 上未做；IL fail-closed 由单测 fake IL provider 覆盖
- 组合型 IME 激活态（C1 保留）：本机无微软拼音
- 网易云真实注入（S-5/C2 保留）：owner E2E 专属，agent 不做
