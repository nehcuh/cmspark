# MCP b585 snapshot — actual GLM-Claude source gate

- Verdict: **APPROVE**, confirming independent B whole-source approval; no blocker.
- Base: `b585eb6bc29baa2e2a0314dad2793de29a72209b`.
- Frozen source manifest SHA256: `477e43a4b22a3c0067e609fd4bc04fa43051f5b989a8b1065a21ec26df4d32a9` (11 exact source files; per-file hashes in JSON).
- Full base-relative review diff SHA256: `8d7b0073f6c6dfd83856d653db1a22207a1fe6f401e50704158be60f4181cd28` (new files included).
- Prompt SHA256: `150d047943fe09bdc47d3b22440c7e3cc8dcd307bf8f828476e410de9fbfb8b2`; 367193 bytes.
- Actual reviewer: Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, endpoint host `open.bigmodel.cn`; process exit `0`, is_error false, one tool-free turn, duration `151435ms`.
- Actual model usage: {"glm-5.3": {"inputTokens": 96636, "outputTokens": 11308, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.76588, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Exact approval: “无 blocker，确认 APPROVE。”
- Permission scope: frozen test-only source commit and one purposeful instrumented Windows CI after coordinator gates. This report does not claim Windows compilation/execution, historical physical cause, merge or release passed.
- Inputs include full11path source/base-relative diff, actual author/B reports, three design reports, actual non-sensitive177/22/BigInt2/compile logs, same-wire source experiments and sanitized main failure receipt. The local host-integrity pin, live config, private caches and raw local host suite logs are excluded.

## Actual reviewer response (verbatim)

# GLM-Claude 独立源码复审 — #825 MCP 独立快照（冻结11路径，基 b585）

**结论：确认 B 的 APPROVE。** 逐项核对冻结源码与全量 diff，未发现可达缺陷；B 唯一 blocker（全宽 receipt 身份）已实修为 BigInt 并有实机正/负控复验。以下为源码级证据。

## 1. 独立采样
`mcp-snapshot-825.h`：`start()` 用 `started.exchange(true)` 保证单次启动；worker detach、不 join。worker 仅 `GetModuleFileNameW` 自身模块目录拼固定 `mcp-startup-825.bin`，以 `OPEN_EXISTING|FILE_FLAG_OPEN_REPARSE_POINT|三共享标志` 打开（符合批准条件1）。头内 `sleep_for` 恰 1 处；`capture()` 为单次双版本稳定读、无自旋；测试断言 worker 体不含 `socket_lock|send(|PostMessage|DispatchMessage|while(`。UI 侧 `publish` 仅两次 `fetch_add`+原子写，无锁无等待。

## 2. 奇偶发布先于可疑等待
每个 hook 都是完整 `publish`（+1→change→+1），返回前版本必为偶。关键位点：`obApi773` 内 `api()` 在原 SDK 调用返回后、`wrapper()` 在 `obRecord773`（含 flush→emit→原 send）之后；`CallbackScope` 构造于 `DESKTOP_TEST_NOTE(controller_callback)` 之前；send 边界 stage2 在 `lock_guard` 之前、stage3 在持锁后、stage4 在 WinHTTP 调用前、stage5 携真实返回码——被测锁/send/SDK 等待期间版本恒为偶，可采样。`sendStage` 首行 `if(!kind)return;`，业务/认证 send（thread_local kind=0）零写入。

## 3. 真实选定 send 边界区分
CPU 驱动用实际生成的 `send/test_note/obApi/record/flush/两层 emit` 与实际 header。modes 0/1/2 线形状完全相同（`rows[0]==rows[1]==rows[2]`，8 串），receipt 分别为：stage6/resultKnown/无 ControllerEntry（wrapper 已离开、outer dispatch 已返回）；BOOT(kind2) stage4/无 WrapperLeave/resultKnown=false（末条 BOOT send 内）；phase(kind1) stage4/ControllerEntry=16（callback 已进入、最前 phase send 内）——三同线排程被真实区分。mode3 嵌套 COM pump 不锁 OuterDispatch（flags&32==0）；`outerDispatch()` 仅挂原 run() 循环 `DispatchMessageW` 之后且需 Armed 一次性。原调用计数逐项相等（WinHTTP/CreateEnvironment/CreateController/get_CoreWebView2/Navigate 的 split 计数断言），COM 操作数未动。

## 4. 文件身份 / 完整 receipt
helper 所有 receipt stat 显式 `{bigint:true}`，比较 BigInt `dev/ino/birthtimeNs`，`nlink===1n`、`size===128n`。增量测试用真实 native 写出的有效 receipt、仅控文件系统身份 leaf：`9007199254740992n`（并断言 Number 折叠确实发生）同身份 OBSERVED；path/handle 侧 inode 或 birthtimeNs 各差 1n 均 UNKNOWN 且在任何 `readSync` 前拒绝；恢复后再次 OBSERVED（identityReads=4）。既有 canonical 目录身份/copier 原样复用未重设计，符合"只修 receipt 身份"的窄范围。coherence：worker 先写完整 128B payload+`FlushFileBuffers`，再写 word31 commit；decoder 校验 commit/magic/status/采样窗（≤250ms 且 <deadline）/偶版本≤65536/reserved 全零/闭集枚举；Node 两次等长读取须一致并在读后复核身份；路径替换、截短 127、短 seed、无 writer、晚采样、WriteFile 失败、采样中版本变化（mode4/6）全为 UNKNOWN。

## 5. builder/wire/VM/finally 精确集成
builder 仅 `family==="mcp"` 分支读取并传入 header；selector 测试补绑定 fs/path/root 验证 mcp/local/其余 family 选择。`snapshotControl===undefined` 时原样返回——legacy 调用者输出零变化（diagnostics 测试 sampled=false 四组 host/fixture EOL wire 与旧完全一致）。825 变换严格叠加在 773 之后（锚点即 773 生成体），host×fixture×header 三层 EOL 全逆变换通过。VM 消费者把生成 flush 体的 `Observation observation825(2,…)` 绑定为 `observations825.push([2,…])` 并断言新旧 producer 差异恰为四行——真实消费者验证，非 import/tsc 替代。finally：snapshotRead 在诊断 try 内、`snapshotClose` 在 server 关闭之后 env 恢复/rmSync 之前且 try/catch 包裹；receipts 测试精确断言 12 步调用序，LF/CRLF×throw 下主失败与全部清理保持。资产复用 canonical 9 项清单并逐字节核对 canonical 产物（漂移即拒绝），未自造列表。

## 6. 原语义保留
`timeout:20000` 不变；deadline=入口+20s、target=deadline−1500（helper `putNumber(seed,4,deadline-1500)`、native `deadline-target==1500`、`deadline-clock<=20000`），严格早于既有 abort，finally 不 join/不等待/不加预算。业务断言、receipts、配置持久化、权限、surface lease、成功 close/exit 段零改动；产品 `DesktopHost.cpp` 与 binding 不在 11 文件清单内。快照仅 win32 启用，macOS 原路径不变（snapshot825 undefined→投影 UNKNOWN），观察不构成业务通过或授权依据。

## 语义边界（重申，非缺陷）
快照只证其采样瞬间；UNKNOWN 不作负面证明，不归因 WebView/SDK 内部或历史根因。本批准范围=该冻结测试单元 commit + 协调门后一次有目的 instrumented Windows CI；非 merge/release、Windows 通过或根因认定。Windows 原生编译/执行仍属下一道门。

**无 blocker，确认 APPROVE。**
