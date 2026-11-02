# #826 activity existing-failure facts — actual GLM design gate

- Verdict **APPROVE**; scope exact12 reasons, Apps fixed6 timeout stages and fixed6 positive history each approved.
- Base `d94d5db5ce30aee7d047baea53c0bc503f766461`; no implementation diff.
- Prompt SHA256 `486b58c9fdbc9547c7f539305cc6763de1c0a70f2dd35cf606711be15c6ea14d`; 73754 bytes.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, host `open.bigmodel.cn`, exit0/is_error false, one tool-free turn; duration `99599ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 18300, "outputTokens": 6721, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.259525, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Implementation only. Preserve exact closed enums/UNKNOWN, original type/fence/Shutdown, single10s timers,10s/90s/180s/business/cleanup, fixed per-mode producer/reader paths and positive-history meaning. No new API/input/clock/sampling/retry/framework.
- Source models34PASS are not implementation/native acceptance. No historical cause, runtime acceptance, extra MCP probe, merge or release approved.

## Actual reviewer response (verbatim)

**结论:APPROVE(仅授权实现,不含运行时验收/合并/发布)。** 设计与三份现行源、d94实际失败及34控件逐项核对一致,未发现可达阻塞。

**A Scope(无阻塞)。** SetupOwnedClick源中恰为12条 `OWNED_SCOPE825_INPUT_<名>` 常量,含SHORT且SHORT仅在 `SendInput(3,…) != 3` 时抛出,与"12而非11、SHORT=插入数≠3"要求逐条吻合;控件对12常量做Set去重断言,防回退到11。改动仅为 `catch(Exception error)` + 在既有聚合type旁追加reason,switch对完整串精确相等,非前缀/模糊;PRECONDITION/WINDOW/CLIENT等复合谓词保持成组不拆子条件。原Observe(INPUT_REFUSED)、best-effort写、Shutdown(2)、return顺序在每种reason及UNKNOWN、含写失败抛出下与旧catch事件序列deepEqual,已实测等价;私有串经断言永不进入payload,无stack/HWND/PID/坐标/HRESULT/lasterror投影。setupComplete成功栅栏、无新增native API均保持。

**B Apps(无阻塞)。** 只改原NOT_READY超时错误为封闭后缀;派生receipt中 `10_000` 恰一次,六stage加UNKNOWN经真实定时器回调实测,clearTimeout/watch.close/close监听清理齐全;ready/failure/closed三条原路径前后实测相等,无新等待/重试/回退。两调用点封闭:launch由已有gui/headless定界mode,control传实际固定command,任意串仅映射UNKNOWN,永不反射原始输入;序列id不入错误。全源替换具备精确逆。

**C Apps(无阻塞)。** 六点插入位与源核对:MAIN_ENTER在Root赋值后分支前、RUN_ENTER紧邻app.Run(Window)前、SOURCE_INITIALIZED/LOADED为新增passive订阅、CONTENT_RENDERED在既有handler入口(先于ready存在性检查,正确)、READY_WRITTEN仅在ready Record返回之后(Record抛出则不写,语义正确)。复用758实际Observe体证明once-only且写失败全吞;MAIN_ENTER对headless同样产生,构成"仅共享main历史、不新增UI权威"。真实finally顺序kill→closed→project→remove→settled实测保持,投影抛出仍保留主错与清理;reader沿用758/scope封闭校验(缺/畸形/外来→UNKNOWN/缺省)。

**实现期必守(均为设计已述内容的落地条件,非新增范围):** ①派生receipt中的allowedStages在模型里由宿主注入,实现须在函数/模块内自带该六个封闭标签常量;②Apps源当前无MainThread/Observed/Observe/RecordObservation成员,实现须按758样式补齐,且MainThread捕获严格先于首个MAIN_ENTER观察;③生产者文件名前缀须为固定常量并与reader严格配对,位于gui/headless既有固定子目录,不得任意路径/字段;④按验收要求加LF/CRLF源消费控制并保留全部旧input/fence控件、10s/90s/180s预算、业务断言与surface lease。

**边界确认:** 本单元不扩展诊断面、权限、预算或输入;不对历史OS/SDK成因作任何归因,UNKNOWN即不支持分类;34控件是源导出受控叶模型,不构成已实现生产者/reader或Windows原生证明,不得以此冒充原生证据。批准仅开启实现及随后的机器/独立/源GLM审查,下一次有目的的changed-head真实Windows结果才是决定性证据;MCP20与发布包不在本门内。
