# MCP b585 discrimination — actual GLM-Claude design approval

- Verdict: **APPROVE**, authorizes implementation of this design only.
- Base: `b585eb6bc29baa2e2a0314dad2793de29a72209b`; no implementation diff existed.
- Prompt SHA256: `2cef4b41fdcc1effd4fd7312de4c9bcb1cdd384091697801b5353c14e14043a8` (74664 bytes).
- Actual model: `glm-5.3`; CLI `2.1.153`; endpoint host `open.bigmodel.cn`; process exit `0`; one tool-free turn; duration `104430ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 19180, "outputTokens": 7399, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.280875, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Exact approval: “批准按本设计实施”（仅此设计，附绑定条件）. Structured verdict is a faithful normalization, not an extra model response.
- This does not approve a historical cause, Windows/CI success, merge or release.

## Coordinator clarification

The reviewer’s condition4 asks that publication visibility be exercised by the real writer/reader. The proposed UI atomics and native worker share one process; the worker then writes the fixed file for Node. No cross-process shared-memory/mapping mechanism is proposed or required by this approval. Preserve the minimal mechanism and verify actual coherence/complete receipt consumption. Reuse the existing nine-entry asset copier unchanged (seven runtime files plus two licenses).

## Actual reviewer response (verbatim)

# GLM 独立复审结论：**批准按本设计实施**（仅此设计，附下列绑定条件）

依据：设计文档、B 独立 APPROVE、真实源码实验（含全序八串三轮复现）、`DesktopHost.cpp` 实际 `send/test_note`、#773 生成器、#476 消费者、#480 owned 目录/资产/receipt 机制。

## 必要性与可行性成立

三种排程在真实提取的产品 `send/emit/record` 代码上产生完全相同的线形状（6 BOOT+2 phase，全序一致），而独立原子状态确实区分三态：证明当前共享 WS 投影存在实际可达的共同盲区，无改动 rerun 无区分力。快照是对已复现盲区的最小观测，非假想边界框架。worker 不取 `socket_lock`、不 send、不进 dispatcher，奇偶发布闭合了 B 指出的“最相关阻塞态全成 UNKNOWN”风险。字段组恰好覆盖三排程加“send 已离开但 leave/dispatch 缺失”区间；仅闭集 enum/uint32/布尔，业务 send 不入状态，无 payload/路径/指针。

**“七项 assets”系笔误**：实际 `OFFLINE_ACCEPTANCE_ASSETS_480` 为九项（7 运行时+2 LICENSE）。必须原样复用导出函数与清单，禁止新建七文件子集。

## 可执行验收条件（须全部满足）

1. MCP 克隆调用现有 `copyOwnedAcceptanceAssets`，核对 `acceptance/mcp/assets` 与 canonical 构建产物一致；receipt 沿用 `wx+`/0600/固定尺寸/nlink==1/dev+ino 重读、`OPEN_EXISTING`+`FILE_FLAG_OPEN_REPARSE_POINT`，原生仅开自身模块目录该一文件。
2. 打点经生成器完成且全逆变换通过；原 API/COM 调用次数与参数逐项相等；产品文件零改动。
3. 发布/读取实测控制：更新中采样、短读、超界、迟到、writer 不可用、版本不稳、身份不符一律 UNKNOWN 且绝不判 pass；三真实源码排程下快照区分三态而线形状仍相同。
4. 跨进程可见性正控制：worker 读取路径必须经与 UI 写入一致的共享段语义（或等价 coherence），实测“已发布态能被 worker 真正读到”，防止 ReadFile 对 mapped 写的陈旧缓存造成假 UNKNOWN。
5. 目标 x64 `static_assert(is_always_lock_free)`，固定布局偏移自然对齐；odd/even 版本在进入被测 send/API/dispatch 前完成，读取为单次稳定读、无自旋；outer dispatch 标记只挂 `run()` 循环既有 `DispatchMessageW` 返回处，加嵌套 COM pump 不误锁存的负控制。
6. 采样目标严格早于既有 20s abort（按实际锚点校核，不止示例 +19s），记录有限目标/实际差值；达不到即 UNKNOWN，不改 timeout、不加清理预算、finally 不 join/不等待。
7. 诊断任何异常不替换原失败 guard、业务判据或 child-close/directory/lease cleanup；#773/476 真实消费者与完整 TS 编译保持，新增数值 hook 由真实消费者消费验证，不得以 import/tsc 通过替代。

## 语义边界

本批准仅授权按上述条件实施该设计：不构成 Windows 原生通过、本次 CI 失败的根因认定、无改动 rerun、merge 或 release 的依据；快照只证其采样瞬间，UNKNOWN 不得用于消红或归因 WebView/SDK 内部。
