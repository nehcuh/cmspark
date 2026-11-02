# #826：scope825 初始就绪超时的有限观察设计

当前64db实际Windows native：MCP8121ms成功；Activity8PASS/1FAIL/0SKIP，唯一失败是scope825Receipt original10秒 INITIAL timeout。没有failure.json/childclose报告。该事实不证明WPF是否已渲染或哪项真实前台/焦点资格未满足。原scope gate是有意强化的真实资格，不能退回ContentRendered即成功、重复Activate/Focus、强制抢焦点或放宽10秒。

## 最小变化

只改未分发scope825 C# fixture、其原native finally投影以及真实readiness CPU消费者。不改产品、workflow、成功断言、surface lease、180秒用例、10秒单次receipt、原控制轮询/事件安排、原Activate/Focus次数。

复用已有#758有限观察模式：固定闭集文件名、每个点至多一次、wx临时文件→原子rename、异常吞掉且不改变原判断。UI同线程记录，Node仅在原child close之后、owned目录删除之前读取闭集投影；不等诊断、不新增worker/heartbeat/轮询。没有原始窗口标题/HWND/PID/文本/路径/任意错误进入投影。

观察范围只针对已失败的主窗INITIAL（不为历史已通过的popup/resize增加新诊断）。C#保存初始window引用与MainThread；主窗尚未写ready时尝试以下固定记录：

- RUN_ENTER、SOURCE_INITIALIZED、LOADED、CONTENT_RENDERED、READY_WRITTEN、RUN_RETURN各一次，字段仅phase和sameSta，复用#758形状。
- 原单次Window.Activate/Focus调用的返回bool，各固定一次；不再请求激活或焦点。记录失败仍继续原流程。
- 原IsReady每条现有资格的返回路径记录闭集reason（notRendered、notCurrent、notReceiptWindow、noPending、noHwnd、notForeground、noKeyboardFocus、qualified）；每种reason至多一次。保留原短路求值顺序与GetForegroundWindow调用次数，所有观察更新在返回前结束，不改变真值。reason只说明曾在一次检查到达该分支，缺失不是未发生，集合不是最后时刻状态。

观察文件仅供失败后解释，不能产生ready/ack、批准截图或改变业务。完整文件被读取且schema闭合才输出；缺失/破损/写入失败省略为UNKNOWN。ready_written仍在原ready写入成功之后记录。

## 有目的的验证

1. 当前已存在的真实C# gate/event CPU harness复用，扩大ports仅绑定新passive观察叶；实际原资格/事件代码继续执行，不用另写假gate。对比HEAD原guard与新guard全部受支持资格组合，返回值与OS查询次数一致；原单次activate/focus与queued-current-state/resize/pop逻辑保持。
2. 用真实观察producer/reader控制验证每点一次、bool/enum闭集、异常不改变原ready、malformed/foreign字段不输出、finally保持childclose→projection→rm→lease且投影抛错不跳过清理或替代主错。LF/CRLF真实源码消费者照常。
3. 独立agent先验证设计/原guard失败路径→实际GLM设计→实现机器→独立source→实际GLMsource，随后一次有目的CI读取事件/曾遇资格原因。若无法观察则UNKNOWN，不重新猜原因或放宽原门。

这是一批实际失败的有限test-only观察，不是Windows历史原因认定或产品修复。原生Windows成功仍需不跳过的完整9项真实业务验收。
