# RFC — follow-up C Phase 2-B: user-declared MCP server capabilities

> **Status:** design — pending kimi review
> **Date:** 2026-07-12
> **Predecessor:** `docs/followup-c-mcp-capability-gate-rfc-2026-07-12.md` (Phase 1, PR #44),
> Phase 2-A meta-tool gate (PR #45)
> **Scope:** companion-only. No extension / WS / protocol / storage-schema-breaking change.

## 1. Problem

Phase 1 (`classifyMcpCall`, PR #44) infers an MCP tool's capabilities from its **name + args**
heuristics. This is defense-in-depth, but it has two known gaps:

1. **False negative (under-classify):** a tool with a benign name that does something dangerous
   and whose args happen not to trip the arg-scan at this call — e.g. a custom `process_data`
   tool that shells out, called with args that don't contain a URL/shell/content-pair literal.
   Inference returns `{unknown}` (→ critical → force-confirm, so this is actually *caught*),
   BUT if the name happens to match a read keyword (`get_info`, `query`), inference returns
   `{read-only}` (non-critical) and the dangerous behavior is missed.

2. **False positive (over-classify):** a tool with a scary name that is actually safe — e.g.
   `delete_cache_entry` (in-memory cache, no real deletion) → inference tags `db-mutate` (delete
   keyword) → force-confirm every call. The user cannot tell the gate "I've vetted this; it's
   read-only", so vetted tools nag forever.

Phase 1 explicitly deferred both to "Phase 2 user-declared `capabilities` field" (security.ts:265-267).
This RFC is that field.

## 2. Goal

Let the user **declare** the security capabilities of an MCP server in `config.json`, so:

- The gate uses the declaration as a **primary** signal (resolves false-negatives AND false-positives).
- Phase 1 inference remains as **defense-in-depth** (never fully overridden — see §4).

## 3. Proposed schema

### 3.1 Field

Add to `McpBaseServerConfig` (`companion/src/mcp/types.ts:13`):

```ts
import type { McpDeclaredCapability } from "../security.js"

interface McpBaseServerConfig {
  enabled: boolean
  trust_level: McpTrustLevel
  startup_timeout_ms?: number
  call_timeout_ms?: number
  restart_policy?: Partial<McpRestartPolicy>
  roots?: Array<{ uri: string; name?: string }>
  /**
   * User-declared security capabilities for this server's namespaced tools. Used as the
   * PRIMARY classification source by the §6.3 capability gate; Phase 1's classifyMcpCall
   * inference remains as defense-in-depth (union, never fully overridden — see RFC §4).
   *
   * Omit the field entirely to keep pure-inference behavior (Phase 1 default).
   */
  security_capabilities?: McpDeclaredCapability[]
}
```

### 3.2 Naming

**`security_capabilities`**, NOT `capabilities`. There is an existing `McpCapabilities` type
(`types.ts:59` = `{tools, resources, prompts}` — MCP **protocol**-level flags the server
advertises) and `McpServerMeta.capabilities` (line 91). Reusing `capabilities` for a security
classification array of a different element type would be a confusing collision. `security_`
prefix disambiguates at every read site.

### 3.3 New type

In `security.ts`:

```ts
/** The subset a user may declare for a server. Excludes "unknown" (a non-declarable sentinel
 *  meaning "inference found nothing" — declaring "I don't know" is meaningless) and the
 *  read variants are kept so a user can explicitly vouch for read-only behavior. */
export type McpDeclaredCapability = Exclude<McpCapability, "unknown">
```

`McpCapability` stays as the full union (inference can still yield `"unknown"`).

## 4. The design fork: ADD vs REPLACE semantics  ← kimi decision

When both inference and a declaration are present, how do they combine? Three options:

### Option A — pure ADD (union)
`final = inferred ∪ declared`
- Declared can only **escalate**. A user can never weaken the gate below inference.
- **Pro:** maximally fail-safe; matches the project invariant "god-mode bypasses the UI prompt,
  not the capability boundary" — the user shouldn't either, for inferred caps.
- **Con:** cannot resolve false-positives (the `delete_cache_entry` case). And because inference
  always includes `"unknown"` when nothing matched, declaring `["read-only"]` on an unclassified
  tool still yields `{unknown, read-only}` → still force-confirms. ADD alone doesn't deliver
  goal §2's false-positive resolution.

### Option B — pure REPLACE
`final = declared if non-empty else inferred`
- Declared is authoritative.
- **Pro:** resolves both false-negatives and false-positives.
- **Con:** **fail-dangerous.** A misconfigured or prompt-injection-influenced declaration of
  `["read-only"]` would suppress a *positively-inferred* critical capability. e.g. a `save_file`
  tool (inference: `file-write`) declared `["read-only"]` runs zero-confirmation on a `trusted`
  server. This reopens exactly the Phase 1 hole.

### Option C — hybrid: REPLACE the "unknown" sentinel, ADD the rest (RECOMMENDED)
```ts
const inferred   = classifyMcpCall(toolName, params)          // may include "unknown"
const declared   = manager.getServerConfig(serverName)?.security_capabilities ?? []
const inferredK  = inferred.filter(c => c !== "unknown")      // strip the non-declarable sentinel

let final: McpCapability[]
if (inferredK.length > 0) {
  final = uniq([...inferredK, ...declared])                   // inferred ALWAYS applies (ADD)
} else if (declared.length > 0) {
  final = uniq(declared)                                      // resolve the "unknown" ambiguity
} else {
  final = ["unknown"]                                         // no signal → critical (Phase 1 default)
}
const forceMcpConfirm = final.some(c => CRITICAL_MCP_CAPABILITIES.has(c))
```

**Invariants (Option C):**
- **I1.** A *positively-inferred* critical capability can NEVER be suppressed by any declaration
  (fail-safe — closes the Option B hole).
- **I2.** The user CAN resolve the false-positive on an unclassified tool: declaring
  `["read-only"]` when inference found nothing replaces the `"unknown"` sentinel → no
  force-confirm (the user is explicitly vouching; no worse than existing `trust_level: "trusted"`).
- **I3.** The user CAN escalate: declaring `["exec"]` on a tool inference missed adds it → force-confirm.
- **I4.** Pure-inference behavior is unchanged when the field is absent (Phase 1 regression-free).

**Recommendation: Option C.** It is the only option that satisfies all of §2's goals without
reopening a bypass. The decision is whether kimi agrees I2's "user resolves unknown" is an
acceptable trust grant (it is the same trust already implied by setting the *server* to
`trust_level: "trusted"`).

## 5. Integration points

### 5.1 The gate (`executeMcpTool`, server.ts:1140)
Replace the single `classifyMcpCall` call with the Option-C merge above. The rest of the gate
(force-confirm → request, never-cache critical, audit log) is unchanged. Add
`declared_capabilities` to the `mcp.confirm.requested` / `security.mcp_critical_denied` /
`security.mcp_critical_confirmed` log entries for forensic traceability.

### 5.2 Meta-tool path (`executeMcpMetaTool`, server.ts:1307)
**Unchanged.** `mcp_read_resource` / `mcp_get_prompt` force-confirm via `CRITICAL_MCP_META_TOOLS`
(Phase 2-A), independent of `CRITICAL_MCP_CAPABILITIES`. A server's declared
`security_capabilities` describe its *namespaced tools*, not the meta-tool read surface.
Conflating them would re-criticalize reads — exactly what Phase 2-A's "deliberately separate"
comment (security.ts:310-312) warns against.

### 5.3 Config validation (`validateServerConfig`, manager.ts:455)
Lenient: if `security_capabilities` is present, require it to be an array; each entry must be a
known `McpDeclaredCapability`. **Drop only the invalid entries with a warning, never the whole
server** (a typo in one capability value shouldn't orphan a configured server). Unknown string
values are ignored by the gate anyway (not in `CRITICAL_MCP_CAPABILITIES`, can't de-escalate via
union), so stripping them is cosmetic + a warning.

### 5.4 Hot reload / restart
`security_capabilities` is a classification annotation, not a transport param → **NOT** added to
`RESTART_FIELD_KEYS` (types.ts:128). `applyConfig` updates `currentConfig` (manager.ts:85)
immediately; `getServerConfig(name)` returns the new value at the next gate call. The existing
soft-update path (`client.updateConfig`, manager.ts:118-124) is a no-op for this field (the client
doesn't consume it) — harmless.

### 5.5 Extension round-trip
`McpServerMeta.config` (types.ts:99 / manager.ts:390) snapshots the full `McpServerConfig`, so
the field round-trips to the extension edit form automatically. The form won't *expose* it until
Phase 2-C, but it won't drop it on edit/save either (the extension already preserves unknown
fields on round-trip). No extension change required for 2-B.

## 6. Test plan

### 6.1 Unit (`classifyMcpCall` merge helper — new exported fn)
A small pure helper `mergeCapabilities(inferred, declared): McpCapability[]` to unit-test the
Option-C logic in isolation:
- U1. inferred `{file-write}` + declared `[]` → `{file-write}` (I4 regression)
- U2. inferred `{unknown}` + declared `[]` → `{unknown}` (Phase 1 default)
- U3. inferred `{unknown}` + declared `[read-only]` → `{read-only}` (I2 resolves FP)
- U4. inferred `{file-write}` + declared `[read-only]` → `{file-write, read-only}` (I1 — inferred critical NOT suppressible)
- U5. inferred `{read-only}` + declared `[exec]` → `{read-only, exec}` (I3 escalate)
- U6. inferred `{file-write}` + declared `[exec]` → `{file-write, exec}` (union, both critical)
- U7. inferred `[]`?? — `classifyMcpCall` never returns empty (always at least `unknown`), but
  mergeCapabilities should treat empty inferred as `unknown`-equivalent for safety.

### 6.2 Integration (gate behavior over WS pair, extends `mcp-capability-gate.test.ts`)
- I1. trusted server, tool `save_file` (inferred file-write), declared `[read-only]` → STILL
  force-confirms (the bypass Option B would open — prove it stays closed).
- I2. trusted server, unclassified tool `foobar` (inferred unknown), declared `[read-only]` →
  NO force-confirm (trust_level skip applies; only first-use cache as usual).
- I3. trusted server, unclassified tool `foobar`, declared `[exec]` → force-confirms despite
  trusted + benign name.
- I4. trusted server, `save_file`, NO field → force-confirms (Phase 1 regression).
- I5. first-use server, unclassified tool, declared `[read-only]`, approved once → cached, 2nd
  call skips (non-critical caching preserved).
- I6. invalid declared value `["bogus"]` → stripped + warning logged; server still loads;
  inference-only behavior (→ unknown → force-confirm).
- I7. audit log: `declared_capabilities` present in confirm/denied entries.

### 6.3 Regression
Full `npm test` (Phase 1's 17 tests + Phase 2-A's 9 must stay green); tsc clean.

## 7. Out of scope (later phases)
- **P2-C:** extension UI form field for `security_capabilities` (cross-layer).
- **P2-D:** `godmode_bypassed layer:"mcp"` real-time audit broadcast to extension UI.
- **P2-E:** Phase 1 NITs (non-http(s) schemes, bare-IP, >4000-char arg tail).

## 8. Open question for kimi
**ADD vs REPLACE vs hybrid (Option C)?** Recommend Option C. The sub-question under I2: is
letting the user declare `["read-only"]` to resolve an `unknown` classification an acceptable
trust grant, given it's equivalent to the trust already granted by `trust_level: "trusted"`?
