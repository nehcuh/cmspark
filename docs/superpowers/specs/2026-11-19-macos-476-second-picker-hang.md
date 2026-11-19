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

实现还不属于这一份文档。通过这一道规划门之后，改 `WorkspacePickerUITests.swift`，并同时改 `desktop-workspace-xctest-705.test.ts` 的当前源文片段、投影和逆操作。按 nonce 匹配窗口的查询留在原处。

窗口、Cancel 和 `inputs` 没有现成的存在等待。它们改成两次 `element(boundBy:).waitForExistence(timeout:)`：下标 0 的超时参数是 `try remaining()`，false 拒绝；下标 1 的超时参数是 1 秒，true 拒绝。sheet 和 Choose 已经有下标 0 的 `waitForExistence(timeout: try remaining())` 并且 false 会拒绝，只把后面的 `count` 换成下标 1、超时 1 秒、true 拒绝。`comboBoxes.count` 是分支，不是拒绝，规则见 5.1。

拒绝型等待不返回，就没有 Bool，序列停住，交给 45 秒后盾，用例失败。组合框等待都返回但不是单一候选时，下一句是改走 `textFields`，不是拒绝。两次返回只证明各自那一次的结果，不是原子的 `count==1`。`isHittable`、`click()`、`typeText`、`typeKey` 仍没有超时参数。历史停点不在它们上面。这一步不给它们加线程，也不新加 `count`。

`waitForExistence` 覆盖的是「`count` 要解析全部匹配、而单次快照仍能返回」这一类。它覆盖不了「单次快照不返回」。后一类仍由 45 秒后盾判失败。

不改 `DesktopHost.swift` 的取消发送。历史日志里点击还没发生，没有一份产品取消帧可修。等待若能返回并且点击发生，现有宿主路径就会发出 `cancelled`。等待若仍不返回，再把当时的 stage 记下来，不先改宿主。

## 5.1 结构断言不只是哈希

`companion/tests/desktop-workspace-xctest-705.test.ts` 对当前 Swift 还有有序片段和变体。只改 Swift 再更新 `RESULT705_SOURCES` 和整文件哈希，这些断言仍失败。唯一性检查不能删。

当前文件里已经核对过的锁：

- 第 445 行在 `previousChoose705` 还原后的片段里要求 `let chooseCount=choose.count`，并且 `guard chooseCount==1 else` 排在可点击之前。第 448 行要求这个还原片段里 `waitForExistence(` 恰好 1 次。
- 第 520–522 行读的是当前源文的 `uiStage=11` 到 `uiStage=12`，有序要求 `let chooseCount=choose.count` 和 `guard chooseCount==1 else`，并要求 `waitForExistence(` 与 `try remaining()` 都恰好 1 次。
- 第 639–640 行在 `previousCriticalCensus705` 的结果上做同样的有序要求和恰好 1 次计数。
- 第 656 行要求当前源文里 `guard chooseCount==1 else` 出现在 `choose.element.isHittable` 之前。
- 第 683 行把当前源文的 `guard chooseCount==1 else` 换成 `guard chooseCount>=1 else`，`previousCriticalCensus705` 必须抛 `ERR_ASSERTION`。
- 第 688–705 行把 stage 11–13 投进 `vm`。它要求源文里有且仅有一次 `guard chooseCount==1 else{throw OwnedUI705Error.refused}`，桩的 `count` 为 0 或 2 时必须在 `click` 之前拒绝。
- 第 390 行的逆操作要求当前源文里有且仅有一次包含 `let comboCount=first.comboBoxes.count` 的输入就绪片段，换成旧片段后整文件哈希仍是 `0b193e101ccee97e618500e56208e6e1740bad28558a8c2439252efca7b9b572`。
- 第 799–801 行要求当前 `uiStage=7` 片段里 `first.descendants` 在 `let comboCount=first.comboBoxes.count` 之前，并且仍有 `comboCount==1 ? first.comboBoxes:first.textFields` 和 `guard inputCount==1 else`。
- 第 711–788 行的输入投影今天用一个 `count` 同时表示组合框和文本框。第 783 行的 `{count:0}` 与 `{kind:'combo', count:2}` 会在点击前拒绝，是因为回退后的文本框数量为 0。第 773 行的 `kind:'text'` 且数量为 1 会点到输入。第 807 行把 `guard inputCount==1 else` 换成 `>=1` 时，逆操作必须失败。
- 第 641 行要求 `observeChooseCensus` 体内 `.count` 恰好 3 次。那是诊断普查，不是按钮权威。

第 445 和 639 行的片段来自逆操作之后的源文，不是裸的当前文件。证据是第 441 行 `swift=previousChoose705(...)` 和第 639 行 `ui=previousCriticalCensus705('ui',actual.ui)`。新的逆操作若先把等待语句还原成今天的 `count` 文本，这两处应继续要求 `choose.count` 和恰好 1 次 `waitForExistence(`。把它们改成在还原结果里寻找新的 `boundBy` 等待，会和还原文本冲突。当前源文的有序片段改第 520、656、799 行，以及第 688 和 711 行的投影。

第 683 行的变体是对当前源文做 `replace`。唯一性句子从源文里消失之后，这个 `replace` 不再改文件，逆操作哈希仍能对上，`assert.throws` 就会失败。Choose、窗口、sheet、Cancel 和 `inputs` 的变体改成破坏各自的「下标 1 为 true 就拒绝」。Choose 的现有投影，以及 `inputs` 的拒绝检查，都是下标 0 为 false 或下标 1 为 true 时在 `click` 之前拒绝。窗口、sheet、Cancel 用同样的有序片段和变体，不另写成组合框那种回退。这个拒绝不用于组合框分支。只删掉旧句子、不补这条，变体锁就没了。

`comboBoxes.count` 不是恰好一个就拒绝。若对组合框套用「下标 0 用 `try remaining()`，false 就拒绝」，没有组合框的文本路径会先占满剩余时限，或者直接被拒绝。实现不这样改。组合框分支改成两次超时都是 1 秒的 `waitForExistence`：下标 0 为 true 且下标 1 为 false 时仍用 `comboBoxes`，其余仍用 `textFields`，这两次返回本身不 `throw`。恰好一个的拒绝留在随后的 `inputs` 上：下标 0 的超时参数是 `try remaining()`，false 拒绝；下标 1 的超时参数是 1 秒，true 拒绝。新的输入投影要有一条「组合框不唯一且文本框恰好一个」并点到输入；文本框不恰好一个才在点击前拒绝，而且调用序列里已经走过文本框等待。第 786 行今天还要求取消发生后执行过 `hittable`。`inputs` 的 `try remaining()` 移到 `hittable` 之前之后，取消改为在 `hittable` 之前拒绝。

第 797–801 行整段都是当前源文，起点 `uiStage=7`，终点 Choose 查询。第 798 行今天把 `waitForExistence(` 锁成恰好 1 次；新片段是 5 次：descendants 的 `timeout:try remaining()`，组合框两次 `timeout:1`，`inputs` 的 `timeout:try remaining()` 和 `timeout:1`。第 800 和 801 行锁住的 `comboCount==1 ?` 与 `guard inputCount==1 else` 只留在逆操作之后。第 786 行同时覆盖 `cancelOnWait` 和 `expireOnWait`，两条都改为候选等待返回后、`hittable` 之前拒绝。

Swift 句子逆操作和 helper 的新摘要还原都在第一次 `restoreCloseObservation476`、`restoreObservation826`、`restoreObservation788` 或 `restoreWorkspaceQuery101` 之前完成，每个原始文件只做一次。不放进 `restoreObservation788`。`restoreWorkspaceQuery101` 今天对含 `let w=windows.firstMatch` 的 Swift 先校验整文件摘要 `2eca9be7…`，对含这个摘要的 helper 先校验 `56cb1183…`；还原放晚了会先失败，而且 helper 里的 `2eca9be7…` 会被换成 `1b4837f6…`，后面的 `80b4d544…` 对不上。这四个摘要保持不动。`desktop-workspace-xctest-705.test.ts` 第 363 行直接把原始 helper 交给 `restoreCloseObservation476('helper', raw)`，不经过 `previousInputReady705`；helper 成功路径先还原再 close476，同循环的协议、观察者和 native 不还原。第 364 行的 helper 变体在摘要换回之后停在 query101 的 `56cb1183…`；协议和观察者停在各自的 `exact current 476 observation source`（`a9660927…`、`b5be419d…`），基数只证明字节改了，不是抛错点。第 171 行的 `raw+raw` 停在入口精确一次，到不了 `56cb1183…`。破坏新窗口拒绝句的 query101 变体停在 ui 入口精确一次，到不了 `2eca9be7…`；没改这些句子的变体才在该摘要失败。成功路径的输出摘要不套到变体上。`desktop-local-native-476.test.mjs` 第 326 行只处理 native，不加还原。`desktop-workspace-query-101.test.ts` 的 `sheet()` 投影改为窗口下标 0 在下标 1 之前拒绝、sheet 下标 1 为 true 才拒绝；第 47 行的 `==1` 变体改到这两句，并保证替换真的改到源文。第 522 行的 `choose.firstMatch` 仍恰好 1 次。第 780 行不再用旧调用序列做全等。完整入口表在计划里。

窗口 `count`、sheet `count`、Cancel `count` 在这个测试文件里没有单独的有序片段，只进整文件哈希。同一提交要给这三处补上和 Choose 一样的当前源文有序片段，以及「下标 1 为 true 仍继续则失败」的变体。不靠只更新哈希来保住它们的唯一性。

sheet 已经有 `firstMatch.waitForExistence(timeout:try remaining())`，false 会拒绝。这里只把后面的 `sheets.count` 换成下标 1、超时 1 秒、true 拒绝，不再加一次重复的下标 0 等待。Choose 的下标 0 同样是已有的 `chooseElement.waitForExistence(timeout:chooseTimeout)`，`chooseTimeout` 来自 `try remaining()`，`guard chooseSeen else` 拒绝。新句子只替换 `choose.count`。窗口、Cancel、`inputs` 没有这层已有等待，两下标都新写。

新逆操作放在 `previousInputReady705` 的第一句，把上述新句子还原成今天的 `count` 文本，然后再走现有片段。还原后的哈希保持 `0b193e10…`、`1c9da3dd…`、`6efad44d…`、`182d2773…`、`ab75e477…`。`RESULT705_SOURCES` 改成新 Swift 文件的哈希。第 641 行的普查 `.count` 仍是 3，新等待不写进 `observeChooseCensus`。

`RESULT705_SOURCES` 和这些逆操作哈希都只说明源文。它们不是 macOS 红灯，也不是原生绿灯。

## 6. 验证

红灯来源是 macOS 上这条现有用例。历史运行 `44280268875` 不能充当新提交的红灯。Linux 上的解析、结构测试，以及本 PR 文档提交的十项 CI，都不能证明选择框已经修好。

这条停住目前没有稳定重现：未改选择框的 main 和本 PR 上一头是绿的，历史失败只有 `46cdd7ab` 那一次。不靠重复跑旧提交刷绿。实现提交只跑一次 `smoke (macos-latest)`，用该提交的进度文件判断机制有没有走到：

- stage 15 的 detail 离开 0，随后出现 stage 18、19、20 的取消计时，`cancelReturned` 为 1，子进程退出码为 0，同一作业的后三例通过。这是该提交的成功。它证明新的等待路径返回了，并且取消完成了。它还不能单独证明「单次快照不返回」以后不会在 `waitForExistence` 里面再发生。
- stage 15 的 detail 仍是 0。新的等待也没有返回。用例保持失败，不跳过，不重跑。
- detail 离开 0，但 `cancelReturned` 仍是 0。等待路径已走到拒绝或还没点到 Cancel。用例保持失败，把新的 stage 记入下一次说明。

不放宽 45000，不跳过，不删 `cancelReturned == 1`。

## 8. 原生证据否定了「换 API 就能返回」

`5abc4ad3` 上的 `waitForExistence` 已经由 `f894bffb` 的 CI run `44475469229`、macOS job `135394832966` 跑过。选择框用例仍是 45000 毫秒超时。`uiProgress` 仍是 `{stage:15,detail:0}`，`cancelTiming788.events` 仍是空数组，`cancelReturned` 仍是 0，`childExited` 是 false，`childExitCode` 是 null。同一作业里随后的 local-work、archive history、terminal-only 三例也超时。

stage 15 detail 0 写在 `sheet(15)` 进入后、下一次 `observeUIStage` 之前。当前源文里，这一笔之后才计算 `remaining()`，然后才调用 `waitForExistence`。因此这次日志不能分开「`remaining()` 没返回」和「`waitForExistence` 没返回」。它能否定的是：把 `count` 换成带 `timeout` 的 `waitForExistence` 并没有让第二次窗口查询在 45 秒内返回一个 Bool。`timeout` 不是对底层辅助功能快照的强制中断。

`D826_UI_TIMING` 里的 1、2、3、5、6 是 node 侧 `note826` 的站点，不是 XCTest 的 stage 18–20。桶值 180 等于 `floor(45000/250)`。站点 5 是 `complete()` 拒绝，站点 6 是取消；站点 7 和 8（Xcode 退出）没有出现，和 `xcodeClosed:false` 一致。取消计时 18–20 的缺失仍以 `cancelTiming788.events` 为空为准。

宿主在第二次 ping 时主线程还跑得动 `panel()`：`pickerObserved` 是 2，宿主 `failureSite` 是 0。ping 之后验收定时器被取消，之后没有宿主心跳。所以不能判断卡住期间宿主主线程是否还在跑。

`finishPicker` 只对已经结束的那张 `NSOpenPanel` 调用 `orderOut`。稍后 `retirePicker` 又对同一对象调用 `cancel(nil)` 和 `orderOut`，然后下一次 `beginPicker` 才 `beginSheetModal`。这是第一次和第二次查询之间的生命周期差别。它是否让共享的打开面板服务停住，这次日志没有证明。

## 9. 下一道诊断

不增加 45000。不把查询挪到别的线程。不改 `DesktopHost.swift`，直到诊断把阻塞侧分开。下一道实现只加两笔阻塞前、跨进程能看见的记录：

- `sheet()` 在 `remaining()` 返回之后、`waitForExistence` 之前写下 detail 1。停在 detail 0 表示还没进入等待；停在 detail 1 表示等待调用本身没有返回。
- 验收夹具在发出第二次 `D476_WS_PICKER_CANCELLED` 之后，用主线程 `Timer` 继续发送有上限的 `system.ping`（每秒至多一次，最多 40 次），面板结束就停。node 测试已经在收 `system.ping`。等待期间仍能收到这些 ping，表示宿主主线程还在跑，阻塞在 XCTest 这一侧的辅助功能调用。ping 在第二次选择框出现后停止，表示宿主没有再执行这个定时器。

这两笔都不是取消成功。`cancelReturned` 仍必须是 1，后三例仍必须在同一作业通过。

## 7. 这一节点不做的事

不改测试源码，不改产品源码，不打安装包，不覆盖 `~/.cmspark-agent`。没有候选安装包，也就没有架构、sha256、签名或公证可报。那些要等有一个被上述 macOS 作业证明的修复提交。不开始侧栏 Task 2。发布仍暂停。
