# follow-up C — MCP tool-call capability gate (RFC draft)

> **Date**: 2026-07-12
> **Author**: Claude (grounding) → kimi review
> **Status**: RFC draft, awaiting kimi design decisions before implementation
> **Predecessors**: §6.1.5 IMAGE_FETCH_GATE (PR #39), §6.2 CRITICAL_API_GATE (PR #40), M2 `<untrusted>` (PR #42)

## §1. Grounding (what exists today)

MCP support is **fully implemented** in `companion/src/mcp/` (7 files, ~57 KB), wired into config, the LLM tool list, dispatch, message routing, and the extension UI. Not scaffolded.

### 1.1 Dispatch + gate path for MCP namespaced tools

`createToolExecutor` (server.ts:202) routes `mcp__<server>__<tool>` calls at **server.ts:687** to `executeMcpTool` (**server.ts:1097-1212**). This is the single function all MCP tool_calls pass through before `manager.callTool` (server.ts:1179) reaches the external MCP server.

### 1.2 The existing MCP gate — `trust_level` + name regex

```ts
// server.ts:1111-1130
const configuredTrustLevel = manager.getTrustLevel(route.serverName) ?? "first-use"
const isDestructiveName = DESTRUCTIVE_MCP_TOOL_PATTERN.test(route.toolName)   // :1116
const trustLevel = isDestructiveName ? "manual" : configuredTrustLevel         // :1117
...
const needsConfirm =
  trustLevel === "manual" ||
  (trustLevel === "first-use" && !cache.isApproved(cacheKey))                  // :1128-1130
```

- `manual` → always prompt.
- `first-use` → prompt once, then cached; cache has a per-tool call cap (default 10) at server.ts:1170-1174.
- `trusted` → `needsConfirm = false` **always**.
- `DESTRUCTIVE_MCP_TOOL_PATTERN` (server.ts:137): `/\b(write|delete|exec|commit|rm|remove|shell|curl|wget|spawn|fork|kill|drop|truncate|wipe|destroy)\b/i` — name-only heuristic, forces `manual`.

The confirmation request itself (server.ts:1145-1157):
```ts
const decision = await securityConfirmations.request(..., {
  toolName,
  dangerousApis: [],                    // ← NO critical-API detection on MCP args
  code: safeJsonStringify(params, 1200),
  riskLevel: "medium",                  // ← generic, never "high"
})
```

### 1.3 god-mode / auto_approve do NOT touch MCP

`executeMcpTool` (server.ts:1097-1212) has **zero references** to `allow_all_schemes`, `auto_approve_dangerous`, `skipConfirmation`, `forceConfirm`, or `detectCriticalApis`. The MCP gate is entirely `trust_level`-driven and god-mode-unaware in both directions.

### 1.4 Existing capability-gate templates (the reusable pattern)

- **§6.2 CRITICAL_API_GATE** (server.ts:303-313): `detectCriticalApis(code)` → `forceConfirm = criticalApis.length > 0` → `if (!skipConfirmation || forceConfirm)`. Even when god-mode/auto_approve/domain-whitelist sets `skipConfirmation=true`, a non-empty critical set forces interactive confirmation. Audit: `security.critical_capability_denied`/`_confirmed`/`_token_replay` with `god_mode_active` + `auto_approve_active` (server.ts:364-432).
- **§6.1.5 IMAGE_FETCH_GATE** (server.ts:554-655): skip expression deliberately omits `allow_all_schemes`/`auto_approve_dangerous` — only `trusted`/`autoApproved` domain can skip; god-mode never bypasses.
- `DANGEROUS_API_PATTERNS` with `critical?: boolean` (security.ts:155-232) — classification table pattern.

## §2. Premise correction (push-back, META 2.4)

kimi's original framing for follow-up C was: *"MCP tool-call gate — god-mode should not auto-approve MCP tools."*

Grounding shows this specific concern is **already satisfied — by accident, not design**. `executeMcpTool` never reads `allow_all_schemes`/`auto_approve_dangerous`, so god-mode does NOT auto-approve MCP calls. A `manual` or un-approved `first-use` MCP tool still prompts under god-mode. (Worth a code comment + test to make this intentional, but no behavioral gap here.)

**The real gap is adjacent** — the §6.2 analog for MCP:

## §3. The real gap — MCP gate is not capability-aware

The MCP `trust_level` gate can skip confirmation for capability-equivalent-dangerous calls, with **no `forceConfirm` / critical-capability boundary** — exactly what §6.2 fixed for `evaluate`'s `skipConfirmation` path.

### 3.1 Three concrete bypass paths

| Path | Mechanism | Result |
|---|---|---|
| `trust_level: "trusted"` | `needsConfirm = false` always (server.ts:1129-1130) | Destructive/exfil-capable MCP tools execute **zero-confirmation**, no capability check |
| `first-use` cached (calls 2-10) | `cache.isApproved` true (server.ts:1130); cap enforced at :1170-1174 | Args can change to a destructive target between calls — **no re-check** of content |
| Name-regex evasion | `DESTRUCTIVE_MCP_TOOL_PATTERN` (server.ts:137) is name-only | A server naming its exfil tool `fetch_data` / `get_info` / `query` / `read_record` **passes** the regex → takes the server's configured trust level |

### 3.2 Threat scenarios

- **`trusted` filesystem server, `read_file` tool** (name passes regex). LLM calls `read_file({path: "/Users/x/.ssh/id_rsa"})` or `read_file({path: "~/.cmspark-agent/config.json"})` (contains the WS shared secret from PR #35). Zero confirmation. Result flows back to the LLM. (M2's `<untrusted>` wrapping marks it DATA — stops the LLM from *following embedded instructions*, but does NOT stop it from *reading and exfiltrating* the secret in a later tool call.)
- **`trusted` MCP server with `query`/`search` tool** that makes network egress to an attacker endpoint (the server's own implementation, invisible to companion). Zero confirmation, no network-egress capability boundary.
- **`first-use`-approved `search` tool**, call #5 with args `{query: "password", scope: "~/.ssh"}` — cached, no re-prompt.
- **Prompt-injection amplification** (audit item 8's original concern, only half-fixed): `DESTRUCTIVE_MCP_TOOL_PATTERN` now forces `manual` for destructive-*named* tools, but a non-destructive-named tool on a `trusted` server is a clean amplification path — a hostile page can steer the LLM to call it with sensitive args, zero confirmation.

### 3.3 Audit gap

MCP has no `critical_capability_*` audit events and no `godmode_bypassed layer:"mcp"` emission. The trail for MCP is thinner than for `evaluate`: only `mcp.confirm.requested`/`mcp.confirm.approved`/`mcp.destructive_force_manual` (server.ts:1119, 1139, 1169). A `trusted`-server exfil leaves no `critical_capability_*` trace.

## §4. Proposed fix — mirror §6.2 CRITICAL_API_GATE

Add a **capability-declaration + classification gate** to `executeMcpTool`, never bypassed by `trusted`/first-use-cache/god-mode. Two phases.

### 4.1 Phase 1 (minimal, no config/UI change) — closes the worst gap

**Capability classification from name + args** (no new config field yet):

```ts
// security.ts (new), mirroring DANGEROUS_API_PATTERNS + detectCriticalApis
export type McpCapability =
  | "file-read" | "file-write" | "exec" | "network-egress"
  | "db-mutate" | "db-read" | "read-only" | "unknown"

// Critical = the never-auto-approved subset (mirror of §6.2 `critical: true`)
export const CRITICAL_MCP_CAPABILITIES: ReadonlySet<McpCapability> = new Set([
  "file-write", "exec", "network-egress", "db-mutate", "unknown",
])

// Name heuristics (extends DESTRUCTIVE_MCP_TOOL_PATTERN) + arg scan
export function classifyMcpCall(
  toolName: string, params: any,
): McpCapability[] { /* name regex + serialized-arg scan (paths, urls, shell verbs) */ }
```

**Gate in `executeMcpTool`** (insert at server.ts:1131, after `needsConfirm`, before the confirm block):

```ts
// §6.3 MCP_CAPABILITY_GATE (follow-up C): capability classification that
// survives trusted/first-use-cache/god-mode — mirror of §6.2. Even a `trusted`
// server or a first-use-cached tool must confirm when the call touches a
// critical capability (file-write/exec/network-egress/db-mutate/unknown).
// god-mode bypasses the UI prompt, not this capability boundary.
const mcpCaps = classifyMcpCall(route.toolName, params)
const forceMcpConfirm = mcpCaps.some(c => CRITICAL_MCP_CAPABILITIES.has(c))

if (needsConfirm || forceMcpConfirm) {
  // ... existing confirmation flow, but:
  //   riskLevel: forceMcpConfirm ? "high" : "medium"
  //   dangerousApis: mcpCaps,                         // surface capabilities
  //   autoConfirmEligible: !forceMcpConfirm
  // CRITICAL: never cache a forceMcpConfirm approval (always per-call):
  //   if (trustLevel === "first-use" && !forceMcpConfirm) cache.approve(cacheKey)
}
```

Key invariants (mirror §6.2 server.ts:313):
- `trusted` server + critical capability → **still confirms** (`forceMcpConfirm` overrides `needsConfirm=false`).
- `first-use` cached + critical capability → **still confirms, never cached** (critical calls always per-call).
- god-mode / auto_approve → **no effect** (gate doesn't read them; consistent with current MCP behavior + §6.1.5).
- Audit: `security.mcp_critical_denied`/`_confirmed` with `{server, tool, capabilities, god_mode_active, auto_approve_active}`, mirroring server.ts:364-388.

### 4.2 Phase 2 (full) — explicit capability declaration + meta-tool coverage + god-mode audit

- **Config field**: `capabilities?: McpCapability[]` on `McpBaseServerConfig` (types.ts:11). User declares when adding a server. Default `["unknown"]` (→ forceConfirm) if undeclared — safe default. UI (McpServerForm) exposes checkboxes. This is kimi's "capability-declaration gate (allowed-tools list)".
- **Shared helper**: `assertMcpCapabilityAllowed(route, params, declaredCapabilities)` called from BOTH `executeMcpTool` (server.ts:1097) and `executeMcpMetaTool` (server.ts:1258) — `mcp_read_resource` can read `file://` URIs → also a file-read capability.
- **god-mode audit** (kimi: "all MCP calls enter godmode_bypassed audit log"): when `allow_all_schemes` or `auto_approve_dangerous` is active, emit `logger.warn("security.godmode_bypassed", { layer: "mcp", server, tool, capabilities, ... })` for every MCP call — so the operator sees MCP activity during a god-mode session even though god-mode doesn't skip MCP confirmation. (Interpreting kimi's directive as traceability, not bypass.)

## §5. Design decisions for kimi

| # | Decision | My recommendation | Rationale |
|---|---|---|---|
| D1 | Should `trusted` servers be exempt from the capability gate? | **No** — `trusted` bypasses *interactive confirmation*, NOT the capability boundary | Direct analog of §6.2: `skipConfirmation` bypasses the prompt, `forceConfirm` still gates. kimi: "god-mode narrows to bypassing only interactive confirmation, not security policy gates" — same principle for `trusted`. |
| D2 | Capability source: user-declared vs inferred vs both? | **Both**: Phase 1 inferred (name+args, no config), Phase 2 adds user-declared `capabilities` field as primary, inference as defense-in-depth fallback | Phase 1 ships the gap-fix with zero config/UI churn; Phase 2 makes it explicit + auditable. |
| D3 | Should critical-capability calls use the first-use cache? | **No** — critical calls always per-call confirm (never cached) | Mirror `DESTRUCTIVE_MCP_TOOL_PATTERN → manual` (server.ts:1117). Args can change between cached calls. |
| D4 | god-mode / auto_approve interaction | **No bypass** (gate doesn't read them); add `god_mode_active`/`auto_approve_active` to audit | Consistent with current MCP behavior + §6.1.5. Traceability via audit fields. |
| D5 | Scope: namespaced tools only, or meta tools too? | **Both** (Phase 2 shared helper) | `mcp_read_resource` reads arbitrary URIs (file://) — a file-read capability. Phase 1 can gate namespaced only; Phase 2 adds meta. |
| D6 | Phase 1 vs Phase 2 in one PR or two? | **Two PRs** | Phase 1 is a contained behavioral fix (security.ts + executeMcpTool + tests, no config/UI/protocol change). Phase 2 adds config schema + UI + meta coverage — larger blast radius. Keeps each PR reviewable + kimi-gated. |
| D7 | Default capability when undeclared | **`["unknown"]` → forceConfirm** | Safe default; nudges users to declare. A `read-only` declaration is the only way to opt out of forceConfirm for a non-destructive server. |
| D8 | `read-only` / `db-read` / `file-read` as non-critical? | **Yes, non-critical** (no forceConfirm) | Read-only tools don't mutate state; the exfil risk is real but lower than write/exec. (M2 `<untrusted>` + the read still being visible to the LLM is the residual risk for reads — separate concern.) |

## §6. What this does NOT fix (out of scope, flagged)

- **Read-path exfil** (D8 residual): a `read-only`/`file-read` `trusted` server can still exfil `~/.ssh/id_rsa` to the LLM, which can then relay it. The capability gate only forces confirmation for *critical* (write/exec/egress/mutate) capabilities. Read exfil is mitigated by: (a) M2 `<untrusted>` (LLM treats result as data — but can still read+relay), (b) the existing confirmation for non-`trusted` servers, (c) Phase 2 `file-read` could be escalated to critical if kimi prefers a stricter posture. **Flag for kimi: should `file-read`/`db-read` be critical too (stricter, more prompts) or non-critical (lower friction, rely on M2 + trusted-level)?**
- **Server-side malicious behavior**: a `trusted` MCP server's own implementation (e.g. a `query` tool that phones home) is invisible to companion. The gate can classify `network-egress` from the *server's declared capability* (Phase 2) but cannot detect it from args alone. Declaration is the enforcement point.
- **M11 MCP force-kill** (P2-2 reliability, separate milestone): unrelated to the capability gate.

## §7. Test plan (Phase 1)

Mirror §6.2's test matrix (PR #40's 15 tests). New file `companion/tests/mcp-capability-gate.test.ts`:

1. `classifyMcpCall` unit: name-based (`write_file` → file-write; `exec_cmd` → exec; `read_file` → file-read; `query` → unknown) + arg-based (path `/etc/shadow` → file-read; url `http://attacker` → network-egress; shell verb in args → exec).
2. `trusted` server + critical capability → confirms (forceMcpConfirm overrides needsConfirm=false).
3. `trusted` server + non-critical (`read-only`) → no confirm (needsConfirm=false, forceMcpConfirm=false).
4. `first-use` cached + critical capability → confirms AND does not cache (next call still confirms).
5. `first-use` cached + non-critical → uses cache (no re-prompt).
6. `manual` + anything → confirms (existing behavior preserved).
7. god-mode ON (`allow_all_schemes=true`) + critical MCP → still confirms (gate god-mode-unaware).
8. `DESTRUCTIVE_MCP_TOOL_PATTERN` name → still forces `manual` (existing behavior preserved, now also forceMcpConfirm).
9. Audit events: `security.mcp_critical_denied` on reject, `_confirmed` on approve, with `god_mode_active`/`auto_approve_active`/`capabilities` fields.
10. Name-regex evasion: `fetch_data` (non-destructive name) + network-egress arg → forceMcpConfirm=true (closes §3.1 row 3).

Targeted: `npm --prefix companion test` (security-gates suite + new file). Full suite for regression.

## §8. Implementation footprint (Phase 1 estimate)

- `companion/src/security.ts`: +`McpCapability` type, +`CRITICAL_MCP_CAPABILITIES`, +`classifyMcpCall()` (~40 lines, mirroring `detectCriticalApis`).
- `companion/src/server.ts`: `executeMcpTool` gate block (~15 lines) + audit events (~20 lines).
- `companion/tests/mcp-capability-gate.test.ts`: ~10 tests.
- `docs/`: this RFC → ADR-011 (MCP capability gate, §6.3).
- Zero config/UI/protocol/extension/storage change in Phase 1.

## §9. Open question for kimi

The single most important decision is **D1 + D8**: does kimi agree that the gap is the §6.2-analog (trusted/cached bypass capability boundary), NOT the original "god-mode auto-approves MCP" framing? And for reads (`file-read`/`db-read`): critical (stricter) or non-critical (rely on M2 + trusted-level)?

If GO on D1-D8: I implement Phase 1 first (two-PR plan, D6), kimi-gated as usual.
