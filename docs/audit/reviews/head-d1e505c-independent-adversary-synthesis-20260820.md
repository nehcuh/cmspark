# 三路独立对抗 — `main` HEAD `d1e505c`（含 #202）

**日期**: 2026-08-20  
**对象**: 拉取 `origin/main` 后当前 HEAD（PR #200/#201 已合，#202 关闭上一轮对抗发现）  
**方法**: 三路独立 agent 重读源码 + 重放攻击；不信任上一轮 APPROVE  
**本会话不得自评放行修复**

## 参与路

| 路 | 范围 | 裁决 |
|----|------|------|
| **A Security** | file cage + SSRF IPv6 + settings-web DNS + file: L2 skip | **APPROVE_WITH_NITS**（无 P0/P1；P2×3 XLAT/GCP FQDN/config.test 无 DNS） |
| **B Voice** | classic/continuous retry、abort ACK、V2 max-1 | **APPROVE_WITH_NITS**（生产 V1/V2 闭合；连续模式测试仍是弱 fake） |
| **C Vision/panel** | probe 缓存 lock-step、MinimalConfirm、echo 守卫、gate copy | **APPROVE_WITH_NITS**（无 P0/P1；unkeyed `detected` 与双缓存 destHost 残留） |

### 合成裁决

**SHIP.** 上一轮 critical/high（V1 锁死、V2 槽位、S1 IPv6 字面量、F1 `file:///C:`）在 HEAD 上均被独立重放关闭。本轮无新 P0/P1。P2 为 SSRF 同类遗漏（IPv4-translated / 尾点 GCP 别名 / `config.test` 无 DNS）与测试空洞，不阻断已合入的 #202。

## 已闭合（本轮重放）

| 原 ID | 攻击 | HEAD |
|-------|------|------|
| V1 | classic `resource_conflict` + 250ms 窗内 abort ACK | 不锁死；sid 先换再 abort；`reset()` 升 `loopGen` |
| V2 | stale abort 不放 max-1；late `end()` 丢掉 retry bind | 同 peer abort 释放 bound；identity-guard dropBound |
| S1 | `[::ffff:169.254.169.254]` / `[fd00:ec2::254]` / `[fe80::1]` | LLM + settings-web 均拦；NAT64 WKP / 6to4 亦拦 |
| F1 | `file:///C:Windows/...` | darwin 笼外硬拦；win32 `kind:invalid` 不 `path.resolve` 进 cwd |
| M2 | junction 逃出 home | ancestor realpath 笼子 |
| file L2 skip | `auto_approve_dangerous` + `localhost`/`*` | file: early-return，仍 HITL |
| DNS fail-open | settings-web lookup 失败 | fail-closed |
| M1 probe | 面板 unkeyed detected 驱动 composer | 面板忽略 unkeyed；keyed `{url,model}` lock-step |
| L4 copy | `files.example.com` 标成本文件 | 需 `local file` 或 `file:` 合取 |
| L5/L7/L8 | MinimalConfirm 误提示 / list echo / hostname 预算静默 | 已按合同修 |

## 本轮新发现（不阻断）

| ID | Sev | 路 | 摘要 |
|----|-----|----|------|
| S-XLAT | P2 | A | `::ffff:0:a9fe:a9fe` IPv4-translated 未进 `embeddedV4FromGroups`，LLM/`/api/test` 放行 |
| S-GCPDOT | P2 | A | `metadata.google.internal.` 尾点 FQDN 逃过精确字符串；settings-web 仍 DNS 拦，`config.test` 不拦 |
| S-NODNS | P2 | A | `assertLlmEndpointUrlAllowed` 纯字面量；`169.254.169.254.nip.io` 在 WS `config.test` 无 DNS 复查（存量） |
| B1 | 测试空洞 | B | `voice-local-continuous.test.ts` 仍弱 fake，退回 continuous sid-swap 测不红 |
| B2/B3 | low | B | 双击 stop 无测；streaming start-conflict 不 abort、不收槽 |
| C1–C3 | low | C | companion 仍认 unkeyed `detected`（测试/API 后门）；设置文案「最近一次探测」与 composer 预检可分叉；面板 draft probe vs companion 已存 config 双缓存 |

跟进（与 #202 文档一致、本轮再确认）：dangling-junction TOCTOU、in-home symlink 一律拒、`config.test` 无 DNS。

## 机器

- A：[executed] file-url-admission + llm-endpoint-url + url-cookie-admission + settings-web **66/66**
- B：[executed] voice-stt-session-service 18/18；voice-local-stt-adapter-ws + continuous 14/14
- C：[executed] 扩展相关 **78/78**；companion probe/likely-multimodal/config-test-keyed 绿；vision-pipeline 3 fail 为 OpenAI mock 环境，非 key 逻辑
