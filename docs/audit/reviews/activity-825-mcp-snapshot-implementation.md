# #825 b585 MCP 独立快照实施与机器核验

2026-11-03。分支 `codex/mcp-startup-observation-0.8.0`，HEAD 仍为 `b585eb6bc29baa2e2a0314dad2793de29a72209b`。实现按 B 与 GLM 已批准的 discrimination design；未 stage、commit、push 或发起 CI。本文是作者实施交接，等待 B 非作者复审和 GLM 源码门，不是作者自批。

## 最终行为

仅 Windows 未分发 MCP fixture 多一份独立快照。生产 DesktopHost、其它 acceptance family、原认证/业务/可见性/确认断言、原 COM 参数及调用次数、原 20 秒 deadline、surface lease 和原清理均保持。

UI 的固定数值 hook 只更新 `atomic<uint32_t>` 字段。每次 publish 的 odd/even 版本在离开 hook 前闭合；send/API/DispatchMessage 与磁盘、worker 等待都不在 publish 内。编译断言 uint32 原子 lock-free、字段自然四字节布局。callback 入口 hook 在原 phase send 之前；API5/7 原返回值、环境 callback 离开、API5 wrapper 离开、原 outer run-loop 的 DispatchMessage 返回、仅既有 BOOT/phase 的 socket-lock/WinHTTP/emit 边界均有有限数值标志。没有增加消息、SDK 调用、轮询或 UI wakeup。其它 send 的 thread-local kind 为零，不写诊断字段。

原 MCP case 入口预定原 20 秒预算前 1500ms 的采样目标；UI ready 后只启动一个同进程 native worker。worker 从自身模块目录打开既有固定 `mcp-startup-825.bin`，验证普通单链/非 reparse/128 字节文件及身份，读预置 seed；一次 sleep、一次双版本稳定采样，写固定 payload，完成 flush 后才写最后 commit。250ms 以外、太晚启动、采样时字段更新、写入失败或未完成都没有有效 receipt。worker 不 send、不获取 socket_lock、不调用 dispatcher，不 join、不在原 finally 增加 await/重试/时限。

Node 直接复用 canonical `copyOwnedAcceptanceAssets` 的完整 **9 项 inventory（7 runtime + 2 LICENSE）**，不自造列表。MCP exe 与这些资产复制到原 owned case 目录下独立目录；原源 assets 和 canonical native/assets 要逐项字节一致。固定文件 `wx+`/0600 预建，保留 fd 及 dev/ino/birth 身份。finally 在原位置读取一次尝试（两块固定长度一致读取及身份复核），只公开闭集数字；缺失、身份替换、短文件、破损、迟到、未 commit、更新中均为 `{status:'UNKNOWN'}`。观察不成为业务通过或授权依据。FD 在原 child/WS/server 清理后关闭，诊断异常不替换原失败。

输出 `snapshot825` 只有 UNKNOWN 或 OBSERVED；OBSERVED 字段为 sampleOffsetMs、version、flags、三个 uint32 HRESULT、callbackPresent，以及 sendKind/site/edge/stage/result/resultKnown。kind 1=既有 phase、2=既有 BOOT。stage 1=observation entered、2=before lock、3=lock acquired、4=before WinHTTP、5=WinHTTP returned、6=observation left。flags 由真实 header enum 定义；不记录路径、HWND、指针、正文、凭据、capability、URI 或任意错误文本。

## 精确代码范围

新增：

- `companion/tests/fixtures/desktop-476/mcp-snapshot-825.h`：原子状态与一次 native worker。
- `companion/scripts/desktop-mcp-snapshot-fixture-825.mjs`：仅已生成 MCP 的逐字节可逆 hook 插入。
- `companion/tests/helpers/mcp-snapshot-825.ts`：canonical copier 接线、owned file 与闭集读取/解码。
- `companion/scripts/tests/desktop-mcp-snapshot-825.test.mjs`：真实 generator/native worker/Node reader 的 CPU 控制。
- `companion/tests/fixtures/desktop-476/mcp-snapshot-825-posix.h`：仅非 Windows CPU 测试用的文件 API leaf；Windows CPU 测试使用真实 Win32 文件 API。

修改：

- `companion/scripts/desktop-bootstrap-observation-fixture.mjs`：只有显式传入 snapshot header 的 MCP 路径追加新变换；原默认 MCP、#773/#782 输出不变。
- `companion/scripts/build-desktop-windows.mjs`：仅 MCP 分支读取并传入 header。
- `companion/tests/desktop-native-mcp-476.test.ts`：Windows owned clone、预算 seed、原 finally 投影及 FD close。
- `companion/scripts/tests/desktop-bootstrap-observation-773.test.mjs`：真实 builder selector 补绑定 fs/path/root；通过既有入口 import 新 CPU test，无新增 CI 步骤。
- `companion/tests/desktop-acceptance-diagnostics.test.ts`：真实 producer body 的新有限 hook 绑定，旧/新 producer 各四种 host/fixture EOL 的 wire/负例控制。
- `companion/tests/desktop-native-receipts-476.test.ts`：真实 finally AST/源码消费者补新 reader/close 依赖，原主失败与清理纪律照常验证。

没有编辑已知 host-integrity 本地 pin、root 的 release/audit 文档、workflow、配置或版本。

## 实际机器结果

Node 22.23.4，当前 macOS。命令均在 `companion/`：

```sh
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null
node --test scripts/tests/desktop-build-windows-480.test.mjs
npx tsc -p tsconfig.test.json
node --test .test-dist/tests/desktop-acceptance-diagnostics.test.js .test-dist/tests/desktop-native-receipts-476.test.js
```

- 原构建契约入口 **177 PASS / 0 FAIL**，含新 2 项。日志 `/tmp/cmspark-825-snapshot-build-contracts-final.log`（最终 EOL 增量后重跑通过）。
- 全 Companion TS test 编译 **PASS**。日志 `/tmp/cmspark-825-snapshot-types-final.log`。
- 原真实诊断与 #476 cleanup 消费者 **22 PASS / 0 FAIL**。日志 `/tmp/cmspark-825-snapshot-consumers-final.log`。
- `git diff --check` **PASS**。

真实 C++ 控制使用实际新 header/worker、实际生成的 obApi/record/flush/两层 emit、实际生成的 Desktop send/test_note，以及实际 TS reader 和 AST 提取的 canonical copier。Json/WinHTTP/SDK 排程是受控边界；CPU clock leaf 固定了目标，避免把编译/进程启动耗时算成被测试的迟到条件，生产时钟未改。版本变化负控在实际 capture 的两次版本读取之间注入受控 UI 变动；WriteFile 负控仅在派生 CPU native leaf 失败。

实际证据：

1. 暂不投递 controller callback、末条 BOOT 的 WinHTTP 尚未返回、callback 已进入但最前 phase send 尚未递送，三者完整 wire 都相同（6 BOOT + 2 phase），独立 receipt 分别为 send 已离开/outer dispatch 已返回、BOOT stage4/未离开 wrapper、callback entered/phase stage4。
2. 嵌套 COM dispatch 负控不锁存原 outer run-loop marker；只有实际 outer hook 才产生 marker。
3. 采样 odd version、采样两版本变化、晚采样、worker WriteFile 失败、native 短 seed、无 writer 均为 UNKNOWN。
4. 真实 writer 的 payload 派生出的 magic/status/version/enum/reserved/commit/迟到/短读负例均 UNKNOWN；实际 owned path 替换和截短也 UNKNOWN；closed reader 为 UNKNOWN。
5. host LF/CRLF × 原 fixture LF/CRLF × 新 header LF/CRLF 全部逐字节 inverse 相等；SDK/send/Translate/Dispatch 原调用个数不变。
6. 原 VM actualBootstrapProducer773 消费者旧/新模式各四个 host/fixture EOL 均保持相同真实 wire/计数与原负例，且新 hook 参数来自实际 generated flush body；旧 #773 输出与 HMAC consumer 控制继续通过。
7. 原 finally 的 LF/CRLF、诊断输出异常与 FD close 异常控制，保留原主失败及全部原清理顺序。

这证明实现的区分能力及当前平台的 CPU/文件路径，不宣称 Windows WebView2 实际根因或 native PASS。仍需 B 非作者复审、GLM 源码门，再由 root 安排一次有目的的 Windows instrumented CI；不允许凭本机结果 tag。

## B 复审后的唯一 blocker 修正（追加增量）

B 亲证 Number Stats 会把不同的 64 位 inode 折叠为同值。本轮仅修新 receipt helper 及其对应测试：所有 receipt `lstatSync`/`fstatSync` 均显式 `{bigint:true}`，比较 `BigIntStats.dev`、`ino`、`birthtimeNs`，没有 Number coercion；普通单链和固定尺寸比较使用 bigint。既有 directory identity/canonical copier、binary source 检查、native writer、协议、业务与清理不变。

回归通过实际 helper 和实际 native worker 写出的有效 receipt，只有 receipt 文件系统身份 leaf 受控，canonical copier 仍使用原真实 fs：

- `9007199254740992n` 身份在 fd/path 两侧相同，实际 payload 为 OBSERVED；恢复相同身份后再次 OBSERVED。
- inode `9007199254740992n` 与 `9007199254740993n` 在 Number 中相等，但在当前 reader 中，path 端或 fd 端单独变化均 UNKNOWN，且任何 `readSync` 之前拒绝。
- path 或 fd 的 `birthtimeNs` 单独相差 1ns 也在 readSync 之前拒绝。测试同时要求 receipt 的每次 stat 确实使用 bigint 选项。

增量命令（Node 22.23.4，`companion/`）与结果：

```sh
node --test scripts/tests/desktop-mcp-snapshot-825.test.mjs
npx tsc -p tsconfig.test.json
```

定向 **2 PASS / 0 FAIL**；编译 **PASS**；`git diff --check` **PASS**。日志 `/tmp/cmspark-825-snapshot-bigint-fix.log`、`/tmp/cmspark-825-snapshot-bigint-types.log`。未重复无关历史通过检查，未 stage/commit/push/CI；已交 B 继续非作者增量复审。
