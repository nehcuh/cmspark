# 首次远端 CI 与有界修复

Head `a7159117b644e06ce0f1d0733d8be30047608686`；[run 39622056813](https://github.com/nehcuh/cmspark/actions/runs/39622056813)。

## 本次遗漏的旧源消费者

ACP hosted CPU controls 的三个真实回调消费者报 `onView is not defined`。本地执行原 CI 命令（Node 22.23.2）：修前 86 tests / 83 PASS / 3 FAIL；修后 86 PASS / 0 FAIL / 0 SKIP。

唯一修改为 `chrome-extension/scripts/tests/acp-history-hosted-732.test.mjs` 的 VM closure：绑定新导航依赖 `onView` 并验证参数必须 chat；正向点击与延迟关闭验证实际次数，missing/disabled 负向验证零调用。原选中 aria-current、thread.select、真正关闭、owner 与 foreign-history 拒绝全部保留。没有修改生产代码、超时或跳过条件。`rg` 同类消费者另有 `thread-timeline.test.ts` 仅检查来源文本，已在扩展全量通过，不需要虚构 VM 依赖。

Case：导航加入 onView 后漏查 scripts/tests 下的 VM 消费者。
结果：远端三个明确 ReferenceError，本地同原完整 callback 亲证 RED → GREEN。
归责：本次实施遗漏测试闭包，并非无关 CI 或外部环境。
保护：已有 ACP 历史选择和 owner 拒绝不被新导航回调破坏；无需更改产品回调或放松旧断言。

## 独立 Windows 首错

Windows census lane 尚未进入测试，在未改动的固定发行包 gallery 采样返回 `GALLERY70_SAMPLE_FAILURE`。有限投影 `killed:true, signal:SIGTERM, code:null`，last observed `SIGNATURE_RETURNED`；内部终止原因 UNKNOWN，不能以最后阶段猜根因。后续 module-scope 仅因 probe 未产生报 CALLER_MISSING。采样脚本、固定 catalog、PowerShell runner、锁文件和 CI YAML 相对 base 无差异。未更改该门的 15 秒、拒绝或权限，也不将失败称通过。

## 已通过的远端步骤

该精确 head 的 Companion 正式构建、完整测试（8,512 PASS / 178 平台 SKIP / 0 FAIL）、production audit、扩展正式构建/类型检查均通过；Linux smoke 通过。其余平台最终结论以 CI 为准。扩展远端测试在 ACP 失败后未执行，本机全量证据仍为 1,807 PASS。真实录屏/OCR/模型/通知验收缺口不变。

## 测试闭包修复复核

独立 R3 APPROVE；Pi 增量复审 APPROVE，双方各自运行原 86 项控制全部通过。Pi 机械核对原七行的条款均保留，仅插入新依赖/断言；没有生产代码、时限或权限变化。报告分别为 `2026-10-21-chat-action-workspace-adversary-r3.md`、`2026-10-21-chat-action-workspace-pi-r2.md`。后续首次远端 macOS smoke 已成功；Windows 原生 lane 尚在运行。此测试补丁推送后须以新 CI 为准，仍未合并。
