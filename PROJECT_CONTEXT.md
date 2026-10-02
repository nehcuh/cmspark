# Project Context

## Session Handoff

<!-- handoff:start -->

### 2026-10-02 S120 · 拉取 0.6.11 · 三处 P1 · 本机换装

- **拉取**：`8e74b77b` → `6e0dec82`（84 提交，产品 0.6.11）。五路对抗 + Claude/Kimi 双路 `APPROVE_WITH_NITS`。
- **已改未提交的行为**：缺标签先分类再拼标题，登记 `TAB_NOT_FOUND`；Windows 后台左键只认 UIA Invoke；`chatCreate` 用 run epoch 写 `last_run_terminal`，领号在第一个 `await` 之前。Pi 要求的双跑行为测试已补。
- **换装**：`dist-package/CMspark-v0.6.11-macOS.dmg`。`/Applications/CMspark.app` CDHash `167c71c0c34fbfeda80490385f04e199ae09182a`，plist 0.6.11，daemon `127.0.0.1:23401`。无 bak。`host-integrity.ts` 不提交。
- **CLEARED**：线程 `t569rp` / `w-569-rp` 是裸 `node --test` 写进 `~/.cmspark-agent` 的残留，`run_progress` 为 sticky `null`。用户在这条上让插件播网易云，提案被拒并整轮停止。换新对话。
- **Next**：重载 `chrome-extension/build/chrome-mv3-prod/`。#568 > #567 > #563 后续。
- **Do not**：`xattr -cr`、`pgrep -f /Applications/CMspark.app`、换装留 bak、`kimi -p` 后紧跟 `--output-format`、裸 `node --test` 打到本机数据目录、`cp` 不带 `/bin/cp -f` 去还原 CHANGELOG。

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

<!-- handoff:end -->
