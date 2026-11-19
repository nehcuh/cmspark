# macOS #476 第二次工作区选择框卡住

这是现有验收的故障说明，不是新功能。不改版本，不打 tag，不发 Release。不合并 #866、#867、#864，不改 #856。这一版撤销上一版「让 `remaining()` 包住窗口计数」的修法。那个写法约束不到真正卡住的调用。

对照：

- `origin/main`：`08fe57feacd6ca634eb2f8369dada10420ce0d44`
- 本 PR 上一头：`aba282dde90a6c653eeaf7f9f52ed38fc064fea8`。其上的十项 CI 跑的是未改过的原生选择框。
- 历史失败提交：PR #867 `46cdd7ab533d1b58bc6ee231764f57142ee039bf`
- 历史失败运行：CI `44280268875`，作业 `134718780580`，`smoke (macos-latest)`，步骤 `Native desktop interaction acceptance (#476)`

旧运行只作历史证据。以后每一次红灯或绿灯都要落在含有对应改动的提交上。

## 1. 历史日志停在哪里

用例是 `desktop-native-thread-metadata-476.test.ts` 里的：

`#476 actual native workspace picker binds canonical root, reopens lists/reads and cancels the second OS picker`

时限 45000 毫秒。`D476_WORKSPACE_NATIVE_PHASE` 记下 `picks:2`，`pickerObserved:2`，`pickerReturned:1`，`cancelReturned:0`，`selectedOutcome:true`，`selectedIdentity:true`，`childExited:false`，`firstFailedAssertion:0`，`failureSite:9`，`uiProgress` 为 `{stage:15,detail:0}`，取消计时事件为空，宿主 `nativeDiagnostic.failureSite` 为 0。同一作业里后面三条例子接着超时。清理开始时 `xcodeClosed` 为 false。

源码里的对应关系：

- `WorkspacePickerUITests.swift` 的 `sheet(15)` 先写 stage 15、detail 0，下一句才是 `app.windows.matching(identifier:).count`。detail 0 写在 `count` 之前。日志没有下一笔 detail。这与执行停在这一句上相容。
- Cancel 的观察在 stage 18。那一笔没有出现，所以这条 UI 序列没有执行到 `cancel.element.click()`。
- `failureSite` 9 只写在 `uiOwner.complete()` 被拒绝的回调里。`firstFailedAssertion` 仍是 0。9 是 45 秒中止之后的记录。
- 宿主 `panel()` 在真实 `NSOpenPanel` 可见且 sheet 父窗口匹配之后发出 ping。两次 ping 都到了测试进程，宿主自己的 `failureSite` 是 0。第一次 `desktop.workspace.picker.result` 已是 `selected`，路径身份匹配。

## 2. 这一份日志分不开的两件事

停在 `count` 那一句，和下面两种情况都相容：

- XCTest 这条同步辅助功能查询没有返回。
- 选择框进程不再应答辅助功能，查询因此没有返回。

宿主在发出第二次 ping 时，主线程还跑得动 `panel()`。ping 之后定时器被取消。卡住期间没有下一笔宿主心跳。因此不能把产品里的取消逻辑说成已经定位。`cancelReturned:0` 表示测试进程没有收到 `outcome:"cancelled"`。UI 序列还没到点击，这份日志里没有一次已经发出、然后丢失的取消结果。

PR #867 相对 main 的产品差异只有侧栏 `ProjectNavigationRoot.tsx`。它不编译进 `DesktopHost.swift`、`workspace-acceptance.swift` 或 `WorkspacePickerUITests.swift`。main 最近的 CI，以及本 PR 上一头的十项 CI，跑的都是这份未改选择框。一次历史失败加上这些成功，说明这条路径不是每次都停。它没有证明 `46cdd7ab` 引入了停住，也没有证明选择框本体有一个稳定缺陷。

## 3. 同步查询的边界

`sheet()` 里和精确数量有关的调用是：

```swift
let windows=app.windows.matching(identifier:scene.nonce),count=windows.count
let exists=w.sheets.firstMatch.waitForExistence(timeout:try remaining())
let sheets=w.sheets.count
```

`remaining()` 在调用前计算剩余秒数。返回值只被传进声明了 `timeout` 的 API，例如 `wait(for:timeout:)` 和 `waitForExistence(timeout:)`。`XCUIElementQuery.count` 没有超时参数。先调用 `remaining()` 再读 `count`，超时代码排在 `count` 后面，`count` 不返回时那些代码不会执行。

这条用例标了 `@MainActor`。把 `count` 丢到别的线程不能安全打断正在进行的辅助功能调用，也越出 XCTest 查询要待在主执行器上的用法。

`waitForExistence(timeout:)` 的超时属于这个等待方法：快照能返回时，它会在超时内得到 true 或 false。一次快照本身若不返回，这个超时没有公开参数可以打断那一次调用。`exists`、`isHittable`、`click()`、`typeText`、`typeKey`、`label`、`title` 同样是同步解析，同样没有超时参数。新加任何一次这样的调用，都会重新引入同一种停住。历史日志停在第二次 `sheet(15)` 的窗口 `count`，还没有执行到同函数里紧跟着的 `sheets.count`，也没有执行到 stage 18 的 `cancel.count`。

45 秒的 node 测试时限是这种不返回调用的外层后盾。它中止 `t.signal`，`finally` 里会 `child.terminate()` 并 `uiOwner.cleanup()`。历史运行在 45000 毫秒进入了 `CLEANUP_ENTER`，同时 `over_budget` 为 true，桌面子进程和 Xcode 都没有记下退出。这个后盾让用例失败，不负责把取消变成成功，也不保证子进程已经回收。时限保持 45000，不加大。

## 4. 有界失败和真正成功是两件事

有界失败：精确数量的等待在自己的超时里返回 false，或看到第二个匹配。测试抛出现有的 `OwnedUI705Error.refused`，用例失败。`cancelReturned` 仍是 0。这只说明等待没有被当成成功。

真正成功只认同一作业、同一提交上的这些事实：`cancelReturned` 为 1，桌面子进程退出码为 0，后面原来连锁超时的三条例子通过。等待超时、拒绝、或者 45 秒后盾触发，都不是取消成功。

不能因为没数到就把数量当成 1。不能把不返回的同步调用挪个位置就算修好。

## 5. 下一步实现要改的调用

实现还不属于这一份文档。通过这一道规划门之后，只改测试驱动 `WorkspacePickerUITests.swift` 里那些用 `count` 判定「恰好一个」的地方：`sheet()` 的窗口和 sheet，第一次面板的组合框与输入框，Choose 按钮，Cancel 按钮。按 nonce 匹配窗口的查询留在原处。

每个这样的判定改成两次 `element(boundBy:).waitForExistence(timeout:)`：

- 下标 0 的超时参数用 `try remaining()`。返回 false 就拒绝。
- 下标 1 的超时参数是这个等待调用自己的 1 秒字面量，不用 `remaining()`，也不占用整段 45 秒。返回 true 就拒绝。返回 false 表示这次等待看到没有第二个匹配。
- 两次等待都返回之后，才把 detail 写成「恰好一个」并继续。任一等待不返回，就没有 Bool，序列停在那里，交给 45 秒后盾，用例失败。

这两次等待不是同一次原子快照。它们只证明：第一次等待返回时下标 0 存在，第二次等待返回时下标 1 不存在。Choose 与 Cancel 的 `isHittable` 和 `click()`，以及输入用的 `typeText` / `typeKey`，仍是没有超时参数的同步调用。历史停点不在它们上面。这一步不给它们加线程，也不新加 `count`。

`waitForExistence` 覆盖的是「`count` 要解析全部匹配、而单次快照仍能返回」这一类。它覆盖不了「单次快照不返回」。后一类仍由 45 秒后盾判失败。

不改 `DesktopHost.swift` 的取消发送。历史日志里点击还没发生，没有一份产品取消帧可修。等待若能返回并且点击发生，现有宿主路径就会发出 `cancelled`。等待若仍不返回，再把当时的 stage 记下来，不先改宿主。

`WorkspacePickerUITests.swift` 被 `desktop-workspace-xctest-705.test.ts` 和 `RESULT705_SOURCES` 的源文哈希锁住。实现提交要同时更新这些锁，让锁描述新源文。锁更新只说明源文被改过。它不是 macOS 红灯，也不是原生绿灯。

## 6. 验证

红灯来源是 macOS 上这条现有用例。历史运行 `44280268875` 不能充当新提交的红灯。Linux 上的解析、结构测试，以及本 PR 文档提交的十项 CI，都不能证明选择框已经修好。

这条停住目前没有稳定重现：未改选择框的 main 和本 PR 上一头是绿的，历史失败只有 `46cdd7ab` 那一次。不靠重复跑旧提交刷绿。实现提交只跑一次 `smoke (macos-latest)`，用该提交的进度文件判断机制有没有走到：

- stage 15 的 detail 离开 0，随后出现 stage 18、19、20 的取消计时，`cancelReturned` 为 1，子进程退出码为 0，同一作业的后三例通过。这是该提交的成功。它证明新的等待路径返回了，并且取消完成了。它还不能单独证明「单次快照不返回」以后不会在 `waitForExistence` 里面再发生。
- stage 15 的 detail 仍是 0。新的等待也没有返回。用例保持失败，不跳过，不重跑。
- detail 离开 0，但 `cancelReturned` 仍是 0。等待路径已走到拒绝或还没点到 Cancel。用例保持失败，把新的 stage 记入下一次说明。

不放宽 45000，不跳过，不删 `cancelReturned == 1`。

## 7. 这一节点不做的事

不改测试源码，不改产品源码，不打安装包，不覆盖 `~/.cmspark-agent`。没有候选安装包，也就没有架构、sha256、签名或公证可报。那些要等有一个被上述 macOS 作业证明的修复提交。不开始侧栏 Task 2。发布仍暂停。
