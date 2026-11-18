# 迟到 modules.list 不盖过已落定档位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本组件自己早先发出的 `modules.list` 不能在切换落定、等待、断线或 15 秒超时之后改写显示档；空闲时没有 id 的 list 仍能刷新。

**Architecture:** `CapabilityProfileSection` 挂载时 `sendMessage({ type: "modules.list" })`，没有 id。断线时 `releaseAttempt(..., true)` 和 15 秒未知超时同样再发一条没有 id 的 list。失败时 `releaseAttempt(..., false)` 不发 list。`companion/src/ws/lifecycle.ts` 用 `{ ...response, id: msg?.id }` 回显；请求没有 id 时，序列化后的回执也没有 id。`message-router.ts` 的普通 `modules.list` 响应本身不带 id。`ShellProvisionRow` 的「刷新本机能力列表」也是没有 id 的 `modules.list`。`PacksPanel` 挂载时同样发一条没有 id 的 list。因此不能把「没有 id」一律当成无效，也不能只拒绝测试里写死的陌生 id。`config_revision` 是不透明的 `epoch:sequence`，本修不比较它。

**Tech Stack:** Chrome 扩展 React 18、`chrome-extension/tests/shell-provision-receipt.test.ts` 的 `mountSurfaces`、`node:test`、`tsc -p chrome-extension/tsconfig.test.json`。

GitHub: #853

## Global Constraints

- 基线 `55f82f93434b4d1dc6edf69412b16cbbdf923434`。不改版本号、tag、Release、CHANGELOG。
- `Refs #853`。本 PR 合并不关闭 #853。
- 不修改、不合并 PR #856，不触碰 PR #861。
- 不改变 enterprise 档恒提供 shell，不改变 L2、信任确认、自动批准、netsec 或命令授权。
- 不改 `modules.set_profile`、`setCapabilityProfile`、`shell-provision`、`message-router` 的 list 响应形状。
- 带当前切换 id 的 `modules.updated` 与 `modules.profile.result` 仍是唯一能结算该次尝试的权威回执。已退役的切换 id 不能改档。
- 不新增 revision 排序协议。

## 最小实现规则

1. 本组件自己发出的每条 `modules.list`（挂载、断线刷新、15 秒超时刷新）带一个新的字符串 id。失败路径不发 list。
2. 有效集只有本组件最近一次发出、且尚未失效的那个 list id。出现更新的本组件 list，或一次切换尝试结束（权威回执落定、错误、断线、超时、卸载），之前的本组件 list id 离开有效集，不能继续留用。
3. 带字符串 id 的 `modules.list` 只有在没有未完成切换、且该 id 仍是有效集里的那一个时，才改显示档。
4. 没有 id 的 `modules.list` 在有未完成切换时不改显示档。空闲时仍改显示档。这保留 message-router 的无 id 回执、`ShellProvisionRow` 刷新和 `PacksPanel` 的无 id list。
5. 残余：空闲时的无 id list 没有年代。它发生在权威回执之后，仍可能画出它携带的档位。本修不声称这种无关联广播有时序保证。本组件自己的旧请求不再走无 id 回执，所以它们的回显 id 失效后不能覆盖。

## 红测试怎样卡住「只忽略陌生 id」

测试从 `mountSurfaces` 记录的 `sendMessage` 取出真实 list 请求，再按 lifecycle 的回显规则组装回执：请求有字符串 id 才写入回执 id。当前生产请求没有 id，所以回执也没有 id。现有代码对这条回执执行显示更新，断言失败。只忽略从未发出的陌生 id 不会让这条回执失效，断言仍然失败。断言变绿只可能是：记录到的那次请求已经带 id，并且该 id 在落定、断线、超时或失败后不在有效集里。空闲、且从未出现在 `sent` 里的无 id list 仍必须能改档；拒绝全部无 id 会让这条基线失败。

## 关闭条件（本小修，不是整张 #853）

- 本文件新增的覆盖、等待、断线、超时、失败断言变绿。
- `shell-provision-receipt.test.ts` 里原有用例仍绿。
- 同 SHA 十项检查成功后由主对话合并。#853 保持开放。

---

### Task 1: 红回归

**Files:**

- Test: `chrome-extension/tests/shell-provision-receipt.test.ts`

- [x] 用组件实际 `sendMessage` 的 list 请求构造回执，不写死陌生 id。
- [x] 落定后重放该次挂载请求的回执，不能把 enterprise 改回 community。
- [x] 等待中重放该次请求、且回执带目标档，显示仍是切换前档；随后同一切换 id 的 `modules.profile.result` 仍落成 enterprise。
- [x] 断线和 15 秒超时分成两条用例。各自新增一条 list；新回执可以显示，更早那条请求的回执不能覆盖；已退役的切换 id 也不能改档。
- [x] 失败不新增 list，显示留在切换前档，退役切换 id 和更早的 list 回执都不能改成 enterprise。
- [x] 空闲无 id list 仍能从 community 显示成 enterprise。这条在当前代码上通过，用来守住合法刷新。

### Task 2: 关联本组件自己的 list id

**Files:**

- Modify: `chrome-extension/src/sidepanel/components/CapabilityProfileSection.tsx`
- Test: `chrome-extension/tests/shell-provision-receipt.test.ts`

- [x] 按上面五条规则改显示关联。不改 Companion。
- [x] 重跑 `node --test .test-dist/tests/shell-provision-receipt.test.js`。新增断言变绿，原有用例仍绿。

节点 0 只提交 Task 1。Task 2 等独立对抗 gate 通过后再做。
