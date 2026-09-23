# 双路复审任务（只读）

你是独立评审。只读仓库，不要创建、修改、删除任何文件，不要 commit，不要跑全量 `npm test`（会抢 `.test-dist`）。可以用 Read / Grep 核对源码。结论必须来自你自己读到的代码，不要复述本提示里的自我评价。

## 范围

未提交改动，相对当前 `main` 工作区。补丁：

`docs/audit/reviews/524-outbound-confirm.diff`

只审这 10 个文件。忽略无关脏文件（`companion/src/host-use/darwin/host-integrity.ts`、`memory/session.md`、未跟踪目录）。

GitHub #524。用户四条：

1. Windows 上怎么配租手 MCP，文档要写清楚。
2. 编程助手的 caller 必须和 Chrome 插件签发 grant 时的 caller 一致；签发界面要能填 caller。
3. Chrome 插件签发时要有权限配置入口。
4. 如果必须弹确认台，现在的体验太差（窗口不出现，Windows 没有托盘，约 45 秒后失败）。

## 实现者声称

- 文档不再让人把 `%LOCALAPPDATA%` 写进 MCP `command`/`args`，改为 `C:\Users\<你的用户名>\AppData\Local\CMspark\...`。Explorer 里可以用 `%LOCALAPPDATA%\CMspark` 找目录。
- 侧栏「调用方 caller_id」有可见标签。`CMSPARK_OUTBOUND_CALLER_ID` 必须与钥匙 caller 逐字相同。
- 签发表单有「权限」：页面外泄勾选始终可见；上下文出口只在工具档为 `outbound_context_v1` 时出现。
- `tool_name` 以 `[Outbound]` 开头的确认，`decideCockpitFocus` 返回 `open_focus`。其它轻确认仍 `stay_background`。首次外泄正文带调用方，并设 `fullPreview`。45 秒超时未改。不自动允许。
- 已跑：`cockpit-focus-policy.test.ts` 36 通过；companion 三个测试文件 38 通过。请核对测试是否真锁住行为，不要重跑全库。

## 能力声明（ADR-020）

```text
Surface: L1 租手确认
L2-classes: none
Compose: none
Autonomy: 仍须人批，不自动过
Trust: fail-closed，45s 超时拒绝不变
Channel: Chrome 确认台；Windows/Linux 无托盘
```

## 请核对（有文件和行号才算）

1. `[Outbound]` 前缀是否覆盖首次外泄和租手 L2（navigate 等）？有没有租手确认用了别的 tool_name，因而仍然不弹窗？
2. `open_focus` 是否真的会 `openOrFocusCockpit()`？侧栏没开时扩展后台收不收得到 `security.confirmation.request`？文档「确认台会到前面」有没有说满？
3. `fullPreview` 会不会把这次确认同时变成「重预览」，从而改变侧栏能否点允许？有没有误开 nonce？
4. 焦点例外有没有放宽到非租手的轻确认？`auto_approve` / god-mode 有没有因此跳过租手确认？
5. `originWs` 绑定有没有被这次 `request()` 改动弄丢？
6. Windows 文档和侧栏复制片段还有没有会让人复制即失败的路径？非 Windows 上 CLI 仍印 `%LOCALAPPDATA%` 时，文档是否诚实？
7. caller 只是加了标签，还是以前根本没有输入框？权限入口是否名不副实（上下文权限仍要先改工具档才出现）？
8. 测试是否只锁了策略函数，没锁「后台真的开窗」？这算不算阻塞？

## 输出

先列阻塞项（没有就写「无阻塞」），再列非阻塞 NIT。每条带 `file:line` 和你读到的事实。不要改代码。

最后一行必须恰好是下面三者之一，后面不能再有字：

VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
