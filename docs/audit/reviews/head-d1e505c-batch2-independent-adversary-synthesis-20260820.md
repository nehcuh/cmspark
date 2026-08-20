# 三路独立对抗合成 — `d1e505c` working tree batch2

**日期**: 2026-08-20  
**对象**: `fix/head-d1e505c-adversary-residuals` vs `d1e505c`（未 commit）  
**内容**: HEAD d1e505c 残留 P2 收口（XLAT/GCPDOT/DNS/C1/voice 测）+ fzbcro `osascript_eval` 批准后二次硬拦 + 确认文案  
**方法**: 三路独立 agent 读 frozen patch + 活码 + 定向执行；不信任实现会话  
**本会话不得自评放行**

Frozen patch: `docs/audit/reviews/head-d1e505c-batch2-diff-20260820.patch`（三路均确认与 `git diff d1e505c` 字节一致）

## 参与路

| 路 | 范围 | 裁决 |
|----|------|------|
| **A SSRF/DNS** | XLAT / GCPDOT / classify DNS / request-path gate / settings-web / C1 | **APPROVE_WITH_NITS** |
| **B Voice** | continuous start-conflict fake、classic double-stop | **APPROVE_WITH_NITS** |
| **C L2/osascript** | 批准后 regex 二次硬拦、tokenless 短路、确认文案 | **APPROVE_WITH_NITS** |

报告：

- `docs/audit/reviews/head-d1e505c-batch2-lane-a-ssrf-20260820.md`
- `docs/audit/reviews/head-d1e505c-batch2-lane-b-voice-20260820.md`
- `docs/audit/reviews/head-d1e505c-batch2-lane-c-l2-20260820.md`

### 合成裁决

**SHIP with nits.** 无 P0/P1。声称的闭合均被至少一路 **[executed]** 重放。最高残留为 P2：`/api/testVision` allowlist 跳过 DNS 后仍 fetch；voice `delayMs` 未断言锁死；osascript APPROVE 回归测仅 Darwin 负载。均不阻断本 batch 的 Trust 方向（LLM 门更严；osascript 仍 L2 HITL，只去掉批准后的假拒绝）。

## 已闭合（本轮重放）

| ID | 攻击 / 缺陷 | 本 tree |
|----|-------------|---------|
| S-XLAT | `::ffff:0:a9fe:a9fe` SIIT | lexical+async IMDS；NAT64 公网 / `::1` 仍放行 |
| S-GCPDOT | `metadata.google.internal.` | `isCloudMetadataIp` 剥尾点 |
| S-NODNS / N1 | NXDOMAIN 标成 metadata | `LLM_ENDPOINT_DNS_ERROR` 与 IMDS 文案分离 |
| N2 | `localhost.` 不进 allowlist | `canonicalizeLlmHostname` 先于 allowlist/`isIP` |
| N3 | DNS 只绑 `config.test` | providers / vision / probe / lifecycle 请求前 `throwIfLlmEndpointBlocked` |
| C1 | unkeyed `detected` 驱动路由 | `void opts.detected`；keyed cache |
| B1 | continuous 弱 fake | start-conflict + macrotask；退 sid-swap 测红于 `:414` |
| B2 | 双击 stop 无测 | `stop(); 40ms; stop()` 打到 `stopChainInFlight` |
| fzbcro | 批准后再 `checkHighRiskExecution` 硬拦 | dispatch 只审计；L2 仍 forceConfirm |
| copy | 「若你已拒绝弹窗」套批准后失败 | 仅 `User denied` |

## 残留 nits（非阻断）

| ID | 路 | Sev | 摘要 |
|----|----|-----|------|
| P2-A1 | A | P2 | `/api/testVision` allowlist 跳过 DNS 后 fetch；chat/`/api/test` 已二次门。HTTPS 会撞 TLS |
| P2-A2 | A | P2 | `probeNativeVision` 自身无 DNS 门；唯一调用方已在双门之后 |
| P2-A3 | A | P2 | lookup→fetch TOCTOU / redirect 未钉 IP（存量 SSRF 类） |
| B-N1 | B | test | 删 `delayMs` B2 仍绿；当前 80ms 下 guard **是** load-bearing |
| B-N2 | B | test | retry sid 允许任意 `*-r1` |
| C-N1 | C | test | APPROVE 回归仅 Darwin 走到 dispatch；Linux CI 早退 macos-only |
| C-N2 | C | copy | `/你拒绝了/` 也能匹配 `不是你拒绝了`（今日有短接） |
| C-N3 | C | pre-exist | osascript `code` vs `expression` preview/bind 分裂 |

## 机器（对抗路自行跑，非实现会话自评）

- A：[executed] llm-endpoint-url + likely-multimodal + llm-connection-test + llm-provider-anthropic + settings-web **73/73** + live `tsx` probes
- B：[executed] voice-local-stt-adapter-ws + continuous **15/15**；sid-swap / delayMs / guard 变异在 `.test-dist`
- C：[executed] security-thread + files + security-gates **157/157**；gate-error-copy **4/4**

实现会话另有 companion 全量 3063 pass / 0 fail（另 23 skip）+ settings-web 19 — **对抗不得用该数字代替自己的执行**。

## Trust / ADR-020

```
Surface:      L1 LLM endpoint（更严）；osascript L2 仍在（无新 Surface）
L2-classes:   none new（osascript 仍在 L2_GATE_TOOLS）
Compose:      none
Autonomy:     single
Trust:        LLM/IMDS 单调变严；osascript 去掉「批准后再拒」不是 skip confirm
Channel:      community
```

VERDICT: APPROVE_WITH_NITS
