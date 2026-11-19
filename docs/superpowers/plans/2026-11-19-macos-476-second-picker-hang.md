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

拒绝型等待不返回就没有 Bool，不能当成恰好一个，也不能点按钮。组合框两次等待若都返回了，但不是「0 存在且 1 不存在」，就改走 `textFields`，这本身不拒绝；随后的 `inputs` 仍按拒绝规则检查，通过才会点到输入。单次快照不返回时，组合框分支同样停住，交给 45 秒后盾。两次返回不是原子 `count==1`。detail 仍是 0 到 5。不把 `isHittable`、`click()`、`typeText`、`typeKey` 包进新线程。`observeChooseCensus` 体内的三处 `.count` 保持不动，也不把它们当成拒绝或回退。

## 结构断言和变体怎么一起改

`desktop-workspace-xctest-705.test.ts` 第 797–801 行的片段来自当前 Swift：起点 `uiStage=7`，终点 Choose 查询，不是逆操作结果。今天第 798 行要求这个片段里 `waitForExistence(` 恰好 1 次。新片段恰好 5 次，顺序固定：

1. `inputCandidates.firstMatch.waitForExistence(timeout:try remaining())`
2. 组合框下标 0：`waitForExistence(timeout:1)`
3. 组合框下标 1：`waitForExistence(timeout:1)`
4. `inputs` 下标 0：`waitForExistence(timeout:try remaining())`，false 拒绝
5. `inputs` 下标 1：`waitForExistence(timeout:1)`，true 拒绝

因此当前片段里 `waitForExistence(timeout:try remaining())` 恰好 2 次，`waitForExistence(timeout:1)` 恰好 3 次。两次字面量 1 秒先出现在组合框上，且这两句不含 `try remaining()`。第 800 和 801 行今天锁在当前片段上的 `comboCount==1 ? first.comboBoxes:first.textFields` 与 `guard inputCount==1 else` 改到逆操作之后的文本；当前片段不再要求这两句，也不要求组合框 `throw`。第 799 行只改顺序不够，第 798、800、801 行同一片段一起改。

第 520 和 656 行读 Choose 的当前源文。第 519 行的片段止于 `uiStage=12`，所以新增的 `waitForExistence(timeout:1)` 必须写在 `guard chooseSeen else` 之后、`uiStage=12` 之前。这个片段里 `waitForExistence(` 恰好 2 次，`try remaining()` 恰好 1 次，`choose.firstMatch` 仍恰好 1 次。第 655 行的片段延续到 `uiStage=14`，同一句拒绝仍在 `isHittable` 之前。第 522 行的计数改成这两个数，不删 `choose.firstMatch` 的计数。`sheet()` 在 stage 7 之前，不计入这 5 次或这 2 次。

`desktop-workspace-query-101.test.ts` 第 12–38 行投影的是当前 `sheet()`。今天要求 `guard count==1`、`guard sheets==1`，成功调用序是 `window-count`、`window-first`、`sheet-first`、`remaining`、`wait`、`sheet-count`、`sheet-first`。新投影改为：窗口下标 0 为 false 时，在下标 1 之前拒绝；窗口下标 1 为 true 时，在 `let w=windows.firstMatch` 和 sheet 等待之前拒绝；已有的 sheet `firstMatch.waitForExistence(timeout:try remaining())` 为 false 时，在下标 1 之前拒绝；sheet 下标 1 的 `timeout:1` 为 true 时拒绝，并且不执行 `return w.sheets.firstMatch`。`let w=windows.firstMatch`、`w.sheets.firstMatch.waitForExistence`、`return w.sheets.firstMatch` 各自仍恰好 1 次。第 47–49 行把两处 `==1` 改成 `>=1` 的变体，在新源文上是空替换。变体改成破坏窗口下标 0 的拒绝和下标 1 为 true 的拒绝，先断言旧句在当前源文里恰好 1 次，再断言还原失败。`guard inputHittable`、`guard r>0,r<=45` 和 `cancel.element.click()` 这三对变体保留。

第 780 行今天用旧调用序列和新序列做全等。新语义成立之后不再维持这个全等。旧路径只证明还原后的 `count` 在输入一开始不存在时仍会拒绝；新路径用上面的 5 次等待和点击作为证据。

第 688–705 行只覆盖 Choose。下标 0 返回 false 时，在下标 1 等待和 `click` 之前拒绝。下标 1 返回 true 时，在 `click` 之前拒绝。`count` 桩不再被调用。

第 711–788 行的输入投影拆开，不再沿用今天第 783 行把 `{count:0}` 和 `{kind:'combo', count:2}` 一律当成点击前拒绝。那个拒绝来自回退之后文本框数量为 0，不是组合框分支自己拒绝。新桩要把组合框结果和 `inputs` 结果分开：

- 组合框恰好一个，且选中的 `inputs` 恰好一个：点到输入。
- 组合框 0 不存在，或 0 存在且 1 也存在，同时文本框恰好一个：仍点到输入，调用序列里要出现文本框等待。这是回退成功。
- 选中的 `inputs` 下标 0 为 false，或下标 1 为 true：在 `click` 之前拒绝。组合框不唯一且文本框也不恰好一个时同样拒绝，但拒绝点在 `inputs`，调用序列里仍要有文本框等待。

把组合框回退写成 `throw` 的变体，必须让「组合框不唯一且文本框恰好一个」这一条失败。第 776 行今天要求 `wait` 恰好 1 次且早于 `comboCount`；成功路径改为 5 次等待，顺序是 descendants、组合框两下标、`inputs` 两下标，然后才 `hittable` 和点击。第 732–734 行要求当前投影正文里恰好一次 `guard inputCount==1`、`min(comboCount,2)` 和 `min(inputCount,2)`，这些替换改到新的 `inputs` 拒绝句，不再要求组合框 `count`。

第 786 行的条件是 `cancelOnWait` 或 `expireOnWait`，两边今天都期望 `wait` 恰好 1 次并且已经执行 `hittable`。下一个 `try remaining()` 今天在 stage 10，晚于 stage 9。`inputs` 的 `timeout:try remaining()` 会先求值 `remaining()`，发生在两次组合框字面量等待之后、`hittable` 之前。取消和过期都改为：候选等待返回后，组合框两次字面量等待仍执行，然后在 `hittable` 和 `click` 之前拒绝。`wait` 恰好 3 次。不能只改取消。

第 445 和 639 行读的是逆操作之后的文本。新逆操作先还原今天的 `count` 句子，这两处继续要求 `let chooseCount=choose.count` 和 `guard chooseCount==1 else`，还原片段里的 `waitForExistence(` 仍恰好 1 次。不把这两处改去找新的 `boundBy`。

第 683 行的 `guard chooseCount==1 else` 变体改成破坏 Choose 的「下标 1 为 true 就拒绝」。新逆操作找不到这句精确片段时抛 `ERR_ASSERTION`。第 807 行只改 `inputs` 的拒绝句，不改组合框回退句。窗口、sheet、Cancel 补当前源文有序片段和同样的拒绝变体。组合框不补「下标 1 为 true 却没拒绝就失败」这种变体。

新的还原单独做成入口，每个原始文件只调用一次，并且发生在该文件第一次进入 `restoreCloseObservation476`、`restoreObservation826`、`restoreObservation788` 或 `restoreWorkspaceQuery101` 之前。不放进 `restoreObservation788` 里面，否则外层再调用一次就会重复精确替换。

调用顺序今天是：`previousInputReady705` 先 `restoreCloseObservation476`，后者先 `restoreObservation826`，后者第一句就是 `restoreWorkspaceQuery101`。`restoreObservation788` 自己也会先调用 `restoreWorkspaceQuery101('ui')`，helper 再经 `restoreCloseObservation476('helper')` 进入 `restoreWorkspaceQuery101('helper')`。Swift 含有 `let w=windows.firstMatch` 时，query101 立刻用整文件摘要 `2eca9be781a3c401b6d96bf8cba6b41f9c8fe32f9be5052be094d0ae27c972b8` 做 `QUERY101_COMPLETE_CURRENT_SOURCE`，然后把这个标记换成 `let w=windows.element`，摘要变成 `1b4837f6ce7945273d0a1ead0542712503191a422f36b8a743a9622aab89c37a`。helper 的标记就是 `2eca9be7…`，当前整文件摘要是 `56cb1183b0e057b879d11567424c5b325362e7dbfd373edeca4faa5dd73751e5`；标记被换成 `1b4837f6…` 之后，`OBS826_CURRENT_SOURCE` 才要求 `80b4d54471bb1007bb237c8236846b8bb84db86c88c96df4f163686cb215aa7e`。句子还原若放在 `restoreObservation788` 之后，这两次整文件校验已经失败，而且 `2eca9be7…` 已经不在 helper 里，精确一次找不到新摘要。

入口按种类分流，都只做一次：

- `ui`：把新的等待句子还原成今天的 `count` 文本，保留恰好一次 `let w=windows.firstMatch`、`w.sheets.firstMatch.waitForExistence` 和 `return w.sheets.firstMatch`。输出摘要必须是 `2eca9be7…`。没有这些新句子的文件原样返回。
- `helper`：把新的 `RESULT705_SOURCES` 摘要精确一次换回 `2eca9be7…`。输出摘要必须是 `56cb1183…`。不对 helper 做 Swift 句子替换。

下表的每一行都在进入既有 restore 之前调用这个入口。query101 的 `2eca9be7…`、`1b4837f6…`、`56cb1183…`、`80b4d544…` 四处锁不改。

| 入口 | 文件 | 今天的第一跳 |
| --- | --- | --- |
| `previousInputReady705` | ui 与 helper | `restoreCloseObservation476` |
| `desktop-native-observation-788.test.ts` 第 43 行 | 十个文件里的 Swift 与 helper | `restoreObservation788` |
| `desktop-workspace-query-101.test.ts` 第 44 和 49 行 | Swift 与 helper | `restoreWorkspaceQuery101` |
| `desktop-workspace-xctest-705.test.ts` 第 57 行 | helper | `restoreObservation826('helper')` |
| `desktop-workspace-xctest-705.test.ts` 第 363 行 | helper 成功路径 | 本地包装后的 `restoreCloseObservation476('helper', raw)` |
| `desktop-close-observation-826.test.ts` 第 171 行 | helper | `restoreObservation826('helper')` |

第 358 行的本地函数只是转调模块。第 359–364 行直接读原始文件，成功路径第 363 行对 helper 调用 `restoreCloseObservation476('helper', raw)`，不经过 `previousInputReady705`。包装的第一句仍是 `restoreObservation826`，接着 `restoreWorkspaceQuery101('helper')`，所以生效摘要一改，未还原的 helper 会先撞上 `56cb1183…`。这一行的 helper 成功路径要先做 helper 入口还原，再调用 close476。同循环里的协议、观察者和 native 样本没有新摘要，不还原。

第 364 行的四个变体仍要抛 `ERR_ASSERTION`。未改动的 helper 里 `/*OBS476_CLOSE_BEGIN*/` 有 4 处，`split` 长度是 5，对应配置里的 count 4，不是单标记的 2。变体先按这个基数证明字节变了：删掉第一处后剩 3 处，第一处被重复后变成 5 处，第一处 `OBS476` 改成 `OBS475` 后精确标记剩 3 处，多一段换行则标记仍是 4 处但全文不同。helper 先把新摘要换回 `2eca9be7…`，再进入 close476。close476 的第一跳是 `restoreObservation826`，它先做 `restoreWorkspaceQuery101('helper')` 的整文件 `56cb1183…` 校验，通过以后才数 OBS826 和 OBS476。这四个变体都改了字节，所以失败点就是 `QUERY101_COMPLETE_CURRENT_SOURCE`。不要求它们抵达后面的标记计数，也不放宽这个摘要。协议、观察者没有 query101 档案，它们的变体仍由各自的 OBS476 边界计数拒绝，基数分别是 2 和 11。`desktop-local-native-476.test.mjs` 第 326 行只对 native 测试调用 `restoreCloseObservation476('native')`，没有 helper 摘要，不加还原。

同一类顺序也用于另外两处，摘要本身不改、不后移。ui 句子还原之后，`desktop-workspace-query-101.test.ts` 的变体第一失败点是 `2eca9be7…`，不是后面的 pair `split`。第 171 行的 helper 变体第一失败点同样是 `56cb1183…`，不要求先抵达 OBS826 的 16 块计数。

还原之后，第 390 行 ui 的 `current`、`prior` 和哈希 `0b193e101ccee97e618500e56208e6e1740bad28558a8c2439252efca7b9b572` 保持不动。helper 随后仍把注释里的 `fb446e0d2b32e5a55e05a03e369fa5635b98448513a59fe9ea91bd098590b076` 换成 `0b193e10…`，整文件哈希保持 `1f8e2f2129378ec2ccc4510e6a4ab29a4445fa71208223ef04c4114b2bf0885d`。第 43 行在入口之后再跑 `restoreObservation788`，Swift 期望仍是 `fb446e0d…`，helper 期望仍是 `873b5ced054248db5af1b6b007104ec7f4095f34ff622b5335e751419c2eff3b`。其余直接调用 `restoreObservation788` 的 C++、native 测试和终端夹具没有这两个标记，入口对它们原样返回。

其后 ui 哈希保持 `1c9da3dd55238e24652db387a3dd351ae49f40bc4c566c5db8621a9fdf453b68`、`6efad44df4a39d7b4aa33a2509dd01b17e97f8ed333252169c058aa5815f064e`、`182d2773a37134d289fec9c80a27107b5359c51d2cab1545bdfd62c3f6a2cee4`、`ab75e477a7f678cbc86191ca3997ea9d55fa8e6ba9cca6a408536af82afa7a79`。第 642 行改为 helper 含有新 Swift 文件的摘要。

## 约束映射

| 位置 | 读的文本 | 今天 | 实现后 |
| --- | --- | --- | --- |
| 84、100 | 当前 Swift | 窗口 nonce、`remaining()`、stage 10 的 click 后 `try remaining()` | 保持这三句，不挪 stage 10 |
| 353 | 当前 Swift | `uiRefusal` 只写一次 | 不改 |
| 441–448 | `previousChoose705` 之后 | `choose.count`，`waitForExistence(` 1 次 | 保持；句子逆操作先还原 |
| 474–490 | 逆操作后的整文件 | `ab75e477…` 等 | 保持 |
| 513–522 | 当前 stage 11–12 | `choose.count`，两种调用都 1 次 | `waitForExistence(` 2 次，`try remaining()` 1 次，`choose.firstMatch` 仍 1 次 |
| 575、641 | 当前或还原后的普查函数 | `.count` 3 次，函数内无 `waitForExistence` | 保持，新等待不写进普查 |
| 639–640 | `previousCriticalCensus705('ui')` | stage 11 的 `choose.count`，等待 1 次 | 保持 |
| 646–660 | 当前 stage 11–14 | `guard chooseCount==1` 在 hittable 之前；逆操作哈希 `182d2773…` | 当前片段改成下标 1 的 true 拒绝仍在 hittable 之前；哈希保持 |
| 676–705 | 当前 Choose 投影 | `count` 为 0 或 2 时点击前拒绝 | 下标 0 false 在下标 1 之前拒绝；下标 1 true 在点击前拒绝 |
| 683、684 | 当前 ui 变体；helper 多一个换行 | ui 变体破坏旧 `chooseCount==1`；helper 哈希路径失败 | ui 变体改破坏 Choose 的下标 1 拒绝；helper 仍只靠多一个换行失败 |
| 711–734 | 当前输入投影正文 | 恰好一次 `inputCount==1` 与两处 `min(…Count,2)` | 改写 `inputs` 拒绝句；不要求组合框 `count` |
| 769–780 | 当前与还原后的 ui | 成功路径 `wait` 1 次，并和新旧序列全等 | 不再维持全等；新路径 `wait` 5 次后点击，旧路径只保留「输入一开始不存在就拒绝」 |
| 783–786 | 当前输入投影 | `cancelOnWait` 与 `expireOnWait` 都要求 `hittable`，`wait` 1 次 | 两条都在候选等待和两次组合框等待之后、`hittable`/`click` 之前拒绝，`wait` 3 次 |
| 791–795 | `previousInputReady705` 的 ui 与 helper | ui `0b193e10…`；helper `1f8e2f21…` | 两个哈希都保持；Swift 句子只还原 ui |
| 797–801 | 当前 stage 7 到 Choose | `waitForExistence(` 1 次；当前片段含 `comboCount==1` 与 `inputCount==1` | 等待 5 次；字面量 `timeout:1` 3 次；`timeout:try remaining()` 2 次；那两句旧 `count` 只出现在逆操作后 |
| 803 | 当前 stage 7 片段 | 禁止 `.count >=`、双击、定时器 | 保持 |
| 807 | 当前 ui | 旧 `inputCount==1` 恰好一次，变体使逆操作失败 | 改成 `inputs` 下标 1 的拒绝句恰好一次；不动组合框回退 |
| 390 helper 分支 | helper 源文 | `fb446e0d…` 换成 `0b193e10…` | 保持；先把新的 `RESULT705_SOURCES` 摘要还原成 `2eca9be7…` |
| query101 第 12–49 行 | 当前 `sheet()` 与整文件 | `guard count==1`、`guard sheets==1` 和旧调用序；`==1` 改 `>=1` 使 query101 失败 | 窗口 0 在下标 1 前拒绝，sheet 下标 1 为 true 才拒绝；变体改这两句并确实改到源文 |
| 57、171、363、43、44 行的 restore | 原始 Swift 或 helper | 第一跳就做 `2eca9be7…` 或 `56cb1183…` 整文件校验 | 入口先还原，再进入这些第一跳；第 363 行只还原 helper 成功路径；不改那四个摘要 |
| 788 测试 40–43 行 | 入口之后的 `restoreObservation788` | Swift `fb446e0d…`；helper `873b5ced…` | 期望摘要保持 |
| 642 | helper 含当前 Swift 摘要 | 含 `2eca9be7…` | 含新摘要 |
| 新增 | `sheet()` 与 Cancel 的当前源文 | 今天没有有序片段 | 窗口与 Cancel：下标 0 用 `try remaining()`，下标 1 用 `timeout:1`；sheet 只把 `count` 换成下标 1 的 `timeout:1`。true 拒绝。不进入 stage 7 的 5 次计数 |

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
