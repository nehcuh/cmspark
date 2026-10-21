# 桌面用户终端（#476，0.6.14 开发候选）

这是原生工作台的终端切片，不包含新的工作目录选择器或桌面编程 Agent 适配。对话必须已有明确绑定的工作目录；没有可用目录时显示不可用，本页不猜目录、不创建默认目录、不修改模块配置。桌面 Agent 入口尚未交付，不代表当前机器没有配置 Agent。

在对话列表打开“用户终端”后，先核对当前对话和目录，再明确请求原生确认。可信系统对话框显示实际起始目录、用户 shell 和参数。用户 shell 可以执行命令、访问用户环境并离开起始目录，不是 OS 沙箱。该确认不授予对话模型读取终端尾部的权限。原有单 PTY 的运行／退出中槽、输入序号、流控、所属连接和 Stop 规则继续生效。

终端内容只在原所属界面显示，不自动保存或回传给模型。只有明确选择显示内容并另行通过原生确认，才将标为“用户选择的终端摘录／partial”的内容保存到原对话；它不证明命令成功或已验证结果。丢回执时重新核对原对话历史，不自动重做写入。切换对话不改变运行归属，断线或原生文档退休会停止该 owner 的操作，不恢复旧操作控制权。

当前源码／CPU 控制不是真实终端或人工批准证明。发布前仍需独立新 head 的 Windows/macOS 真实 PTY、键盘、原生确认、Unicode 输入输出、resize、Stop／实际退出、摘录与历史重开验收。旧 PR705 的 picker/XCTest/ACP 完整原生失败、取消和焦点断言均保留，原因仍 UNKNOWN；本切片不以跳过这些失败或降低预算宣称完成。#476 整票仍部分完成，未发版或安装。

远端验收载体位于现有串行 `desktop-native-thread-metadata-476` 文件，独立 `acceptance/terminal` 测试宿主由 `build-desktop-native.mjs --test-fixtures` 构建；Windows canonical 与既有 macOS 原生步骤会执行该回调。它只允许 GitHub Actions 的对应系统与 canonical owned 数据目录，手工本机启动会在原生载入前拒绝。验收中的系统窗口按钮／键盘为合成操作，不是人工批准；仍须以该新 head 的真实平台结果为准。


## #747 一次有界首拒观察（未出货验收夹具）

仅在独立 `acceptance/terminal` 夹具中，Windows C++ 与共享 form 将原拒绝出口附上闭集 `D476_TERMINAL_FIRST_W_n` / `D476_TERMINAL_FIRST_R_n`；原通用 FAIL、成功动作、权限、45秒与 cleanup 不变。正常产品 host／renderer／PTY 不带此观察逻辑。真人于2026-10-22批准的一次有界恢复，不新增重试或后续诊断次数。

`firstFailure` 是 Node 在原失败／abort／actual child exit／finally 首次封口前，观察到的第一个合法原生控制器锁存码；不是跨进程物理最早原因。`source` 绑定原公开 `ffe3514318883fc863bf2347093f328354ee841b` 的坐标。复合条件仍按原顺序／短路只求值一次：码只定位下表的原拒绝语句，**不能区分其中各个 OR 子项或断言某个 API 为根因**。例如 W14 仍可能是 current、foreground、typed 或计数保护；需相应真实证据，不能据此猜修或续加字段。

每个 form 至多送一个固定 R token；C++ 在既有 current/generation/flat-frame 保护后只锁存一次，向 Node 至多 best-effort 送一个固定 token（不超过32 ASCII字符）。失败不重发、不替换主错误。Node 只接受两个 own-data 字段 type/id、W1..28/R1..19；getter不求值（不承诺任意Proxy无trap）。新增 finally DTO不超过256字节，只有 schema、原源码commit、固定 origin/site 或 null；不带任意错误/HRESULT、路径、标题、命令/输出、PID或凭据。旧通用FAIL、输送丢失、格式拒绝、未覆盖的原异常均 UNKNOWN。诊断从不参与接受、权限或清理。

W4 的 payload throw 与 W8 的失效 owner 只能本地锁存：不存在安全 host 时不解引用、不查询新窗口或伪造回执，因此 Node 可保持 null。W28 best-effort 后仍原 `ExitProcess(64)`，观测异常不得代替该退出。R7为原1/3/5穷尽状态分支后的保留 fallthrough，普通JSON日程不可达。共享form在Swift路径的额外 R token仍按原未知消息忽略，原FAIL保留；不声称Mac新增了等价观察。

| Windows code | 原拒绝出口（ffe351） |
| --- | --- |
| W1 | document-entry |
| W2 | script-completion |
| W3 | script-submit |
| W4 | payload-invalid-throw-no-safe-host |
| W5 | input-admission |
| W6 | input-queue-full |
| W7 | input-step-entry |
| W8 | dead-owner-no-safe-host |
| W9 | input-completion-fence |
| W10 | input-result-shape |
| W11 | input-result-parse |
| W12 | input-submit |
| W13 | key-kind |
| W14 | type-order |
| W15 | resize-order |
| W16 | resize-effect |
| W17 | confirmation-entry |
| W18 | confirmation-owner |
| W19 | confirmation-kind |
| W20 | confirmation-reveal-button |
| W21 | confirmation-after-reveal |
| W22 | confirmation-details |
| W23 | confirmation-decision-button |
| W24 | renderer-frame |
| W25 | renderer-key-order |
| W26 | renderer-receipt-order |
| W27 | renderer-done-order |
| W28 | terminal-exit64 |

| Form code | 原拒绝出口（ffe351） |
| --- | --- |
| R1 | key-target |
| R2 | key-focus |
| R3 | typing-trust |
| R4 | key-trust-order |
| R5 | selection-keyup |
| R6 | state-shape |
| R7 | state-order |
| R8 | open-thread |
| R9 | open-phase-result |
| R10 | textarea-missing |
| R11 | textarea-focus |
| R12 | output-decode |
| R13 | output-bound |
| R14 | ack-result |
| R15 | ack-order |
| R16 | resize-result |
| R17 | close-result |
| R18 | return-result |
| R19 | history-result |

永久 `desktop-terminal-first-failure-747` 执行实际 collector／C++ note 与完整 stock form 的受控拒绝；`desktop-terminal-webview-input-747` 的原29断言、原 script-install5及 pinned xterm6保留。CPU不是Win32／WebView／真实PTY证据。当前 ffe351 Mac terminal PASS、Windows FAIL以及旧705 picker/ACP欠账均保留；本候选本机原生未运行。源码两非作者、必要ARM及唯一changed-head真实诊断由root另外验收；若仍UNKNOWN，停止本条，不把观察合同当成功或整票完成。
