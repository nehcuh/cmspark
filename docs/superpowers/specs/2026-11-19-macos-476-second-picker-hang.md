# macOS #476 第二次工作区选择框卡住

2026-11-20 更新。XCTest 在首次选择目录时，为缺席的组合框、第二个输入和第二个 Choose 按钮分别等待一秒，并采集调试描述。首次点击 Choose 到第 25 秒才开始，开始查找第二个窗口时余 4.1 秒，开始校验窗口唯一性时约余 2.3 秒。本次恢复首次选择对输入和 Choose 的唯一性计数，保留等待输入出现、等待 Choose 出现、可点击性及实际点击。两次窗口、sheet 和 Cancel 的检查继续执行，整例截止仍为 45 秒。下文记录此前各轮方案。[该次 macOS 作业](https://github.com/nehcuh/cmspark/actions/runs/44650948321/job/136005378640)

首次选择修正后，Choose 点击提前到 15.98 秒。第二次打开时，窗口和 sheet 的重复项等待各触发一次辅助功能树采集。看到 Cancel 时余 182 毫秒。另一台 runner 上实际取消已经返回，夹具只余 936 毫秒收尾。窗口、sheet 与 Cancel 现在都先等目标出现，再对同一限定查询要求当次数量恰好为一。目标消失或有重复时立即拒绝。真实选择、取消、持久化、退出和清理仍须在原验收中完成。[首次修正的运行](https://github.com/nehcuh/cmspark/actions/runs/44664613580/job/136050776624) · [取消已返回的运行](https://github.com/nehcuh/cmspark/actions/runs/44664930770/job/136051789125)

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

不放宽 45000，不跳过，不删 `cancelReturned == 1`。上一节对 detail 0 的读法只适用于当时那一版：detail 0 写在等待前面，后面没有另一笔同样可能被吞掉的写入。第 9 节的预等待标记不再用「detail 停在 0」证明 `remaining()` 没返回。

## 8. 原生证据否定了「换 API 就能返回」

`5abc4ad3` 上的 `waitForExistence` 已经由 `f894bffb` 的 CI run `44475469229`、macOS job `135394832966` 跑过。选择框用例仍是 45000 毫秒超时。`uiProgress` 仍是 `{stage:15,detail:0}`，`cancelTiming788.events` 仍是空数组，`cancelReturned` 仍是 0，`childExited` 是 false，`childExitCode` 是 null。同一作业里随后的 local-work、archive history、terminal-only 三例也超时。

stage 15 detail 0 写在 `sheet(15)` 进入后、下一次 `observeUIStage` 之前。当前源文里，这一笔之后才计算 `remaining()`，然后才调用 `waitForExistence`。因此这次日志不能分开「`remaining()` 没返回」和「`waitForExistence` 没返回」。它能否定的是：把 `count` 换成带 `timeout` 的 `waitForExistence` 并没有让第二次窗口查询在 45 秒内返回一个 Bool。`timeout` 不是对底层辅助功能快照的强制中断。

`D826_UI_TIMING` 里的 1、2、3、5、6 是 node 侧 `note826` 的站点，不是 XCTest 的 stage 18–20。桶值 180 等于 `floor(45000/250)`。站点 5 是 `complete()` 拒绝，站点 6 是取消；站点 7 和 8（Xcode 退出）没有出现，和 `xcodeClosed:false` 一致。取消计时 18–20 的缺失仍以 `cancelTiming788.events` 为空为准。

宿主在第二次 ping 时主线程还跑得动 `panel()`：`pickerObserved` 是 2，宿主 `failureSite` 是 0。ping 之后验收定时器被取消，之后没有宿主心跳。所以不能判断卡住期间宿主主线程是否还在跑。

`finishPicker` 只对已经结束的那张 `NSOpenPanel` 调用 `orderOut`。稍后 `retirePicker` 又对同一对象调用 `cancel(nil)` 和 `orderOut`，然后下一次 `beginPicker` 才 `beginSheetModal`。这是第一次和第二次查询之间的生命周期差别。它是否让共享的打开面板服务停住，这次日志没有证明。

## 9. 下一道诊断

不增加 45000。不把查询挪到别的线程。不改 `DesktopHost.swift`。这一节通过独立门之前不实现。诊断读数不是取消成功，`cancelReturned` 仍必须是 1，后三例仍必须在同一作业通过。

### 9.1 预等待 detail

`observeUIStage` 是 `try? scene.writeUIProgress(uiStage,uiDetail)`。写入失败会被吞掉，文件里可以留下上一笔成功的 detail 0。因此中止时进度文件仍是 stage 15 detail 0，不能断言 `remaining()` 没有返回。这一态保持未知。

`windowOne` 为 false 时下一句也是 `uiDetail=windowOne ? 2:1`，同样写成 1，然后 `throw`，`catch` 再写 `uiRefusal`。所以单独看到 detail 1 不能区分「等待没返回」和「等待返回了 false」。

只有这三件同时成立，detail 1 才支持「`waitForExistence` 没返回」：`uiProgress.stage` 仍是 15，`uiRefusal` 为 null，进度里没有 stage 16 或更后的 stage。这个读数仍不是成功。`remaining()` 自己在时限外会把内存里的 detail 设成 4 或 5 再抛出；那要看 `uiRefusal` 是否真写上，不能从进度文件的 detail 0 反推。

实现时窗口查询改成先 `let windowTimeout=try remaining()`，返回后 `uiDetail=1;observeUIStage()`，再 `waitForExistence(timeout:windowTimeout)`。不在等待参数里再调用一次 `remaining()`。

### 9.2 宿主 tick 的 id 和打印位置

id 只有一个：`system.ping` 的 `id` 是 `D476_WS_HOST_TICK`。不使用没有 id 的 ping，也不使用 `D476_WS_DIAG_` 前缀。

现在的消息分支只把 `D476_WS_PICKER_SELECTED`、`D476_WS_PICKER_CANCELLED`、`D476_WS_DIAG_`、`D476_WS_FAIL` 和 `required` 里的 id 记进状态。`D476_WS_HOST_TICK` 不在其中，所以不会出现在 45 秒中止时打印的 `D476_WORKSPACE_NATIVE_PHASE`。

实现把计数记进这个已经会打印的对象：`hostTicks` 是 0 到 40 的次数，`hostTickLast` 是 null 或正好 `D476_WS_HOST_TICK`。两个字段写在 `cancelCurrent` 后面。不放进 `required`，不改 `receiptMask`。45 秒中止时现有的 stdout 行就是证据。不要求 40 次都到达；0 次也要能看见，并且不是成功。

`panel()` 里 0.016 秒的定时器仍在面板刚可见、发出 ping 之前停掉。新定时器在同一次 `panel()` 里、第二次 `emit` 已经返回之后创建，不另开队列，也不 `DispatchQueue` 延后。创建和 `invalidate` 都在这个 runloop 上。面板变为 `settled`、次数到 40，或验收 `fail` 时，在同一轮调用里 `invalidate` 再返回，避免 45 秒 `terminate` 之后定时器还拖住宿主。第一次选择框的 `D476_WS_PICKER_SELECTED` 不启动它。tick 还在增加只说明这个 runloop 还在执行定时器。它不证明 `orderOut` 或打开面板服务是根因。

### 9.3 源锁和调用序

窗口那一句的精确文本改为：

`uiStage=stage;uiDetail=0;observeUIStage();let windows=app.windows.matching(identifier:scene.nonce);let windowTimeout=try remaining();uiDetail=1;observeUIStage();let windowOne=windows.element(boundBy:0).waitForExistence(timeout:windowTimeout);uiDetail=windowOne ? 2:1;observeUIStage();guard windowOne else{throw OwnedUI705Error.refused};let windowExtra=windows.element(boundBy:1).waitForExistence(timeout:1);uiDetail=windowExtra ? 3:2;observeUIStage();guard !windowExtra else{throw OwnedUI705Error.refused};let w=windows.firstMatch`

`picker-wait-inverse.cjs` 的第一对当前句换成上面这句，还原句仍是现在的 `windows.count` 句。`NEW_DIGEST` 从 `f0379ae7e39c248d64e088379e3b876897c86ff060c6adddb833d33fe2fa24cf` 改成新的 `WorkspacePickerUITests.swift` 摘要。`RESULT705_SOURCES` 里同一文件的那一格改成同一个摘要。成功的 ui 还原输出仍是 `2eca9be781a3c401b6d96bf8cba6b41f9c8fe32f9be5052be094d0ae27c972b8`。成功的 helper 还原输出仍是 `56cb1183b0e057b879d11567424c5b325362e7dbfd373edeca4faa5dd73751e5`。变体走 `requireSuccessDigest:false`，不套这两句成功摘要。不改更早的 query101、826、788 历史摘要。

`sheet()` 的成功调用序从 `window-one`、`remaining`、`window-one-wait` 改成 `remaining`、`window-one`、`window-one-wait`，然后再接现有的 `window-extra`、`window-extra-wait`、`window-first`、`sheet-first`、`remaining`、`wait`、`sheet-extra`、`sheet-extra-wait`、`sheet-first`。窗口没有时停在 `remaining`、`window-one`、`window-one-wait`。多一个窗口时停在 extra 等待之后。`waitForExistence(timeout:try remaining())` 在 `sheet()` 里只剩 sheet 那一次；窗口等待是 `timeout:windowTimeout`，只有一次。字面量 `timeout:1` 仍是两次。

同一组 tick 句子只此三句，每句恰好一次：`pickerObserved=0,hostTicks=0,hostTickLast=null,pickerReturned=0` 还原成 `pickerObserved=0,pickerReturned=0`；`D476_WS_HOST_TICK` 计数分支整句删掉；`cancelCurrent,hostTicks,hostTickLast` 还原成 `cancelCurrent`。少一句先在精确一次处失败，不套后面的成功摘要。旧 hash 常量不改、不后移。

这三句必须在各入口的第一道 hash 之前剥掉。`restoreObservation826` 的第一道是 `9e80020deed6f46ede58481ecbd2e631c796b0cc653995ad1f6bdbfa9d2cbabe`，`restoreCloseObservation476` 会先走进它。剥掉之后仍保持的摘要：

- `scripts/tests/native-join-observation-788.test.cjs`：`close476` 之前剥。去掉 JOIN 之后仍是 `120cc92d2c0eb1209f1db8843ea054468cb2ddd7ac80a5ed530e196e50c65164`。
- `desktop-native-observation-788.test.ts` 的十文件循环和 801 测试：`restoreObservation788` 之前剥。现在 native 不走 picker peel。788 和 `terminalAdmissionInverse801` 之后仍是 `5f225d624d4d83a55b76ebe0b7f82bbe1202dffda843139c674156ea72e2e018`，再去掉 `{ llmKey: true }` 仍是 `56abd88e272e8982388507c79c4046936401937e534d5333d5f42885f563f313`。
- `desktop-workspace-xctest-705.test.ts`：第 57 行是 helper 的 `restorePickerWait`。native 的 `restoreHostTick` 在第 58 行，位于 `restoreObservation826` 之前。去掉 CLOSE 之后仍是 `0b78022a6efaa334ce97d5d1ccfb9c6d59857997ddefed3ad5f7a0e501fb78a4`。这个摘要入口不改。
- 705 的 `workspaceAbortPhaseInverse705` 先调用 `close476`，所以剥在 `close476` 之前，不只在 788 之前。747 的同名函数剥在 `restore788` 之前。两处最终仍是 `6fadbe6027b50d5a1b0654ba30641d260e7dcaa098d38ad90a398fe4639eed3c` 和 `7c5d8b54f03c68fa285d60d8fd029cd10dbbf5c0073e79d5944778435e3d1288`。747 再往后的 `6d79c72e958fb35b40c42086c098235425b1f2b1b63e4ef95295d4c085007b4b` 不改。
- `desktop-archive-observation-782.test.ts`：`restoreObservation788` 之前剥。之后仍是 `33b233999fcfcc764b4882749d7264aa534fc45938ff717dd23bcc51f4cdeaa6` 和 `f4b0ae09fd52e2ed4fa2d112ebc041e1a33e5323776ddc3e00291c1a4bea4675`。
- `desktop-close-observation-826.test.ts` 的 native、`desktop-owned-initial-input-826.test.ts`：在 `restoreInitialOwnedInput826` 和 `restoreObservation826` 之前剥。`9e80020d…`、`08dcaea7cc828719ea144c2b42129d90919f8693854782db683bddb0deca0ab0`、`46d852529cfbb6016484b8680d534549303d9c88e0083ffa83d9071b18886e16` 不改。
- `desktop-local-native-476.test.mjs` 的 `hostObservationSource808`：`close476` 之前剥。配对还原后仍是 `04b5b5edcaf59cfe666f5e84de6a1a386ea4f48d493023e13ef75bd7a9c084f2`。
- `previousCensus705('native')` 经 `previousInputReady705` 进入 `close476`。剥在那之前。`2f2a3d08eafb54b2eef26450e30b12000844479e759316eff3773ebad8364f2e`、`ba6a17d9ba68cefa2ea0a4feae84a2ef41ada61c83073a5d7b47e7755b4f9b5e`、`bdba454b129cdc8364cb937a1445f57661a374b54ef1ff6904398d08cbde61e3` 不改。

`705 aborted workspace context preserves the same closed phase` 执行的是当前 phase 块。它的 vm scope 必须自带 `hostTicks` 和 `hostTickLast`，否则在 abort 打印之前就是 `ReferenceError`。这个 scope 不是上面的历史摘要。

`desktop-workspace-picker-readiness-705.test.ts` 的同步 `panel()` 不执行定时器 callback。`startHostTick` 在这个 fixture 里是 `()=>calls.push('HOST_TICK_START')`，只记名。第一次 `panel()` 仍是 `['RETIRE_TIMER','D476_WS_PICKER_SELECTED']`。第二次仍是 `['RETIRE_TIMER','D476_WS_PICKER_CANCELLED','HOST_TICK_START']`。这三条不含停因。0.016 秒定时器仍在 emit 之前停。停因断言不写在这次调用序上，见第 15 节。

## 10. 诊断运行否定了「第二次查询不返回」

CI run `44481851252`，macOS job `135415734824`，SHA `7c5209b0470b1aecf0b151f116371494b31b2132`。十项检查里只有 `smoke (macos-latest)` 失败。其余九项成功：`build`、`smoke (ubuntu-latest)`、`smoke (windows-latest)`、`smoke (windows-native)`、`activity (Linux X11 native)`、`acp-history-restart`、`Affected CPU controls (Linux ARM64)`、`Windows session persistence`、`Linux integration controls (ARM64)`。

选择框用例仍是 `test timed out after 45000ms`。原始 phase 是：

- `uiProgress` 为 `{stage:20,detail:0}`，`uiRefusal` 为 null。stage 18、19、20 都有进入和返回：`cancelTiming788.events` 含 `[18,false,29480,5814,0]`、`[18,true,31030,4264,0]`、`[19,false,33553,1741,1]`、`[19,true,33990,1304,1]`、`[20,false,33991,1302,1]`、`[20,true,34833,461,1]`。
- `cancelReturned` 为 1，`pickOutcome` 为 4，`receiptMask` 为 1023，`childExited` 为 true，`childExitCode` 为 0。`firstFailedAssertion` 为 3，`failureSite` 为 9。
- `hostTicks` 为 12，`hostTickLast` 为 `D476_WS_HOST_TICK`。次数没有到 40。定时器在 `pickerCurrent` 不为真或面板 `settled` 时会停，所以次数停不能证明 `orderOut` 或打开面板服务停住。12 次到达说明第二次面板处于当前选择期间，宿主 runloop 还在执行这个定时器。
- stage 20 的 detail 0 是点击前那一笔。计时 20 的 `true` 说明 `click()` 已返回。这里的 detail 0 不是 `try?` 吞写造成的未知态。`uiRefusal` 为 null 与没有抛出一致。
- `xcodeClosed` 为 false。`D476_WORKSPACE_COMPLETE_788` 是 `aborted:true`、`xcodeExit:"NOT_CLOSED"`。中止后的站点 7 和 8 是信号退出。`D705_XCRESULT_DETAILS_CLOSED` 是 `TOOL_FAILURE`。
- 后三例都是 `ACQUIRE_REFUSED`：local-work 45000ms，archive 20000ms，terminal-only 45000ms。选择框用例的 `RELEASE_REFUSED` 使同一作业的租约没有交还。

宿主在桶 179 退出码 0，离 45 秒节点超时只剩不到 250ms。`xcodebuild` 还要等应用退出并写完 `Result.xcresult`，这一段没有排进剩余时间。

## 11. 已执行的删参数实验（历史，结论不充分）

下面这一段已经在 `6067e9ee90e67609b4b418c3971dc6598efa48db` 做过，不是当前要再做的事。它从 `OwnedWorkspaceUI705.start` 去掉了 `'-resultBundlePath',path.join(this.scene.root,'Result.xcresult')`，并在 `restorePickerWait('helper')` 之前用 `restoreResultBundle` 把这对参数还原回去。第 10 节里宿主退出码 0 的事实保持不变：那是 `7c5209b0470b1aecf0b151f116371494b31b2132` 的记录，不是这次。

第 12 节的日志没有进入那个收尾窗口。因此这次删除对「显式结果包路径影响收尾」既不支持，也不否定。当前不再执行删除，也不再保留 `restoreResultBundle`。

## 12. 去掉结果包路径的这一次没有测到收尾

CI run `44487668420`，macOS job `135435079906`，SHA `6067e9ee90e67609b4b418c3971dc6598efa48db`。十项检查里只有 `smoke (macos-latest)` 失败。选择框用例仍是 `test timed out after 45000ms`。

最早停点是 stage 14 detail 0。`sheet(15)` 没有写下 stage 15。`cancelTiming788.events` 是空数组，没有 18/19/20。`cancelReturned` 是 0，`picks` 是 1，`pickerObserved` 是 1，`hostTicks` 是 0，`hostTickLast` 是 null。`receiptMask` 是 7，只到 `D476_WS_CONFIRMATION`，没有 `D476_WS_COMMITTED`。第二次选择框没有被请求。这不是 `orderOut`，也不是第二次辅助功能查询卡住。

中止时 `childExited` 是 false，`childExitCode` 是 null。中止之后的计时点是 `[4,183,true,2]`，非零退出；`[7,183,true,3]` 和 `[8,183,true,3]` 是信号。不能把这次说成宿主退出码 0。`xcodeClosed` 是 false，`xcodeExit` 是 `NOT_CLOSED`。`D705_XCRESULT_DETAILS_CLOSED` 的 `reason` 是 `BUNDLE_UNAVAILABLE`，`tool826` 是空数组。结果工具没有留在等待里。后三例仍是 `ACQUIRE_REFUSED`：local-work 45000ms，archive 20000ms，terminal-only 45000ms。选择框用例 `RELEASE_REFUSED`。`uiRefusal` 是 null。

## 13. 已执行的放回参数（历史）

下面这一段已经在 `12f5876c6527fcdc045d6ea6ab3415ddd4f22f4c` 做过，不是当前要再做的事。它把 `'-resultBundlePath',path.join(this.scene.root,'Result.xcresult')` 放回 `OwnedWorkspaceUI705.start`，并删掉 `restoreResultBundle`。窗口预等待和 `D476_WS_HOST_TICK` 仍留着。`path.join(scene.root,'Result.xcresult')` 的读取、`BUNDLE_UNAVAILABLE`、stdout/stderr 捕获、45000 和 `DesktopHost.swift` 都没有改。

那次提交已经删掉 `result-bundle-inverse.cjs` 和全部 `restoreResultBundle` 调用，包括 `previousInputReady705` 的 helper、705 第 57 行和第 365 行、826 的 helper peel、query101 的 helper `open`、788 的 helper、JOIN 的 helper，以及 `RESULT_BUNDLE_ONCE` 用例。helper 的第一道 hash 回到 `restorePickerWait('helper')` 的 `56cb1183b0e057b879d11567424c5b325362e7dbfd373edeca4faa5dd73751e5`。`source+eol` 仍是 `requireSuccessDigest:false`，然后在 `QUERY101_COMPLETE_CURRENT_SOURCE` 失败。`b0e30a4e…`、`873b5ced…`、`0397f3cb…` 没有后移。这些都不是当前步骤。

## 14. 放回参数后的最早未闭合点

CI run `44492046690`，macOS job `135449866902`，SHA `12f5876c6527fcdc045d6ea6ab3415ddd4f22f4c`。十项检查里只有 `smoke (macos-latest)` 失败。选择框用例仍是 `test timed out after 45000ms`。

`uiProgress` 是 `{stage:15,detail:1}`，`uiRefusal` 是 null，没有 stage 16 或更后的 stage，计时 18–20 是空数组。按第 9.1 节，这支持第二次窗口的 `waitForExistence` 没有返回。`cancelReturned` 是 0。`picks` 和 `pickerObserved` 都是 2，`pickerReturned` 是 1，`receiptMask` 是 255，第二次选择框 ping 已经记下，取消结果没有回来。`hostTicks` 是 2，`hostTickLast` 是 `D476_WS_HOST_TICK`。现有定时器在 `pickerCurrent` 不为真或面板 `settled` 时就停，所以停在 2 不能证明 runloop 死了，也不能证明 `orderOut`。中止时 `childExited` 是 false，`childExitCode` 是 null。中止后 `[4,183,true,2]` 是非零退出，`[7,183,true,3]` 和 `[8,183,true,3]` 是信号。`xcodeClosed` 是 false。`D705_XCRESULT_DETAILS_CLOSED` 的 `reason` 是 `TOOL_FAILURE`，`tool826` 是 `[[1,false,64,0,true,true,0,466,false]]`：工具跑过并以 64 退出，不是 `BUNDLE_UNAVAILABLE`，也不是仍在等待。后三例 `ACQUIRE_REFUSED`，选择框用例 `RELEASE_REFUSED`。

这和 `7c5209b0` 的取消返回、宿主退出码 0 不是同一次窗口，也不覆盖第 10 节。和第 12 节的 stage 14、`BUNDLE_UNAVAILABLE` 也不是同一次。三次都保留。

## 15. 已执行的停因 ping（历史）

以下是当时实现，非当前步骤。

不增加 45000。不改 `DesktopHost.swift`。不把查询挪线程。不删 `cancelReturned == 1`、子进程退出码 0、计时 18–20、`xcodeClosed` 为 true、租约交还和后三例。窗口预等待和现有 tick 计数留着。

同一次宿主定时器回调里，在 `invalidate` 之前最多发一次 `system.ping`。id 只是 `D476_WS_HOST_TICK_STOP`。`reason` 只允许 `not-current`、`settled`、`cap`。判定沿用当前 guard 从左到右的顺序：`hostTickCount` 已经到 40 就是 `cap`，这时即使同时 `not-current` 也先记 `cap`。否则没有 `workspaceSelection`，或 `pickerCurrent` 不为真，记 `not-current`；没有 `workspaceSelection` 不能记 `settled`。再否则 `settled` 才记 `settled`。`not-current` 先于 `settled`。`guard` 里的宿主对象消失时发不出去；中止时没有这笔记下，保持未知，不叫做 `absent`，也不叫做回调没有再进来。停因不是辅助功能查询卡住的原因，也不是取消成功。

`hostTickStop` 写在 `D476_WORKSPACE_NATIVE_PHASE` 里 `hostTicks` 旁边。不放进 `required`，不改 `receiptMask`。执行当前 phase 块的 vm scope 在已有的 `hostTicks`、`hostTickLast` 之外再带 `hostTickStop`。

新句子只加进 `host-tick-inverse.cjs` 现有的那一组，不另做一层还原，也不新开入口。现有三句改成仍各恰好一次：

- `pickerObserved=0,hostTicks=0,hostTickLast=null,hostTickStop:string|null=null,pickerReturned=0` 还原成 `pickerObserved=0,pickerReturned=0`。
- `D476_WS_HOST_TICK` 计数分支整句仍删掉。同一组再加一句 `D476_WS_HOST_TICK_STOP` 分支，还原成空。
- `cancelCurrent,hostTicks,hostTickLast,hostTickStop` 还原成 `cancelCurrent`。

少一句先在 `HOST_TICK_ONCE` 失败，不套后面的成功摘要。这些句子仍由现在已经位于第一道旧 hash 之前的 `restoreHostTick` 剥掉。入口不增不减：join 去掉 JOIN 后仍是 `120cc92d2c0eb1209f1db8843ea054468cb2ddd7ac80a5ed530e196e50c65164`；788 的十文件循环和 801 测试之后仍是 `5f225d624d4d83a55b76ebe0b7f82bbe1202dffda843139c674156ea72e2e018`；705 第 58 行 native 的 `restoreHostTick` 去掉 CLOSE 后仍是 `0b78022a6efaa334ce97d5d1ccfb9c6d59857997ddefed3ad5f7a0e501fb78a4`，第 57 行是 helper，这个摘要入口不改；705 与 747 的 abort 仍是 `6fadbe6027b50d5a1b0654ba30641d260e7dcaa098d38ad90a398fe4639eed3c` 和 `7c5d8b54f03c68fa285d60d8fd029cd10dbbf5c0073e79d5944778435e3d1288`；782 仍是 `33b233999fcfcc764b4882749d7264aa534fc45938ff717dd23bcc51f4cdeaa6` 和 `f4b0ae09fd52e2ed4fa2d112ebc041e1a33e5323776ddc3e00291c1a4bea4675`；826 与 initial-input 的第一道仍是 `9e80020deed6f46ede58481ecbd2e631c796b0cc653995ad1f6bdbfa9d2cbabe`；808 配对还原后仍是 `04b5b5edcaf59cfe666f5e84de6a1a386ea4f48d493023e13ef75bd7a9c084f2`；`previousCensus705('native')` 仍是 `2f2a3d08eafb54b2eef26450e30b12000844479e759316eff3773ebad8364f2e`。旧 hash 不改、不后移。

交叉核对过：`desktop-native-thread-metadata-476.test.ts` 的整文件还原入口就是上面这些 `restoreHostTick` 调用，没有另有一个整文件 hash 不经过它。`workspace-acceptance.swift` 不在这些整文件摘要里。

`desktop-workspace-picker-readiness-705.test.ts` 里同步 `panel()` 和稍后的定时器 callback 是两种测试，不能并成一条调用序。同步 `panel()` 保持原样：第一次是 `['RETIRE_TIMER','D476_WS_PICKER_SELECTED']`，停在 `D476_WS_PICKER_SELECTED`，不启动 tick。第二次是 `['RETIRE_TIMER','D476_WS_PICKER_CANCELLED','HOST_TICK_START']`。这里的 `startHostTick` 被 stub 成只把 `HOST_TICK_START` 推进 `calls`，callback 没有执行，所以这三条不加 `D476_WS_HOST_TICK_STOP`。另一条独立断言驱动真实 `startHostTick` 注册的定时器 callback，不是这个 stub。该 callback 在 `invalidate` 之前恰好发一次 `D476_WS_HOST_TICK_STOP`。

上面这一段已经在 `4b3ffbd1d9bea36b4b84d87ebfe36f9323e1f851` 做过，不是当前要再做的事。

## 16. 停因没有被收到

CI run `44498584497`，macOS job `135472041422`，SHA `4b3ffbd1d9bea36b4b84d87ebfe36f9323e1f851`。选择框用例是 `test timed out after 45000ms`。`uiProgress` 是 `{stage:15,detail:1}`，`uiRefusal` 是 null，没有 stage 16 或 18–20，`cancelTiming788.events` 是空数组。`cancelReturned` 是 0，`picks` 和 `pickerObserved` 都是 2，`pickerReturned` 是 1，`receiptMask` 是 255。`hostTicks` 是 0，`hostTickLast` 是 null，`hostTickStop` 是 null。中止时 `childExited` 是 false，`childExitCode` 是 null，`firstFailedAssertion` 是 0。中止后 `[4,182,true,2]` 是非零退出，`[7,182,true,3]` 和 `[8,182,true,3]` 是信号。`xcodeClosed` 是 false。`D705_XCRESULT_DETAILS_CLOSED` 的 `reason` 是 `TOOL_FAILURE`，`tool826` 是 `[[1,false,64,0,true,true,0,466,false]]`。后三例是 `ACQUIRE_REFUSED`，选择框用例 `RELEASE_REFUSED`。

`hostTickStop` 为 null 且 `hostTicks` 为 0 保持未知。不能叫做 `absent`，不能叫做回调没有进来，也不能叫做宿主对象已经消失。它不解释第二次窗口等待，也不是取消成功。这和 `12f5876c` 的 `hostTicks` 为 2 不是同一次。也不覆盖 `7c5209b0` 的取消返回、宿主退出码 0，或 `6067e9ee` 的 stage 14。四次都保留。

## 17. 已执行的挂起 ping（历史）

以下是当时实现，非当前步骤。

不增加 45000。不改 `DesktopHost.swift`。不把查询挪线程。不删取消成功条件。窗口预等待、tick 计数和停因 ping 留着。

在 `startHostTick` 里，只有 `hostTickTimer` 原先是 nil、并且 `Timer.scheduledTimer` 已经返回之后，用现有的两参数 `emit` 发一次 `system.ping`，id 只是 `D476_WS_HOST_TICK_ARMED`。定时器已经存在而提前返回时不发。这一笔在 `panel()` 的 runloop 上，晚于第二次 `D476_WS_PICKER_CANCELLED`，早于任何 timer callback。它不是 tick，也不是停因。

`hostTickArmed` 只记 0 或 1，写在 phase 的 `hostTickStop` 旁边。不进 `required`，不改 `receiptMask`。执行当前 phase 块的 vm scope 再带 `hostTickArmed`。本轮只加这一笔，不再加别的探针。

下一趟只按组合判读。`hostTickArmed` 为 1、`hostTicks` 为 0、`hostTickStop` 为 null，只说明 `scheduledTimer` 已经返回，并且两参数 `emit` 把 `D476_WS_HOST_TICK_ARMED` 送达了。这不说明 callback 没跑，不说明 runloop 停了，也不说明 `orderOut`。`hostTickArmed` 为 0，且 `receiptMask` 已经含有 `D476_WS_PICKER_CANCELLED`，说明 `startHostTick` 在那次 emit 之后被调用，但 `D476_WS_HOST_TICK_ARMED` 没有送达。可能是已有非 nil 定时器提前返回，也可能是 `scheduledTimer` 或 `emit` 没有完成送达。不能说定时器没创建。两种都不是 `cancelReturned == 1`，也都不解释 stage 15 detail 1。

新句子只扩 `host-tick-inverse.cjs` 现有那一组，不另做一层还原。声明变成 `pickerObserved=0,hostTicks=0,hostTickLast=null,hostTickStop:string|null=null,hostTickArmed=0,pickerReturned=0`，还原成 `pickerObserved=0,pickerReturned=0`。tick 分支和 STOP 分支仍整句删掉。同一组再加一句 `D476_WS_HOST_TICK_ARMED` 分支，还原成空。phase 字段变成 `cancelCurrent,hostTicks,hostTickLast,hostTickStop,hostTickArmed`，还原成 `cancelCurrent`。少一句先 `HOST_TICK_ONCE` 失败，不套成功摘要。旧 hash 不改、不后移。入口仍是第 15 节那一份：join 的 `120cc92d…`、788 两处的 `5f225d62…`、705 第 58 行 native 的 `0b78022a…`、705/747 abort 的 `6fadbe60…` 和 `7c5d8b54…`、782 的 `33b23399…` 和 `f4b0ae09…`、826 与 initial-input 的 `9e80020d…`、808 的 `04b5b5ed…`、`previousCensus705('native')` 的 `2f2a3d08…`。

readiness 保持三种测试分开。同步 `panel()` 仍是原来的两组调用序，stub 不执行 `startHostTick`。timer callback 断言仍只覆盖停因和增量 tick。第三条单独驱动真实 `startHostTick`：测试里的 `Timer.scheduledTimer` 只记下 callback，不调用它。`hostTickTimer` 为 nil 时，调度返回后恰好一次 `D476_WS_HOST_TICK_ARMED`，并且这次调用本身没有 tick 或停因。`hostTickTimer` 已经存在时不发 `D476_WS_HOST_TICK_ARMED`。

上面这一段已经在 `ebc7cc30b2c0950921cb3bb9d10d76432a34c88f` 做过，不是当前要再做的事。

## 18. 这一次选择框用例通过了

CI run `44504061497`，macOS job `135490928834`，SHA `ebc7cc30b2c0950921cb3bb9d10d76432a34c88f`。十项检查都成功。`#476` 这一文件 12 项都通过，失败 0。选择框用例耗时 40028ms，没有碰到 45000。

成功 phase 是 `failed:false`，`receiptMask` 1023，`picks` 2，`pickerObserved` 2，`pickerReturned` 1，`cancelReturned` 1，`pickOutcome` 4，`childExited` true，`childExitCode` 0，`failureSite` 0。`xcodeClosed` 为 true，`xcodeCode` 为 0，`observerClosed` 为 true，`observerCode` 为 0，`uiReceiptMask` 为 31。`uiProgress` 和 `cancelTiming788` 在成功路径上是 null，因为这两项只在失败时读取。`hostTickArmed` 是 1，`hostTicks` 是 12，`hostTickLast` 是 `D476_WS_HOST_TICK`，`hostTickStop` 是 null。同一文件随后的 local-work、archive、terminal 都通过，租约是 `RELEASED`。

`hostTickArmed` 为 1 且随后有 12 次 tick，说明 `scheduledTimer` 已返回、ARMED 已送达，并且 callback 后来发出了 tick。`hostTickStop` 仍是 null，因为结束前没有收到停因；这不说明 callback 没跑。这一次是 `cancelReturned == 1` 且宿主退出码 0。它不解释以前 stage 15 detail 1 的那几次，也不把 ARMED 说成修复。

这和 `4b3ffbd1` 的 `hostTicks` 0、`hostTickStop` null、取消未返回、宿主未退出不是同一次。也不覆盖 `12f5876c` 的 `hostTicks` 2，或 `7c5209b0` 的取消已返回但 `xcodeClosed` 仍为 false。那些失败都保留。

## 19. 已停的探针

不增加 45000。不改 `DesktopHost.swift`。不再加下一笔诊断 ping。一次通过不抹掉前面的失败，也还没有一份由这些日志支持的产品修复。发布仍暂停。`ebc7cc30` 的成功日志保留为那个 SHA 的事实。它的 `cancelTiming788` 是 null，不能当作 18–20 六条计时，后续实现的 CI 不得冒用。

## 20. 已执行的成功路径计时读取

以下是 `b3ea545cb9aa0e471887a53b9fa3820c01858c81` 的实现，不是当前步骤。该 SHA 的 macOS job `135513859906` 有六条原文，只属于这个 SHA，不能冒用给后来的提交。

成功路径也把现有 `cancelTiming788()` 读进现有的 `D476_WORKSPACE_NATIVE_PHASE`。不新增 ping。不改 45000。不改 `DesktopHost.swift`。不改 `uiProgress` 的失败门。不把 null、空 `events` 或 `invalid:true` 当成 18–20。

文件生命周期已经对过源码。六份 `cancel-18-enter.json` 到 `cancel-20-return.json` 由 XCTest 的 `writeCancelTiming788` 写在场景目录根上，不在 `Result.xcresult` 里。`UI705_FILES` 允许 `cancelTiming788()` 读它们。某一份缺了就跳过该份。六份都缺时函数返回 `{schema:1,events:[],invalid:false}`，不是 null。调用抛错时外层 `catch` 才把字段留成 null。空 `events`、`invalid:true` 和 null 都不能代替六条原文。`finally` 里这次读取位于 `uiOwner?.cancel()`、`t.diagnostic`、`child?.terminate()`、`cleanup()` 和 `fs.rmSync(dir)` 之前。`cancel()` 只写 `cancel.json` 并给 xcode 发 SIGTERM，不删除这六份文件。`cleanup()` 不删除场景目录。目录删除在 `cleanup()` 之后。成功时 `uiDone` 要等 xcode 与 observer 都已退出才返回，所以进入 `finally` 时写入已经结束，文件还在。`ebc7cc30` 的 phase 能打出来，null 是因为 `if(primaryFailed)` 跳过了读取，不是文件已经被清掉。读取必须留在这个位置，不能挪到 `cleanup()` 或 `rmSync` 之后。

只改这一句：`try{if(primaryFailed)cancelTiming788=uiOwner?.scene.cancelTiming788()??null}catch{}` 改成 `try{cancelTiming788=uiOwner?.scene.cancelTiming788()??null}catch{}`。失败路径仍会读到同一函数。phase 字段名不新增。

六条的形状是 `events` 长度为 6，stage 依次 18、18、19、19、20、20，`returned` 依次 false、true、false、true、false、true。合并门要看新实现自己的 macOS 成功日志里这六条原文。不重跑 `ebc7cc30`。

旧 hash 不改。新句子先精确还原成带 `if(primaryFailed)` 的旧句，少一句先在 `SUCCESS_TIMING_ONCE` 失败，不套 `9e80020d` 或其他成功摘要。这道还原要放在每个整源入口的第一道旧 hash 之前。第一道旧 hash是 `restoreInitialOwnedInput826` 的 `9e80020deed6f46ede58481ecbd2e631c796b0cc653995ad1f6bdbfa9d2cbabe`，它在 `restoreObservation826('native')` 和 `restoreCloseObservation476('native')` 里面。入口是：

- `scripts/tests/native-join-observation-788.test.cjs` 的 native 文件：在 `restoreHostTick` 之前还原。它随后进 `restoreCloseObservation476('native')`，去掉 JOIN 之后仍是 `120cc92d2c0eb1209f1db8843ea054468cb2ddd7ac80a5ed530e196e50c65164`。
- `desktop-native-observation-788.test.ts` 的十文件循环和 801 测试：在 `restoreHostTick` 之前还原。后面的 `5f225d62…` 不改。
- `desktop-workspace-xctest-705.test.ts` 第 58 行 native：在 `restoreHostTick` 之前还原。`0b78022a…` 不改。第 57 行仍是 helper。
- 同文件第 365 行那一对的 native peel：也在 `restoreHostTick` 之前还原，然后进 `restoreCloseObservation476('native')`。这条不经过第 58 行。
- 705 的 `workspaceAbortPhaseInverse705` 和 747 的同名函数：在各自的 `restoreHostTick` 之前还原。`6fadbe60…`、`7c5d8b54…` 不改。
- `desktop-archive-observation-782.test.ts`：在 `restoreHostTick` 之前还原。`33b23399…`、`f4b0ae09…` 不改。
- `desktop-close-observation-826.test.ts` 的 native 与 `desktop-owned-initial-input-826.test.ts`：在 `restoreHostTick` 之前还原。`9e80020d…`、`08dcaea7…`、`46d85252…` 不改。
- `desktop-local-native-476.test.mjs` 的 `hostObservationSource808`：在 `restoreHostTick` 之前还原。`04b5b5ed…` 不改。
- `previousInputReady705('native')`，因而 `previousCensus705('native')`：在该函数里 native 的 `restoreHostTick` 之前还原。`2f2a3d08…` 不改。

交叉核对过这个文件上所有会碰到 `9e80020d` 的路径：它们都先经过上面某一处 `restoreHostTick`，或者就是 `restoreObservation788` 内部再进 `restoreCloseObservation476('native')`。没有另一处整源入口绕过这份清单。

另外，705 里进度守恒那一刀从 `surfaceLease.retain()` 切到函数结束，摘要是 `aa950d5bf4a8cbb67fce423534261f026acb99c7e7057b2f8988c69009e2c52e`。这刀包含计时读取句，但不走上面的整文件还原。同一句要在算这个摘要之前还原回去。这不是新的整文件入口。

TDD 先红后绿。红灯是现有 `finally` 前缀的 success 变体：场景提供 `cancelTiming788`，成功时它在 `cancel()` 之前被调用一次，phase 带上六条形状；`uiProgress` 在 success 仍不调用。今天 success 不调用计时读取，所以这条断言失败。少掉新句子时 `SUCCESS_TIMING_ONCE` 失败，错误里不出现 `9e80020d`。绿灯只做上面这一句和这些还原。

## 21. 同一次运行里的两项 Windows 失败

CI run `44510689058`，SHA `b3ea545cb9aa0e471887a53b9fa3820c01858c81`。十项里失败的是 `smoke (windows-native)` job `135513859817` 和 `smoke (windows-latest)` job `135513859937`。macOS job `135513859906` 的六条计时仍只属于这个 SHA。不重跑这个 SHA。不放宽 20000 或 10000。不改旧 hash。

`windows-native` 的失败测试是 `Windows-style Git checkout preserves canonical capture bytes and still rejects drift`，位置 `companion/tests/meeting-pcm-generated.test.ts`。可见错误只有 `EBUSY`，`rmdir` 的路径是 `seed\.git`。这个文件里唯一的 `fs.rmSync` 在 `finally`，删的是整个临时目录。`git` 调用都是 `execFileSync`，返回之后才执行 `finally`。日志里没有断言失败原文。`finally` 抛错会盖住 `try` 里先抛出的错误，所以这份日志不能证明字节检查已经通过，也不能证明它没通过。

`windows-latest` 的失败测试是 `#476 actual native MCP form + OS-only confirmation approves update/add and denies update`，文件 `companion/tests/desktop-native-mcp-476.test.ts`，时限是测试自己的 `timeout:20000`。超时当下的 `DESKTOP_476_PROGRESS` 是 `authenticated:true`、`windowRequested:true`、`postAuthRequestMask:0`、`nativePhases` 只有 `ready_accepted` 和 `env_callback`、`exited:false`、窗口 0、批准 0、拒绝 0、`done:false`。bootstrap 行到了点 5 `CreateCoreWebView2EnvironmentWithOptions`、点 6 `environmentCallback`（edge 2、code 0、present 1）、点 7 `CreateCoreWebView2Controller` 的调用返回（edge 1、code 0）。点 8 `controllerCallback` 不在这些行里，阶段名也没有 `controller_callback`。后面日志里的 `DESKTOP_480_NATIVE` 属于下一条 Windows 绑定测试，不是这一条超时测试的补完。

这两项的源文件不在这次计时读取的 diff 里，`DesktopHost.cpp` 也没改。这只说明计时那一句没有进入这两个测试的源码。它不把这两项记成无关，也不记成偶发。

## 22. 已执行的 owned 清理

以下是 `35526f9f5f31ea7686ba1b73ba05e959e8aadb98` 的实现，不是当前步骤。

只改 `meeting-pcm-generated.test.ts` 里这个测试自己的 `owned` 目录清理。日志里只有一次 `rmdir seed\.git` 的 `EBUSY`，没有第二次删除。总尝试次数因此写死为 2：第一次删除，若错误码是 `EBUSY` 就立刻再删一次。没有 `sleep`，没有 `setTimeout`。两次都是 `EBUSY` 就停止。其它错误码第一次就抛出，不进入第二次。`git` 的 `timeout: 10_000` 和 `spawnSync` 的 `timeout: 10_000` 保持原样。字节比较保持原样。

`try` 里的错误先保存。清理结束后如果 `try` 有错，抛出的是那个原始错误，不用清理的 `EBUSY` 替换它。清理错误不吞掉。`finally` 不再用自己的异常盖住 `try`。

三条断言只驱动这个 `owned` 路径上的删除函数，不跑真实 `git`：

- `try` 抛出断言错误，同时两次删除都是 `EBUSY`：最后抛出的仍是原来的断言错误。
- 删除抛出的不是 `EBUSY`：立刻抛出那个错误，删除函数只被调用 1 次。
- 删除连续两次都是 `EBUSY`：抛出的错误码仍是 `EBUSY`，删除函数被调用 2 次，没有第 3 次。

MCP 表单测试仍是独立阻断，本轮不改。超时当时是 `authenticated:true`、`windowRequested:true`、`postAuthRequestMask:0`，阶段只有 `ready_accepted` 和 `env_callback`。bootstrap 只有点 5、6、7，没有点 8，也没有 `controller_callback`。后面的 `DESKTOP_480_NATIVE` 是下一条用例。不把 20000 加大。不重跑 `44510689058`。

`b3ea545c` 的 macOS 子门通过只绑定那个 SHA。旧 hash、45000、`DesktopHost.swift` 不动。发布仍暂停。

## 23. 35526f9f 的 macOS 失败

CI run `44513461777`，macOS job `135523299113`，SHA `35526f9f5f31ea7686ba1b73ba05e959e8aadb98`。十项里只有 `smoke (macos-latest)` 失败。其余九项成功。这次 Windows 上，原先的 `EBUSY` 测试是 ok 2，MCP 表单测试是 ok 24。这只说明这两项在这个 SHA 上通过，不说明历史的 MCP 20 秒超时已经修好。

选择框文件的汇总是 8 通过、0 失败、4 取消。四条 `not ok` 都是 `testTimeoutFailure`。选择框用例 45000ms 超时。最后读回的进度是 `{stage:17,detail:0}`。在 `sheet(15)` 里，这是 `uiStage=stage+2;uiDetail=0;observeUIStage()`，紧挨在 `w.sheets.element(boundBy:1).waitForExistence(timeout:1)` 之前。detail 2 或 3 没有被读回。进度写入和计时写入都可以失败，所以空的 `cancelTiming788.events` 不能证明 18–20 确定没有执行。`uiReceiptMask` 是 23。`xcodeClosed` 和 `observerClosed` 都是 false。工作区租约是 `RELEASE_REFUSED`，并且 `over_budget`。后三例没有进入自己的操作，是 `ACQUIRE_REFUSED` 之后的超时，不是各自的功能失败。

`cancelReturned` 是 0，`receiptMask` 是 255，`picks` 和 `pickerObserved` 都是 2，`pickerReturned` 是 1。`hostTickArmed` 是 1，`hostTicks` 是 6，`hostTickStop` 是 null。这些只说明定时器被调度过并且收到了 6 次 tick。它们不说明 runloop 还在，也不说明 `orderOut`。中止时宿主没有退出。

这和 `b3ea545c` 的六条计时、取消返回、退出码 0 不是同一次。也和先前最后读回停在 stage 15 detail 1 的记录不是同一次。各次都保留。不重跑 `44513461777`。

## 24. 已执行的 sheet(15) 跳过

以下是 `acfd55ecfe500472117c48a811e3b27d5790453c` 的实现，不是当前步骤。

不再加诊断 ping。45000、`DesktopHost.swift` 和产品取消条件保持。真实 OS 点击保持。新 SHA 仍要自己拿到取消返回、宿主退出码 0、六条计时、xcode 与 observer 都关闭、租约交还、后三例通过，以及十项 CI。

`sheet()` 里阶段 16 的第一张 sheet 检查保持。阶段 17 的 detail 0 写入也保持，它就是 `uiStage=stage+2;uiDetail=0;observeUIStage()`。这句留着，是因为 `sheet(15)` 时它发布的就是 stage 17 detail 0；删掉它之后，以后的 17/0 不再是这次跳过的对照点。只在 `stage == 15` 时跳过这句写入之后的第二张 sheet `waitForExistence(timeout:1)` 和 `guard !sheetExtra`。`stage != 15` 时这两句照旧，所以 `sheet(3)` 仍拒绝多一张。然后仍 `return w.sheets.firstMatch`。调用方现有的 18–20 取消点击保持。

`WorkspacePickerUITests.swift` 里这一整句改成：

`uiStage=stage+2;uiDetail=0;observeUIStage();if stage != 15 {let sheetExtra=w.sheets.element(boundBy:1).waitForExistence(timeout:1);uiDetail=sheetExtra ? 3:2;observeUIStage();guard !sheetExtra else{throw OwnedUI705Error.refused}};return w.sheets.firstMatch`

`picker-wait-inverse.cjs` 第二对的当前句就是上面这一整句，还原句仍是：

`uiStage=stage+2;uiDetail=0;observeUIStage();let sheets=w.sheets.count;uiDetail=min(sheets,2)+1;observeUIStage();guard sheets==1 else{throw OwnedUI705Error.refused};return w.sheets.firstMatch`

当前句必须含 `if stage != 15 {` 和 `return` 前的 `}`。少掉这一整句时，`split` 长度不是 2，先在 `PICKER_WAIT_UI_ONCE` 失败，不进入 `2eca9be781a3c401b6d96bf8cba6b41f9c8fe32f9be5052be094d0ae27c972b8`。成功路径的 ui 输出仍是这个摘要。

`NEW_DIGEST` 与 `workspace-xctest-owned-705.ts` 的 `RESULT705_SOURCES` 里 `WorkspacePickerUITests.swift` 那一格引号中的 `b2884ab51d4087d14c31eae948fb05a0a2b9019ebc44f58ffda0c9c45debfd00` 同一步换成新的整文件摘要。helper 还原是把这一处精确一次换成 `2eca9be7…`，成功输出仍是 `56cb1183b0e057b879d11567424c5b325362e7dbfd373edeca4faa5dd73751e5`。只改 `NEW_DIGEST` 时 helper 里仍是旧字面量，还原找不到新摘要，到不了 `56cb1183…`。注释里的 `fb446e0d2b32e5a55e05a03e369fa5635b98448513a59fe9ea91bd098590b076` 保持。`2eca9be7…`、`56cb1183…` 和更早的 hash 不改、不后移。

`desktop-workspace-query-101.test.ts` 的 `sheetQuery` 作用域 `stage` 仍是 3，期望调用序保持。它继续覆盖 `sheet(3)` 的多一张拒绝，不覆盖 `stage == 15` 的跳过。

下一份 macOS 日志只属于新的 SHA。stage 17 detail 0 仍在分支前写入，再读到 17/0 就是这句保留的发布。读到 stage 18 或更后，只说明这次第二张 sheet 调用原来位于已发布进度之前，不是根因。空 `events` 仍不能证明 18–20 没有执行。不重跑 `44513461777`。发布仍暂停。

## 25. acfd55ec 的两处失败

CI run `44519261215`，SHA `acfd55ecfe500472117c48a811e3b27d5790453c`。失败的是 macOS job `135543346448` 和 windows-latest job `135543346278`。windows-native job `135543346400` 成功。其余八项成功。这两处不在同一个进程、同一套二进制或同一次消息循环里。

macOS 选择框文件是 8 通过、0 失败、4 取消。四条 `not ok` 都是 `testTimeoutFailure`。选择框用例 45000ms 超时。最后读回是 `{stage:15,detail:1}`。`sheet(15)` 里这是 `let windowTimeout=try remaining();uiDetail=1;observeUIStage()` 之后、`windows.element(boundBy:0).waitForExistence(timeout:windowTimeout)` 之前。`remaining()` 已经返回，超时参数是距离 `uiDeadline` 的剩余秒数，并且必须大于 0、不超过 45。节点的 `timeout:45000` 和 `uiDeadline=Date.now()+45000` 是同一个起点。这次等待的合法结束点和节点中止是同一时刻。因此 15/1 不能证明这次 `waitForExistence` 忽略了它的超时，也不能证明它已经返回。被跳过的第二张 sheet 等待在阶段 16 和 stage 17 detail 0 之后。这次没有读到那两处。空 `cancelTiming788.events` 仍不能证明 18–20 没有执行。`cancelReturned` 是 0，宿主没有退出。xcode 和 observer 都没关。`uiReceiptMask` 是 7。`hostTickArmed` 是 1，`hostTicks` 是 2，`hostTickStop` 是 null。租约 `RELEASE_REFUSED`，`over_budget`。后三例是 `ACQUIRE_REFUSED` 后的超时。

`b3ea545c` 在第二张 sheet 拒绝还在时，有取消返回、六条计时、退出码 0 和双收尾。那次成功不能借给 `acfd55ec`。它说明拿掉 `sheet(15)` 的第二张 sheet 拒绝不是已知成功的条件。`acfd55ec` 又没有执行到这个跳过。所以这次跳过既不能支持、也不能反驳「第二张 sheet 等待挡住了取消」这个假设。不在第一扇窗口的 `waitForExistence` 上再叠一个跳过。

windows-latest 的 MCP 表单是 not ok 24，20000ms 超时。当时 `authenticated` 与 `windowRequested` 为 true，`postAuthRequestMask` 为 0，阶段只有 `ready_accepted` 和 `env_callback`。bootstrap 行是 `[5,1,0,0,0,2]`、`[6,1,0,8,0,2]`、`[6,1,2,8,0,1]`、`[7,1,0,8,0,2]`、`[7,1,1,11,0,2]`、`[5,1,1,11,0,2]`。点 5 是 `CreateCoreWebView2EnvironmentWithOptions`，点 6 是环境回调，点 7 是 `CreateCoreWebView2Controller`。点 7 的 edge 1、code 0 表示这次调用已经返回 0。没有点 8，阶段里也没有 `controller_callback`。`snapshot825` 在测试截止前 1500ms 的窗口里采到，`sampleOffsetMs` 是 2，`flags` 是 751。751 是 `EnvApi|EnvLeave|ControllerApi|WrapperLeave|OuterDispatch|Armed|EnvEntry|SendReturned`。其中没有 `ControllerEntry`（16）和 `ControllerLeave`（256）。`envHr` 与 `controllerHr` 都是 0，`callbackPresent` 是 0。`sendKind` 2、`sendSite` 5、`sendEdge` 1、`sendStage` 6 对得上最后一条点 5 的返回。`OuterDispatch` 只说明 `CreateCoreWebView2Controller` 返回之后，外层 `DispatchMessageW` 至少返回过一次。它不说明之后的 20 秒都在泵消息。超时当时的 bootstrap 行仍然没有点 8。后面的 `DESKTOP_480_NATIVE` 属于下一条 Windows 绑定测试，那条有 `controller_callback` 并且退出码 0。那不是这条 MCP 进程补上的回调。文件是 25 通过、0 失败、1 取消、12 跳过。`35526f9f` 的 ok 24 不能借给这个 SHA。同一条隐藏窗口路径曾经在 20 秒内进入过回调，所以这次日志还不够把 `ShowWindow` 写成产品改动。`DesktopHost.cpp` 这一步不改。20000 不加大。

## 26. 已执行的回退

以下是 `269b89c7d844cc9ad5baef451ab9f0fe0d4561ea` 的实现，不是当前步骤。回退子门只覆盖这次回退。

回退 `acfd55ec` 的 `sheet(15)` 跳过。第二张 sheet 的等待和 `guard !sheetExtra` 对 `sheet(15)` 与 `sheet(3)` 都恢复。18–20 的取消点击保持。45000、`DesktopHost.swift`、`DesktopHost.cpp` 和 20000 都不改。

`WorkspacePickerUITests.swift` 恢复为：

`uiStage=stage+2;uiDetail=0;observeUIStage();let sheetExtra=w.sheets.element(boundBy:1).waitForExistence(timeout:1);uiDetail=sheetExtra ? 3:2;observeUIStage();guard !sheetExtra else{throw OwnedUI705Error.refused};return w.sheets.firstMatch`

`picker-wait-inverse.cjs` 第二对当前句恢复成这一整句，还原句仍是 `sheets.count` 那句。`NEW_DIGEST` 与 `RESULT705_SOURCES` 里 `WorkspacePickerUITests.swift` 的引号摘要恢复为 `b2884ab51d4087d14c31eae948fb05a0a2b9019ebc44f58ffda0c9c45debfd00`。这是跳过前那份文件的摘要，两处同一步写回。helper 成功输出仍是 `56cb1183…`，ui 成功输出仍是 `2eca9be7…`。注释里的 `fb446e0d…` 保持。

`desktop-workspace-query-101.test.ts` 去掉 `stage == 15` 的跳过断言和 `if stage != 15` 的投影改写。`sheetQuery` 的 stage 3 调用序保持。先红后绿：在当前带 `if` 的源文上，`sheet(15)` 遇到第二张 sheet 仍应拒绝；这条现在不拒绝，所以先失败。源文和两处摘要恢复后，这条连同原有的 stage 3 用例通过。

这一步不给 Windows 增加新的探针，也不把 MCP 的 20 秒失败记成下一轮可能会过。下一份 SHA 的 windows-latest 仍要自己出现点 8 或 `controller_callback`，macOS 仍要自己出现取消返回 1、退出码 0、六条计时、双收尾、租约交还和后三例。十项 CI 都看这个新 SHA。读到 stage 18 或更后，只说明当时的等待位于已发布进度之前。空 `events` 仍不能证明 18–20 没有执行。不重跑 `44519261215`。发布仍暂停。

## 27. 已停止的 1 秒余量

`85f7392b3c02f603faebd0bdd73bf2f53dd2b32a` 做了这一次实验，run `44525070865`，macOS job `135563344587`。节点 45 秒时进度仍是 `{stage:15,detail:1}`，`uiRefusal` 是 null，`xcodeClosed` 是 false。`cancelTiming788.events` 是空的。`cancelReturned` 是 0，宿主没有退出，observer 没有关闭。租约 `RELEASE_REFUSED` 且 `over_budget`。后三例是 `ACQUIRE_REFUSED` 后的超时。文件是 8 通过、0 失败、4 取消。这命中停止条件，所以 `uiDeadline` 已恢复为 `Date.now()+45000`，余量分支已从 `restoreSuccessTiming476` 去掉。不再改这个余量，也不加探针。十项里只有这一项 macOS 失败。windows-latest job `135563344609` 在这个 SHA 上成功，不借来关闭先前的控制器回调调查，也不改 `DesktopHost.cpp`。Windows 调查仍未完成。下面留下的是这次实验当时的假设，不是下一步。

两条假设分开。都不靠再跳过一次查询，也不靠下一轮碰巧通过。

macOS 假设：`acfd55ec` 的 `{stage:15,detail:1}` 写在 `let windowTimeout=try remaining()` 已经返回之后、`windows.element(boundBy:0).waitForExistence(timeout:windowTimeout)` 之前。`remaining()` 的终点就是 `uiDeadline`。测试把 `uiDeadline` 设成 `Date.now()+45000`，节点时限也是 `timeout:45000`，两者从同一行附近起算。这次等待的合法终点和节点中止是同一时刻，所以这份日志不能区分「等待还在自己的时限里」和「等待没有按自己的时限返回」。另外，等待返回 false 时下一句仍是 `uiDetail=1`。因此只看到 15/1 也不能区分「还在等待里」和「等待已返回 false」。写入可以失败，所以没有 detail 2 也不证明等待没有返回 true。支持这句边界的是源码顺序和 `pickerObserved` 为 2：宿主在 `panel.isVisible` 之后已经发出第二次选择框通知，XCTest 才进入 `sheet(15)`。反证是 `35526f9f` 的 stage 17 detail 0 紧挨 `timeout:1`，那次 45 秒仍没有读回后续 detail，所以短时限并不是每次都会返回。`b3ea545c` 的阶段 20 返回时 UI 剩余是 2328ms，那次成功只属于那个 SHA。

区分方法只改这一处：`desktop-native-thread-metadata-476.test.ts` 的 `const uiDeadline=Date.now()+45000` 改成 `Date.now()+44000`。节点 `timeout:45000` 不动。第一扇窗口等待、第二张 sheet 拒绝、18–20 点击都不动。`OwnedWorkspaceUI705` 里 `deadline>Date.now()+45000` 的拒绝也不动，44000 仍被它接受。`2eca9be7…`、`56cb1183…` 和更早的 hash 不改不后移。

`restoreSuccessTiming476` 的顺序是：

1. 非字符串仍抛 `SUCCESS_TIMING_SOURCE_REQUIRED`。没有 `cancelTiming788` 时原样返回，不看 `+44000`。
2. 先数当前计时句 `try{cancelTiming788=uiOwner?.scene.cancelTiming788()??null}catch{}`。不是恰好一次时，走今天的分支：零次则要求旧句 `try{if(primaryFailed)cancelTiming788=uiOwner?.scene.cancelTiming788()??null}catch{}` 恰好一次，断言名仍是 `SUCCESS_TIMING_ONCE`，然后原样返回。其它次数也是 `SUCCESS_TIMING_ONCE`。这条分支不读 `+44000`。
3. 只有当前计时句恰好一次之后，才看余量。文本里有 `const uiDeadline=` 时，`Date.now()+44000` 必须恰好一次，否则 `DEADLINE_MARGIN_ONCE`。命中后把它换成 `Date.now()+45000`。没有 `const uiDeadline=` 就跳过余量。然后再把当前计时句换成旧句。

因此现有红灯保持原阶段：把计时句改成 `try{cancelTiming=uiOwner?.scene.cancelTiming788()??null}catch{}` 且截止仍是 `Date.now()+45000` 时，失败名是 `SUCCESS_TIMING_ONCE`，错误里不出现 `DEADLINE_MARGIN_ONCE`，也不出现 `9e80020d`。新的红灯是计时句仍恰好一次、并且有 `const uiDeadline=`，但 `+44000` 缺失或重复：失败名是 `DEADLINE_MARGIN_ONCE`，错误里不出现 `9e80020d`，调用方不会拿这份文本去对旧摘要。成功路径同时有一次 `+44000` 和一次当前计时句，返回文本里是 `+45000` 和旧计时句，随后的旧摘要不变。没有 `cancelTiming788` 的文件仍原样返回。

判读只看新 SHA 自己的 macOS 日志。节点 45 秒时仍是 15/1、`uiRefusal` 为 null、xcode 未关闭：把 `+44000` 恢复成 `+45000`，停止，不再改这个余量，也不加探针。`remaining()` 在 `r<=0` 时把 `uiDetail` 设为 4 并抛出，`cancel.element.click()` 不执行。阶段 20 的计时写在点击之后，所以没有一条计时能证明点击落在被削掉的那 1 秒。可观察的替代是 `uiRefusal` 或进度里的 detail 4：那表示 `remaining()` 在点击前拒绝。看到 detail 4 也把 `+44000` 恢复成 `+45000` 并停止。detail 2、其它拒绝，或 xcode 在 45 秒前退出，只说明有一次可分开的读回，不是根因，也不是产品修复。只有取消返回 1、退出码 0、六条计时、双收尾、租约交还和后三例才算这次验收通过。

Windows 调查没有完成。支持：点 7 的 edge 1、code 0，没有点 8，阶段没有 `controller_callback`；`flags` 751 含 `ControllerApi`、`Armed`、`OuterDispatch`，不含 `ControllerEntry`（16）和 `ControllerLeave`（256）；`callbackPresent` 是 0。`OuterDispatch` 只表示 `CreateCoreWebView2Controller` 返回之后，外层 `DispatchMessageW` 至少返回过一次。`build_webview()` 在 `desktop.ready` 里调用，主窗口创建时没有 `WS_VISIBLE`，`show()` 在更后的 `desktop.window`。反证：`35526f9f` 的同一条 MCP 测试是 ok 24；`44519261215` 里下一条 `DESKTOP_480_NATIVE` 有 `controller_callback`。现在还没有一个证据方案能把「回调没投递」和「线程不再泵消息」分开，并且不同时被那次 ok 24 满足。在这样的方案写出来之前，不改宿主生命周期。这个停放不是 Windows 调查的结论，也不是下一项实验。这一步不改 `DesktopHost.cpp`，不加探针，不把 20000 加大。回退和这 1 秒余量都不能补上这个回调。

owned 的两次清理和成功路径的计时读取保持。不重跑 `44519261215` 或 `44513461777`。发布仍暂停。

## 28. 只读调查结论

余量、跳过和追加探针的试错路线停止。这一节不提出下一次代码实验。

保留的工件只有 GitHub Actions 的 job 日志。run `44525070865` 的 artifact 是公开构建包、gallery 证书元数据和 windows census，没有 `Result.xcresult`、xcode stdout/stderr 原文、sample、spindump 或崩溃报告。成功 run `44510689058` 同样没有这些场景文件。`.github/workflows/ci.yml` 的上传步骤不包含选择框场景目录。测试 `finally` 在 `uiOwner.cleanup()` 之后 `fs.rmSync` 删掉该目录，所以场景里的 bundle 和日志文件在 job 结束前已经不在 runner 上。

对照的是同一条选择框用例。成功 SHA `b3ea545c`，job `135513859906`：`cancelReturned` 1，`childExitCode` 0，xcode 与 observer 都关闭且 code 0，`uiReceiptMask` 31，六条计时 `[18,false,30841,8387,0]` 到 `[20,true,36901,2328,1]`，工作区租约 `RELEASED` 43418ms，后三例 `RELEASED`，文件 12 通过、0 失败、0 取消。失败 SHA `85f7392b`，job `135563344587`：`cancelReturned` 0，`childExitCode` null，xcode 与 observer 在相位读取时都未关闭，`uiReceiptMask` 23，`uiRefusal` null，`uiProgress` `{stage:15,detail:1}`，`cancelTiming788.events` 空，`hostTickArmed` 1，`hostTicks` 2，`hostTickStop` null，租约 `RELEASE_REFUSED` 且 `over_budget`，后三例 `ACQUIRE_REFUSED` 后超时，文件 8 通过、0 失败、4 取消。成功日志没有 `D705_XCRESULT`，因为 xcresult 读取包在 `primaryFailed` 里面。

失败日志在 `cancel()` 之后补到了三件事后记录。`D705_XCODE_FAILURE_AFTER_CANCEL` 的 stdout 和 stderr 都是 `OBSERVED`，`firstMarker` 是 `NONE`，没有 `Error Domain=`。分类器只认整行 `Testing failed:`、`xcodebuild: error:` 和 `xcode-select: error:`，并且丢掉最后一行没有换行的尾巴。`D705_XCRESULT_DETAILS_CLOSED` 的 reason 是 `TOOL_FAILURE`。`tool826` 第一行是 `[1,false,64,0,true,true,0,466,false]`：`xcresulttool get test-results tests` 退出码 64，stdout 0 字节，stderr 466 字节。stderr 正文没有进入日志。因此 `sourceCoordinates` 为空，`testPresent` 是 null。`timing826` 的点 7 和点 8 退出类是 3，也就是 xcode 的 exit 和 close 带着信号，不是自行以数字退出码结束。点 4 是宿主子进程的非零退出码，桶 184。

已证实：进度文件是单文件覆盖写。`writeUIProgress` 用 `rename` 替换 `ui-progress.json`，失败会留下上一份成功发布的内容。`observeUIStage` 用 `try?`，所以写入失败不进入 `catch`，也不会产生 `ui-refusal.json`。拒绝文件只在 `catch` 里 `try?` 写。相位读取发生在 `finally`，并且当时 `xcodeClosed` 仍是 false。空的计时 `events` 只说明读取器没有看到 18–20 的六个文件。成功那次这些文件存在并被读到。

已排除：这次 15/1 不是第二张 sheet 跳过造成的，跳过已经回退，而且 15/1 在第一扇窗口等待之前。也不是节点时限被改掉，两次都是 45000。成功那次证明同一条 18–20 点击、六文件写入和 xcode 退出 0 可以在这套读取里出现。`hostTicks` 2 只说明宿主进程收到了 tick，不说明 XCTest 进程里的 `waitForExistence` 已返回。

未知，并且现有工件分不开：`waitForExistence` 是否仍未返回，以及它是否已返回但随后的 detail 2 或 `ui-refusal.json` 写入失败。这两种都会在相位里留下 15/1 和 null refusal。xcresult 没有给出源码行，stdout/stderr 分类没有 `Testing failed:`，信号关闭说明 xcodebuild 是被结束的而不是先以测试失败码退出。这些都偏向「结束时还没有一份正常的失败报告」，但分类器会丢弃未换行的尾巴，stderr 的 466 字节也没有保留，所以不能把缺事件写成未执行。

架构上的盲区是：同步的 `waitForExistence` 在返回前不能更新那份唯一进度文件；节点中止后的读取看到的是返回前的最后一次成功发布；关闭后的 xcresult 工具失败会丢弃能指出行号的 stderr；场景目录随后被删除，而 CI 不另存这些文件。要分开上面两种未知，需要在删除前留下调用栈或带行号的结果。当前流水线没有这件工件。这是取舍，不是这一节要开始的改动。

Windows 仍未分开。失败运行里点 7 已返回且 code 0，没有点 8，`flags` 751 含 `OuterDispatch` 但不含 `ControllerEntry` 16 和 `ControllerLeave` 256，进程当时 `exited` false。`85f7392b` 的 windows-latest 是 ok 24，并且有 callback 和点 8。ok 24 因此不呈现「有 OuterDispatch、无 ControllerEntry」这个失败组合。但 `outerDispatch()` 只在第一次外层 `DispatchMessageW` 返回时置一位，之后不再计数。失败快照里的这一位既符合「之后还在泵、只是完成回调没投递」，也符合「那一次返回之后线程不再泵」。ok 24 不能充当这个区分，因为成功路径已经进入了回调。没有保留的线程栈或后续泵计数，所以这两条失败假设现在分不开。缺的就是这个计数或栈，不能把缺席的点 8 写成其中一种。

## 29. 当前唯一下一步

第 28 节的负结论成立：不能再从那些投影推断等待是否已经返回。这一步只保留失败时已经存在的文件，不改产品生命周期，不重写测试架构，也不保证因此能定位根因。

只在选择框用例 `primaryFailed` 时，于现有 `fs.rmSync(dir)` 之前复制。交互验收步骤先 `cd companion`，所以测试写的是 cwd 下的 `picker-failure-evidence/`。workflow 在仓库根上传 `companion/picker-failure-evidence/`。绿色缺席和上传看的是这同一个位置。不扫描场景目录。只打开这四个已知路径：

- `Result.xcresult`。先在诊断目录旁的暂存目录里累计，目录树合计不超过 33554432 字节，并且每一项的 `lstat` 不得是符号链接，realpath 必须仍在这个 `Result.xcresult` 里面。超限、符号链接或指向外部时删掉整个暂存目录，诊断目录里不留下这个名字，状态写 `OVERSIZE`。`OVERSIZE` 表示目标不存在，不是半棵树。只有全部检查通过才把暂存目录改名成最终目标；改名失败同样删掉暂存并写 `COPY_FAILED`。
- `xcode.stdout`，不超过 262144 字节。超过则整份不留，状态 `OVERSIZE`。
- `xcode.stderr`，不超过 262144 字节。超过则整份不留，状态 `OVERSIZE`。
- `xcresulttool` 的 stderr。今天 `child.stderr` 的 `data` 回调只增加 `errBytes`，不保存正文；失败分支还会把 stdout 的 `chunks` 清空。保留加在这个既有 `data` 回调里，最多 262144 字节，不新启动工具，也不为它增加等待。一个字节都没收到则 `ABSENT`。累计超过 262144 则丢掉已经收下的全部字节，不写 `xcresulttool-stderr.txt`，状态 `OVERSIZE`。

同时写 `evidence-status.json`，只含这四个名字的 `COPIED`、`ABSENT`、`OVERSIZE` 或 `COPY_FAILED` 和字节数。不复制 `input.json`、配置、密钥、环境、用户媒体或场景里的其它路径。

复制放在现有 `cleanup()` 返回之后、`rmSync` 之前。`cancel()`、相位打印、`cleanup()` 自己的等待、节点 `timeout:45000`、真实点击、第二张 sheet 拒绝、租约和断言都不动。`cleanup()` 失败因而今天不删除目录时，同样做这次复制，然后保持今天不删除的行为。复制抛错时打印一行 `D476_PICKER_EVIDENCE_COPY_FAILED`，不抛出，因此原来的超时或断言失败仍是测试错误。成功路径不创建这个目录。

`restoreSuccessTiming476` 仍先处理计时句。计时句不是恰好一次时仍是 `SUCCESS_TIMING_ONCE`，不看证据句。计时句恰好一次且文本含 `fs.rmSync(dir,{recursive:true,force:true})` 时，证据调用必须恰好一次，否则 `PICKER_EVIDENCE_ONCE`，并且不进入 `9e80020d`。没有这句 `rmSync` 的切片跳过。证据调用被剥掉之后，旧摘要保持不变。

CI 在 `Native desktop interaction acceptance (#476)` 之后加一步，仅 `macos-latest`。`if: always()`，不用 `continue-on-error`。上传 `companion/picker-failure-evidence/`，`retention-days: 7`。绿色 job 没有该目录，`if-no-files-found: ignore` 只覆盖这种缺席，不把上传接口失败变成成功。失败 job 至少应有 `evidence-status.json`。没有这个文件只说明保留没有运行，原失败仍在。

独立测试不启动 xcode。它们验证：成功路径零复制；失败路径的复制发生在代表 `cleanup` 完成的标记之后、`rm` 之前；白名单之外的文件不被复制；文本或 stderr 超限时目标文件不存在且状态是 `OVERSIZE`；xcresult 超限或暂存失败时诊断目录里没有 `Result.xcresult`，暂存目录也被删掉；指向 `Result.xcresult` 之外的符号链接不被跟随，也不把外部文件复制进来；复制抛错不替换原失败，同时留下 `COPY_FAILED`；一个 stderr 字节都没收到时是 `ABSENT`，不阻止另外两个日志复制；stderr 字节只来自既有 `data` 回调，函数自己不生成子进程。测试写出的相对目录和 workflow 上传的 `companion/picker-failure-evidence/` 是 cwd 为 `companion` 时的同一路径。

即使这些文件留下来，仍可能分不开「等待尚未返回」和「已返回但进度写入失败」。被信号结束的 bundle 可能继续让 `xcresulttool` 失败，原文里也可能没有调用栈。那时缺口仍是：没有调用栈，也没有源码行。这一步不因此追加采样或架构改动。它只改善证据能不能被再次打开。新的 SHA 走常规 CI。不重跑 `44525070865`。发布仍暂停，整票仍不能合并。

## 30. 上传步骤的精确逆投影

`e196f29bb8a4acc14ead3e06e32eccecf468bca8` 的十项检查跨 run 聚合是 5 通过、5 失败。主 run `44532945072` 是四条 smoke 失败。ARM run `44532945063` 另失败。不要把这十项都记在主 run 上。失败不是选择框回归。`Pinned NSIS dependency transport and integrity (#633)` 里的 #748/#760/#796 在 `validateWindowsCiFeedback750` 把四个原生阶段折回旧步骤之后，看到多出来的 `Upload picker failure evidence (#476)`，于是 `all old steps retain order/cardinality`。`Native desktop interaction acceptance (#476)` 因此被跳过。没有相位、没有取消数、退出码、六条计时、双收尾、租约或后三例。macOS 上传步骤因 `if: always()` 仍执行，日志是路径下没有文件。这不是空 events，也不能当成原生失败。windows-latest 上 gallery 元数据找不到文件、census 后诊断 `CALLER_MISSING`，是这一步提前失败之后两个 `always()` 步骤的后效。

下一步只给这一个上传步骤补上和 `projectActivityFirst826`、`validateCockpitSteps748`、`conservedBuildSteps794`、`conservedBuildSteps806` 相同的精确逆投影。函数放在 `validateWindowsCiFeedback750` 调用 `projectActivityFirst826` 和 `collapseNativeStages760` 之前。它只认名字 `Upload picker failure evidence (#476)`。恰好一个，否则失败。整个解析后的步骤对象必须等于：

- `if` 是 `always() && matrix.os == 'macos-latest'`
- `uses` 是 `actions/upload-artifact@v4`
- `with.name` 是 `picker-failure-evidence-${{ github.sha }}-${{ github.run_attempt }}`
- `with.path` 是 `companion/picker-failure-evidence/`
- `with.retention-days` 是数字 7
- `with.if-no-files-found` 是 `ignore`
- 没有 `continue-on-error`、`run`、`shell`、`id` 或其它键

位置必须是 `Native desktop interaction acceptance (#476)` 的下一项，再下一项仍是 `Compile shared companion test inputs (#650)`。这样交互步骤失败后上传仍会执行，也不会插进四个必须连续的原生阶段。核对通过之后只从数组里去掉这一个对象。去掉之后，旧步骤顺序、个数、`baseline` 里的旧摘要、四个原生阶段的连续性和既有红灯原样成立。不按 `uses: actions/upload-artifact` 过滤，因此 #748 里那个名字不同的 retired upload 仍然是红灯。不改 `baseline` JSON，不改旧 hash，不放宽旧断言。

上传步骤留在现在这个位置。不把它挪到不会在 macOS 失败后执行的地方。失败证据的复制、上限、符号链接、暂存、45000、20000、真实点击、第二张 sheet 拒绝、租约和两个 Host 都不改。

读 `ci.yml` 的结构测试都对过。必须先走这个逆投影的是调用 `validateWindowsCiFeedback750` 的两处：`scripts/tests/windows-ci-feedback-750.test.mjs` 和 `scripts/tests/native-ci-stages-760.test.mjs`。其余读取者不比较 smoke 步骤全名单，这次不改它们的断言：`nsis-ci-setup.test.mjs` 的 census 切片和 #725 尾步仍在共享编译的下一项；`node-security-runtime-759.test.mjs` 只数 4 次 `setup-node`；`native-join-observation-788.test.cjs` 只看 build job；census 三个测试、`uia-no-autofocus-572`、`ax-native-571`、两处 UIA 572、`cockpit-native-gate-source-723`、`computer-capture-native-controls-723`、`computer-bg-module-scope-650.probe`、两处 #732，以及已经写明这一上传步骤的 `picker-failure-evidence-476.test.ts`。`skills.test.ts` 写的是合成 zip，不是这份 workflow。

新红灯写在 #750 的现有变体表里，LF 和 CRLF 都要抛 `ERR_ASSERTION`。缺这个上传步骤、重复一次、挪到交互步骤之前、挪到共享编译之后、改 `if`、改路径、改 7、改 `ignore`、加上 `continue-on-error`，都失败。旧步骤的移动和删除继续由 #750/#760 已有变体报红，不改那些变体的预期。规划门通过之后才实现这一层逆投影。不重跑 `44532945072`。当前整票仍不能合并，也不能发布。

## 7. 这一节点不做的事

第 7 节原先的「不改测试源码」是当时还没有修复提交时的边界。第 22 节的 `owned` 清理已经在 `35526f9f` 落地。第 24 节的跳过已经在 `acfd55ec` 落地，并在 `269b89c7` 回退。第 27 节的 1 秒余量已经做完并按日志停止，`uiDeadline` 恢复为 `Date.now()+45000`。第 28 节是只读结论。第 29 节的失败证据复制和上传已经在 `e196f29b` 落地。当前步骤是第 30 节，规划门通过之后才实现上传步骤的逆投影。不改 `DesktopHost.swift`，也不改 `DesktopHost.cpp`。除此之外仍不改产品源码，不打安装包，不覆盖 `~/.cmspark-agent`。没有候选安装包，也就没有架构、sha256、签名或公证可报。不开始侧栏 Task 2。发布仍暂停。

## 31. Windows 合并门续查

第 30 节的范围约束适用于上传步骤逆投影。该步骤已完成，之后的 Windows 合并门单独追查。launcher 的受限环境从 Windows 目录推导 `SystemDrive`。原版和新版的本机对照均通过 20 秒 MCP 用例，但只有原版产生字面 `%SystemDrive%` 缓存路径。因此已确认缓存路径缺陷，托管超时仍须由托管验收验证。失败证据复制同批补绑已打开文件身份和读取上限，并清理失去来源的旧副本。正式发布须在整票检查和评审通过后执行。
