# enterprise 档提供 shell 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** enterprise 档始终提供 shell，不再有生效的 shell 电源；命令授权保持独立。

**Architecture:** `shellProvision` 只在就绪为 ready 时判断 provided。`repairShellProjection` 在 `getConfig` 建立缓存之后最多写一次，并用现有 revision 防止覆盖较新配置。`unknown` 时工具门拒绝且不进入 L2。下一次显式 `modules.list` 可以再试一次。

**Tech Stack:** Companion Node 测试、`handleMessage`、`checkShellScope`、扩展组件测试。

## Global Constraints

- 规格：`docs/superpowers/specs/2026-11-16-enterprise-shell-enablement-design.md`，基线 `da6046b3a3df391ec7ab3650c424b942ab5d785c`。
- enterprise 恒提供 shell。community 不可用。旧的 `enabled: false` 要迁移成 true。撤代码不自动恢复这次写成 true 的值。
- `shell_switch_removed` 拒绝 shell 的 true 和 false。netsec、appsec、devsec-workspace 的 `modules.set_enabled` 不变。
- `config.set` 只在请求体显式有 `config.modules.shell.enabled` 时整次拒绝。未知键继续被白名单忽略。
- 不改 L2、`security_token`、三旗、确认短语、命令 policy。不打开 netsec。不实现 Linux PTY / Whisper。
- `loadConfigFile` 不调用 `saveConfig`。修复不在 `getConfig` 内部。`saveConfigInternal` 深度大于 0 时不再开始修复。
- `checkShellScope` 是 `l2-admission.ts` 1205 行、发 token 之前的预检查。修复必须发生在这次 `checkShellScope` 之前或作为它的第一步，不能只放在 `shellExec` 拿到 token 之后。
- `modules.list` 且 `profile_receipt_protocol === 1` 在 `getModulesConfigSnapshot` 早返回之前也要修复。测试要打到这个分支，不能只覆盖普通 list。
- 设置助手只解释和导航，不发送 `config.set`、`modules.set_enabled`、`modules.set_profile`、`pack.apply`。
- 每个任务独立评审通过后才做下一任务。不要一次提交全部实现。

## 文件

- 新建 `companion/src/capability/shell-provision.ts`：纯投影、就绪、一次修复。
- 改 `companion/src/config.ts`：写入前投影，深度计数。不在 `loadConfigFile` 里写盘。
- 改 `companion/src/capability/modules.ts`：`requireModule("shell")` 与 `setModuleEnabled("shell")`。
- 改 `companion/src/capability/shell.ts`：`checkShellScope` 第一步修复。
- 改 `companion/src/message-router.ts`：两种 `modules.list` 都先修复。
- 改 `companion/src/message-router/handlers/config.ts`：只拒绝显式 `config.modules.shell.enabled`。
- 任务 2 再改 `pack-engine.ts` 的 `restoreTrustSnapshot`、`computeApplyBlocked`，以及 `acp/capability-context.ts`。
- 任务 3 再改扩展的能力档、场景页、失败导航和设置助手。

## 接口

```ts
export type ShellReadiness = "ready_provided" | "ready_not_provided" | "unknown"
export function shellProvision(config: { capability_profile?: string; modules?: { shell?: { available?: boolean } } }): "provided" | "not_provided"
export function shellReadiness(): ShellReadiness
export function repairShellProjection(): ShellReadiness
```

`shellProvision` 不读就绪。调用方先看 `shellReadiness()`。`unknown` 时不得把它的返回值当成可执行。

---

### 任务 1：投影、未知恢复、核心写入

**Files:** 上面列出的 provision、config、modules、shell.ts 的 `checkShellScope`、router 的 `modules.list`、config handler。

**独立测试：** `companion/tests/shell-provision-1.test.ts` 已先写红。实现前不要改这些断言。`setModuleEnabled("shell", true)` 和 `false` 都必须是 `shell_switch_removed` 且 shell 写入次数为 0。不可写目录必须出现一次 `config.json.tmp` 的 `EACCES`，然后 `checkShellScope` 才是 `SHELL_PROVISION_RESULT_UNKNOWN`。过期 revision 用 `saveConfig` 的第三个参数触发 `CONFIG_REVISION_CONFLICT`，缓存和磁盘保留较新的 `trusted_domains`；随后的 `checkShellScope` 也不得回滚该字段。

- [x] 跑红：`npx tsc -p tsconfig.test.json && node --test .test-dist/tests/shell-provision-1.test.js`，确认失败原因是旧行为。
- [x] 按规格实现任务 1 的最小生产代码。`checkShellScope` 在读命令策略之前调用 `repairShellProjection`。协议 1 的 list 在 `getModulesConfigSnapshot` 之前调用它。普通 list 也调用。
- [x] 同一测试变绿。再跑相邻的 config、shell、pack 套件。
- [x] 提交并停下来做独立评审。通过前不开始任务 2。

### 任务 2：pack 与 ACP 文案

**Files:** `restoreTrustSnapshot`、`computeApplyBlocked`、`buildCodingHandoffContext`。

- [x] 先写失败测试：enterprise 快照里 shell 关闭不被当成已恢复；`unknown` 时 apply 返回 `SHELL_PROVISION_RESULT_UNKNOWN`；Linux community 提示不含「启用 shell」。
- [x] 看到红之后再改这三处。netsec 的 `setModuleEnabled` 返回值不再被忽略。只列出 `shell_exec` 的场景不会被误挡。
- [x] 变绿后独立评审。通过前不开始任务 3。

### 任务 3：扩展界面与助手

**Files:** `capability-profile.ts`、`CapabilityProfileSection.tsx`、`PacksPanel.tsx`、shell 失败导航、设置助手的服务端文案和扩展导航。

- [ ] 先写组件测试：确认文案、场景页没有 shell 开启按钮、未知只发 `modules.list`、助手两句受控文案且导航不发四种写入。
- [ ] 看到红之后再改界面。
- [ ] 变绿后跑扩展全量与 Companion 全量。独立评审通过，并且该 head 的 CI 全部成功之后，才由主对话合并。局部变绿不合并。

## 规格自查

- 规格里的 enterprise 恒提供、community 不可用、旧 false 迁移、`shell_switch_removed`、白名单、netsec、L2、助手导航、未知拒绝和有界重试都有对应任务。
- 没有占位句。接口只有上面四个导出。
- `l2-admission.ts` 1205 与协议 1 早返回已写进任务 1，不留到 token 之后。
