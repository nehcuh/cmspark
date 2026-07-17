# Windows Computer-Use 实现 — 交接评审文档

> **日期**: 2026-07-17 深夜 · **分支**: `computer-use-w8-windows`（基于 tag `computer-use-w8-snapshot` = `44d27e9`）
> **状态**: 多代理流水线（规划→对抗→开发→评审）已全部完成，本机构建+测试亲自复验通过。**等你实机验证 + 决定是否合并。**
> **一句话**: Windows 的 computer-use 能力已补足——经典 Outlook 读邮件、OneNote 建笔记、用户目录内文件列表/移动，全部走未签名可用的 COM + Node fs 路径，安全等级与 macOS 完全对齐。

---

## 1. 流水线裁决记录

| 阶段 | 产出 | 裁决 |
|---|---|---|
| 规划 Agent | `docs/decisions/windows-host-use-plan.md`（含本机实证探测：New Outlook 无 COM、Windows Hello 未签名可调、测试基线 27/27） | — |
| 对抗 Agent | `docs/decisions/windows-host-use-adversary.md` | **PLAN CORRECT WITH MANDATORY AMENDMENTS**：A1 originWs 缺失、A2 路径前缀边界（`Documents2` 逃逸）、A3 nonce 应挂进既有 L2 对话框（扩展早已实现内嵌验证码 UI），3 项强制修订 + 4 项小修，全部并入方案 |
| 开发 Agent | 8 个本地 commit（见 §2） | 全部修订落地，7 项对计划的偏差均自述并附理由 |
| 评审 Agent | 见 §4 | **APPROVED WITH REQUIRED FOLLOW-UPS**：§D 全部安全不变量 + 7 条修订逐条 ✅；唯一 MUST-FIX（R1 打包 staging）已由我修复并提交（`e653d8c`） |

## 2. 提交清单（10 个本地 commit，未 push）

```
e653d8c fix(package): wire stage:win-scripts into build:exe (review R1)   ← 我按评审意见补的
8df4db0 docs(decisions): plan §G +R7/R8 (amendment 7)
9886760 docs(decisions): windows host-use plan + adversary verdict
b18ffed fix(host-use/win): resolve powershell.exe via SystemRoot absolute path
7d82ca2 test(host-use/win): adapter, blacklist, nonce, hello tests
951c73d docs(host-use): win tool descriptions, LLM rule 12, packaging
8096631 feat(host-use/win): L2 single-dialog nonce + executor skip-L2 nonce with originWs
b16945b feat(host-use/win): WinHostAdapter + hostRead + Windows Hello wrapper
fff3808 feat(host-use/win): primitives — errors, nonce, blacklist, powershell runner, ps1 scripts
```

新增：`win/adapter.ts`、`win/blacklist.ts`、`win/powershell.ts`、`win/scripts/{outlook-list,outlook-read,onenote-create,hello-verify}.ps1`、`host-use/nonce.ts`、4 个测试文件。
改动：`types.ts`（新错误类型 + `windows-hello` method）、`win/index.ts`（stub → 真实现）、`security-confirmation.ts`（nonce 挑战/3 次锁定）、`server.ts`（win32 接线）、工具描述 + LLM Rule 12、`darwin/index.ts`（仅 re-export，行为不变）。
**未触碰**：chrome-extension/（零改动！扩展的验证码 UI 是现成的）、thread-approvals、security-policy、history 脱敏、tool-schemas。

## 3. 验证结果（我亲自复跑，非转述）

- host-use 测试套件：**74/74 通过**（42 个新 win 测试，断言的是安全性质而非形状）
- 生产构建 `tsc`：exit 0；`stage:win-scripts` 验证 4 个脚本正确落到 `dist/host-scripts-win/`
- 全量套件：943/989，46 个失败全部抽样核实为**基线就有的 Windows 环境性失败**（unix socket、0o600 权限、symlink、EBUSY），与本分支无关；基线 tag 上同样 43 个失败
- 本机冒烟：`hello-verify.ps1 -ProbeOnly` → exit 3（VM 无 Hello 硬件，符合预期）；`hostRead` → 诚实抛出 `WinAppNotAvailable`（本机是 New Outlook，无 COM）

## 4. 评审 Agent 结论摘要

- 安全不变量逐项核验通过：token 剥离、L2 gate、thread-trust 只读、vault 黑名单优先、每次写必过生物识别 tier（Hello 或 6 位手输码，**绝无 ask-once 降级**）、cancel→denied 绝不 fallback、argv-only PowerShell 无注入面、nonce 请求全部 origin-bound。
- 开发的 7 项偏差全部判 ACCEPTABLE（其中 realpath 施于 dirname 是对计划文本的**必要修正**——按计划字面会把合法移动全误拒）。
- 残余 NIT（不阻塞）：R2 hello-verify.ps1 的 AsTask 反射重载选择可再精确；R3 probe 与 executor 间 Hello 状态翻转可能双对话框；R4/R5 与 darwin 同构的既有行为。

## 5. 明天需要你做的验证（按优先级）

**本机（New Outlook + VM 无 Hello）即可验证：**
1. `cd companion && npm run dev` 起 companion，让 agent 调 `host_read` → 应收到 `WinAppNotAvailable`，消息含"用浏览器打开网页版邮件"的回退提示。
2. 调 `host_write`（create note）→ L2 对话框应**内嵌 6 位验证码输入框**；故意输错 2 次看 `nonce_retry` 计数、第 3 次错误应 denied；粘贴应被 UI 阻止。
3. 文件移动：Documents→Desktop 应成功；移到 `C:\Windows\Temp` 或 `Documents2` 必须抛 `WinPathOutsideAllowlist`。

**需要其它硬件（可延后）：**
4. Hello 已登记的机器：host_write → 弹 OS Hello 对话框；取消必须 denied 且不得退化为验证码；成功则 OneNote Unfiled Notes 出现新页，日志 `method=windows-hello`。
5. 经典 Outlook 机器：直接跑 `outlook-list.ps1` / `outlook-read.ps1`，确认无 Object Model Guard 弹窗、四元组正确。
6. `npm run build:exe` 后在干净目录跑一次，确认打包产物不依赖 src 布局（R1 修复的回归验证）。

## 6. 已知边界（有意为之，非缺陷）

- **UI 驱动（点击/输入/切前台）不做**——确实需要 EV 证书 + UIAccess，Phase 0 spike 证据仍然成立。
- **New Outlook 不支持**（无 COM；MS Graph 是另一个产品决策）；无经典 Outlook 时诚实报错并建议浏览器路径。
- **邮件只读、笔记只建、update/delete 抛错**——与 macOS 现状完全对齐。
- 文件移动限制在 `%USERPROFILE%\{Documents,Desktop,Downloads}`——比 macOS 更严，是有意的加固（Windows 没有 TCC 兜底）。

## 7. 待办 / 风险

- ⚠️ **macOS 修复尚未合入**：你说在 Mac 上修了 computer-use 的问题，但远程所有分支最新提交就是 tag 本身（`44d27e9`），修复**还没 push**。请在 Mac 上 `git push` 后告诉我，我把它合进本分支并回归验证（若改动触及 `darwin/`、`server.ts`、`security-confirmation.ts`，需重点看与 win32 接线的交互）。
- 全量测试的 46 个环境性失败是 Windows 上跑 POSIX 假设测试的基线噪音，可考虑另开 issue 加 `skip` 标记（与本分支无关）。
- OneNote COM 路径和 Hello `RequestVerificationAsync` 未在真机跑过（本机无对应硬件/软件），风险已在方案 R2 披露，降级路径兜底。

## 8. 如何继续

```bash
cd C:\Users\HuChen\Projects\cmspark
git checkout computer-use-w8-windows
git log --oneline computer-use-w8-snapshot..HEAD   # 10 个 commit
# 验证满意后：合并到 main 或 push 分支开 PR，由你决定
```
