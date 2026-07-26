I now have a complete picture of the entire implementation. Here is my structured adversarial review.

---

# Mission Pack P0 — Implementation Audit Report

| Field | Value |
|-------|-------|
| **Branch** | `feat/mission-pack-p0` |
| **Commit** | `a170023` |
| **Spec** | `docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md` |
| **Plan** | `docs/superpowers/plans/2026-07-26-mission-pack-p0.md` |
| **Design Review** | APPROVE_WITH_CHANGES (Claude 86% / Pi 84%), must-fix merged |
| **Test Baseline** | Companion: 1868 total, 1850 pass, 0 fail · Extension: 239 pass, 0 fail |
| **Lines Changed** | +3661 / −7 across 28 files |

---

## 1. Architecture Alignment

The implementation faithfully executes the P0 plan (Tasks 1–8) and the design spec. The core architecture — Companion as source of truth, zip/dir install → validation → namespaced asset copy → atomic `applyPackPatch` → snapshot-based rollback — matches the design.

| Spec Item | Implemented? | Notes |
|-----------|-------------|-------|
| `pack.yaml` schema v1 validator | ✅ Full | Tool name check, path containment, security blocklist, size limits |
| S11: intersect + null → degrade to allowlist | ✅ | `computeWhitelist` line 55–61 |
| S8: atomic apply (validate-then-commit) | ✅ | `applyPackPatch` validates all fields before first mutation |
| S9: snapshot-based uninstall rollback | ✅ | `snapshotFromThread` + `restoreSnapshot` |
| S4: forbidden keys blocklist | ✅ | Recursive scan in validator |
| `system_prompt_append` in ALLOWED keys | ✅ | 16KB limit, adapter merge order |
| Builtin `appsec-prd-review` pack | ✅ | Skills + knowledge + pack.yaml |
| `capability-audit.jsonl` | ✅ | 0o600, append-only, 256KB line limit, 10MB rotate ×3 |
| Module opt-in (appsec only, default false) | ✅ | `setModuleEnabled` + audit |
| Side Panel PacksPanel UI | ✅ | List, apply, module enable banner |
| **Shell PTY, NetSec, DevSec workspace** | N/A — correctly excluded | Spec says P1/P2 |

---

## 2. Security Deep-Dive

### 2.1 Zip-Slip Protection — **PASS**

Two-pass defense in `installPackFromZip`:
1. **Pre-extract**: Iterates entries, resolves each against realpath of tmp root, rejects if destination doesn't start with tmp root + separator
2. **Post-extract**: Recursive directory walk with realpath verification on every file/dir

This is robust against both direct traversal (`../../etc/passwd`) and symlink-in-zip attacks. The post-extract walk is the stronger defense since `adm-zip` extraction may create symlinks that weren't visible in entry inspection.

### 2.2 Path Containment in Validator — **PASS**

`resolveContained` uses `fs.realpathSync` on both the pack root and resolved target, then applies `path.relative()` + prefix check. This correctly resolves symlinks and rejects `..` escape. The TOCTOU window between validation and file copy is mitigated by the install path copying to a temp directory, re-validating, then atomically renaming.

### 2.3 Forbidden Keys Scan — **PASS**

`scanForbidden` recursively walks all nested objects in pack.yaml and `thread_defaults`. The blocklist includes `auto_approve_dangerous`, `allow_all_schemes`, `auto_approved_domains`, `trusted_domains`, `god_mode`. Called on both the top-level pack doc and the `thread_defaults` sub-object. A pack attempting to set `thread_defaults.auto_approve_dangerous: true` is caught.

### 2.4 Unknown Tool Rejection — **PASS**

The validator calls `getToolDefinitions()` and checks every `tools.allow` and `tools.deny` entry against the known set. Unknown tools are **rejected outright** (not silently stripped). This follows the spec's "拒绝" mandate exactly.

### 2.5 MCP Server Validation Gap — **FAIL (Medium)**

**Finding**: In `pack-engine.ts` line 446, `applyPack` sets:
```typescript
active_mcp_server_ids: result.manifest.mcp_servers || [],
```

The design spec §6.4 table says `active_mcp_server_ids` should be "`mcp_servers` 与**已连接** server 求交". The implementation bypasses this intersection — pack-declared MCP server IDs are written to the thread without checking whether those servers are configured or connected.

**Impact**: Currently low (the builtin pack declares `mcp_servers: []`), but any future pack with MCP server requirements could reference non-existent or disconnected servers. The MCP selection mode is forced to `manual`, so the invalid IDs won't be auto-activated, but they'll still appear in the thread state.

**Recommendation**: Add a validation step in `applyPack` that intersects `result.manifest.mcp_servers` with the list of currently connected MCP servers (from `McpManager` or config).

---

## 3. Correctness Analysis

### 3.1 System Prompt Merge — **PASS (with caveat)**

The `userAppendBase` computation in `applyPack` (lines 419–431) handles four major cases correctly:

| Scenario | `userAppendBase` result | Expected per §6.5 |
|----------|------------------------|-------------------|
| First apply (no prior user append) | `null` | Pack block only ✅ |
| First apply (user has append) | `existingAppend` (user text) | Pack → User ✅ |
| Re-apply same pack | `null` (early return) | Pack block only, no stacking ✅ |
| Switch to different pack | Restored user append from snapshot | User → new Pack ✅ |

**Caveat**: This has 7 conditional branches with no dedicated unit tests. The four edge cases above are exercised only through the full integration test. Brittle to refactoring.

### 3.2 Atomic Apply — **PASS**

`applyPackPatch` in thread-manager.ts validates **every field** before making the first mutation:
1. `active_skill_ids` array shape check
2. `tool_whitelist` null-or-array check
3. Three selection modes checked against `["auto", "all", "manual"]`
4. `active_mcp_server_ids` shape check
5. `config_override` merge validated through `validateConfigOverride`
6. Only after all pass: direct field assignments to thread object
7. `this.saveIndex()` writes to disk

### 3.3 Snapshot Integrity — **PASS**

`snapshotFromThread` captures a deep clone of mutable arrays (`[...thread.active_skill_ids]`, `[...thread.active_mcp_server_ids]`). Snapshots are taken **before** the pack is applied, ensuring they capture pre-pack state. On uninstall, the snapshot is restored via `applyPackPatch` which re-validates and re-commits.

### 3.4 Uninstall Without Snapshot Fallback — **PASS (with minor gap)**

When a thread has `mission_pack_id === packId` but no snapshot (shouldn't happen, but defensive), the uninstall code (line 477–483):
- Sets `tool_whitelist = null` — correct per spec
- Filters `active_skill_ids` by pack prefix — correct
- Sets `system_prompt_append = null` — correct
- **Does NOT restore**: `skill_selection_mode`, `knowledge_selection_mode`, `mcp_selection_mode`, `active_mcp_server_ids` — these remain in pack-configured state after pack removal

**Impact**: Minor; this is a defensive fallback for corrupt state that shouldn't occur in normal operation.

### 3.5 Module Enable/Disable — **PASS**

`setModuleEnabled` correctly:
- Checks `available === true` before allowing enable/disable
- Does NOT silently enable a module that was never available
- Writes audit log with timestamp and actor
- Prevents enabling non-existent modules

### 3.6 `ensureBuiltinPacksInstalled` Force-Reinstall — **Observation**

Every server startup calls `installPackFromDirectory(..., { force: true })`. While correct (ensures builtin updates propagate), this does a full directory copy + asset re-install on every start. Acceptable for P0 with a single small pack, but should become a version check before P1.

---

## 4. Test Coverage Audit

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `packs-validator.test.ts` | 4 | Unknown tool reject, valid tool accept, path escape, security blocklist in thread_defaults |
| `packs-engine.test.ts` | 4 | Install + apply + uninstall lifecycle, intersect degrade, module blocked, builtin install |
| `packs-audit-log.test.ts` | 2 | Append + permissions, oversized line skip |
| `thread-pack-patch.test.ts` | 3 | Atomic patch, system_prompt_append acceptance, invalid shape rejection |

### Coverage gaps:

| Gap | Severity |
|-----|----------|
| System prompt merge branching logic | **Medium** — 7 branches, no dedicated unit test |
| Zip-slip with actual symlink-in-zip | **Low** — post-extract walk catches it, but no test exercises it |
| Re-apply same pack (no stacking) | **Low** — path exercised in lifecycle test, but not asserted for system_prompt |
| `pack.apply` with `workspace_path` option | **Low** — feature not fully designed for P0 |
| `modules.set_enabled` → audit log content | **Low** — audit log existence tested but not content |

---

## 5. Type Safety & Code Quality

### 5.1 Duplicate `ThreadPackSnapshot` — **Issue**

Two independent definitions of `ThreadPackSnapshot` exist:
- `companion/src/packs/types.ts` (exported, used by pack-engine)
- `companion/src/threads/thread-manager.ts` (local interface, used by applyPackPatch)

The thread-manager version omits `SelectionMode` import from types. If fields diverge between these two, `snapshotFromThread` in pack-engine (which casts with `as ThreadPackSnapshot`) could silently produce incompatible shapes for `applyPackPatch`.

### 5.2 `snapshotFromThread` uses `any` — **Observation**

```typescript
function snapshotFromThread(thread: any): ThreadPackSnapshot {
```

The thread parameter is typed as `any` rather than the `Thread` interface from thread-manager. This is because pack-engine.ts doesn't import the Thread type. A shared type import would improve safety.

### 5.3 Dynamic Imports in WS Handlers — **Observation**

Each WS handler (`pack.list`, `pack.apply`, etc.) does `await import("./packs/pack-engine")`. Since all handlers that need the engine import it separately, this creates multiple import references to the same module. Node.js caches the module after first import, so this is correct but verbose.

---

## 6. UI Integration

### 6.1 PacksPanel — **PASS**

Clean, minimal implementation following the design:
- Lists installed packs with `apply_blocked` reason
- Shows active pack per thread
- Module enable banner when appsec is off
- Handles error states with status messages

### 6.2 Mode Controller — **PASS**

`packs` tab added to both L0 (`chat`: `["skills", "knowledge", "packs", "history"]`) and L1 (`browser`: `["tabs", "skills", "packs"]`). L2 (computer) correctly excludes it.

### 6.3 WebSocket Integration — **PASS**

`pack.applied` → `UPSERT_THREAD` dispatch correctly updates thread state in the extension store. Background script forwards all 6 new message types. The `IconSkills` reuse for the "packs" tab is a placeholder — functional but semantically imprecise.

---

## 7. Spec Compliance Summary

| Spec § | Requirement | Status |
|--------|------------|--------|
| 6.1 | Pack schema v1 | ✅ |
| 6.2 | Validation rules (all 10) | ✅ |
| 6.2 | Security blocklist keys | ✅ |
| 6.3 | Install flow + zip slip | ✅ |
| 6.4 | Thread field mapping | ⚠️ MCP server intersection missing |
| 6.4 | S8 atomic apply | ✅ |
| 6.4 | S11 intersect degrade | ✅ |
| 6.5 | system_prompt_append merge order | ✅ |
| 6.6 | Namespaced skill/knowledge copy | ✅ |
| 6.7 | Snapshot + uninstall rollback | ✅ |
| 8.2 | Audit log contract (all 6 items) | ✅ |
| 7.1 | Module registry | ✅ |
| 10 | P0 delivery checklist (9 items) | ✅ (8 + 1 partial) |

---

## 8. Verdict

### **APPROVE_WITH_CHANGES** · Confidence: **88%**

The implementation is solid for P0. The architecture faithfully follows the approved design, the security posture is strong (zip-slip hardening, forbidden keys, path containment), and tests are comprehensive for the core paths. No test failures.

**Must-fix (1 item):**

| ID | Issue | Fix |
|----|-------|-----|
| **M1** | MCP server IDs from pack are not intersected with connected servers (§6.4 spec violation) | Add `McpManager` lookup in `applyPack` before setting `active_mcp_server_ids` |

**Should-fix (2 items):**

| ID | Issue | Fix |
|----|-------|-----|
| **S1** | System prompt merge has 7 branches with zero dedicated unit tests — high refactoring risk | Add `packs-engine.test.ts` test for each merge scenario (first apply, re-apply, switch packs, user append present) |
| **S2** | `ThreadPackSnapshot` duplicated in `types.ts` and `thread-manager.ts` — will drift | Consolidate to `types.ts`, have `thread-manager.ts` import it |

**Advisory:**

| ID | Issue | Recommendation |
|----|-------|----------------|
| A1 | `ensureBuiltinPacksInstalled` force-reinstalls every startup | Add version comparison before P1 |
| A2 | `snapshotFromThread` parameter typed as `any` | Import Thread interface from thread-manager |

No blocking security vulnerabilities found. The MCP gap is a correctness issue, not a security one at P0 (builtin pack declares empty MCP servers). Approve for merge after M1 fix.
