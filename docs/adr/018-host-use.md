# ADR-018: Host Use（宿主读写）与 Apps 白名单

**日期**: 2026-07-28  
**状态**: **Implemented / Accepted**（产品 0.3.0；macOS / Windows 主路径；Linux 部分 pending）  
**用户指南**: [host-and-apps.md](../host-and-apps.md)  
**相关**: [ADR-017](017-computer-use.md) · [ADR-010](010-tiered-privilege-godmode.md) · Confirm Center

> **过程史（非唯一规范）**：`docs/decisions/host-adapter-interface.md`、`targetid-format-*.md`、`w7-trusted-apps-*.md`、`w8-biometric-*.md`、各平台 RUNBOOK。现行行为以本 ADR + `companion/src/host-use/` · `apps/` 为准。

---

## Context

Agent 需要在浏览器之外访问本机应用数据（邮件预览、笔记创建、受限文件移动）并启动用户指定应用，但不能变成任意 shell 或未授权进程控制。需要跨平台可适配的最小接口与统一安全门。

---

## Decision

1. **HostAdapter 最小面**：`listReadTargets` / `readOne` / `writeOne`；**opaque TargetId**（LLM 不得伪造；须 `validateTargetId`）。  
2. **Phase-1 kinds**：以 `mail-inbox` / `note` / `file` 等已验证路径为主；未实现 kind 返回 typed error。  
3. **LLM 工具**：  
   - `host_read` — L2 后读（平台实现差异大：Mail / Outlook classic 等）；  
   - `host_write` — create/move 等；**每次写生物识别或 6 字 nonce**；  
   - `host_app` — 仅 `launch` 无参；依赖 Apps 白名单与 per-app policy（auto / ai / manual）。  
4. **Apps**：`apps.enabled` 总开关（配置权威）；Side Panel Apps 面板管理候选与条目；全局开关 UI 只读镜像。  
5. **黑名单 / vault**：密码管理器与高危路径拒读写；与 Computer Use 结构排除互补。  
6. **平台**：darwin（Swift/AppleScript）、win（PowerShell/COM/UIA）、linux（部分 RUNBOOK / nonce，写路径受限）。  
7. **与 workspace/shell 分离**：目录沙箱用 `workspace_*`；自由命令用 `shell_exec`（enterprise）；Host 专注应用语义 API。

---

## Consequences

- **正向**：结构化本机能力可确认、可审计；接口小利于多端对齐。  
- **负向**：各 OS 应用碎片化（New Outlook 等不支持）；用户需维护白名单。  
- **维护**：新增 TargetKind 须 ≥2 平台实装后再升契约；过程 interface 文档可落后于代码字段。

---

## Code map

| 路径 | 职责 |
|------|------|
| `companion/src/host-use/` | host-adapter、darwin/win/linux、blacklist、nonce、thread-approvals |
| `companion/src/apps/` | enumerate、launch、guards、biometric-gate、handlers |
| `companion/src/server.ts` | L2 门与 host_* 执行调度 |
