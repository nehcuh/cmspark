# 502-E 舰队 Glance + Inspect Implementation Plan

> GitHub: #502 · Spec §6 · Kimi `out-kimi.md`
> Blast: **T2** · 不新 BottomBar · 不做 Observatory · 不解禁 worker `run_progress_propose`

**Goal:** Glance 一行能看到最近工具名；点开一只 worker 能看任务简报 + 当前工具 + 可选短 token 窗，不必切走主对话。完整 system prompt 不进侧栏。

**Architecture:**
- Companion `FleetWorkerView` 加 `latest_tool?: string`（该 worker 线程最后一条 tool 的 `tool_name`，无 stdout）。
- Glance：现有 FleetStrip 在 FocusBand 一行追加最近工具（有 `llm_active` 的那只优先）。
- Inspect：`FleetWorkerListPortal` 行内展开，**默认不** `SET_ACTIVE_THREAD`。「进入子任务」仍切线程。
- Live token：**禁止**把 `shouldApplyStreamEvent` 放宽到主 `SET_STREAMING`（会污染当前对话气泡）。新增 `inspectedWorkerId` + inspect buffer；仅当 `msg.thread_id === inspectedWorkerId` 时更新 buffer。不转发 `tool.progress` stdout_tail。

**Tech Stack:** companion fleet snapshot · extension FleetStrip / FleetWorkerList · node:test

**NEVER:** overlay Allow/Deny；新 BottomBar Tab；默认展示 composed system prompt；解禁 worker run_progress；百分比进度条；把 vis 调试器塞进 320px。

---

### Task 1: latest_tool 快照（TDD）

**Files:**
- Modify: `companion/src/orchestrator/fleet.ts` `FleetWorkerView`
- Create: `companion/tests/fleet-latest-tool.test.ts`

从 `tm.get(id).messages` 倒序找 role=tool 或 assistant.tool_calls 的 tool_name。取最后一条名字。无则省略字段。

- [ ] 测试：有 click 则 latest_tool=`click`；空线程无该字段
- [ ] Commit `feat(fleet): latest_tool on worker snapshot (#502 E)`

---

### Task 2: Glance 一行

**Files:**
- Modify: `chrome-extension/src/sidepanel/types.ts` FleetWorkerView
- Modify: `chrome-extension/src/sidepanel/components/FleetStrip.tsx`
- Modify: `chrome-extension/tests/now-band-321.test.ts` 或新建 `fleet-strip-latest-tool.test.ts` 源码/纯函数锁

FocusBand 一行仍 ≤80px。文案例：`3 worker · 1 锁 · 抓取:get_page_text`。无 latest_tool 时保持现状。

- [ ] Commit `feat(sidepanel): fleet glance shows latest tool (#502 E)`

---

### Task 3: Inspect 抽屉（不切线程）

**Files:**
- Modify: `chrome-extension/src/sidepanel/store/agentStore.tsx` 加 `inspectedWorkerId: string | null` + `inspectTokenTail: string`
- Modify: `chrome-extension/src/sidepanel/components/FleetWorkerList.tsx`
- Modify: `chrome-extension/src/sidepanel/hooks/useWebSocket.ts`

Inspect 展开一只：
- 任务简报：该 worker 在 `state.threads` 里第一条 `role=user` 的 content，截断 160 字。没有则 `worker_role_label`
- 最近工具：`latest_tool` + 锁
- token 窗：`inspectTokenTail` 最后 ~800 字，等宽 11px，默认收在「本轮输出」下
- 按钮：暂停/取消（现有）+「进入子任务」（现有切线程）

`chat.token`：若 `thread_id === inspectedWorkerId`，**只** `SET_INSPECT_TAIL`，不 `SET_STREAMING`。
`tool.start`：可更新 inspect 的 latest 名。忽略 `tool.progress` tails。

测试：
- `shouldApplyStreamEvent` 行为不变（现有 stream-thread-gate 必须绿）
- 新纯函数 `shouldUpdateInspectBuffer(tid, inspectedId)` 
- 源码锁：Inspect 路径不含 `SET_STREAMING`

- [ ] Commit `feat(sidepanel): inspect worker without stealing the transcript (#502 E)`

---

### Task 4: 验收

- [ ] ≥2 worker 时 Glance 可见最近工具
- [ ] 点开 Inspect 不切换 `activeThreadId`
- [ ] 主对话气泡不被 worker token 污染
- [ ] 无完整 system prompt
- [ ] overlay / BottomBar 零改
- [ ] 写 `E-DONE.md`

不在本 PR：Observatory 全页、kimi vis 级 wire 时间线。
