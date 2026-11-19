# macOS #476 第二次工作区选择框卡住

这是现有验收的故障说明，不是新功能。不改版本，不打 tag，不发 Release。不合并 #866、#867、#864，不改 #856。

对照：

- `origin/main`：`08fe57feacd6ca634eb2f8369dada10420ce0d44`。最近 8 次 push 到 main 的 CI 都是成功。
- 失败提交：PR #867 `46cdd7ab533d1b58bc6ee231764f57142ee039bf`。
- 失败运行：CI `44280268875`。十项里只有 `smoke (macos-latest)` 失败。`acp-history-restart` 在这一提交上已经成功。
- 失败作业：`134718780580`。失败步骤是 `Native desktop interaction acceptance (#476)`。

## 1. 日志实际证明的位置

作业跑的是 `companion` 里的 `desktop-native-thread-metadata-476.test.js`。第一个失败用例是：

`#476 actual native workspace picker binds canonical root, reopens lists/reads and cancels the second OS picker`

它自己的时限是 45 秒，日志是 `test timed out after 45000ms`。随后同一作业里的三条例子也超时。那三例开始前，这一例的清理记录已经是 `xcodeClosed:false`、`childExited:false`。它们是同一次原生界面没退出之后的连锁，不是四个互相独立的产品缺陷。

这一例打印的 `D476_WORKSPACE_NATIVE_PHASE`：

- `picks:2`，`pickerObserved:2`，`pickerReturned:1`，`cancelReturned:0`
- `selectedOutcome:true`，`selectedIdentity:true`
- `childExited:false`
- `firstFailedAssertion:0`
- `failureSite:9`
- `uiProgress` 是 `{stage:15,detail:0}`
- `cancelTiming788.events` 是空数组
- `nativeDiagnostic.failureSite` 是 0，`phaseMask` 是 271

这些数字对上源码，而不是对上「取消消息写错了」这种猜测：

1. `failureSite:9` 只出现在 `uiOwner.complete()` 被拒绝的回调里（`desktop-native-thread-metadata-476.test.ts` 约第 220 行）。`firstFailedAssertion` 仍是 0，所以不是断言序号 9 失败。45 秒的测试时限先到，信号中止 UI runner，回调才写下 9。9 是超时的后果。
2. `uiProgress.stage` 15、`detail` 0 是 `WorkspacePickerUITests.swift` 的 `sheet(15)` 刚进入时写下的。下一笔应是 `windows.count` 返回后的 `detail`。那一笔没有出现。卡住的调用是 `app.windows.matching(identifier:).count`。
3. 取消按钮的观察在 stage 18–20。对应的 `cancel-18/19/20` 文件没有被读到，所以测试还没点到 Cancel。
4. 宿主 `workspace-acceptance.swift` 的 `panel()` 在面板可见且 sheet 父窗口匹配之后才发出 `D476_WS_PICKER_SELECTED` 或 `D476_WS_PICKER_CANCELLED`。`pickerObserved:2` 说明这两次 ping 都到了测试进程。宿主诊断的 `failureSite` 仍是 0，宿主没有调用自己的 `fail()`。
5. `pickerReturned:1` 且身份匹配，说明第一次选择结果已经回到测试。`cancelReturned:0` 是因为没人点到第二次的 Cancel，宿主也就没有发出 `outcome:"cancelled"`。

## 2. 还不能当成根因的说法

「第二次取消结果没返回」描述的是结果帧缺失，不是第一故障点。结果帧缺失是因为 XCTest 停在数窗口，没有点 Cancel。

PR #867 相对 main 的产品差异只有 `ProjectNavigationRoot.tsx` 的侧栏文案和按钮。它不编译进 `DesktopHost.swift`、`workspace-acceptance.swift` 或 `WorkspacePickerUITests.swift`。因此这次日志不能证明侧栏改动让 NSOpenPanel 卡住。main 上最近的 CI 是绿的，只能说明这条路径不是每次都红，不能证明 `46cdd7ab` 引入了它。

本环境是 Linux。这里不能打开真实 NSOpenPanel，也不能把 Linux 上的解析测试当成这次 macOS 失败已经复现。

## 3. 要守住的行为

不增加 45000 毫秒。不跳过这条用例。不删断言。`cancelReturned` 仍必须是 1，子进程仍必须以 0 退出，清理后不能留下 Xcode 或选择框进程。

连续选择、第二次取消、取消后再打开、正常选择、拒绝或错误、超时后清掉锁和子进程，都仍用现有 #476 用例验收。修的是第二次 sheet 的窗口查询不能无限卡住；验收条件不放宽。

## 4. 还不在这一节点做的事

不改侧栏，不开始 UI Task 2。不打安装包，不覆盖 `~/.cmspark-agent`。安装包要等有一个被 macOS CI 证明的修复提交之后再单独做，并写明架构、sha256、构建 run、签名和公证状态。
