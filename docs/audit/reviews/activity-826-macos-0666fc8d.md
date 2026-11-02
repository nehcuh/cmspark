# #826 macOS 0666fc8d：实际 CI 只读回执

2026-11-03。CI41521066023，head `0666fc8d066ec6a0941c5edec865063a30692cf9`，macOS job `125536906690`。[实际 job](https://github.com/nehcuh/cmspark/actions/runs/41521066023/job/125536906690)

API终态 **FAILURE**；started2026-11-02T20:38:37Z，completed20:48:51Z。按不超过60秒间隔读取metadata，终态后才下载此单job日志至 `/tmp/cmspark-826-macos-0666fc8d.log`。没有改源、rerun、cancel、扩时限、新实验或Windows验收主张。

## 通过及未到达的门

- Desktop build helper controls：318 PASS / 0 FAIL；新真实CPU producer/reader case37 PASS（5829.376375ms），原callback/fd/主错误控制case38 PASS（28.106125ms）。这只是Mac机器事实，不是stdio作者自评批准。
- Pinned runtime header controls：16 PASS。
- Native fixtures构建与acceptance TS编译：PASS。
- Native bootstrap/process acceptance：23 PASS、14 Windows平台SKIP、0 FAIL。Mac visual/hostile/reconnect/relaunch、owned parent watcher均PASS。
- 原 #476 MCP真实表单/OS确认：PASS，8387.913041ms；windows3、approved2、denied1、persistedtrue，requestMask7、done true。
- Native interaction step17：前置metadata/dialog/resource通过，首错workspace；最终12 tests中8 PASS、4 testTimeout取消，步骤FAIL。
- #758 actual activity/local OCR及后续步骤因step17失败未执行；不计作通过。

## 本次首错及真实边界

首错为 `#476 actual native workspace picker binds canonical root, reopens lists/reads and cancels the second OS picker`，原45000ms超时，报告45114.812708ms（raw log3881–3888）。闭集回执在raw log3876：

- receiptMask1023，picks2、pickerObserved2、pickerReturned1、**cancelReturned1**。
- selectedOutcome/selectedIdentity true；authenticated/windowRequested true；connections1。
- native childExited true、childExitCode0。
- firstFailedAssertion3、failureSite9、pickOutcome4。
- uiReceiptMask31，uiProgress stage20/detail0，uiRefusal null。
- observerClosed true、observerCode0；**xcodeClosed false**、xcodeCode null。
- cancelTiming788包含 `[20,true,24354,744,0]`：已观察到Cancel click返回，UI记录剩744ms；这是实际producer自己的固定时间记录，不与其它钟域相减。
- diagnostics invalid false，UI lifecycle invalid false。

与64db的 cancelReturned0、stage18 不同，本次取消结果及全部native/UI receipts都已观测。不能把旧“Cancel未返回”描述复制到本次。

## 真实消费者核对与定位范围

- `companion/tests/fixtures/workspace-ui-705/WorkspacePickerUITests.swift:100–102`：18=Cancel count，19=isHittable，20=Cancel click。20 return timing在原click之后，source52–53的defer写 UI_SEQUENCE_RETURNED。
- `companion/tests/helpers/workspace-xctest-owned-705.ts:248–257`：31为startup/ack/UI begin/UI returned/runner-closed五类固定receipts；`closure():260–264`还要求observer和xcode实际close。
- `companion/tests/desktop-native-thread-metadata-476.test.ts:220–223`：failureSite9来自 `uiOwner.complete()` 拒绝；assertionSite3等待UI owner确实闭合。`workspace-xctest-owned-705.ts:342–350` 的 canSettle/complete/cleanup要求xcode真实终态，不以UI receipts代替。

因此下一定位范围应是 **UI动作已返回后，owned xcodebuild/runner 完整关闭的原完成守卫与deadline关系**。本次没有证据支持再改Cancel元素选择/点击顺序，也不能由deadline剩744ms猜测具体XCTest内部原因。有限后置诊断仍UNKNOWN：cancel后Xcode stdout/stderr首marker/NSError皆NONE；xcresult详情为TOOL_FAILURE（raw log3918–3919），不能据此认pass、崩溃或某个系统根因。

如root决定继续定位，可先只读比较fc4通过/64db失败/0666失败在同一complete()/close边界的原记录，明确构建、UI动作和关闭时间消耗；任何新增关闭观察或流程修正另需设计、独立验证与GLM批准。此回执不直接修代码或安排无变化rerun。

## 下游影响

workspace45秒时surface RELEASE_REFUSED；LOCAL45000ms、ARCHIVE20000ms、TERMINAL45000ms都记录 ACQUIRE_REFUSED 后超时（raw log3920–3964）。这些是未取得共享surface的下游拒绝，不能独立认作三个产品缺陷。

当前Mac门未通过，不能据前一head绿或本次MCP绿替代整job验收。Windows及其它平台由root/独立agent协调，本报告仅上述单Mac job机器事实。
