# 迟到 modules.list 不盖过已落定档位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 能力档设置里，一次已按请求 id 落定的切换不被更早发出的 `modules.list` 改回旧档；等待中的切换也不能被并发 list 提前显示成目标档。

**Architecture:** 根因在事件关联，不在某一行 `setProfile`。`companion/src/ws/lifecycle.ts` 已把请求 id 回显到响应（`{ ...response, id: msg?.id }`）。`modules.set_profile` 的 `modules.updated` / `modules.profile.result` 只有 id 与当前尝试一致时才落定。同一组件的挂载、断线 `releaseAttempt` 和 15 秒未知超时都会再发不带 id 的 `modules.list`，而 `CapabilityProfileSection` 对每条 `modules.list` 都改显示档，不管是否仍有未完成的切换、也不管这条 list 是不是本组件在最近一次权威回执之后发出的那一次。`config_revision` 是进程内不透明令牌（`epoch:sequence`），客户端不能靠字符串大小比较新旧。本修只给本组件自己的 list 请求盖上 id，并只采纳「当前仍有效的那一次 list」；带 id 的权威回执保持现有关联。不新增协议，不改 Companion 的 shell 提供、授权或档位写入。

**Tech Stack:** Chrome 扩展 React 18、现有 `chrome-extension/tests/shell-provision-receipt.test.ts` 的 `mountSurfaces`、`node:test`、`tsc -p chrome-extension/tsconfig.test.json`。

GitHub: #853

## Global Constraints

- 基线 `55f82f93434b4d1dc6edf69412b16cbbdf923434`。不改版本号、tag、Release、CHANGELOG。
- `Refs #853`。本 PR 合并不关闭 #853。关闭 #853 还要满足票面其余完成句，包括设置助手解释与导航，以及失败时界面和后端权威状态一致。
- 不修改、不合并 PR #856，不触碰 `cursor/external-chat-asr-design-d8b3` / PR #861。
- 不改变 enterprise 档恒提供 shell，不改变 L2、信任确认、自动批准、netsec 或命令授权。
- 不改 `modules.set_profile`、`setCapabilityProfile`、`shell-provision`。
- 带 id 的 `modules.updated` 与 `modules.profile.result` 仍只结算当前未退役的那一次切换；错误 id、无 id、已退役 id、断线、超时和卸载后的迟到回执继续不能改档。
- 不把 `config_revision` 做成新的排序协议。若实现时发现必须改 Companion 响应形状或比较 revision 数值，先停下来报告，不擅自扩大。

## 关闭条件（本小修，不是整张 #853）

- 下面两条红测试变绿，且 `shell-provision-receipt.test.ts` 里已有的切换、失败、断线、超时和卸载用例仍绿。
- 同 SHA 的四条 workflow、十项检查成功后，才由主对话合并。
- 合并后 #853 仍开放，直到票面「界面与后端权威状态一致」整句被独立核验。

---

### Task 1: 红回归

**Files:**

- Test: `chrome-extension/tests/shell-provision-receipt.test.ts`

**Interfaces:**

- Consumes: 现有 `mountSurfaces()`。初始 list 把显示设为 community；`confirmSwitch()` 发出带 id 的 `modules.set_profile`。
- Produces: 两条必须先失败的用例。失败点必须是迟到或并发的 `modules.list` 改了显示档，而不是切换请求本身没发出。

- [x] 写「权威回执落成 enterprise 之后，更早的 community list 不能把显示改回 community」。
- [x] 写「切换尚未回执时，一条 enterprise list 不能提前把显示改成 enterprise；随后带同一 id 的 `modules.profile.result` 仍可落定」。
- [x] 在未改 `CapabilityProfileSection.tsx` 的树上运行，确认两条都是 `ERR_ASSERTION`。

### Task 2: 只关联本组件当前的 list 请求

**Files:**

- Modify: `chrome-extension/src/sidepanel/components/CapabilityProfileSection.tsx`
- Test: `chrome-extension/tests/shell-provision-receipt.test.ts`

**Interfaces:**

- Consumes: `chrome.runtime.sendMessage` 已有的请求对象，以及 lifecycle 对响应 id 的回显。
- Produces: 本组件发出的每次 `modules.list` 带唯一 `id`。组件记住最近一次自己发出的 list id。权威回执按现有 `finishCurrent(id)` 落定后，这次落定之前发出的 list id 失效。

- [ ] 挂载、断线刷新和未知超时刷新发出的 `modules.list` 都带新的 id，并成为当前 list id。
- [ ] `modules.list` 只有在没有未完成切换、且 `msg.id` 等于当前仍有效的 list id 时，才更新显示档和模块快照。
- [ ] 匹配的 `modules.updated` / `modules.profile.result` 继续按现有 id、`shell_provision` 和期望档位落定；落定后使此前的 list id 失效。
- [ ] 不改 Companion。不解析 `config_revision`。
- [ ] 重跑 `node --test .test-dist/tests/shell-provision-receipt.test.js`，两条新用例变绿，原文件其余用例仍绿。

---

节点 0 只提交 Task 1。Task 2 等独立对抗 gate 之后再做。
