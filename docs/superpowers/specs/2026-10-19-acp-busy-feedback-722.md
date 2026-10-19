# ACP busy 反馈不断轮：首个有限修复

GitHub: #722
Related: #728 (bounded-N ADR prerequisite), #607 (process non-overlap)
Base: 2152ab8945310e782f62c321eae470b17934a863
Status: IMPLEMENTED — root approved finite scope; independent source and hosted gates pending

## 已证问题

实际 `AcpManager.propose` 同线程第二次提案返回失败文案 `ACP_SESSION_BUSY`；实际 `executeCompanionTool` 该 case 丢弃结构信息，错误等级表未登记，两者使实际 adapter 停轮分支设 `shouldStop=true` / `security_halt`。隔离 CPU AST producer 为 11 控制 6 PASS / 5 FAIL，自然 exit 1。首次提案确实 offered；拒绝后没有新会话、runningCount 未增。全局已 running 的拒绝链同样不可恢复。该反例不涉及真实进程、有效 L2 token、人类确认、平台原生或模型。

## 本 slice 的可见行为

忙碌仍返回 `success:false`。模型得到有限 typed refusal 和下一步建议，当前轮可以解释并走其他路径，不因第一次 busy 就安全熔断。原同工具重复失败阈值与计数不豁免。

1. 既有 `runningCount >= 1` 门保留原位置、条件和失败语义，结构码改为 `ACP_CONCURRENCY_LIMIT`。
2. 既有 same-thread offered/running 门保留原位置、条件和失败语义，结构码 `ACP_SESSION_BUSY`。
3. 两码明确登记 `recoverable`；这是原 non_recoverable → recoverable 的有限可观察更正。不能添加全局 busy 文案启发式、generic severity mapper 或任意上游码降级。
4. 只对上述 typed manager refusal，经 dispatcher 保留 `error_code` 及有限 `data`，其他错误返回、授权与 owner 拒绝保留原等级。
5. 本线程 holder 只披露既有 `session_id`、`agent_id`、`state`（字段 `holder_session_id`、`holder_agent`、`holder_state`）；不披露 goal、workspace、prompt、report、token、thread ID 或 foreign session handles。全局 gate 若没有本线程 running holder，省略 holder 字段，只反馈容量占用。不得遍历并暴露另一线程 holder。
6. 建议动作只有有限常量：same-thread offered → `start_or_cancel_current_acp_session`；same-thread running → `wait_or_cancel_current_acp_session`；全局容量 → `wait_for_acp_capacity`。始终 `data_not_instruction:true`，无执行能力/授权自动复用。

## 容量与权限不变

不增加 `max_concurrent_sessions`，不允许更多 offered，不新增队列，不自动取消/开始/重放提案，不改 PTY、协议进程、默认 enabled=false、L2、worker HARD_DENY、owner、workspace containment。

追加已证已有缺陷：不同线程能先获得 offered，旧 start 没有独立 admission check。实际 start/CLI 方法的 CPU 惰性边界在 POSIX 与 win32 准备路径均出现两个 admission/runningCount2（不是两个真实进程或历史 Windows 根因证明）。Root 随后批准同组修复：原 session/cfg/server 检查后、runningCount++ 前同步检查既有 >=1，检查至递增间无 await。目标仍 offered/confirmed，拒绝携有限 ACP_CONCURRENCY_LIMIT；仅本线程 holder，可在原关闭释放后由新显式 L2 start 重试，无自动启动或排队。原 cancel/shutdown/真实 close 释放时序不改。原第一版14源码冻结和下一合同保留，不能回写成最初就含此修复。

#728 仍必须先决策新增容量/config、多 offered 与 PTY 多路复用。本组只修原固定1的缺失验证，不引入 bounded-N，不移除 propose 门，不弱化 #607 真实进程关闭断言。

## 原 #722 完成映射

本 slice 实现 A 的 typed feedback、同线程 holder 事实和既有固定1的 start 验证。原票 UI “待启动/本机 shell”语义、提示词、offered 生命周期、确认前忙碌说明及 multi-offer/config capacity 仍未交付；#722 保持 PARTIAL，PR 使用 `Refs #722`，不自动 Closes。后续 UI/生命周期仍可内部执行，不能统称外部阻塞。multi-offer/config capacity 必须等 #728 ADR，不能在本修夹带。

## 验证

永久纯 CPU production-source-coupled tests：首次 offered、第二次同线程拒绝 typed/recoverable/不停轮/不新增 session、全局已运行拒绝 typed/recoverable/不新增、offered 与 running 建议准确；同 owner holder 有限投影、foreign holder 无泄露；missing/invalid L2、worker、disabled、owner security、data-root workspace 拒绝不弱化；unknown errors 不降级。使用实际 manager.propose、dispatcher case、classifier、adapter stop block，构造/配置/auth seam 明确隔离；不把其称真实 Windows进程/L2/模型验收。

源码冻结后，必要 affected tests/build、fresh locked ARM、一组两路互盲非作者复审、精确新 head 四 CI。只重审改变的增量；不等待四个模型。Windows真实门禁失败阻止合并，禁止延时/skip/无变化重跑。
