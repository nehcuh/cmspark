# macOS #476 第二次选择框卡住的修复计划

> 规划修订。上一版「在 `remaining()` 内完成 `count`」作废。这一份通过复审之前，不改 Swift，不改 TypeScript，不改产品。

GitHub: 现有 #476 桌面验收。没有新的用户可见行为。

**Base:** `08fe57feacd6ca634eb2f8369dada10420ce0d44`

规格：`docs/superpowers/specs/2026-11-19-macos-476-second-picker-hang.md`

## 上一版为什么约束不到

`remaining()` 的结果只会传给带 `timeout` 参数的等待。`XCUIElementQuery.count` 没有这个参数。它不返回时，写在它后面的拒绝不会执行。把查询挪到别的线程也不能安全打断它。到时拒绝只是有界失败，`cancelReturned` 不会因此变成 1。`waitForExistence(timeout:)` 写在当前 `windows.count` 之后，历史日志还没走到它。

## 实现时改哪些调用

只改 `companion/tests/fixtures/workspace-ui-705/WorkspacePickerUITests.swift` 里用 `count` 判定恰好一个的五处：`sheet()` 的窗口、`sheet()` 的 sheet、第一次面板的组合框和输入框、Choose、Cancel。窗口查询继续用 `app.windows.matching(identifier:scene.nonce)`。

每一处换成：

1. `element(boundBy: 0).waitForExistence(timeout: try remaining())`。false 则 `throw OwnedUI705Error.refused`。
2. `element(boundBy: 1).waitForExistence(timeout: 1)`。true 则拒绝。false 才是「没有第二个」。
3. 两次都返回后才把该 stage 的 detail 记成恰好一个。缺一次返回就不能记成 1，也不能继续点按钮。

detail 仍只能是 0 到 5，沿用现有的 `writeUIProgress`。不新增 stage 编号。不把 `isHittable`、`click()`、`typeText`、`typeKey` 包进新线程。不在第二次面板上新加 `count`。诊断用的 `observeChooseCensus` 保持原样，不把它当成按钮权威。

同一提交更新钉住这份 Swift 的源文哈希：`companion/tests/helpers/workspace-xctest-owned-705.ts` 的 `RESULT705_SOURCES`，以及 `companion/tests/desktop-workspace-xctest-705.test.ts` 里会重算这份文件的守恒断言。哈希要等于新文件。不改断言的含义来迁就哈希。

不改 `DesktopHost.swift`，不改 45000，不给用例加 `skip`。

## 这次修订还没有的红绿

这一份仍是文档。没有新的 macOS 失败或成功可记。历史红灯是 run `44280268875` 上的 `46cdd7ab`。本分支 `aba282dd` 的十项成功跑的是旧选择框，不能写成修复。

## 实现提交的一次 macOS 作业

红灯和绿灯都只认该提交的 `smoke (macos-latest)` 里这条现有用例。不重跑旧 head 来等它变绿。

成功要同时看到：stage 15 的 detail 离开 0；取消计时有 18、19、20；`cancelReturned` 为 1；`childExited` 为 true 且 `childExitCode` 为 0；同一作业里随后三条例子通过。该提交的 diff 里，上述五处不再用 `count` 做恰好一个的判定。

stage 15 的 detail 仍是 0：等待没有返回。保持失败，不重跑。detail 离开 0 但 `cancelReturned` 仍是 0：保持失败，把新 stage 写进后续说明。单次快照不返回时，45 秒后盾仍会失败，并且历史运行没有在这个后盾里记下子进程退出。那不是取消成功，也不靠加长时限解决。

Linux 上更新哈希锁之后的结构测试，只证明锁和新源文一致。

## 安装包

这一节点没有修复提交，所以没有候选包，没有架构、sha256、构建 run、签名或公证。不读取、不写用户的 `~/.cmspark-agent`。
