# #826 cross-platform path harness — actual GLM incremental source gate

- Verdict **APPROVE**, confirms B source approval; no blocker.
- Base `8aa98dbb2b65041b92c9d847c95dd616efaa3d8d`; source `companion/tests/activity-failure-observation-826.test.ts`.
- Source SHA256 `e54d4ac877287d50f5e237195a14ec070ab4b9509e71c7fba9d0d7fab8657f2a`; full diff SHA256 `0832f67033d3ecac6a26be2778762f2b239281d9eab082e8a57f45d5fdcb0313`.
- Prompt SHA256 `6b8a2ae2778f4097269738f495e54442e24180d46956205b7dec92df17e76baf`; 102051 bytes.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, host `open.bigmodel.cn`, exit0/is_error false, one tool-free turn; duration `76903ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 26520, "outputTokens": 5182, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.26215, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Only harness same-root/pathApi construction and explicit posix/win32 coverage change. Original failure priority/parse/close/abort identity/cleanup order and10s/90s/180s/business/controller/CI remain.
- Evidence: immutable8aa RED under win32/GREEN under posix, current actual bothGREEN, official19PASS0SKIP andstrictnoEmit. Original9businessPASS at8aa remains exact-head history, not a green overall job.
- Permission: frozen singlefile commit and changed-head canonical CI aftercoordgates; no retroactive8aa/native acceptance, newprobe, merge or release approved.

## Actual reviewer response (verbatim)

**结论：APPROVE（确认 B 的正式 SOURCE 批准，且仅限该批准范围）**

一、缺陷定性确认。两处失败均为 harness 路径表示缺陷，非产品/receipt/finally 缺陷：旧 fakeMap 键为 POSIX 字面量 `'/owned/failure.json'`，而真实提取的 receipt 以 `path.join(path.dirname(file),'failure.json')` 派生失败文件名，在 win32 下为反斜杠路径，Map 未命中后回退命中字面量 ready 键并 resolve，故 case10 的 failure-before-ready 断言按设计正确报 Missing expected rejection；case12 的 finally 期望串硬编码 `project:/owned/gui|headless`，与宿主 path 生成的 `\\owned\\gui` 严格 deepEqual 失败。Windows 日志、AST 绑定复现（8aa win32 双 RED、posix 双 GREEN）与因果逐行吻合，无产品侧缺陷证据。

二、修复逐项核验通过。receiptHarness 新增 pathApi 参数并以它构造唯一合成根 `pathApi.resolve('owned-826')` 及 ready/failure/binary/spawn 写入键/renameSync 派生 response 路径全部同源；宿主 path 仍为默认（测试1保持原行为），测试2/3/5 显式遍历 posix+win32，满足“单根、全路径同一 pathApi、宿主默认+显式双 API”要求。断言零删除、零弱化：failure 优先于 ready、malformed 按 error.name==='SyntaxError'、close 事件、abort 以 `error === primary` 同一对象断言、`['clearTimeout','watch.close']` 与 `listenerCount('close')===0`、10_000 定时器、六阶段集合与 PRIVATE→UNKNOWN、launch/control 的真实 receipt825 集成（仅包裹记录 args[3]，timers=5、close=1）、finally 精确顺序 kill→closed→gui→headless→diagnostic→remove→settled 及 throwing 短分支、主错误穿透，全部逐字保留。期望串由同一 pathApi 派生属构造侧统一，不是对实际产品输出的归一化；fake 优先级 receipt 数据未改。测试1终检改用 h.readyFile，文件内已无残留 POSIX 路径字面量假设。

三、范围与证据链。diff 仅触及该单测试文件；activity-apps-825.test.ts、两个 C# fixture、observation.cjs、scope native/helper、CI workflow 按绑定 SHA 与 8aa 逐字节一致；inverse 的 d94 基线 SHA 钉与 90s/180s 门未动。独立核验闭环成立：不可变 8aa 双消费者 win32 RED/posix GREEN；当前冻结文件在外层 win32 与 posix 端口下全 GREEN 且内层双循环真实执行；官方隔离运行 19 PASS/0 FAIL/0 SKIP；strict noEmit 通过；末次仅缩进快照无语义差异。未发现任何新增探针/输入/诊断、产品/CI/超时/清理语义改动，或以 CPU 结果冒充 Windows 验收之处。

四、批准边界。本 APPROVE 仅授权单测试文件提交与协调后变更头的 canonical CI 全门通过流程；不构成 8aa 追溯绿、native 验收、合并或发布授权，亦不重开既定议程。8aa 原九项业务通过仅属该精确头的事实，新头仍须完整 canonical 门通过后方可接受。
