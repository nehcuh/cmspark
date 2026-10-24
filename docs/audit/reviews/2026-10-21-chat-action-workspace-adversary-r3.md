# 聊天事项工作中心：CI 测试闭包增量复核（第三轮）

时间：2026-10-21 15:09:48 UTC。独立评审者：`/root/workspace_adversary`，未参与此测试修复；精确模型版本不可核实。

HEAD：`a7159117b644e06ce0f1d0733d8be30047608686`。本轮唯一暂存差异：`chrome-extension/scripts/tests/acp-history-hosted-732.test.mjs`；`git diff --cached --binary` SHA-256 `6baf05faeef1c425e3d9d444bd28054c4f2932b6416144054b6e418e2e05adfa`，起止核对一致，不包括本报告。生产文件、workflow、固定采样预算和证书断言均未改。

## 结论

批准这个有界测试闭包修复，无新增阻断项。它补全真实回调新依赖的 VM 环境，并新增可观测行为断言，没有把错误吞掉、跳过原控制或降低通过条件。

## 核对

真实生产回调位于 `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx:149`：先 `onView("chat")`，再选择同一 thread、发送 `thread.select`、关闭导航。测试仍从该文件 AST 抽取真实按钮 `onClick`，没有复制/替换回调正文。

`stockNavigationContract()` 的 VM globals 新增 `onView()`，必须传入 `chat`，记录实际调用。正向断言要求一次选择恰有一次调用，延迟关闭后的第二次选择累计恰有两次调用；原有消息、所选 owner、真实 `aria-current` 和延迟 React close 断言均保留。

检查此共享源回调夹具的三个主要消费者：普通 seeded selection、fresh document 正向 readiness、fresh document owner 变更拒绝路径。`freshOwnerControl()` 保留真实 reducer/effect 与回调，只暴露新增调用记录；late hydration、ready、deferred close 三种正向场景均要求一次 `chat`。missing / disabled 负控必须零视图调用，仍禁止面板打开或查询其他 owner。owner 变更场景继续要求关闭面板且不读取 foreign history。

检索 `chrome-extension/scripts`、`chrome-extension/tests`、`scripts` 与 `companion/tests` 中同类 `WorkspaceFrame.tsx` / `cm-nav-thread` 消费者：未发现另一个缺少此 VM 闭包的实际回调抽取器。既有侧栏浏览器脚本调用真实 DOM；thread-timeline 测试读取源码约束，不是本次缺失 globals 的执行路径。

## 独立执行结果

执行父任务指定的同一命令：

```sh
source /Users/huchen/.nvm/nvm.sh && nvm use 22.23.2 && node --test chrome-extension/scripts/tests/acp-history-hosted-732.test.mjs chrome-extension/scripts/tests/cft-linux-supplier-732.test.mjs
```

结果：**86 PASS / 0 FAIL / 0 SKIP / 0 CANCEL，exit 0**。原曾报错的 seeded / fresh 正向 / owner 变更测试均通过；missing / disabled 负控与全部 fixed-supplier 控制继续通过。`git diff --cached --check` 通过。

修前 83 PASS / 3 FAIL 是父任务提供的定位证据，本轮只独立复跑修后的同一命令。没有重跑或重新认证未变的生产代码、真实桌面、模型、通知或全量平台功能。没有触碰另一个 Windows gallery 证书采样 SIGTERM 问题；本报告不能将其标记通过，也不能代替该 CI 的真实回执。

第一轮三个 P2 的第二轮 FIXED / APPROVE 处置保留；此次无生产行为增量，不产生新的现场能力承诺。现有 macOS 权限、真实模型质量和通知展示的验收缺口不因测试修复消失。

VERDICT: APPROVE
