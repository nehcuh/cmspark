# #826 stdio/cwd + scope INITIAL — actual GLM-Claude design gate

- Unit1 compiler file-fd/stable-cwd: **APPROVE**.
- Unit2 scope INITIAL finite observation: **APPROVE**.
- Base: `64dbdaafda240f06cac21955e2a4a8ee163c8740`; no implementation diff existed.
- Prompt SHA256: `dc35675d76da1e10f83c029e6103b0c50e88c879306fd1c6e5ee157d5e2274a3`; 113012 bytes.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, endpoint host `open.bigmodel.cn`, exit `0`, is_error false; one tool-free turn, duration `105817ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 28256, "outputTokens": 7088, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.31848, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Approval permits each bounded implementation followed by machine, independent and actual source-GLM gates. It does not claim Windows cleanup/compiler/scope/CI success, historical cause, merge or release.
- Implementation note: extend the existing actual-callback fs mock for open/close and exercise fd cleanup paths; keep its original timeout/cleanup priority control effective.

## Actual reviewer response (verbatim)

# GLM-Claude 设计审查 — #826 两单元

## UNIT1 compiler file-fd/stable-cwd：**APPROVE**

机制证据链真实且可复核。Node22.23.4 官方 spawn_sync.cc/文档支持「直接子进程已退出、后代继承 stdio pipe 时超时仍报 ETIMEDOUT 且可与 status=0 并存」；实测日志精确复现：pipe 503ms ETIMEDOUT/status0/后代实际 alive，owned file fd 36ms 返回不等后代 EOF，独立复测 33ms 一致。真实 `node --test` 外层链 counterexample 决定性：inherit 时内层编译成功但外层 runner 803ms ETIMEDOUT，file fd 69ms 完整 PASS——这以真实受支持调用链排除了 inherit，选择 file fd 不是臆测。

Windows 事实未被预claim。libuv share flags 与 macOS 实验不冒充 Windows 证明；设计明确要求 live-descendant、完整 owned 目录 rmSync、late-write 控制经测试入口在 Windows 实跑，独立侧已在 macOS 真实执行该删除与晚写（PID 前后存活、删除成功、经已删 fd 读到晚写字节），只作为本地路径证据。

范围与守卫符合约束：单文件；原 `built.error===undefined`/`status===0` 守卫照旧，不以二进制存在替代；失败才读至多 64KiB、不等 EOF/不重试、诊断读失败不替换主错；初次/二次 open、spawn、断言失败各路径全关已开 fd；primary 与 cleanup-only 失败优先级保留；30s/20s/6s/native20s 不变；无树扫描/重试/等待框架。cwd 改稳定仓库 root 后显式 `/Fo`/`/Fd` 防 obj/PDB 落仓库，有 MSVC 文档支持；status0 仅指直接编译命令返回，实际 exe 执行仍是真验证。

一条实施注意（非 blocker，属验收已含项）：同文件内 826 CPU 控制的 fsPort 现无 `openSync`/`closeSync`，新 callback 在编译前即会抛 TypeError、主错优先级控制失真；落源必须同步扩展该 mock 并让 fd-close 控制为真——设计验收已列 fd close 控制，据此要求落实。

## UNIT2 scope INITIAL 有限观察：**APPROVE**

事实边界正确。实际失败仅 `OWNED_SCOPE825_RECEIPT_TIMEOUT_INITIAL`，不证明渲染/前台/焦点哪项未满足；观察只加正向历史证据，缺失=UNKNOWN、不得负向推断或由 reason 集推断终态。不回退 ContentRendered 即 ready、不重复 Activate/Focus、不放宽 10 秒。

守卫保真有真实对照证据：独立 probe 取实际 fixture 的真实 IsReady 体，7 条件全 128 组合逐位对比 HEAD 原体与插桩体，返回值及 Handle/GetForegroundWindow/IsKeyboardFocus 查询次数全等；抛错 sink 惰性；8 个 reason 全达且每种跨重复检查只尝试一次。现有 readiness 4 用例实跑 PASS。这证明分支插桩可实施且不改真值，不替代实现审查。

#758 模式为复用非泛化：固定闭集文件名、每名至多一次、CreateNew pending→原子 move、异常吞掉不改原判断；字段闭集 phase/sameSta/bool/enum，无 PID/HWND/文本/路径/原始错误。仅限已失败主窗 INITIAL，不为 popup/resize 加诊断；READY_WRITTEN 只在原 ready 写成功后记录，初始过滤不抑制该 post-write 标记（设计与独立复核均显式覆盖此坑）。RUN_ENTER/RUN_RETURN 包住原 `app.Run()`，Show-before-Run 差序保留，不暗示普适顺序。

清理与读序合规：仅在原 child close 之后、rmSync/lease 之前读取，无诊断等待；投影错不替代主错、不跳过清理；finally 保持 childclose→projection→rm→lease；观察不能产生 ready/ack 或授权截图。10s/180s、单次 Activate/Focus、50ms timer/Dispatcher 调度、全部业务断言不变；readiness CPU 消费者仅扩 ports 绑定 passive 观察叶，实际原代码继续执行。

## 共同边界

两项批准仅授权各自实施及随后机器/独立/source GLM 门，不构成 Windows 成功、CI/merge/release 或历史物理根因认定。若 Windows 门仍失败，保留真实失败，按新有限 error/status/观察证据继续定位，不加时、不 skip、不认旧因为已知。
