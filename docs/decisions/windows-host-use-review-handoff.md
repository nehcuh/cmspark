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

---

## 追加：darwin 审计修复（2026-07-18 上午）

审计（`macos-host-use-review.md`，M1–M11）已全部修复并经评审 **APPROVED**，4 个 commit：

```
bd2652a M3 jsonEscape + M5 正确定界符守卫 + M7 放行单引号 + M8 诚实固定默认值
d206a9f M6 Finder move 强制绝对 POSIX 路径(DarwinPathNotAbsolute)
5c01c41 M2 list 边界 base64url 编解码 + M4 共享 host-bin resolver + M11 可注入 DarwinRunner + spawn 级测试 + M10 注释
6e081a8 M1 hostRead 按 application 分支(NotImplementedForApp,不再静默返回 Mail) + M8-TS + M9 注释清扫
```

- 本机复验：host-use 套件 **90/90**（darwin 13→29，新增 16 个 spawn 级测试）；`tsc` 主构建 + 测试构建均干净；win32 与 chrome-extension 零改动
- 评审额外做了对抗探针：9 组刁钻文件名 + 200 组随机字节 round-trip 全部无损；crafted id 解码陷阱均 fail-closed
- M8 走了 fallback 分支（TS 侧截断 + 文档对齐），真正的 `--limit`/`--max-chars` 透传需要 NSAppleEventDescriptor，列为 Phase 2
- 评审发现 3 条低优先 follow-up（均非本次引入）：F1 jsonEscape 未覆盖全部 C0 控制字符（fail-closed）；F2 host-bin 候选 3 路径数学 pre-existing 瑕疵；F3 list-files.applescript 的 urlEncode 对 CJK 有损（producer 旧缺陷）

### ⚠️ 必须在 Mac 上验证（本机无法编译 Swift）

1. `bash companion/src/host-use/darwin/build-host.sh` 重新编译（重点：jsonEscape 的转义序列）
2. M3 smoke：subject 含 `"` `\` 的邮件 read-message → `jq .` 能 parse
3. M5/M7 smoke：account 含 `'`（如 John's Gmail）正常读取；create-note 正文含引号正常
4. M2 e2e：Documents 放 `John's report.pdf`、`100%.txt`、中文名文件 → listReadTargets 不再抛错、readOne 回读成功
5. M1 e2e：`com.apple.Notes` 调 host_read → typed 错误，**不返回 Mail 数据**
6. M6 e2e：相对路径 move 报错且 Finder 无动作
7. M8 e2e：`max_chars=200` → ≤200；`max_chars=5000` → ≤500

---

## 分支策略决策（owner，2026-07-18 09:39）

**Computer use 作为独立于 `main` 的长期分支存在，不合并入 main。**

- 普通用户：使用 `main`，无 computer-use 能力
- Computer use 用户：需自行 `git checkout computer-use-w8-windows` 并从源码编译（companion `npm run build`；macOS 还需 `bash companion/src/host-use/darwin/build-host.sh`）
- 该分支已推送至远程：`origin/computer-use-w8-windows`
- 后续 main 上的修复需要时 cherry-pick / merge 进本分支，而非反向合并
- 遗留验证与 Phase 2 事项统一追踪于 GitHub Issue #69

---

# 附录 B：App 页签（本地应用启动台）— P1 完成交接（2026-07-18）

## 范围

在 sidepanel 新增「App」页签：枚举本机已安装应用 → 用户选信任级别（仅启动免确认 auto / AI 判断 ai / 手工确认 manual）加入白名单 → 对话框说「打开网易云音乐」即可经 host_app 工具启动。P1 仅 Windows、纯启动（无参数模板、无 CLI track、无 kill）。

## 工作包与评审记录（12 commits，e55fee0..8f83a87，已推送）

| WP | 内容 | 评审结论 |
|---|---|---|
| WP1 | `companion/src/apps/types.ts` AppEntry schema + 校验 + policy cap + config 块 | APPROVED |
| WP2 | 枚举/签名脚本（apps-enumerate.ps1 / apps-signer.ps1）、D1 guards、add-flow、D2 biometric 门、apps.* WS handlers | APPROVED（修了 W1 多扩展名 lolbin 绕过、W4 UNC 路径 cap ai） |
| WP3 | host_app 工具、三处 gate 接线、策略链、D7 启动引擎（apps-probe.ps1）、线程信任清除 | APPROVED；**顺带修了真实 bug：respondFrom 先删 pending 导致 host_read 的 W7 线程信任从未生效** |
| WP4 | AppsPanel.tsx + BottomBar 页签 + App.tsx canThreadTrust 含 host_app | APPROVED + follow-ups |
| WP5 | buildAppIndexSection 注入 system prompt + W2 测试 | APPROVED |
| WP6a | 终审修复：错误全带 `family:"apps"` 并按 family 路由面板；apps.list 带 `platform`；host_app L2 弹窗显示「启动应用确认」不带高风险 API 区 | APPROVED — ready for owner E2E |

## Owner 三项决策（已确认，全文在 docs/decisions/app-tab-design-draft.md 末尾）

1. **auto 语义** = 仅启动免确认；带参数必 L2 确认；危险操作必 Hello/手输码
2. **W7 线程信任为 app-launch 破例**：勾「此线程不再询问」后同线程同应用免确认；删除应用/改配置即清除信任
3. **未签名或用户可写目录的应用 cap 在 "ai"**，不允许设为 auto（添加时黄标警告，strict 模式下禁止）

## 测试基线

- companion：apps/host-use 相关套件 **251 tests / 250 pass / 1 skip**（off-win32 条件跳）
- 扩展：`tsc --noEmit` 干净，**145/145**
- 全量套件 ~34–53 个预存 Windows 环境失败（daemon unix socket EACCES、symlink EPERM、0o600 断言），与本分支无关，**不要修**

## 安装包

- 已重打包：`dist-package\CMspark-v0.3.0-computer-use-windows-x64.zip`（含 7 个 host-scripts-win ps1 + 新扩展）
- 本机冒烟：exe 正常启动、`server.listening` port 23401

## ⚠️ 待 Owner E2E 验收清单（Windows 本机）

1. 启动 `dist-package\cmspark-windows-x64\cmspark-agent.exe tray`，Chrome 加载包内 `chrome-extension/`
2. 打开 App 页签 → 枚举 → 找到**网易云音乐**（本机已装，NetEase 签名有效，可 auto）
3. 以「AI 判断」添加 → 对话框输入「打开网易云音乐」→ 应弹「**启动应用确认**」（无高风险 API 区、带线程信任 checkbox）
4. 批准 → 应用启动（evidence 应为 process_running / already_running，单实例不误报）
5. 同线程第二次 → 免确认；升级为 auto → 走 Hello/手输码（本机无 Hello 硬件 → 自动 fallback 手输码）
6. 删除该应用 → 信任清除，再次启动重新弹窗

## P1 边界（有意为之）

- kill-switch 只能改 config.json（UI 只读）
- 仅 Windows；纯启动无参数；无 CLI track；无 preset gallery 扩充

## P2 挂账（未开工，等 owner 发话）

L1 参数模板、CLI track（开放前必须补 powershell_ise 等 vault 映射 + AUMID→vault heuristic）、枚举注册表 Uninstall 键、preset gallery、drift sha256 re-approve 的 biometric 门、全量测试 Windows 环境失败加平台 skip（可开 tracking issue）。
