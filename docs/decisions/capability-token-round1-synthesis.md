# Capability Token Round 1 Synthesis — Grok + Pi-sub

> **Date**: 2026-07-24 · **Brief**: `capability-token-brief.md` · **Reviews**: `adversary-grok-capability-token.txt` + `adversary-pi-sub-capability-token.txt`
> **Verdict convergence**: both reviewers **APPROVE WITH REQUIRED AMENDMENTS** — direction (scoped token + LLM-as-compiler + deterministic runtime) is correct, but brief as-written would ship into a DSL trap and wrong migration order.

## TL;DR

两位评审在 6 个核心修订项上 **完全收敛**（high-confidence，必须落地）：

1. **Tray 确认 (B) 必须先于 capability token 发布**（独立 P0，1 周交付）—— 前台抢 bug 与权限重构解耦
2. **`if:` 表达式必须改为受限 AST**（`==`/`!=`/`in`/`matches`，zod 校验 AST 而非字符串）
3. **`allow` 中 `app:"*"` / `action:"*"` 在 schema 层硬拒**
4. **Token HMAC 签名**（canonical JSON + `ws_secret`）
5. **TCC 预检探针**（token 激活时探，fail-loud）
6. **编译器 LLM 是新隐私泄漏 + 新攻击面** —— 隐私 disclosure + opt-in 必须有

并在 4 项上独立强化（不冲突，互补）：
- 优先级规则写死：`deny > require_approval > allow > default-deny`
- session_trust **不得**自动派生 token
- 审计日志：per-action entry + hash-chain + 轮转
- review 疲劳检测（中位审阅时间 < 3s 警告）

## Q1-Q10 交叉对照

| Q | Grok | Pi-sub | 收敛结论 |
|---|---|---|---|
| **Q1** Compiler injection | (a)+(b) 必选，(c) 不可作主控；真正的风险是 compiler 输入若含 page/OCR/剪贴板 = untrusted 供应链 | 错问，应是「layered mitigations」：verb whitelist + compiler input = 用户原话 only（绝不带 page content）+ runtime LLM bound by token | **两方一致**：compiler 输入严格限定 user task verbatim + verb whitelist + zod schema；page-derived content 只能进 runtime LLM，且 runtime 受 token 约束 |
| **Q2** Verb 策略 | (c) Hybrid 但先窄：generic low-level + 全局危险动词 hard-deny | 错问，应是「runtime 能看到的 closed alphabet」；app-specific 是 compiler-side sugar，**desugar 后才持久化** | **互补**：runtime 只见 generic verb（`ui_click`/`ui_type`/`app_activate` 等）；app-specific verb 是 compiler 产物，desugar 后存盘（审计语义稳定） |
| **Q3** Region | (b) AX id 优先；(c) 仅展示；OCR/坐标 = fallback + 强制 require_approval | predicate 对象，运行时按可用信号解析（AX > OCR > semantic > bbox） | **互补**：`region` 改为 predicate 对象 `{kind, id, ocr_fallback?, label?}`；运行时按 fallback chain 解析；坐标不得作 allow 条件 |
| **Q4** session_trust | (b) 短期 fallback，(a) 目标完全覆盖；禁止 (c) 自动派生 | (b) coexist 一个 release，后 (a) deprecate；禁止 (c)，是 paper 警告的反模式 | **完全一致**：token 存在时 **完全覆盖**（不取并集放宽）；无 token 才 fallback；自动派生 = hard NO |
| **Q5** UX | (a)+(b) 主，(d) 有历史时；禁止 (c) 只看 deny | (a)+(c)+(d)；崩相同 app+action 仅 region 不同的行；**最坏动作 pin 到顶部** | **合并**：自然语言 bullets + 同类折叠 + 历史 diff + 最坏动作置顶 + deny/require_approval forward；YAML 永远不直接甩给用户 |
| **Q6** Re-compile | (d) drift-detect 主，(a) 新 user turn 默认新 token；(c) 时间窗需 scope 指纹一致才 reuse | (d) drift-detect + wall-clock 过期；禁止 recurrence 自动续期 | **互补**：drift-detect（action triple `（app, action, region）` 不被现有 token subsumed → 增量 recompile）+ `expires_in` wall-clock + 不自动 recurrence-renew |
| **Q7** Tray 顺序 | **(a) Before**，P0 事故 vs 2-3 周架构 | **(a) Before**，brief P4 是 Critical 顺序错误 | **完全一致 + 升级为 MUST-FIX**：Tray 作为独立 P0 |
| **Q8** 确定性边界 | 真问是「哪些输入进 match key」；只接受已解析 ActionDescriptor；resolution 失败 = block，不得 LLM 猜 | 「输出决定是否执行」必须确定性；OCR/AX 是确定性（pin 版本）；禁止 probabilistic gating | **互补**：resolution layer 产出 ActionDescriptor（deterministic）；matcher 只看 descriptor；compiler LLM 版本 pinned + hashed；OCR/AX 库同样 pin |
| **Q9** Audit | (c) Both；必含 `token_id, rule_id, action, decision, user_modified, compiler_hash, ts` | (c) Both；per-action 为合规真相源；加 `hash_chain_prev` 做廉价 tamper-detection | **合并字段集**：`token_id, rule_id, action, app, region_resolved, matched_rule_id, deny_eval, decision, user_modified, compiler_hash, ts, hash_chain_prev` |
| **Q10** Compiler down | (a) 默认 + degraded banner；(b) 过硬；(c) 高级可选 | (a) 默认 + 醒目 banner；(c) 走 config 暴露给 power user，不在默认 UI | **完全一致**：compiler 挂 = 降级到 per-tool 4-tier + 显式 degraded banner；hand-write token 走 config，不在 UI |

## Schema 修订（v0.2，合并两方）

```yaml
schema_version: 1
token_id: <uuid>
subject: <agent_id>              # sub-agent token MUST be strict subset of parent
issued_at: <RFC3339>
expires_at: <RFC3339>            # absolute, not relative
issued_by: <companion_version>
signed_by: <HMAC-SHA256 over canonical JSON, keyed by ws_secret>
compiler:
  llm_id: "deepseek-v4-flash@2026-07-24"
  prompt_hash: <sha256>
  input_hash: <sha256 of user's verbatim task string>
  user_modified: true|false
scope:
  session: <session_id>
  task: "<user's verbatim task>"
  purpose: "<inferred, user-editable, NOT used for match>"
budget:
  max_invocations: 100           # paper's "frequency" dimension
  max_per_minute: 20
  max_allow_rules: 32            # schema-level cap
allow:                           # closed, no wildcards
  - {app: <bundle_id>,           # MUST be concrete, NOT "*"
     action: <verb_enum>,         # MUST be enum member, NOT "*"
     region: {kind: ax_id|automation_id|role_label|ocr_text, id: <stable>, fallback?: {...}},
     text?: {eq: "..." | glob: "..." | regex: "..."},   # mutually exclusive
     max_count?: <int>}
deny:                            # wildcards OK here (verb-level glob allowed)
  - {app: <bundle_id|*>, action: <verb|verb_glob>}
require_approval:                # escalates despite allow
  - {app: <bundle_id>, action: <verb>,
     if: {field: <string>, op: eq|neq|in|not_in|matches, value: <literal|array>}}
# Evaluation precedence (documented in EBNF):
#   deny > require_approval > allow > default-deny
# Cross-references:
#   - sub-agent token MUST subset of parent (compiler rejects otherwise)
#   - token MUST NOT be auto-suggested from prior approvals (paper §6)
```

**关键变化**：
- `if` 从 string 改为结构化三元组
- `region` 从 string 改为 predicate 对象
- `text_pattern` 拆为 `text.eq`/`text.glob`/`text.regex`（互斥）
- 加 `max_invocations` / `max_per_minute`（paper 频次维度）
- `expires_in` 改 RFC3339 `expires_at`
- 加 `signed_by` HMAC
- 加 `compiler.input_hash`（用户原话证据）
- `allow` 在 schema 层禁止 `app:"*"` 和 `action:"*"`

## 迁移重排（v0.2）

| 阶段 | 内容 | 风险 | 阻塞条件 |
|---|---|---|---|
| **P-1** | **威胁模型 delta doc**：compiler LLM 数据流 + 隐私 disclosure + injection 攻击面单列 | — | P0 启动前必须完成 |
| **P0a** | **Tray 原生确认**（独立线，1 周）：Swift NSAlert + IPC `confirm` 子命令 + 最小 capability token 渲染（"will click X in WeChat"） | High（codesign cycle） | 解前台抢即时 bug |
| **P0b** | **Token 类型 + zod schema + 单测**（与 P0a 并行） | Low | — |
| **P1** | **ActionDescriptor 规范化层**：tool 参数 → 可匹配结构；此时还不接 compiler | Medium | P2 前置 |
| **P2** | **Compiler（constrained）**：verb whitelist + schema 校验先于 prompt；input = user task verbatim only | **High**（injection） | P1 完成且 schema 落地 |
| **P3** | **Review UI**：自然语言 bullets + 同类折叠 + 最坏动作置顶 + 历史 diff + 疲劳检测 | **High**（UX 疲劳） | 疲劳 telemetry 同步上 |
| **P3.5** | **Privacy disclosure UI**：首次跑弹"将发送任务描述到 <provider>"，opt-in | — | P2 之后立刻 |
| **P4** | **Enforce + metrics**：双跑期 log-only vs enforce 切换条件 + 回归矩阵 | Medium | — |
| **P5** | **Audit log hash-chain + rotation** + active-permission viewer + revoke_token 流程 | Medium | — |
| **P5.5** | **Deprecate 4-tier for host_computer only**（其他工具不动） | Medium | 保留 4-tier 作 fallback 安全网 |

## 收敛盲点（高优先级）

| # | 盲点 | 来源 | 处理 |
|---|---|---|---|
| **B1** | Compiler LLM 隐私回归（user intent 上云，当前 per-tool 模型不发送） | Pi-sub Critical / Grok Major | ADR + opt-in + redact PII + 默认走本地/可选 provider |
| **B2** | Compiler LLM 是新攻击面（clipboard / skill 模板 / page 都可能 inject） | Pi-sub Critical / Grok Critical | compiler input = user verbatim only；system prompt 禁 wildcard；schema 硬拒 `*` |
| **B3** | Review 疲劳 → 盲批 → 退化成 auto_approve with fig leaf | Pi-sub Critical / Grok Major | 审阅时间 telemetry；<3s 中位告警；危险 verb 强制二次 |
| **B4** | macOS 26 Tahoe TCC 是 bundle-level 问题，token 解决不了 | Pi-sub Critical（memory `tcc_cdhash_vs_activate.md`）| TCC preflight 探针在 token 激活时；长期走 Developer ID 或稳定 helper |
| **B5** | 跨 session 学习禁止（paper §6） | Pi-sub Major | 不得从历史 approval 自动建议；显式 user action 才能复用 + log |
| **B6** | 审计日志体积（~70MB/yr × hash-chain 3-4x） | Pi-sub Major | 7d hot + cold hash-only；retention policy |
| **B7** | Tray UI **依赖**最小 capability token（要渲染什么）—— 不是 parallel | Pi-sub Major | P0a Tray 同步 ship 最薄 token 渲染（自然语言 bullets）|
| **B8** | deny/require_approval/allow 优先级 implicit | Pi-sub Major / Grok Major | EBNF 写死 `deny > require_approval > allow > default-deny` |
| **B9** | 审计日志 tamper-evidence | Pi-sub Minor | hash_chain_prev 字段 |
| **B10** | Skill 文件作为 injection 入口（恶意 skill prepend 到 user task） | Pi-sub Minor | compiler input = user typed verbatim；skill 内容只进 runtime LLM |
| **B11** | Sub-agent 横向提权 | Pi-sub Minor / Grok Minor | sub-agent token MUST subset of parent（compiler 强制） |
| **B12** | 无 replay screenshots（forensics 缺证据） | Pi-sub Minor | DEBUG 级别可选 |

## 给用户的决策点

1. **批准修订后的方向（v0.2 schema + P-1 到 P5.5 顺序）？**
2. **立即启动 P0a（Tray）作为独立 1 周交付？**（不阻塞 capability token 主线）
3. **P-1 威胁模型 delta doc 我来起草？**（compiler LLM 数据流图 + privacy disclosure 文案 + injection 攻击树）
4. **是否再开一轮 Round 2 评审？**（修订后让 Grok + Pi-sub 再过一遍，或者直接进 P0a）

如果用户拍板「先 P0a Tray」，那么 capability token 主线 P-1→P5.5 可以等 Tray 落地后再启动，不冲突。

---

*End of synthesis.*
