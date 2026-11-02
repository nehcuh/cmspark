# #826 macOS 67c5e209：实际全 lane 成功回执

2026-11-03，非Mac实现作者只读跟踪。PR826，CI41529697607，head `67c5e209d239995b930fe1dfcc54f444005e44f8`，job `125566390605`。[实际Mac job](https://github.com/nehcuh/cmspark/actions/runs/41529697607/job/125566390605)

API终态 **SUCCESS**；started2026-11-02T21:35:28Z、completed21:43:43Z。按不超过60秒间隔读取本run metadata，终态后才下载此单job日志：`/tmp/cmspark-826-macos-67c5e209.log`。未操作其它CI、rerun/cancel、源文件、flags或45秒门。

## 关键原生门

- Desktop build helper controls：322 PASS、0 FAIL/取消/SKIP。真实Mac CPU producer/reader case41 PASS；原callback/fd/主错case42 PASS。这里不主张Windows实际运行。
- Pinned runtime headers：16 PASS；native fixtures构建、acceptance TS编译成功。
- Native bootstrap/process：24 PASS、14 Windows平台SKIP、0 FAIL；Mac visual/hostile/reconnect/relaunch和parent watcher等原native门成功。
- 原MCP真实表单+OS-only确认：**4623.234125ms PASS**；windows3、approved2、denied1、persistedtrue；requestMask7，native exited、done均true（raw3777–3785）。
- Native interaction：**12 PASS / 0 FAIL / 0 cancelled / 0 SKIP**，含原metadata/dialog/resource/workspace/local/archive/terminal各case。

## Workspace原45秒完整完成与清理

原 `#476 actual native workspace picker binds canonical root, reopens lists/reads and cancels the second OS picker` **32002.581375ms PASS**（raw3911–3926），没有扩大45000ms。

实际闭集回执：

- failedfalse，receiptMask1023，picks2、pickerObserved2、pickerReturned1、cancelReturned1。
- selectedOutcome/selectedIdentity true，connections1，authenticated/windowRequested true。
- native childExited true、childExitCode0、firstFailedAssertion0、failureSite0。
- uiReceiptMask31；observerClosedtrue/code0，**xcodeClosedtrue/code0**；invalidfalse。
- 正常业务回执确认真实picker、controller确认、persisted/reopen/list/read/cancel、sibling未变。
- CLEANUP_ENTER31922ms，ACTION_SETTLED/RELEASE_ENTER31999ms，**RELEASED32000ms**；over_budget均false。原full close/quiescence/identity/code0守卫满足后正常释放surface，不是只靠诊断或native exit放行。

本次没有失败用的D826_UI_TIMING/D705最终tool826、timing826输出，也没有REFUSED或firstfailure；不把缺失的失败观察解释成某个内部事件未发生。没有使用exit代替close或从ROOT_REMOVED推断查询读取时因果。

## 后续案例与全 lane

- LOCAL：真实PTY/ACP、Unicode/resize/stop/return/reopen、权限拒绝、sibling unchanged；surface RELEASED4438ms。
- ARCHIVE：永久归档/恢复、history和sibling不变、busy拒绝/lostACK/offline未确认；RELEASED2922ms。
- TERMINAL：真实PTY、拒绝/取消零launch、Unicode/over16KiB/seqACK/resize/真实exit/partial return/reopen/foreign-null拒绝；RELEASED3519ms。
- 原owned PTY tail2项、Office、pure tests、Swift host typecheck、macOS外部AX action/background oracle、#605授权/进程、#607跨平台MCP/process、#609 startup等后续实际步骤均SUCCESS；全job没有not ok、testTimeout取消或失败步骤。
- #758 actual passive activity/local OCR步骤、Windows census和其它Windows-only步骤在本Mac矩阵按原条件SKIP，不能记作该项Mac通过；Windows验证由独立lane负责。

本回执接受本head该Mac lane的实际结果，不推断此前64db/0666物理失败原因已修复或永久不再出现，也不替代Windows scope/census、全局CI或发布门。无需为旧Mac失败继续无变化观察或安排重跑。
