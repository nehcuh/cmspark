# PR #551 独立对抗评审 — release: cut 0.6.10

## 你的角色

独立高级评审员，**对抗性**立场。这是一个 release 提交，风险不在"代码写错"，而在
**版本锚漏改 / 误改历史记录 / CHANGELOG 撒谎**。默认假设这三类问题存在，去找出来。

## 仓库与范围

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash: `/c/Users/HuChen/Projects/cmspark`）
- PR #551，分支 `release/cut-0.6.10`，base `main`
- 单个提交：`71ff2ff9`（其父是 `d1ee60a6` = PR #549 的 merge commit）
- diff：`git diff main...HEAD` 或 `git show 71ff2ff9`

**必须实际打开文件、跑命令核对。** 不要只看 diff 摘要。

## 背景

上一轮 0.6.9 拉取批次的对抗评审裁出 3 条 BLOCKING，已在 **PR #549 修复合并**
（`d1ee60a6`）。本 PR 是其后的发布工程，修 **#547 发布卫生**：

`v0.6.9` tag 指向 `488252bf`，但其后 main 上有 3 个提交（`8e74b77b`、`ad7f0980`、`b5a7396a`），
它们的行为变更写在 CHANGELOG `[Unreleased]`，而所有版本锚仍写 `0.6.9`
→ **同一版本号对应两份不同二进制**。

评审材料：`docs/audit/reviews/069-pull-20260927/`（上一轮 SYNTHESIS.md + 四路输出，
以及本轮 #549 的 `pr-549-*.md`）。

## 实现者声明（**逐条验证，不要相信**）

1. **17 文件 lock-step**，范围照 `b78e0962`（"release: cut 0.6.9"）：
   `AGENTS.md` / `CHANGELOG.md` / `CLAUDE.md` / `PRODUCT.md` / `README.md` /
   两个 `package.json` + 两个 `package-lock.json` / `companion/README.txt` /
   `cli-version.ts` / `jsonrpc-stdio.ts` / `stdio-server.ts` / `cli-version.test.ts` /
   `docs/GOAL.md` / `docs/README.md` / `scripts/installer.nsi`
2. **刻意不改**三处：
   - `PROJECT_CONTEXT.md:6,8,9` —— 2026-09-23 那次 0.6.9 发布的既成事实记录
   - `CLAUDE.md:137` 活切点链里的 0.6.9 —— 降级为历史条目保留
   - `chrome-extension/.plasmo/` 与 `build/` —— 构建产物，plasmo build 会重生成
3. CHANGELOG `[Unreleased]` 已清空并归档为 `[0.6.10]` 段
4. `[0.6.10]` 段**如实标注了 #548 的已知限制**（换策略提示在"反复点同一句"场景不可达），
   没有把 over-claiming 措辞搬进正式发布记录
5. 踩坑并修掉：`cli-version.test.ts:45` 的转义正则 `v0\.6\.9` 是 `sed` 够不着的形式，
   第一轮漏改导致测试红，已用精确 Edit 修正；全仓复扫转义形式残留为空
6. 验证结果：`test-package-gates.sh` 125/0；package.sh GATE-ONLY 识别 0.6.10；
   cli-version 2/2；companion 全量 tests=5306 fail=62（新增失败文件为空）；
   extension 1458/1458；tsc --noEmit 通过

## 重点审查方向

### P0 — lock-step 完整性（release 的核心风险）

- **全仓扫 `0.6.9` 残留**（排除 `node_modules` / `.test-dist` / `build` / `.plasmo` /
  `dist-package` / `docs/audit/reviews` / `memory`）：还有没有**活锚点**被漏改？
  特别查这些容易被漏的形式：
  - **转义正则**：`0\.6\.9`（反斜杠点）—— 实现者承认第一轮就漏了一处，请独立复扫
  - 带 `v` 前缀：`v0.6.9`
  - 带引号 / YAML / TOML / JSON 里的版本字段
  - `package-lock.json` 的 **lockfileVersion 之外的** version 字段（注意别把依赖版本误判）
  - CI workflow（`.github/workflows/`）里有无写死版本号
  - `scripts/` 下有无写死版本（尤其 `build-windows-exe.ps1`、`create-dmg.sh`、`package.sh`）
  - `chrome-extension/manifest` 相关（plasmo 是从 package.json 生成，还是有独立锚点？）
- **反向检查**：有没有把**不该改的**改了？特别是：
  - `PROJECT_CONTEXT.md` 的历史记录是否真的未被触碰（`git diff` 确认）
  - `CLAUDE.md:137` 的历史链是否只是"降级"而非"删除"（0.6.9 应仍在历史里）
  - 依赖版本、ADR 编号、Issue 号、日期、SHA256、CDHash 有没有被 `sed` 误伤
- **一致性 gate 是否真能拦住漏改**：`scripts/tests/test-package-gates.sh` 的版本断言
  覆盖了哪几处？如果它只查 companion/extension/installer.nsi 三处，那其余 14 个文件的
  lock-step 靠什么保证？这个 gate 的覆盖面是否足够（这是 #547 的防复发诉求）？

### P1 — CHANGELOG 诚实性

- `[Unreleased]` 是否**真的为空**？还是留了空标题（空标题是惯例还是问题？）
- `[0.6.10]` 段归档的 6 条，是否与 `git log v0.6.9..d1ee60a6` 的实际改动**对得上**？
  有没有把没发生的事写进去，或漏掉真实发生的用户可见变更？
- **重点**：#548 的限制标注是否**如实**？原 `b5a7396a` 声称"连点同一句三次会换策略"，
  而 #548 证明该场景被 site-op ban 在阈值 2 拦截、pivot 不可达。CHANGELOG 现在的措辞
  是否既没说谎、也没把已知缺陷藏起来？请对照 #548 正文与 `site-op-memory.ts:29`
  （`SITE_LOCATOR_FAIL_BAN = 2`）和 `adapter.ts:255`（阈值 3）独立判断。
- 三条评审后修复（#544/#545/#546）的**用户可见**描述是否准确？
  特别注意：这些是内部机制修复，CHANGELOG 用用户语言描述时有没有夸大或说错？
  例如 #545 描述成"舰队轮询不再误删他人在写的标签锁"是否准确对应代码？
- 日期 `2026-09-28` 是否正确（对照本机日期）？

### P2 — 范围与流程

- 本 PR 是否**只有**发布工程，没夹带代码行为变更？
  （声明称 `src/` 下只动了 3 个写死版本号的常量文件 —— 请核实）
- `.gitignore`（`.alma-snapshots`）与 `docs/audit/reviews/502-punchlist-20260919/` 那批
  未跟踪文件是否被正确排除在 PR 外？
- 归档的 `pr-549-*` 评审材料是否应该进这个 release PR？（体积 / 相关性）
- ADR-020 声明块 `Surface: n/a` 等是否成立？
- 提交信息与实际改动是否一致，有无 over-claiming？
- **顺序**：#547 要求"先修 B1/B2 → 合并 → 再切版本"。请核实 #549 确实已 MERGED
  且本 PR 基于其上（`git log --oneline d1ee60a6..HEAD`、`gh pr view 549 --json state`）。

### P3 — 合并后风险

- 本 PR 合并后若**不立即打 tag**，会不会又产生新的脱节窗口？（实现者在 PR 正文里
  自己提了这条警告 —— 判断这个警告是否充分，还有没有别的遗漏）
- `v0.6.9` tag 已存在于 `488252bf`。本 PR 合并后打 `v0.6.10`，那 `v0.6.9` 与
  main 上 0.6.9 版本锚期间的产物如何追溯？是否需要额外说明？

## 可用命令提示

- Windows 上若 `npm test` 报 `'node' 不是内部或外部命令`，PATH 缺 `C:\nvm4w\nodejs`
- 若 bash 报 `set: pipefail: invalid option name`，说明 `C:\WINDOWS\system32` 在 `/usr/bin`
  之前，WSL 的 bash 抢了 Git Bash —— 把 `/usr/bin:/bin` 提到 system32 之前
- `npm test`（companion 全量）约 60-70 秒；#546 修复后才能跑起来
- 版本 gate：`bash scripts/tests/test-package-gates.sh`
- package.sh 门禁（不实际构建）：`CMSPARK_PACKAGE_GATE_ONLY=1 bash scripts/package.sh windows-x64`

## 硬性规则

1. 实际读代码 / 跑命令。**不要修改任何文件，不要提交，不要 push，不要打 tag。**
2. 每条 finding 必须带 `文件路径:行号`，说明为什么是问题、什么条件触发。
3. 找不到问题就直说，不要编 NIT 凑数。
4. 明确区分：**验证过的** / **推断的** / **没能验证的**（第三类单独列）。
5. 若实现者声明与事实不符，点名 over-claiming 并给证据。
6. 应用 ADR-020 清单：`docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## 输出格式

```
## BLOCKING（必须修才能合）
- [P0|P1|P2] path/to/file:123 — 问题 / 触发条件 / 影响

## NITS（非阻塞）
- path/to/file:45 — ...

## 未能验证
- 声明 N：原因

## 已核实为正确的声明
- 声明 N：证据（file:line + 你跑了什么）
```

**最后一行必须恰好是以下之一（后面不能有任何内容）：**

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```

有任一 BLOCKING → REJECT。只有 NITS → APPROVE_WITH_NITS。干净 → APPROVE。
必须打印在最终回复里，不要只写在别的文件中。
