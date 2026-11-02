# #825 scope 原生夹具就绪：证据与最小修复

对象：bd43 Windows native 首错，日志 `/tmp/cmspark-825-windows-bd43-native-job.log`。初始 Probe 返回 PID 6344，owned child 为 1780，在 ready 已读后 1.229 秒内失败。PID/HWND 原断言继续保留。

## 亲证缺口

旧 `ContentRendered` body 为真实源码：

```text
if (File.Exists(Path.Combine(Root, "ready.json"))) return; Current.Activate(); Focus.Focus(); Write("ready.json", Snapshot());
```

原字节 SHA256 `43fb0fd3a4776fbebdfb09a44cd4a83c805ce705f09d9313494b0667b9e520ad`。它可不改任何语句而直接在 VM 执行；将两个真实 API 边界分别控制为 false/true，4 种组合均写 ready，包括两者都 false。独立复现 `/tmp/cmspark-825-scope-readiness-design-probe.cjs`，日志 `/tmp/cmspark-825-scope-readiness-design-probe.log`。popup 原路径同样忽略请求结果后无条件写 ack。

这证明夹具发布条件缺失，不证明此次 PID6344 的进程种类、Activate/Focus 实际返回值，或焦点究竟在 ready 前还是后变化。WPF [Activate](https://learn.microsoft.com/en-us/dotnet/api/system.windows.window.activate?view=netframework-4.8.1) 是激活请求；[IsKeyboardFocused](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/focus-overview) 表示实际键盘焦点，不能由“请求过”替代。

## 实现（用户后续授权后）

只修改 `companion/tests/fixtures/activity-scope825-windows.cs`，新增 `companion/tests/activity-scope825-readiness.test.ts`；未修改产品、native controller 断言、10 秒 receipt/180 秒用例、采集/OCR/裁剪/模型/清理路径；未 stage/commit/push。

- 每个 Build 出来的窗口使用自己的 rendered/requested 闭包；ContentRendered 后依旧只调用一次 Activate 与 Focus，返回值不被当成成功证明。
- 仅当当前 Window 与 pending receipt Window 相同、ContentRendered 已发生、HWND 非零且等于真实 GetForegroundWindow、当前捕获的 TextBox.IsKeyboardFocused 时才写回执。pending 在写前置空，重复事件不重复写。
- Activated/GotKeyboardFocus 只经原 Dispatcher 排程重新读取守卫；不重新激活/聚焦、不轮询、不恢复焦点、不加 retry。
- 初始 ready、popup ack 使用相同守卫；popup 的显式激活/焦点请求移到自己的 ContentRendered，一次请求数量保持。旧窗口迟到事件捕获旧窗口与旧 check，不能发布新窗口回执。
- resize 仍执行原 Width 变化与 UpdateLayout，之后把 ack 交给同一个前台/焦点守卫；没有从 timer 持续检查就绪。

## 机器验证

在 companion，Node 22.23.4：

```sh
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null
./node_modules/.bin/tsc -p tsconfig.test.json
node scripts/run-tests.mjs .test-dist/tests/activity-scope825-readiness.test.js
```

完整 tsc exit 0；**4 pass / 0 fail / 0 skip**。日志 `/tmp/cmspark-825-scope-ready-types.log` 与 `/tmp/cmspark-825-scope-ready-tests.log`。git diff --check 无错误。

测试直接消费当前真实 C# IsReady body、整段每窗状态/事件接线及实际 resize handler，只适配 C#/JS 的变量类型和事件端口；没有重写就绪守卫。控制了未 render、无前台、无键盘焦点、事件先后两种顺序、排程后状态改变、旧窗口迟到、一次请求/一次回执、resize 实际 layout 后再过门，以及原始 false-ready 反例。

CPU 证明的是夹具逻辑与事件汇合，不冒充 WPF/Win32 原生结果。本机没有 Windows Framework 编译器；Windows 编译与原生链路待 B 非作者/GLM 通过后的既有验收。守卫只保证发布时刻的事实，不承诺发布后前台永不变化；原 Probe PID/HWND 断言必须继续拒绝后续变化。

当前状态：MACHINE PASS；待非作者复核，不由作者自评放行。
