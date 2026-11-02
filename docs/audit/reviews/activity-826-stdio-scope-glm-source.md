# #826 compiler stdio + scope INITIAL — actual GLM-Claude source gate

- Unit1 compiler file-fd/stable-cwd: **APPROVE**, confirms B source review.
- Unit2 scope INITIAL finite observation: **APPROVE**, confirms B source review.
- Base: `64dbdaafda240f06cac21955e2a4a8ee163c8740`; five exact source file hashes are in the structured receipt.
- Frozen manifest SHA256: `00289155409eae6ef8b9376312e5429b9214c6e67f8a77ef2d083b765a2503b4`.
- Exact five-path cached diff SHA256: `844b73ab49b031b7d3015bd8a64031a8a68d346e01b6227eb6151d582cab1f69`.
- Prompt SHA256: `a6ebdf9e41d66d015e1dac34b5450084e2ee180c7aede195753aa074d2c586d9`; 194838 bytes.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, provider host `open.bigmodel.cn`, process exit `0`, is_error false; one tool-free turn, duration `185571ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 49687, "outputTokens": 12792, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.568235, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Explicit approval permits frozen test-only commit and one purposeful Windows CI after coordinator gates. It does not claim Windows/compiler/filesystem/scope success, historical cause, merge or release.
- Nonblocking reviewer note: the nominal CRLF finally-source test iteration is normalized back to LF. This weakens that coverage label; the model explicitly does not block approval. Do not cite that iteration alone as independent raw-CRLF extraction proof.

## Actual reviewer response (verbatim)

# GLM-Claude 独立源码复审 — #826 双单元（冻结5路径，base 64dbdaaf）

结论：**UNIT1 APPROVE、UNIT2 APPROVE**，均确认 B 的源码 APPROVE；未发现可达缺陷，各附边界。

## UNIT1 compiler filefd/stable-cwd：APPROVE（确认 B）

- 冻结 mjs 全文与 diff 后态一致（compiler fd 段、live 控制、826 扩充均在）；worker/header/fixture/scope helper 四哈希与批准基相同，同线/BigInt/UNKNOWN 控制未动。
- 原守卫保留：`built.error===undefined` 与 `built.status===0` 仍逐条断言，无二进制存在替代。stdio 为 `['ignore',fd,fd]`（两 wx+/0600 owned 文件），无 pipe/inherit；cwd=root，Windows `/Fo`/`/Fd` 显式 owned obj/PDB，cpp、`/OUT` 与 clang `-o` 仍 owned 绝对路径。
- 有限诊断：仅失败时每 fd 一次、position0、64KiB；readSync 异常被吞，不替换主错（826 控制断言 length===64*1024、position===0 与 reads 列表）。
- 局部 finally 关闭全部已开 fd，覆盖 first/second open、spawn throw、断言与 close 失败；`primary825===undefined` 才抛 closeFailure——主错优先、close-only 仍失败；外层 rmSync cleanup 优先级原样。
- live 控制为同 30s case 内真实已知子进程：IPC ready 携 cwd 并 realpath 比对 root；父先整目录 `rmSync(recursive,force)` 并断言 existsSync false、exitCode null，再发 write-after-rm；子回执后 `disconnect()` 自然退出，父验 status0/signalnull 并从保留 fd 读精确 READY/LATE 字节。事件驱动（message/close），无轮询、无新时限、无树扫描；失败仅 kill 自有 child 并 await close。30s/20s/6s/native20s 未变，`signal:t.signal` 沿用原信号。
- 826 AST 控制以实际 callback 体 × 两平台 × 8 故障运行：fsPort 显式 open/close/read 防提前 TypeError 伪通过；核 compiled 触达、cwd/timeout/stdio 数字 fd、Windows Fo/Fd、closed 全列表、读取上界、错误同一性、outer rmSync 一次；cleanup-only 断言保留。

边界：Windows 删除/晚写与编译行为待该门实跑，失败按原样保留；status0 仅直接命令返回，不认后代回收。

## UNIT2 scope INITIAL 有限观察：APPROVE（确认 B）

- 四路径冻结全文与 diff 一致。C# 复用 #758 模式：`Observed.Add` 每名至多一次、CreateNew pending→File.Move、Observe 全 try/catch；payload 仅 phase/sameSta，匿名表达式被 readiness 精确单次抽取并实际执行。
- IsReady 展开保序保惰性：Handle 取一次、Zero 比较不触发 GetForegroundWindow、focus getter 只在末位；128 组合对记录的原 guard 比返回值与 handle/foreground/focus 查询计数全等（正常+抛错 sink）。Activate/Focus 仍各一次原序，bool 编码为闭集名；requested/Dispatcher/50ms timer 不变。10s receipt helper 哈希未变；180s、业务断言、lease 原样。
- initial-only：InitialWindow 只在非 popup 设置；popup 无 SourceInitialized/Loaded 观察，ContentRendered/ReadyResult 均判 InitialWindow；InitialReady 只停资格观察，READY_WRITTEN 在 Write 成功后记录（测试断言 alreadyWritten 先真）。
- reader 闭集 18 名、恰 phase+bool 两键；missing/partial/foreign/`.pending`/字符串 sameSta 全省略为 UNKNOWN，非空才 OBSERVED，sameSta:false 保布尔。无产品改动、无放宽、无额外轮询。
- native finally 仅在 child close 后、rm/lease 前投影，整段 try/catch；实际 body 验证主错保留与 stop→kill→closed→project→remove→settled 次序，投影抛错不盖主错、不跳清理。

一条非阻断观察（源码可支持）：该测试 `replace(/\r?\n/g,eol).replace(/\r\n/g,'\n')` 使 CRLF 迭代被归一回 LF，"CRLF" 名义未真正施加；因抽取正则 LF 锚定、语义与 EOL 无关，仅覆盖标签弱化且真 CRLF 会响亮失败，不构成可达缺陷，不阻断。

## 共同边界

观察/reason 均为正向历史，缺失=UNKNOWN，不作终态或负面推断；不授权截图/ready。本批准仅许可冻结 test-only commit 及协调门后一次有目的 Windows CI；不声称 Windows 已通过、历史物理根因或 merge/release。未重开历史未知项或无关范围。
