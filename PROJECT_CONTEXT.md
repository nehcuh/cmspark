# Project Context

## Session Handoff

<!-- handoff:start -->

### 2026-09-29→30 S119 · #560 收尾 · #563 A 批 · #537 拆解 · **cut 0.6.11 发布**

- **决策落地（#560 第二半）**：`HINT_REQUIRED` / `DOWNLOAD_BUSY` 改 `recoverable`（真实行为变更），
  `SELECTOR_REQUIRED` 意图登记（实测**不可达**），`PATH_ESCAPE` 保持 → PR **#564**（`827809ed`）。
  pi 抓到我 3 处 **over-claim**（判据/可达性/用例数），全部更正。
- **#563 A 批**：登记「**已产出但未登记**」的码 → PR **#565**（`d958b70b`）。**七次修订、pi 五轮 REJECT**。
  教训链：枚举盲区逐层暴露（单报文 → 只看首个产出点 → 报文集 helper **分参注入** → 经**对象属性**间接拼装）。
  最终口径：**按「可验证性」收口**，无法证明等级不变的码**一律不收**（它们回到 main 的行为）。
  pi 的判词值得记住：**「风险从『漏一个 = 收紧』变成『漏一个 = 不变』」** —— 对不可穷尽的集合，
  「不确定就不登记」本身就是结构性防线。registry **35 → 109** 条。
- **#537 拆解**：它 4 天没人管、**落后 main 52 提交**、**从未跑过 CI**，且是杂烩（9 提交跨 ≥5 issue）。
  用「**逐提交实测能否 cherry-pick 到当前 main**」决策：只提取 `2a1ca91c`（#528+#529）→ PR **#566**
  （`471a3240`）→ **#529 CLOSED**；其余 3 个 attach/debugger 提交冲突（#555/#559 重写过
  `browser-bridge.ts`）→ **#567**。pi 两轮：REJECT（3 条全成立）→ APPROVE_WITH_NITS。
- **cut 0.6.11**：0.6.10 之后攒了 **7 个 PR**（#555 #557 #561 #562 #564 #565 #566），全是安全/健壮性修复。
  版本 lock-step **17 个文件**（同 v0.6.9/v0.6.10 集合）。
- **Release**：https://github.com/nehcuh/cmspark/releases/tag/v0.6.11 —— tag `v0.6.11` → **`4158cffe`**
  （== 打 tag 时 main HEAD）。三端 zip + Windows Setup.exe + SHA256SUMS 共 **6 个产物**。
  `CMspark-Setup-v0.6.11.exe` sha256 `6fb3814fe9337c2bb472c0b06101a06cd04a075ea18d1d5b1b56aeb6ac57cf2f`。
- **流程**：先 `workflow_dispatch` **dry-run**（run `36661632709`，三端构建 + Publish 正确跳过）
  → 再打 tag（run `36662324260`，preflight + 三端 + Publish 全绿）。`release-guard.sh` 本地全绿。
- **Next**：换装官方 **v0.6.11**（本机仍是 0.6.10，官方已发新版）；重载 unpacked 扩展
  `chrome-extension/build/`。**技术待办优先级**：`#568`（参数拒执的码/等级未闭环 —— 含与 #528
  **同形**的 l2-admission token 过期路径，**可达的真实误封**）> `#567`（attach/debugger，需按现结构重做）
  > `#563` 后续批次（B 产出点保留上游码 / C 模型派生插值 / D `ComputerErrorCode` 35 个未登记，
  含 fail-closed 安全闸门）> `#548` / `#550` / `#539`。

### 2026-09-28→29 S118 · computer-use 实测 · 安全缺陷三票收敛

- **授权与边界**：用户睡前「把所有验证到的真实问题全部解决」。**披露/HITL 属操作员动作，即使口头同意也未代批** —— 该闸门设计上就是防「AI 自己把自己放进门」（`ACK_NOT_OPERATOR: caller acknowledge is not operator consent`，实测复核）。
- **方法**：用产品自己的通道实测（`mcp-outbound` 当 MCP 客户端 → companion → 扩展 → 真 Chrome）；桌面侧 Windows UIA + 内置 OCR 当眼睛；真实鼠标点击（用后还原光标）。
- **已修并合并**：
  - `#554` `wait_for` 6/6 失败（吞 CDP 异常 + 误报「selector 超时」+ 兜底未实现）→ PR **#555**（`654ba143`）
  - `#556`/`#558` 页面可控文本进 `classifyError` → 可被页面用来**整轮终止** → PR **#557**（`227da3b6`）
- **另立待办**：`#559`（`analyze_image` 任何失败都 `non_recoverable`；image 家族码整族未登记）、`#560`（`classifyError` 剩余「依赖文案含某词」的脆弱点）、`#539`（前提已更正）。
- **重要教训**：① 注入表达式里写的任何字符串**都属于页面**，措辞必须来自扩展侧、页面值只能当令牌；② 大文件禁用整文件 Read→Write 回写（本会话因此栽两次，第二次提交了截断的 `session.md`，已由 `b06d8890` 恢复 1112 行）。
- **Next**：`#559` / `#560` / `#539`。本机已装 0.6.10（S117）。


### 2026-09-27→28 S117 · 0.6.9 拉取 · 三条 BLOCKING 修复 · cut 0.6.10 发布

- **拉取**：0.6.9（`59931595..b5a7396a`，12 提交）。本机 Windows 编译 `CMspark-Setup-v0.6.9.exe`（sha256 `c61a949e…`）并换装 `C:\Users\HuChen\AppData\Local\CMspark`，daemon `:23401`。备份 `CMspark-backup-20260927-225703.zip`。
- **⚠️ 本机现装的这份自报 `cmspark-agent v0.6.9`，但含 `ad7f0980`/`b5a7396a` 两个提交的行为**（它们晚于 `v0.6.9` tag）—— 正是 #547 描述的「同版本号两份二进制」。官方 `v0.6.10` 已发布，是同一份代码（fc5935e2）的正确版本化构建；建议换装官方包以消除歧义。
- **四路对抗评审 REJECT**：三条 BLOCKING 全实机复现 → **#544（P0）** pivot 指令投递进 untrusted 通道（rule 11 明令禁止遵循）；**#545** fleet 快照读路径无条件释放 worker 租约；**#546** Windows argv 超限致测试静默空转。连带 **#548**（pivot 在其声称场景不可达）、**#550**（SOFT_RESERVED 窄时序）。
- **修复与发布**：PR **#549** 修三条 BLOCKING（`d1ee60a6`）→ PR **#551** cut 0.6.10、归档 Unreleased、17 文件版本锚 lock-step（`c8d3741f`）→ PR **#553** 落地 `scripts/release-guard.sh` 防复发（`aa3c786b`）。四路评审全程 APPROVE_WITH_NITS；pi 两 PR 均多轮 REJECT 后转通过，抓出 6 处真实缺陷（含操作者自己写错的两处 over-claiming）。
- **Release**：https://github.com/nehcuh/cmspark/releases/tag/v0.6.10 —— 三端 zip + Windows Setup.exe + SHA256SUMS。`Setup` sha256 `59d49e08…`、`windows-x64.zip` sha256 `3958cbb4…`。tag `v0.6.10` == main HEAD `fc5935e2`（#547 脱节闭环）。
- **release-guard dogfood**：v0.6.10 是 `release-guard.sh` 首次在真实 tag push 中运行 —— preflight 的 guard step `completed success`，未误挡正常发布。
- **Next**：换装官方 v0.6.10（消除本机 0.6.9 自报歧义）；重载 unpacked 扩展 `chrome-extension/build/chrome-mv3-prod/`。不要提交 `host-integrity.ts`。#230 仍冻，禁扩默认 outbound profile。#552 follow-up（ps1/create-dmg/installer 三入口未接守卫、cli-version 硬编码正则）另票。
- **Do not**：`xattr -cr`、`pgrep -f /Applications/CMspark.app`、换装留 bak、`kimi -p` 后面紧跟 `--output-format`。

### 2026-09-23 S116 · #524 租手确认 · 0.6.9 换装发布

- **Ship**：#524 合 main 后切 **0.6.9**（`488252bf`）。本机 `/Applications/CMspark.app` 已换装，CDHash `37d554d0…`，daemon `:23401`，`cmspark-agent v0.6.9`。无 bak。
- **Release**：https://github.com/nehcuh/cmspark/releases/tag/v0.6.9 （三端 zip + Windows Setup.exe + SHA256SUMS）。Linux 断言曾因 `napi-v6` 失败，标签已移到修复提交。
- **Next**：重载 unpacked 扩展 `chrome-extension/build/chrome-mv3-prod/`。不要提交 `host-integrity.ts`。#230 仍冻，禁扩默认 outbound profile。
- **Do not**：`xattr -cr`、`pgrep -f /Applications/CMspark.app`、换装留 bak、`kimi -p` 后面紧跟 `--output-format`。

### 2026-09-15 S109 END · VibeSOP 8.5.0 配置刷新

**Workspace**：CMspark main 工作树原有未提交内容保持不变；本次仅新增/刷新本地 agent 配置。

**完成**：`.vibe/dist/` 五个平台产物已重建；项目 `.claude/` 与 `.grok/`、全局 Claude/Grok/Kimi/Pi/OpenCode 配置已同步至 VibeSOP 8.5.0。额外 skill、`.grok/workflows`、Claude 本地设置和模型配置保留。

**验证**：Claude、Grok、Kimi、OpenCode、Pi 独立 `vibe verify` 全部通过；Cursor 未配置，未改动。

**Next**：重启相关 Agent；审阅是否将 `.grok/rules/` 与 `vibesop-*` hooks 纳入仓库版本控制。
<!-- handoff:end -->
