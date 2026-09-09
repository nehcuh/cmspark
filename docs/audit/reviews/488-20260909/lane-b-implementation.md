# #488 协议修复交付

本子任务未 commit；未修改 ThreadList、样式、真实会话或真实配置。

## API

`mutateThreads(ids: string[], mode: 'trash'|'hard'|'restore'|'empty', signal: AbortSignal): Promise<{ok:string[],failed:{id:string,reason:string}[]}>`

- 50 条串行，请求 id 用 `thread-mutation:` + UUID；只将服务端完整相关回执算成功，runtime ACK 仅判传输。
- 正确响应类型、模式、ok/failed 的完整且不重复目标分区、计数与 deleted_ids 一致才接纳。
- 部分失败继续下一批；未知结果/传输失败/取消停止剩余批次；已确认前批成功保留；不自动重试。
- `unknown_*` 表示可能已完成、需重新核对；`not_sent` 表示未发送；`not_sent_unsupported` 表示 empty 能力探测未通过，提示升级 Companion。
- runtime 与 abort 监听器及定时器在各终结路径清理；整个调用跟踪断线，覆盖两批之间及探测后微任务空隙。
- 不改 store；UI 负责依据 ok 更新，展示失败/未知并刷新当前视图。

## 修改文件

- `chrome-extension/src/sidepanel/utils/thread-mutations.ts`：以上协调器。
- `chrome-extension/src/background/index.ts`：delete/batch_delete/restore 强制已连接，保留 id、only_empty/probe，返回真实 send 结果；推送连接状态供在途操作停止。
- `chrome-extension/src/sidepanel/hooks/useWebSocket.ts`：managed batch/error 不走旧的全局 reducer/error 逻辑；managed restore 不触发默认非回收站列表刷新；legacy 路径保持。
- `companion/src/message-router.ts` / `companion/src/ws/validate.ts`：已有 batch_delete 的只读 `probe:'only_empty',thread_ids:[]`，新返回 `thread.batch_delete.capabilities`；only_empty:true 的 hard 请求逐项重新检查 busy、trashed、真实 message 长度。默认 legacy 操作不受影响。
- `chrome-extension/tests/thread-mutations.test.ts`、`tests/fixtures/thread-mutation-responses.ts`、`companion/tests/thread-empty-mutation-488.test.ts`。

## 真实载荷来源

`capture-mutation-payload.ts` 使用临时真实 ThreadManager 与生产 handleMessage，输出 trash/restore/hard/capabilities，已运行后固化为 fixture。WS `lifecycle.ts:1472` 加回 request id。没有假设 restore 存在 mode/ok；测试有相应负向断言。

empty 每次先空目标探测：旧服务端只会因 empty targets 返回错误，永不收到真实删除目标。探测错形状、缺 id、超时、断线都不执行删除；能力不跨连接或调用缓存。

## 验证

- `nvm use 22` 后运行 `tsx --test chrome-extension/tests/thread-mutations.test.ts companion/tests/thread-empty-mutation-488.test.ts companion/tests/thread-batch-delete.test.ts`：32 项通过，0 失败。
- 覆盖 102 条 50/50/2、局部拒绝、错 id/mode/type/target、重复/缺项、计数不一致、ACK 先到/回执先到、超时保留前批、abort、断线、listener 清理、后台真实生产分支离线不发送、empty 旧服务端与新服务端负例、确认后内容改变不得删、trashed/busy 不得删。
- Companion 与插件 `tsc -p tsconfig.test.json --noEmit` 均退出 0。
- `git diff --check` 通过。
- 未运行全量 npm test，以免与主代理 .test-dist 相互覆盖；主代理接续真 UI、完整回归和外部复审。
