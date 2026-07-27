Now I have thorough context across the product conclusion, existing ADRs (004, 006, 007, 010), the Claude external review, the thread-manager, config, security, security-confirmation, message-router, skill-engine, and the UI redesign spec. Here is the adversarial/constructive review.

---

# Design Review: Mission Pack + Enterprise Capability Modules

**Reviewer**: Adversarial design review (structured)  
**Date**: 2026-07-26  
**Scope**: Full design spec in system prompt + cross-references to locked product conclusion, ADRs, and existing code

---

## 1. Consistency Review

### 1.1 Internal Inconsistencies

| # | Location | Issue | Severity |
|---|----------|-------|----------|
| C1 | §6.2 vs §6.2 | `tools.allow` unknown-tool rule is written as **both** "警告并剔除" and "v1 建议拒绝". The validator table says "v1 建议**拒绝**防拼写漏权限". A "建议" in a security-critical allowlist is not a spec — it's an escape hatch. Must be locked to **REJECT always**. | **Must-fix** |
| C2 | §6.4 `tools.mode: intersect` | "若原 whitelist 为 `null`，先视为「全工具」再与 allow 交" — this requires enumerating "all tools" as a canonical set. New tools added later would be silently excluded unless the enumeration is kept in sync. This is a maintenance trap. The correct spec: when original is null, `intersect` degrades to `allowlist` (i.e., apply pack.allow \ pack.deny directly). Null means "no restriction," not "all-tools-enumerated." Mathematically the intersection result is the same, but the implementation path is different — one requires a fragile enumeration, the other doesn't. | **Must-fix** |
| C3 | §6.5 vs §6.4 | Pack apply writes `system_prompt_append` to thread. But what if the thread **already has** a `system_prompt_append` (user configured it manually before applying the pack)? The spec doesn't define whether pack append **replaces** or **concatenates** with existing. Since the spec says "apply 时写入 thread" (write, not merge), applying a pack would clobber the user's manual append. | **Must-fix** |
| C4 | §7.1 `target_allowlist` format | Spec says "CIDR / hostname / *.suffix 规则" but the existing `matchDomain()` in `companion/src/security.ts` only handles hostname globs — no CIDR parsing exists anywhere in the codebase. This is a new, non-trivial capability that must be called out as new implementation, not assumed to re-use existing code. | **Must-fix** |
| C5 | §3.3 vs §6.1 `requires_modules` | §3.3 says Pack L2 = "需要 host / Shell / 强确认桌面能力". But `requires_modules` is an explicit array in the pack manifest (§6.1). If a pack declares `min_capability: L2` but does NOT list `shell` in `requires_modules`, does the pack get rejected? Or does `min_capability: L2` imply certain module requirements? The relationship between capability level and required modules is never specified. | **Must-resolve** |
| C6 | §5 `enabled.json` | Described as "可选：全局「建议 pack 列表」缓存." How does this differ from the list of installed packs? Is it a "featured/recommended" list fetched remotely? If remote, what's the fetch mechanism, format, and signing? If local, why is it separate from the installed directory? Undefined. | Nit |

### 1.2 Consistency with Product Conclusion & ADRs

| # | Spec claim | Product/ADR reality | Verdict |
|---|-----------|---------------------|---------|
| C7 | §3.1 "Pack 可 **require** 某 module" | Product conclusion D10 says modules are opted in by user/admin. Pack requiring a module means: if user hasn't opted in, pack.apply fails with guidance. This is correct and consistent. | OK |
| C8 | §3.2 "`capability_profile` 写在 Companion `config.json`" + "扩展只读展示，不可仅靠扩展伪造 enterprise" | ADR-010 PR-0 already implemented WS HMAC handshake — the extension's ability to write to config is already gated by the shared secret. The "不可仅靠扩展伪造" defense is **redundant** because the WS auth gate already prevents it. The spec should just note this is defense-in-depth, not a primary control. | Nit |
| C9 | §6.4 S4 "Pack 不得将 `auto_approve_dangerous` / God-mode 设为 true" | The `ALLOWED_CONFIG_OVERRIDE_KEYS` in `thread-manager.ts` already validates config_override keys — `auto_approve_dangerous` and `allow_all_schemes` aren't in the allowlist, so they'd already be rejected by `validateConfigOverride`. But the spec should **explicitly** list the forbidden keys in the pack validator too, as defense-in-depth. Currently only mentioned as narrative ("Pack 试图设置安全放宽键 → 拒绝（见 S4）") without enumerating which keys. | Must-fix |
| C10 | §8.3 "`auto_approved_domains` 不放行 Shell/NetSec" | ADR-007 `auto_approved_domains` gates evaluate/osascript_eval/navigate/create_tab/set_tab_url. Shell and NetSec are new confirm kinds — they must be explicitly excluded from domain whitelist auto-approval. The spec says this but doesn't specify **how** the new confirm kinds are registered to avoid the whitelist path. The `SecurityConfirmationManager` would need new `confirm_kind` discrimination. | Must-resolve |

---

## 2. Security Review

### 2.1 Critical: Shell Interactive Session Gap

§7.3C Shell policy `confirm` says "每个「启动 session」确认；可选 per-command 确认（严格模式）".

This is the single largest security gap in the design.

An interactive PTY session is **categorically more powerful** than `osascript_eval`. With `osascript_eval`, every invocation goes through the confirmation stack. With an interactive shell where confirmation only gates **session start**, the LLM can execute an arbitrary sequence of commands through the PTY with zero per-command human review — including `curl | bash`, `sudo`, `rm -rf`, etc.

**The default must be per-command confirmation.** A "session-only" confirmation is a dangerous relaxation that should itself require an explicit policy opt-in (separate from just enabling the shell module). The spec treats per-command as "可选" when it should be the default.

**Recommendation**: Invert the default.
- Default: `policy: confirm-per-command` — every command sent through the PTY requires human confirmation (or a budgeted auto-approve window of N commands / T seconds).
- Opt-in relaxation: `policy: confirm-session` — single confirmation at session start (requires explicit user choice + audit entry + warning).
- `policy: allowlist` — only commands matching a prefix/regex pass without confirmation.

### 2.2 Critical: Audit Log Growth

§5 `capability-audit.jsonl` is append-only with no rotation, size cap, or retention policy. The existing `log-rotation.ts` exists in the codebase but the design doesn't reference it. A jsonl that logs every shell command summary (even sanitized) and every netsec scan will grow unbounded.

**Recommendation**: Specify rotation: max 10MB, keep 3 rotated files, or aggregate older entries.

### 2.3 High: Shell Thread Lifecycle Orphan

§7.3C says "thread 删除/关闭 task → kill" but doesn't address:

- **Thread fork**: Does the forked thread inherit the PTY? Does the original thread lose it? Threads can share the same conversation history but should never share a PTY.
- **Thread resume**: If a thread with an active PTY session is resumed after Companion restart, the PTY is dead. What's the recovery UX?
- **Companion crash**: PTY sessions are in-memory. On crash, all sessions die. This is fine but should be documented as expected behavior.

**Recommendation**: Specify: (a) fork creates a new PTY or no PTY, never inherits; (b) resume shows "Shell session ended" with option to restart; (c) crash = all sessions terminated, audit log records abnormal close.

### 2.4 High: NetSec Allowlist Pre-Execution vs Post-Execution

§7.3D and §8.1 describe Companion hard-refusing out-of-allowlist targets at **execution time**. This is the correct enforcement pattern (server-side validation), but it has a data-leakage implication: the LLM provider **sees** the rejected target in the tool call history. If an employee accidentally asks the agent to scan `competitor-corp-internal.com` and the Companion refuses, the target name still went to the LLM API.

Is this acceptable? For most enterprise deployments using a private LLM endpoint, yes. For users on public APIs (OpenAI, Anthropic), it's a minor data leak concern. The spec should at minimum **acknowledge** this and document it as acceptable for enterprise profiles with private endpoints.

### 2.5 Medium: Shell Audit Sanitization

§7.3C says "命令摘要（注意脱敏：避免完整 secret 入日志）" — this is a human-language instruction, not a security control. "Be careful" doesn't prevent secrets in logs.

**Recommendation**: Specify a concrete sanitization pass: strip patterns matching common secret formats (AWS keys, JWT tokens, `-----BEGIN`, base64 strings >N chars) before writing command summaries to audit log. Or, more conservatively: log only exit codes and command length, never command content by default.

### 2.6 Medium: `pack.install` Zip Slip

§6.3 `pack.install` "从目录/zip/内置资源安装到 `packs/installed/<id>`". §6.2 path containment rule says "相对路径 skill/knowledge 必须在 pack 目录 realpath containment 内". When installing from zip, the extraction step needs zip-slip prevention **before** the path containment check. The spec mentions "zip slip" in §11 testing but not in the validation rules. Should be an explicit validation rule: "Extracted paths must resolve within `packs/installed/<id>/` after `realpath`; reject any path that escapes."

### 2.7 Medium: Community Profile Enterprise Pack Installation

§6.2 says `channel: enterprise` + profile=community → "**可安装但不可 apply**（或安装时警告）". The "or" is ambiguous. Recommendation: **allow installation but flag as "enterprise only — requires enterprise profile to use"** in list UI. Don't reject install — users may switch profiles later. But don't silently install either.

### 2.8 Low: `pack.yaml` Denial-of-Service

`system_prompt_append` has a length cap of 8–16KB. Skills and knowledge in a pack have no individual size limits beyond what the existing skill-engine enforces. A malicious pack with a 10MB skill file would pass validation but could bloat thread prompts. Consider a total pack size cap (e.g., 5MB unpacked, 1MB per individual file).

---

## 3. Feasibility Review

### 3.1 Skill Engine Secondary Roots (§6.6)

The current `SkillEngine` (examined in `companion/src/skills/skill-engine.ts`) scans a single `skillsDir` and a `builtinDir`. Adding **secondary roots** (one per installed pack) requires:

- Changing the scan mechanism to iterate over multiple roots
- Resolving name collisions across roots
- Implementing `refresh()` to pick up new/removed pack directories
- Unloading a secondary root on pack uninstall

This is a significant engine modification — roughly a refactor of the `SkillEngine` constructor and scan loop. The implementation sketch (§13) doesn't list this work. It should be called out explicitly as a pre-requisite for PR-A/PR-B.

### 3.2 CIDR Matching for NetSec (§7.1)

No CIDR matching exists in the codebase today. The `matchDomain` function handles hostname globs only. CIDR matching requires:

- Parsing CIDR notation (`10.0.0.0/8`, `192.168.1.0/24`)
- IPv4 and IPv6 support
- Network address normalization
- Efficient matching against potentially many CIDR entries

This is a new module (`companion/src/netsec/scope.ts` as sketched) with non-trivial logic. The design should note that `target_allowlist` matching is new code entirely, not an extension of `matchDomain`.

### 3.3 Shell PTY + Cockpit (§7.3C)

`node-pty` is a native Node.js addon that spawns child processes with a pseudo-terminal. It requires:

- Platform-specific build (macOS, Linux, Windows)
- Binary distribution or compilation at install time
- Process lifecycle management (spawn, monitor, kill on timeout)
- Data streaming over WebSocket (binary VT sequences → Cockpit xterm.js)

The Companion already streams LLM responses over WS. Adding PTY streaming is a new WS channel type. The implementation is feasible but is the single largest coding effort in the design — larger than the entire pack platform. The PR-F slice (§14) understates this: "Shell PTY + Cockpit" is 3–5 PRs worth of work (PTY manager, WS transport, Cockpit widget, audit integration, policy enforcement).

### 3.4 DevSec Workspace Folder Picker (§7.3B)

The existing `pickFolderNative` (used for Obsidian vault selection) already provides a native folder picker via WS. This is directly reusable. Low risk.

### 3.5 Pack Zip Installation (§6.3)

The `AdmZip` library is already imported in `skill-engine.ts` for VibeSOP imports. Reuse is straightforward. Low risk.

### 3.6 New Config Keys in `ALLOWED_CONFIG_OVERRIDE_KEYS` (§6.5)

Adding `system_prompt_append` to the allowlist is a one-line change in `thread-manager.ts`. However, the **merge logic** (global base → thread.system_prompt → thread.system_prompt_append) must be implemented in the LLM adapter, not in thread-manager. The adapter currently reads `config_override.system_prompt` and uses it as a complete replacement. Adding an append key requires changing the adapter's prompt assembly. This is small but must be called out.

### 3.7 Overall Feasibility Verdict

The design is feasible but significantly **undersells the implementation surface area** of:
1. SkillEngine secondary-root refactor
2. Shell PTY + WS transport + Cockpit widget (the largest single piece)
3. CIDR matching for netsec scope
4. The adapter change for system_prompt_append

The PR breakdown (§14) is optimistic. A realistic breakdown would be 10–14 PRs, not 7.

---

## 4. Q1–Q5 Open Questions

| Q | Spec suggestion | Review | Verdict |
|---|----------------|--------|---------|
| Q1: AppSec default enabled? | "首次展示说明后默认建议开启，需一点击" | Aligns with D10 opt-in. But must clarify: AppSec module enabled ≠ AppSec pack auto-applied to threads. Module gates capability; pack is a per-thread choice. The "首次说明" flow should explain this distinction. | **Agree, with clarification** |
| Q2: system_prompt merge use new key append? | "是" | Agree. But must resolve merge order ambiguity (§6.5 C3 above). Order should be: `[system_prompt base] → [thread.system_prompt override] → [pack.append applied as thread.system_prompt_append]`. If thread already has a manual `system_prompt_append`, pack.apply should **prepend** (pack first, user second) so user intent always wins. | **Agree, with merge-order spec** |
| Q3: xterm.js vs ghostty-web? | xterm.js default; ghostty-web experimental | Correct call. xterm.js is battle-tested (VS Code's terminal). ghostty-web (~400KB WASM, by coder) is promising but immature. The spec's "P1' 默认 xterm.js" is the right answer. | **Agree** |
| Q4: Bundle nmap? | No; PATH or optional installer component | Consistent with product conclusion. PATH probing (`which nmap`) is zero-cost; optional component install is a packaging concern, not a design concern. | **Agree** |
| Q5: Pack + skill-craft? | Pack 可包含 craft 产物；craft 不自动生成 requires_modules | Skill-craft produces individual skills. A pack can bundle crafted skills as static `.md` files. The question of whether applying a pack with a crafted skill should auto-refresh the skill engine's embedding cache is an implementation detail (answer: yes, `refresh()` should be called after pack install). | **Agree** |

---

## 5. Must-Fix vs Nits Summary

### Must-Fix (6 items — block approval)

| ID | Issue | Location |
|----|-------|----------|
| **M1** | `tools.allow` unknown-tool rule: "建议拒绝" → must be **REJECT always** (no warning-and-strip option for security allowlists) | §6.2 |
| **M2** | `tools.mode: intersect` with null whitelist: remove "视为全工具" enumeration; spec as "null → degrade to allowlist (apply pack.allow \ pack.deny directly)" | §6.4 |
| **M3** | System prompt merge: define what happens when thread already has `system_prompt_append` before pack.apply. Pack append should **prepend** so user's manual append always wins | §6.5 |
| **M4** | Shell default policy: per-command confirmation must be the **default**, not "可选". Session-only confirmation must require explicit opt-in with audit + warning | §7.3C |
| **M5** | Audit jsonl growth: specify rotation policy (max size, retention) or reference existing `log-rotation.ts` | §8.2 |
| **M6** | Forbidden security keys: enumerate the blocklist of config_override keys packs must never touch (`auto_approve_dangerous`, `allow_all_schemes`, `auto_approved_domains`, `trusted_domains`) in the validator spec, not just S4 narrative | §6.2, §8.1 |

### Must-Resolve (4 items — require spec clarification, not design change)

| ID | Issue | Location |
|----|-------|----------|
| **R1** | `min_capability: L2` vs `requires_modules: [shell]` relationship: when must they be consistent? Does L2 imply shell? | §3.3, §6.1 |
| **R2** | Shell PTY on thread fork/resume/crash: explicit lifecycle behavior | §7.3C |
| **R3** | Shell/NetSec confirm kinds: how they register with `SecurityConfirmationManager` to bypass domain whitelist path | §8.3 |
| **R4** | `target_allowlist` CIDR matching: acknowledge as new code, not extension of existing `matchDomain` | §7.1, §13 |

### Nits (9 items — non-blocking)

| ID | Issue |
|----|-------|
| N1 | §3.2 extension "不可伪造 enterprise" is redundant defense post PR-0 WS auth — note as defense-in-depth |
| N2 | §5 `modules/shell/` and `modules/netsec/` may never have content — mark as placeholder |
| N3 | §6.1 `schema_version: 1` (integer) vs `version: 0.1.0` (semver) — use semver for both or document the distinction |
| N4 | §7.3A AppSec `evaluate` confirmation — call out that existing confirmation stack applies unchanged |
| N5 | §9.1 "企业能力" should be "企业能力模块" for consistency with spec terminology |
| N6 | §10 PR-D mixes P0 (audit jsonl) with P1 (modules config) — split or clearly phase |
| N7 | §14 PR-B is oversized (schema + WS + thread migration + content) — split into 2 PRs |
| N8 | §6.2 `requires_modules` dual-gate (available vs enabled) is correct but never defines the UI flow for "available but not enabled" |
| N9 | §8.1 NetSec data leakage to LLM provider: acknowledge and document as acceptable for enterprise/private endpoints |

---

## 6. What's Strong

1. **Dual-channel architecture** (§3.2) elegantly resolves the Chrome Web Store policy tension. Community gets safe packs; enterprise gets powerful modules. Each channel has its own default posture. This is the right architecture.

2. **Opt-in model** (§7.2, D10) with explicit `available` vs `enabled` distinction. Prevents the "installer accidentally enables dangerous capabilities" scenario. The two-state toggle + audit trail is well-designed.

3. **Companion-side enforcement** (§8.1) for all hard-refusal decisions (NetSec allowlist, Shell policy). The "不依赖 LLM 自觉" principle is correctly applied throughout.

4. **Pack as configuration layer** (§3.1, §6) — not a new runtime, not a new execution engine. Packs compose existing primitives (skills, knowledge, MCP, tool_whitelist, system_prompt). This keeps the design lean and the implementation surface small.

5. **Security layering** (§8.3) correctly separates Shell/NetSec from existing cookie-trust and domain-whitelist paths. "Shell/NetSec 不走域白名单" is the right call.

6. **Phased delivery** (§10) aligns with product conclusion D11. AppSec first (browser-native, low risk), DevSec workspace next (filesystem access), Shell and NetSec last (highest risk, enterprise-only).

---

## 7. Verdict

### **APPROVE_WITH_CHANGES**

**Confidence: 84%**

The design is architecturally sound and builds correctly on locked product decisions. The dual-channel model, opt-in posture, and Companion-side enforcement are all correct choices. The pack format is well-specified and the apply-to-thread mapping is thorough.

However, there are **six must-fix security/consistency issues** that must be resolved before implementation planning:
1. The Shell default confirmation policy is dangerously permissive (M4)
2. The `tools.mode: intersect` null-handling semantic is fragile (M2)
3. System prompt merge clobber risk (M3)
4. Unknown-tool-name handling is ambiguous (M1)
5. Audit log growth is unspecified (M5)
6. Forbidden security keys are not enumerated (M6)

Plus **four items** that need spec clarification (R1–R4), particularly the Shell PTY lifecycle and the NetSec CIDR matching acknowledgement.

The confidence of 84% reflects: high confidence in the architecture and product model (~90%), moderate confidence in the implementation feasibility estimates (~75%, due to underselling Shell/CIDR/SkillEngine work), and high confidence that the must-fix items are resolvable without structural redesign (~92%).

**Next step after sign-off**: Resolve M1–M6 and R1–R4 in a brief amendment before entering `writing-plans`.
