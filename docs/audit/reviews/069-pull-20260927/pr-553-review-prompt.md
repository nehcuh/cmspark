# PR #553 独立对抗评审 — release-guard.sh（#547 防复发机制）

## 你的角色

独立高级评审员，**对抗性**立场。这个 PR 改的是**发布流水线本身** —— 一个写坏的守卫
要么挡不住坏发布（假安全），要么挡住所有正常发布（假失败）。默认假设它两者之一，去找证据。
只报告能用真实代码位置/真实运行证明的结论。**你可以且应该实际运行守卫脚本来验证。**

## 仓库与范围

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash: `/c/Users/HuChen/Projects/cmspark`）
- PR #553，分支 `feat/552-release-guard`，base `main`
- 单提交：`cc48a924`
- diff：`git show cc48a924` 或 `git diff main...HEAD`
- 4 个文件：`scripts/release-guard.sh`（新增）、`scripts/package.sh`、
  `.github/workflows/release.yml`、`scripts/tests/test-package-gates.sh`

## 背景

#547：`v0.6.9` tag 停在 `488252bf`，main 上又多了 3 提交、版本锚仍写 0.6.9 →
同版本号两份不同二进制。#547 把「防复发机制」列为**本票核心**，PR #551 只修了
具体脱节、机制没写，pi 据此 REJECT 两次。本 PR 补机制，落地 #552。

## 实现者声明（逐条验证，不要相信）

1. `release-guard.sh` 三条断言：工作树干净（tracked）/ HEAD tag == `v$(version)` / `[Unreleased]` 为空
2. tag 来源：CI 用 `CMSPARK_RELEASE_TAG`（`github.ref_name`），本地回退 `git tag --points-at HEAD`
3. 豁免：`CMSPARK_ALLOW_UNTAGGED` / `CMSPARK_ALLOW_DIRTY`；**tag 不匹配永远硬失败、豁免不覆盖**；
   `CMSPARK_RELEASE_STRICT=1` 下两个豁免失效
4. `package.sh` 调用守卫，但 `CMSPARK_PACKAGE_GATE_ONLY=1`（ci.yml 快路径）跳过
5. `release.yml` 的 preflight + package 两 job 都设 strict + 传 ref_name
6. gate 测试 +9 静态 +12 动态 = 125→146 passed；动态用**临时 git repo** 造场景；
   两轮反证（破坏 strict / 破坏 tag 逻辑）各恰好红 2 / 3 条
7. 集成回归：`GATE_ONLY=1` → rc=0；真实打包路径（HEAD 无 tag）→ rc=1

## 重点审查方向

### P0 — 守卫的正确性（最关键）

**实际运行它**（可参考 gate 测试的临时 repo 手法，或直接在仓库跑只读模式）。核实：

- **假安全**：有没有哪条断言其实永远通过？特别是 `[Unreleased]` 检测的 awk —— 它对
  CRLF 行尾（本仓库 CHANGELOG.md 是 CRLF）能正确识别段边界吗？空段 vs 只含空白行 vs
  含注释行，判定对吗？实现者声称场景 5 测了非空拒绝，请独立复现。
- **假失败**：正常发布（tag push 触发）会不会被误挡？`github.ref_name` 在 tag push 时
  确实是 `v0.6.10` 这种 tag 名吗？在 `workflow_dispatch` / `pull_request` 时是什么？
  守卫会不会在**不该跑**的场景跑（比如 ci.yml 的 PR 构建）？核实 `package.sh` 的
  GATE_ONLY 跳过条件，以及 ci.yml 到底走哪条路径。
- **tag 不匹配的豁免覆盖**：实现者声称「tag 不匹配永远硬失败、豁免不覆盖」。核实代码里
  `elif [ "${HEAD_TAG}" != "${EXPECTED_TAG}" ]` 分支确实在豁免检查之外，`ALLOW_UNTAGGED`
  /`ALLOW_DIRTY` 都无法让它通过。这是 #547 的核心，若被豁免绕过则整个机制失效。
- **strict 是否真能让豁免失效**：核实 strict 分支在 untagged 和 dirty 两处都优先于豁免。
- **`set -uo pipefail` 但没有 `-e`**：守卫脚本故意不用 `set -e`（要让 fail() 累积后统一退出）。
  核实中途任何命令失败（如 git 不可用、node 读不到版本）不会让脚本**静默 exit 0**。
  特别是 `VERSION` 读取失败时是 `exit 1` 而非继续。

### P1 — 集成点

- `release.yml`：preflight 和 package 两个 job 的 guard step，env 的 `github.ref_name`
  在 tag push 时的实际值。preflight job 有没有 `permissions` 或 checkout 深度问题
  导致 `git tag --points-at HEAD`（回退路径）在 CI 里失败？（实现者说用 ref_name 绕开，
  核实回退路径在 CI 里是否根本不会走到）
- `package.sh`：守卫插入点在算出 ZIP_NAME 之后、Step1 build 之前。核实 GATE_ONLY
  跳过的确切条件，以及守卫失败时 `exit 1` 真的中断了打包（`set -euo pipefail` 下
  `bash ... || exit 1` 的行为）。
- `build-windows-installer.sh` / `create-dmg.sh` / `build-windows-exe.ps1` 这些**其他**
  打包入口有没有绕过守卫？它们是否也可能产出「同版本号两份二进制」？如果有绕过路径，
  这是 blocking 还是 follow-up？

### P2 — 测试质量

- gate 测试的动态断言是否真在临时 repo 里跑（而非依赖真实仓库状态）？核实 `rg_setup`
  造了独立 git repo。断言的期望值（0/1）与场景是否对得上？
- 实现者声称做了两轮反证（破坏 strict→红 2、破坏 tag→红 3）。请独立复现其中至少一轮，
  确认动态断言不是假绿。
- 有没有**该测没测**的路径？比如 `VERSION` 读取失败（node 不可用）、CHANGELOG 不存在、
  git 不可用时的行为。

### P3 — 卫生

- PR 是否只含 #552 相关改动，无夹带？`.gitignore`（`.alma-snapshots`，操作者进来前就有）
  是否被正确排除？
- ADR-020 声明块（Surface: n/a 等）是否成立？
- commit message 的 `Closes #552` 是否正确（本 PR 落地 #552，合并即完成）？
  会不会误关别的票？`gh pr view 553 --json closingIssuesReferences` 应只含 552。

## 可用命令提示

- 直接跑守卫（当前 HEAD 无 tag，应 rc=1 并列出原因）：
  `cd /c/Users/HuChen/Projects/cmspark && PATH="/c/nvm4w/nodejs:/c/Program Files/Git/usr/bin:/usr/bin:/bin:/c/WINDOWS/system32:$PATH" bash scripts/release-guard.sh`
- 跑 gate 测试：`bash scripts/tests/test-package-gates.sh`（约 15 秒，146 断言）
- 若 `node` 报 not found，PATH 缺 `C:\nvm4w\nodejs`；若 bash 报 `pipefail invalid option`，
  说明 `C:\WINDOWS\system32` 在 `/usr/bin` 前（WSL bash 抢了 Git Bash）。
- **只读评审：不要改文件、不要提交、不要打 tag、不要 push。** 跑守卫脚本本身是只读的
  （它只 git status / git tag / awk 读 CHANGELOG），安全。

## 硬性规则

1. 实际读代码 + **实际运行守卫与 gate 测试**。不要只看 diff。
2. 每条 finding 带 `文件:行号`，说明为什么是问题、什么条件触发。
3. 找不到问题就直说，不要编 NIT 凑数。
4. 区分：验证过的 / 推断的 / 没能验证的（第三类单列）。
5. 声明与代码不符就点名 over-claiming 并给证据。
6. 应用 ADR-020 清单：`docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## 输出格式

```
## BLOCKING（必须修才能合）
- [P0|P1|P2] path:line — 问题 / 触发条件 / 影响

## NITS（非阻塞）
- path:line — ...

## 未能验证
- 声明 N：原因

## 已核实为正确的声明
- 声明 N：证据（file:line + 你跑了什么命令、得到什么）
```

**最后一行必须恰好是以下之一（后面无任何内容）：**
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

有任一 BLOCKING → REJECT。只有 NITS → APPROVE_WITH_NITS。干净 → APPROVE。
必须打印在最终回复里。
