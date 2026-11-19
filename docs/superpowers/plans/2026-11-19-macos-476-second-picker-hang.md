# macOS #476 第二次选择框卡住的修复计划

> 这一份只记录根因证据和下一个实现节点要守的红灯。实现还没开始。

GitHub: 现有 #476 桌面验收。没有新的用户可见行为。

**Base:** `08fe57feacd6ca634eb2f8369dada10420ce0d44`

规格：`docs/superpowers/specs/2026-11-19-macos-476-second-picker-hang.md`

## 证据

失败日志是 CI run `44280268875` 的 job `134718780580`。调用链：

1. 测试向桌面进程发出两次 `desktop.workspace.picker.request`。第二次带 `cancel:true`。
2. `workspace-acceptance.swift` 的 `panel()` 看到真实 `NSOpenPanel` 可见，发出两次 ping。
3. 第一次 `desktop.workspace.picker.result` 是 `selected`，路径身份匹配。
4. `WorkspacePickerUITests.sheet(15)` 写入 `ui-progress` stage 15 detail 0 后，停在 `app.windows.matching(identifier:).count`。
5. stage 18 的 Cancel 计数没有发生，所以宿主没有发出 `cancelled`。
6. 45 秒到点。`uiOwner.complete()` 拒绝，测试把 `failureSite` 记成 9。
7. 同一作业里后面的 #476 用例超时。清理记录里的 Xcode 子进程没有退出。

## 不在修复里做的事

- 不把 45000 改大。
- 不给这条用例加 skip。
- 不把 `cancelReturned == 1` 改成可选。
- 不改 PR #867 的侧栏来「修」这个原生失败。
- 不在 Linux 上宣称原生选择框已经通过。

## 下一个实现节点

只改 `companion/tests/fixtures/workspace-ui-705/WorkspacePickerUITests.swift` 的 `sheet()`。窗口数量改成在该函数已经拿到的 `remaining()` 时限内完成；到时限就走现有的 `OwnedUI705Error.refused`。仍要求窗口数是 1、sheet 数是 1，然后点 identifier 为 `Cancel` 的按钮。45 秒的 node 测试时限不动。

红灯必须来自 macOS 上现有的这条用例，失败形态仍是第二次取消没有完成，而不是编译错误。绿灯是同一用例退出码 0，并且 `D476_WORKSPACE_NATIVE_PHASE` 里 `cancelReturned` 为 1、`childExited` 为 true、`childExitCode` 为 0。后面原来连锁超时的三条例子也要在同一次 `smoke (macos-latest)` 里通过。

Linux 只能继续跑现有的解析和结构测试。那些测试通过不能写成原生选择框通过。

## 安装包

这一节点没有修复提交，所以没有候选安装包。用户本地换装要等 macOS CI 绿了之后，用那个提交的常规 macOS 构建，单独写明文件名、架构、sha256、run、签名和公证。不覆盖 `~/.cmspark-agent`。
