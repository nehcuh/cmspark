# Plan: Enterprise L2 Session Trust (A) + Global Enterprise Auto-Approve (B)

| Field | Value |
|-------|--------|
| Date | 2026-07-27 |
| Status | **Phase 0 PASS — Pi APPROVE_WITH_NITS** (`enterprise-ab-plan-pi-20260727-225536.md`); multi-agent G1–G9 folded; ready for Phase 1 implement |
| Product ask | NetSec pentest UX: stop one-click-per-scan after allowlist; add session allow-all + global enterprise auto-approve |
| Upstream | ADR-014 · confirm-center-user-guide §5 · server.ts forceConfirm · computer session-trust (pattern only) |
| Adversarial | `docs/audit/reviews/enterprise-ab-plan-adversarial-synthesis-2026-07-27.md` |
| Non-goals | Weakening allowlist empty-deny; silent MCP critical bypass; cross-family silent grant; dual-track HUD |

---

## 0. Problem (ground truth)

Three independent gates today:

1. **Module** — enterprise + `modules.netsec|shell.enabled`
2. **Scope** — allowlist (+ task auth for netsec when required)
3. **L2** — `shell_exec` / `netsec_port_scan` are **`capabilityForceConfirm`** — god-mode and `auto_approve_dangerous` do **not** skip

User pain: after IP allowlist + task auth, every scan still needs a click.

---

## 1. Product law (LOCKED post-adversarial)

### P1 — Three-layer model stays
A/B only change interactive L2 vs audited auto-approve under owner opt-in.

### P2 — Scope ∩ mandatory before any skip
Netsec: `targets ⊆ allowlist ∩ task_auth.targets` (if require_task_auth).  
Empty allowlist → **full deny** (A/B cannot bypass).  
Out-of-scope → **hard deny** before token mint; **never** emit `enterprise_auto_approved`.

### P3 — Same forceConfirm **class**, separate **grants**
A/B apply only to `shell_exec` and `netsec_port_scan`.  
**Not:** spawn_worker, ask_user, board_complete, host_computer critical, critical evaluate, MCP critical.

### P3b — **Per-family grant only (G3)**  
Approving netsec with A checkbox grants **`netsec` only**.  
Approving shell grants **`shell` only**.  
「同类」= same tool family. Cross-family requires a separate interactive opt-in (not v1 silent).

### P4 — A is thread-scoped, process-memory
- Key: `thread:<threadId>` only (no `ws:` skip)
- Restart clears A
- **Idle 30m + hard 8h** from **last interactive grant** (G4: **no touch on auto-approve**)
- Grant requires **explicit checkbox** (never implicit first Allow)

### P5 — B is config + high friction
- Key: `security.auto_approve_enterprise_tools` (default `false`)
- Settings phrase `我了解风险` (UX; config.json hand-edit = filesystem owner)
- Boot WARNING + audit on change
- **Pack forbidden key** (G7) — same class as `auto_approve_dangerous`

### P6 — Skip priority
`enterprise_global (B) > enterprise_session (A) > interactive`  
Outer gate:

```ts
const mustInteract =
  (!skipConfirmation || forceConfirm) &&
  !hostComputerTrustSkip &&
  !enterpriseSkip
```

`forceConfirm` stays true for audit classification; **enterpriseSkip is sibling of hostComputerTrustSkip** (G1).  
**Never:** `forceConfirm = critical && !enterpriseSkip` alone without changing outer predicate.

### P7 — Audit every auto-approve
`security.enterprise_auto_approved` with tool, reason, thread_id, targets or command_prefix (truncated), optional command hash.

### P8 — Confirm UI contract
- **MinimalConfirm** (primary Side Panel path) **must** offer A checkbox for shell/netsec when B off (G6)
- ConfirmElevated same checkbox when elevated
- Default **unchecked**
- Label: **本线程内自动批准同类（仅 netsec|shell）操作**
- Subtext: 受白名单/任务授权约束；**30 分钟无人工批准或最长 8 小时或 Companion 重启**后失效
- Payload: `add_to_enterprise_session_trust: true` only when offered + approved
- When B on: no L2 dialog for in-scope shell/netsec; Settings + banner show state

### P9 — Operator path for A status (G8)
- SafetyStrip / 确认台 chip: **企业信任中 · netsec|shell · 约 Nm · 撤销**
- Not PacksPanel-only
- WS: `enterprise.session_trust.status` / `.revoke`

### P10 — Settings truth matrix (G7)
Ship B **with** copy fixes:

| 开关 | evaluate/navigate L2 | shell/netsec L2 |
|------|----------------------|-----------------|
| 自动批准所有危险操作 | 可跳过 | **仍确认** |
| God-mode | 可跳过 (+ scheme) | **仍确认** |
| **B 全局企业工具** | 不改变 | **可跳过（仍受范围）** |

---

## 2. Design

### 2.1 Module `companion/src/capability/enterprise-session-trust.ts`

```ts
export type EnterpriseToolFamily = "netsec" | "shell"

export type EnterpriseSessionGrant = {
  grantedAt: number
  lastInteractiveAt: number  // idle anchor — pure read for isActive
  families: EnterpriseToolFamily[]
  /** Required for netsec: hash(allowlist + task_auth.targets) at grant */
  scopeFingerprint?: string
}

// Map trustKey -> grant
// resolveTrustKey(threadId) -> `thread:…` | null
// grant(key, families, { scopeFingerprint? })
// isActive(key, family, now) — no touch side effect
// revoke(key) / revokeAll() / revokeFamily(key, family)
```

### 2.2 Shared scope helpers

- `checkNetsecScope(params, thread)` — same rules as `netsecPortScan` (requireModule, empty deny, assertTargetsAllowed, task auth)
- `checkShellScope(command)` — requireModule + `commandAllowedByPolicy`
- Used by L2 skip gate **and** execute path (no drift)

### 2.3 Server gate (drop-in intent)

```ts
const enterpriseFamily =
  toolName === "netsec_port_scan" ? "netsec"
  : toolName === "shell_exec" ? "shell"
  : null

let enterpriseSkip = false
let enterpriseSkipReason: "enterprise_global" | "enterprise_session" | null = null

if (enterpriseFamily) {
  const scope = enterpriseFamily === "netsec"
    ? checkNetsecScope(finalParams, thread)
    : checkShellScope(String(finalParams.command || ""))
  if (!scope.ok) {
    return fail(scope.error) // no token, no auto audit
  }
  // optional: if A grant has scopeFingerprint and mismatch → revoke family, no skip
  const sec = getConfig().security
  const trustKey = resolveEnterpriseTrustKey(actingThreadId)
  if (sec?.auto_approve_enterprise_tools === true) {
    enterpriseSkip = true
    enterpriseSkipReason = "enterprise_global"
  } else if (trustKey && enterpriseSessionTrust.isActive(trustKey, enterpriseFamily, Date.now())) {
    enterpriseSkip = true
    enterpriseSkipReason = "enterprise_session"
  }
}

const forceConfirm = criticalApis.length > 0 // still true for shell/netsec tool name
const mustInteract =
  (!skipConfirmation || forceConfirm) &&
  !hostComputerTrustSkip &&
  !enterpriseSkip

if (mustInteract) {
  // L2 dialog; for shell/netsec && !B: enterpriseSessionTrustOffered=true
  // on approve + extras + offered + toolName match:
  //   grant(trustKey, [enterpriseFamily], { scopeFingerprint })
} else if (enterpriseSkip) {
  audit enterprise_auto_approved
}
// ALWAYS issue security_token after for L2_GATE tools
```

### 2.4 Anti-injection grant (G5)

```ts
// PendingConfirmation
enterpriseSessionTrustOffered?: boolean

// respondFrom only:
addToEnterpriseSessionTrust =
  approved &&
  extras?.addToEnterpriseSessionTrust === true &&
  pending.enterpriseSessionTrustOffered === true &&
  (pending.toolName === "shell_exec" || pending.toolName === "netsec_port_scan")

// tray respond() — never sets enterpriseSessionTrustOffered / extras → no A grant
```

### 2.5 Config + control plane

- `security.auto_approve_enterprise_tools: false`
- `message-router` flatten + `FORBIDDEN_PACK_KEYS` include new key
- `types.ts` / `normalizeConfig` / Settings UI (phrase arm)
- WS revoke/status for A

### 2.6 Extension UI

| Surface | Change |
|---------|--------|
| MinimalConfirm | A checkbox when tool is shell/netsec && !B |
| ConfirmElevated | same |
| SafetyStrip chip | status + revoke |
| Settings | B + matrix copy fixes for auto_approve_dangerous / God-mode |
| PacksPanel | optional secondary status (not sole revoke) |

### 2.7 Tests (T1–T20)

| # | Case |
|---|------|
| T1 | A/B off + auto_approve_dangerous on → shell/netsec still interactive |
| T2 | B + in-scope netsec → skip L2 + audit + token works |
| T3 | B + out-of-allowlist → deny, **no** enterprise_auto_approved |
| T4 | A checkbox on netsec → second netsec skips |
| T5 | A other thread still prompts |
| T6 | Idle 30m after interactive grant (no skip-touch) → prompt |
| T7 | Allow without checkbox → no grant |
| T8 | B does not skip spawn_worker / host_computer / ask_user |
| T9 | auto_approve_dangerous alone does not skip netsec |
| T10 | empty allowlist + B → deny |
| T11 | shell policy miss under B → deny |
| T12 | netsec A grant does **not** skip shell (family isolation) |
| T13 | security_token still required at execute |
| T14 | inject extras on evaluate → no A grant |
| T15 | tray respond alone → no A grant |
| T16 | hard 8h expiry |
| T17 | allow_all_schemes alone still force shell/netsec when B off |
| T18 | pack cannot set auto_approve_enterprise_tools |
| T19 | A-only (B off, god-mode off) second scan **does** skip (proves G1) |
| T20 | B does not skip MCP critical |

### 2.8 Docs
- mission-pack-usage §5.3 / §6 — carve A/B owner opt-in
- confirm-center-user-guide §5 — fourth row + A/B
- Settings copy matrix

---

## 3. Phases

| Phase | Deliverable |
|-------|-------------|
| **0** | Plan multi-agent + **Pi** approve |
| **1** | enterprise-session-trust + pure scope helpers + unit tests |
| **2a** | config B + gate with G1/G2 + audit (B-only path) |
| **2b** | grant plumbing + anti-injection (no UI yet) |
| **3** | MinimalConfirm + Settings B + chip/revoke + T4/T7 UI path |
| **4** | docs + manual pentest checklist |

Defaults: A and B **off**.

---

## 4. Threat mitigations (post-amend)

| Threat | Mitigation |
|--------|------------|
| Gate algebra no-op A | G1 mustInteract |
| Cross-family RCE via netsec checkbox | G3 per-family |
| Warm grant forever via touch | G4 pure-read idle |
| WS inject trust flag | G5 offered bit |
| False auto-approve audit | G2 scope-before-skip |
| Pack arms B | FORBIDDEN_PACK_KEYS |
| User arms wrong global toggle | G7 copy matrix |
| Primary path can't arm A | G6 MinimalConfirm |

---

## 5. Q1–Q5 LOCK table

| ID | LOCK |
|----|------|
| Q1 | Idle 30m + hard 8h; idle from last **interactive** grant |
| Q2 | **Per-family only** |
| Q3 | B does not skip MCP critical |
| Q4 | Bulk multi-target dialog out of scope |
| Q5 | shell `confirm_session` does not auto-enable A |

---

## 6. File map

| File | Role |
|------|------|
| `companion/src/capability/enterprise-session-trust.ts` | Create |
| `companion/src/netsec/scope.ts` (+ shell helper) | Shared pure scope |
| `companion/tests/enterprise-session-trust.test.ts` | Create |
| `companion/src/config.ts` | B key + boot warn |
| `companion/src/server.ts` | mustInteract gate + grant |
| `companion/src/security-confirmation.ts` | offered + extras |
| `companion/src/message-router.ts` | flatten B + forbid pack + revoke/status |
| extension MinimalConfirm / payload / Settings / SafetyStrip | UI |
| docs | §2.8 |

---

## 7. Success criteria

1. Pentest: first in-scope scan interactive + A checkbox → subsequent **netsec** in-scope auto until idle/8h/restart.  
2. Shell requires its own A grant (or B).  
3. B: zero interactive L2 for in-scope shell/netsec; allowlist empty still dead; other force tools still prompt.  
4. T1–T20 green; Settings copy no longer claims auto_approve/god-mode skip shell/netsec.

---

*Revision incorporates Security REJECT + Architecture AMEND + Product hard nits (G1–G9). Implement only after Pi VERDICT APPROVE or APPROVE_WITH_NITS.*
