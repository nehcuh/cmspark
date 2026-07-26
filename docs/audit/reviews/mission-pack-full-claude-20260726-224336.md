I have enough to synthesize. Writing the verdict.

---

# Mission Pack Full Implementation — Adversarial Review

**Branch** `feat/mission-pack-p0` @ `ce0a2b9` · **Scope** P0 + P1 + P2 (5,258 LoC, 42 files)
**Spec** `docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md`
**Prior reviews** Claude (78%, 5 bugs) + Pi (88%, MCP gap) on `a170023` — P0 only.
**Test claim** Companion 1878 / Extension 239 pass — **not independently verified** (test exec was gated in this session; accepting as hypothesis per Pi's precedent).

## What's fixed vs prior review ✅

| Prior issue | Status | Evidence |
|---|---|---|
| Claude Bug #1 atomicity (switch A→B) | ✅ Fixed | `pack-engine.ts:416-432` builds `baseSnap`/`freezeSnap` in memory, single `applyPackPatch` call at L467 |
| Claude Bug #2 snapshot corruption (re-apply) | ✅ Fixed + tested | `freezeSnap` reuses original snapshot; `packs-engine.test.ts:150-182` asserts snapshot equality across re-applies |
| Claude Bug #3 user-append loss | ✅ Fixed + tested | `extractUserAppendPortion` (L332-343) splits on `--- User ---`; helper unit-tested L184-192 |
| Claude Bug #5 audit file world-readable briefly | ✅ Fixed | `audit-log.ts:79-83` pre-creates file with `0o600` then `openSync(p, "a", 0o600)` |
| Pi M1 MCP server intersect | ✅ Fixed | `pack-engine.ts:461-462` filters `mcp_servers` through `configuredMcpServerIds(config)` |

## New findings — P1/P2 surfaces

### M1 — `workspace.set` bypasses the native folder-picker *(MEDIUM-HIGH)*

`message-router.ts:1442-1452` accepts an arbitrary absolute path string from any paired WS client and stores it as `thread.workspace_root` via `setWorkspaceRoot()`. Spec §7.3B mandates "**Companion native folder-picker**" — `workspace.pick` correctly calls `pickFolderNative()`, but `workspace.set` exists as a sibling route with no picker binding. Combined with `workspace_read_file` (512KB chunks, no binary), this is a host-file read primitive gated only by the `devsec-workspace` module flag. A prompt-injected page that compromises the extension can: `workspace.set /etc` → `workspace_read_file passwd`.

**Fix:** require a recent picker nonce on `workspace.set` (issue nonce from `workspace.pick`, consume once), or remove the route and rely solely on `workspace.pick`.

### M2 — `modules.update` lets any client rewrite `netsec.target_allowlist` without enterprise gate or audit *(MEDIUM-HIGH)*

`capability/modules.ts:109-122` `updateModuleConfig` only strips `enabled`/`available` from the patch — `target_allowlist`, `policy`, `allowlist_commands`, `require_task_auth` are all writable. No `capability_profile === "enterprise"` check (contrast `setModuleEnabled` L87-94 which gates shell/netsec). No `appendCapabilityAudit` call. A community-profile install can pre-load `target_allowlist: ["0.0.0.0/0"]` so that the moment enterprise is flipped on, the allowlist is already permissive. In enterprise, a paired WS client can rewrite the allowlist freely with no audit trail — violating S7's spirit ("所有 module 启停与 NetSec 任务授权写入 history / 结构化 audit log").

**Fix:** mirror `setModuleEnabled`'s profile gate for netsec/shell patches; audit each allowlist/policy change.

### M3 — `netsec.authorize_task` has no human-in-the-loop enforcement *(MEDIUM)*

`message-router.ts:1453-1479` trusts `rest.authorized === true` from the WS message. There is no `requestConfirmation()` call, no `securityPolicy.validateToken`, no UI-gesture binding. Spec §7.3D table: "任务授权: 每次任务 checkbox 默认 **未勾选**". Targets aren't validated against the allowlist at authorize time either, so the audit log can record authorizations for non-allowlist targets. The LLM can't call this directly (not in `tool-definitions`), but defense-in-depth is broken: a malicious extension self-authorizes trivially.

**Fix:** require a security_token or bind authorized targets to a recent UI confirmation; reject targets not in current allowlist at authorize time (fail-closed).

### M4 — `validateWsMessage` missing all 10 new message types *(LOW — defense-in-depth)*

`server.ts:3152-3388` whitelists ~50 existing types with shape validators, then falls through to `{valid: true}` for unknown. None of `pack.list/install/apply/uninstall`, `modules.list/set_enabled/update`, `workspace.pick/set`, `netsec.authorize_task` have entries. Handlers do their own validation so this isn't a direct vuln, but the project's own pattern (see `computer.model.set_enabled` with both `validateWsMessage` AND handler belt) shows this was an oversight.

### M5 — Bug #4 from prior review still outstanding *(LOW)*

`pack-engine.ts:220-250` install is sequential: `removeNamespacedAssets → rmSync(dest) → renameSync(tmp,dest) → installAssetsFromValidated → refresh`. A throw after `renameSync` (disk full, permission race, concurrent uninstall) leaves installed dir present but no namespaced skills. Builtin packs re-install on every start via `ensureBuiltinPacksInstalled({force:true})`, so the window is short — but a manually-installed pack hitting this is left inert with no auto-recovery. **Fix:** stage new assets before deleting old.

### Coverage gaps *(LOW)*

No tests for: (a) M1 `workspace.set` accepting arbitrary path, (b) M2 community profile rewriting netsec allowlist, (c) M3 self-authorization, (d) Bug #1 switch-A-then-fail-B (the fix is correct, untested), (e) Pi's symlink-in-zip slip case, (f) `intersect` mode non-null path (only null-degrade is tested).

## Solid

- **Validator:** schema_version gate, `PACK_ID_RE`, realpath containment on both root + target, recursive `scanForbidden`, hard unknown-tool rejection (no warn-and-strip), file/total size caps.
- **Atomic applyPackPatch:** all fields validated before mutation, single `saveIndex` commit (`thread-manager.ts:376-433`).
- **Adapter ordering:** `overrideSystemPrompt || basePrompt → skillPrompt → systemPromptAppend → safetyGuardContent` matches §6.5.
- **Audit contract:** 0o600 pre-create, 256KB line cap, 10MB rotate ×3, no command bodies for shell.
- **L2 token binding:** `shell_exec` and `netsec_port_scan` both gate on `securityPolicy.validateToken(token, toolName, args)` at exec time (`server.ts:1901-1928`) — token is HMAC-bound to the exact command/targets, so the LLM can't reuse a stolen token for different args. This is the actual confirmation gate; the comment in `shell.ts:25` ("L2 gate still required") is honored in `server.ts`.
- **netsec scope matching:** IPv4 CIDR math correct (`(~0 << (32-bits)) >>> 0`), `*.example.com` matches multi-level and skips apex, IPv6 hard-denied, empty list denies all.

## Verdict

## **APPROVE_WITH_CHANGES — Confidence 72%**

The P0 platform is solid and the prior bugs were genuinely fixed (with tests). The P1/P2 additions introduce three authorization surfaces that are **weaker than the spec demanded**:

- M1 `workspace.set` bypasses the mandated folder-picker → host file-read primitive
- M2 `modules.update` bypasses the enterprise gate the spec applies to netsec enable → silent allowlist edits, unaudited
- M3 `netsec.authorize_task` has no real user-gesture enforcement

None is a direct RCE — `shell_exec`/`netsec_port_scan` still require L2 security_token per call, and all routes require a paired WS client. But the **defense in depth** the spec baked in (real folder picker, profile-gated allowlist edits, real human authorization checkbox) is partially missing. A prompt-injected page that lands on the extension can rewrite the allowlist, self-authorize task targets, set `workspace_root=/etc`, and read files — at minimum the spec's blast-radius contract is violated.

**Recommended pre-merge fixes (tractable, <150 LoC):**
1. Bind `workspace.set` to a picker nonce (or remove it).
2. Add enterprise gate + audit log to `updateModuleConfig` for netsec/shell module patches.
3. Validate `netsec.authorize_task` targets against current allowlist; require a confirmation token.
4. Add `validateWsMessage` entries for the 10 new types.
5. Stage-then-swap install to close Bug #4.

Then add the 6 missing tests and the verdict moves to **APPROVE — 88%**.

Test-pass claim (1878/239) is **accepted as hypothesis** — could not run `npm test` without approval in this session.
