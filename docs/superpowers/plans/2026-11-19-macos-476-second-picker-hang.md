# macOS #476 第二次选择框卡住的修复计划

> 规划修订。上一版「在 `remaining()` 内完成 `count`」作废。这一份通过复审之前，不改 Swift，不改 TypeScript，不改产品。

GitHub: 现有 #476 桌面验收。没有新的用户可见行为。

**Base:** `08fe57feacd6ca634eb2f8369dada10420ce0d44`

规格：`docs/superpowers/specs/2026-11-19-macos-476-second-picker-hang.md`

## 上一版为什么约束不到

`remaining()` 的结果只会传给带 `timeout` 参数的等待。`XCUIElementQuery.count` 没有这个参数。它不返回时，写在它后面的拒绝不会执行。把查询挪到别的线程也不能安全打断它。到时拒绝只是有界失败，`cancelReturned` 不会因此变成 1。`waitForExistence(timeout:)` 写在当前 `windows.count` 之后，历史日志还没走到它。

## 实现时改哪些调用

改 `companion/tests/fixtures/workspace-ui-705/WorkspacePickerUITests.swift`，并同时改 `companion/tests/desktop-workspace-xctest-705.test.ts` 的当前源文断言和逆操作。窗口查询继续用 `app.windows.matching(identifier:scene.nonce)`。

恰好一个并且 false/true 都要拒绝的四处：

- 窗口：没有现成等待。下标 0 用 `waitForExistence(timeout: try remaining())`，false 拒绝。下标 1 用 `waitForExistence(timeout: 1)`，true 拒绝。
- sheet：保留已有的 `firstMatch.waitForExistence(timeout: try remaining())`，false 拒绝。只把 `sheets.count` 换成下标 1、超时 1 秒、true 拒绝。
- Choose：保留已有的 `chooseElement.waitForExistence(timeout: chooseTimeout)`。`chooseTimeout` 来自 `try remaining()`，`guard chooseSeen else` 拒绝。只把 `choose.count` 换成下标 1、超时 1 秒、true 拒绝，并且这个拒绝仍在 `isHittable` 和 `click()` 之前。
- Cancel 和 `inputs`：两下标都新写，规则与窗口相同。`inputs` 的等待发生在已经选好的 `inputs` 查询上。

`first.comboBoxes.count` 不按上面的拒绝规则改。它现在决定 `comboCount==1 ? first.comboBoxes : first.textFields`。输入投影对文本框路径会成功；数量不是 1 时改走文本框。对它使用「下标 0 用 `try remaining()`，false 就拒绝」会让没有组合框的路径占满剩余时限或被直接拒绝。组合框改成两次超时都是 1 秒的等待：下标 0 为 true 且下标 1 为 false 才用 `comboBoxes`，否则用 `textFields`。

任一等待不返回就没有 Bool，不能记成恰好一个，也不能继续点按钮。两次返回仍不是原子 `count==1`。detail 仍是 0 到 5。不把 `isHittable`、`click()`、`typeText`、`typeKey` 包进新线程。`observeChooseCensus` 体内的三处 `.count` 保持不动。

## 结构断言和变体怎么一起改

`desktop-workspace-xctest-705.test.ts` 里，第 520、656、799 行读当前源文，改成要求上面的有序等待。第 522 行 stage 11 片段的 `waitForExistence(` 和 `try remaining()` 计数改成新源文的精确次数，不删掉计数。第 688–705 行和第 711–788 行的 `vm` 投影改读新句子：下标 0 返回 false，或下标 1 返回 true，都必须在 `click` 之前拒绝。

第 445 和 639 行读的是逆操作之后的文本。新逆操作先还原今天的 `count` 句子，这两处继续要求 `let chooseCount=choose.count` 和 `guard chooseCount==1 else`，还原片段里的 `waitForExistence(` 仍恰好 1 次。不把这两处改去找新的 `boundBy`。

第 683 行的 `guard chooseCount==1 else` 变体改成破坏新的「下标 1 为 true 就拒绝」。新逆操作找不到这句精确片段时抛 `ERR_ASSERTION`。第 807 行对 `guard inputCount==1 else` 的变体同样改到 `inputs` 的新拒绝句。另加窗口、sheet、Cancel 的当前源文有序片段和同样的变体；这三处今天没有有序片段，只有整文件哈希。

新逆操作写在 `previousInputReady705` 开头，把新句子还原成今天的 `count` 文本。其后的哈希保持 `0b193e101ccee97e618500e56208e6e1740bad28558a8c2439252efca7b9b572`、`1c9da3dd55238e24652db387a3dd351ae49f40bc4c566c5db8621a9fdf453b68`、`6efad44df4a39d7b4aa33a2509dd01b17e97f8ed333252169c058aa5815f064e`、`182d2773a37134d289fec9c80a27107b5359c51d2cab1545bdfd62c3f6a2cee4`、`ab75e477a7f678cbc86191ca3997ea9d55fa8e6ba9cca6a408536af82afa7a79`。第 390 行的 `current` 换成新的组合框分支，`prior` 不改。`RESULT705_SOURCES` 改成新 Swift 的哈希。

不改 `DesktopHost.swift`，不改 45000，不给用例加 `skip`，不删唯一性拒绝。

## 这次修订还没有的红绿

这一份仍是文档。没有新的 macOS 失败或成功可记。历史红灯是 run `44280268875` 上的 `46cdd7ab`。本分支 `aba282dd` 的十项成功跑的是旧选择框，不能写成修复。

## 实现提交的一次 macOS 作业

红灯和绿灯都只认该提交的 `smoke (macos-latest)` 里这条现有用例。不重跑旧 head 来等它变绿。

成功要同时看到：stage 15 的 detail 离开 0；取消计时有 18、19、20；`cancelReturned` 为 1；`childExited` 为 true 且 `childExitCode` 为 0；同一作业里随后三条例子通过。该提交的 diff 里，窗口、sheet、Choose、Cancel 和 `inputs` 不再用 `count` 做恰好一个的拒绝；组合框分支不再用 `count`，但下标 1 为 true 时改走文本框，而不是拒绝。普查里的三处 `.count` 还在。这些等待返回不能写成原子 `count==1`。

stage 15 的 detail 仍是 0：等待没有返回。保持失败，不重跑。detail 离开 0 但 `cancelReturned` 仍是 0：保持失败，把新 stage 写进后续说明。单次快照不返回时，45 秒后盾仍会失败，并且历史运行没有在这个后盾里记下子进程退出。那不是取消成功，也不靠加长时限解决。

Linux 上的结构测试只证明有序片段、变体和逆操作哈希与新源文一致。它不是原生选择框通过。

## 安装包

这一节点没有修复提交，所以没有候选包，没有架构、sha256、构建 run、签名或公证。不读取、不写用户的 `~/.cmspark-agent`。
