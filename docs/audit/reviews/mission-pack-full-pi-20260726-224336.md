Now I have all the source code, spec, and prior reviews. Let me compile the adversarial review.

---

# Mission Pack P0+P1+P2 — Adversarial Security Review

**Branch**: `feat/mission-pack-p0` @ `ce0a2b9` · **Scope**: Full (P0 + P1 + P2), 5,258 LoC, 42 files  
**Spec**: `docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md`  
**Prior reviews**: Claude 78% on P0-only (`a170023`, 5 bugs) → Claude 72% on full (`ce0a2b9`, 5 new issues M1–M5) · Pi 88% on P0-only (MCP intersect gap)  
**Claim**: Companion 1878 pass, Extension 239 pass — accepted as hypothesis

---

## 1. What prior reviews caught & got fixed ✅

| Issue | Status | Evidence |
|---|---|---|
| Bug #1: S8 atomicity (switch A→B) | ✅ Fixed | `freezeSnap`/`baseSnap` built in memory, single `applyPackPatch` |
| Bug #2: Snapshot corruption (re-apply) | ✅ Fixed + tested | `freezeSnap` reuse; `packs-engine.test.ts:150-182` |
| Bug #3: User append loss | ✅ Fixed + tested | `extractUserAppendPortion` splits on `--- User ---` |
| Bug #5: Audit file world-readable window | ✅ Fixed | Pre-create with `0o600`, then `openSync("a", 0o600)` |
| Pi M1: MCP server intersect | ✅ Fixed | `configuredMcpServerIds` filter at L461 |

---

## 2. Prior-review issues still outstanding 🔴

### M1 — `workspace.set` bypasses mandated folder-picker *(exists, unchanged)*

`message-router.ts:1442-1452` accepts an **arbitrary absolute path** from any paired WS client. Spec §7.3B: "Companion **native folder-picker**". The `workspace.pick` route calls `pickFolderNative()` correctly, but `workspace.set` exists as an independent route accepting `{path: "/etc"}`. Combined with `workspace_read_file` (512KB), this is a host-file read primitive gated only by `modules.devsec-workspace.enabled`.

### M2 — `modules.update` lets any client rewrite `netsec.target_allowlist` *(exists, unchanged)*

`capability/modules.ts:109-122` `updateModuleConfig` strips only `enabled`/`available`. `target_allowlist`, `policy`, `allowlist_commands`, `require_task_auth` are all writable with **no** `capability_profile === "enterprise"` gate (contrast `setModuleEnabled` L87-94 which gates shell/netsec). **No audit log** call. Spec §7.3D: "config allowlist" — should be admin-gated.

### M3 — `netsec.authorize_task` has no human gesture *(exists, unchanged)*

`message-router.ts:1453-1479` trusts `rest.authorized === true` from WS. No `requestConfirmation()`, no `securityPolicy.validateToken`, no UI-gesture binding. Spec §7.3D: "每次任务 checkbox 默认**未勾选**". Targets aren't validated against allowlist at authorize time either.

### M4 — 10 new message types missing from `validateWsMessage` *(exists, unchanged)*

`server.ts` whitelist has no entries for `pack.*`, `modules.*`, `workspace.*`, `netsec.*`. Defense-in-depth gap.

### M5 — Non-atomic force-install *(exists, unchanged)*

`pack-engine.ts:220-250`: `removeNamespacedAssets → rmSync(dest) → renameSync → installAssetsFromValidated`. A throw between `rmSync` and `installAssetsFromValidated` leaves a pack installed but with no skill files. Triggered on every companion restart via `ensureBuiltinPacksInstalled({force:true})`.

---

## 3. New findings (not in prior reviews)

### N1 — `shell_exec` command text not shown in L2 preview *(MEDIUM)*

`server.ts` computes the L2 confirmation preview as:
```ts
const code = String(finalParams.code || finalParams.expression || "")
```
For `shell_exec`, the actual command is in `finalParams.command`, not `.code`. So `code = ""`, `checkHighRiskExecution("shell_exec", "")` sees nothing, and the L2 dialog shows an **empty code preview**. The user clicks "Allow" on `shell_exec` without seeing what command will run.

The token binding (`issueTokenFor("shell_exec", finalParams)`) still binds to the full params including command, so replay protection works. But the **human sees no command text** in the confirmation dialog. They're approving a blank tool call.

**Evidence**: `server.ts` ~L634 (code extraction), tool-schemas.ts `shell_exec` schema has `command` not `code`.

**Fix**: For `shell_exec`, use `finalParams.command` as the preview text. For `netsec_port_scan`, use `JSON.stringify(finalParams.targets)`.

### N2 — `shell_exec` allows `nmap` → bypasses netsec allowlist *(MEDIUM)*

The design spec says netsec scans must go through `netsec_port_scan` with allowlist gating. But when `modules.shell` is enabled, `shell_exec` can run `nmap`, `nc -z`, `curl` against any target — completely bypassing the `netsec.target_allowlist`. The LLM prompt says "Do not use for unauthorized network scanning" but there's **zero runtime enforcement**. 

`commandAllowedByPolicy` only checks `shell.allowlist_commands` — it has no awareness of netsec scope. If shell is enabled and netsec is disabled, the LLM has unrestricted scanning capability.

**Evidence**: `shell.ts:23-33` `commandAllowedByPolicy` only consults `shell.allowlist_commands`. No cross-module netsec check.

**Fix**: At minimum, reject shell commands matching scanning tool patterns (`nmap`, `nc`, `masscan`, `zmap`, `hping`, `rustscan`) when netsec is disabled. Long-term: the design should acknowledge this bypass explicitly.

### N3 — `spawn(command, {shell: true})` is ShellShock-vulnerable on old bash *(LOW)*

`shell.ts:65-68`:
```ts
const child = spawn(command, {
  shell: true,
  cwd,
  env: { ...process.env, CMSPARK_SHELL: "1" },
})
```
`{shell: true}` passes the command string through `/bin/sh -c`. On macOS, `sh` is `bash 3.2` which is vulnerable to ShellShock (CVE-2014-6271) if the environment contains crafted function definitions. `process.env` includes user environment variables. An attacker who controls any env var value can inject shell functions.

**Mitigation**: ShellShock is a 2014 CVE, most systems are patched. The `CMSPARK_SHELL=1` env var is the only addition. Acceptable risk for enterprise deployment.

### N4 — `workspace_read_file` silently truncates via `.slice(0, MAX_READ_BYTES)` *(LOW)*

`workspace.ts:93-95`:
```ts
if (st.size > MAX_READ_BYTES) {
  return { success: false, error: `file too large` }
}
```
But the actual read uses `buf.slice(0, MAX_READ_BYTES)` **in the calling function**... wait, no. Looking again: it checks size before reading, good. But there's no read call visible in the snippet. Let me check again...

Actually `fs.readFileSync(resolved.abs)` reads the full file. If the size check passes (≤512KB), it reads fully. If the check fails, it errors. This is correct — no truncation. The `.slice` in the return is on stdout in shell.ts, not here.

### N5 — `netsec_port_scan` `taskAuth` not freshness-checked *(LOW)*

`scan.ts:104-115` checks `auth.authorized === true` and `authTargets.has(t)`, but never checks `auth.at` for staleness. A thread authorized 30 days ago is still active. The `netsec_task_auth` record on the thread persists indefinitely.

**Evidence**: `scan.ts:104` — no timestamp comparison.

### N6 — No `netsec.scan.result=error` audit path *(LOW)*

`scan.ts` logs `appendCapabilityAudit({..., result: "denied"})` on deny (L100-108) and `result: "ok"` on success (L142-148). But if `probePort` throws or an exception occurs between the deny-check and the success-log, **no event is recorded**. The spec contract defines `result: "ok" | "denied" | "error"` — the error case is never emitted.

**Evidence**: `scan.ts:132` — `probePort` calls are not wrapped in try/catch for individual probes; a crash in one probe terminates the whole scan without an audit record.

### N7 — `commandAllowedByPolicy` allowlist uses prefix matching — risky *(LOW)*

`shell.ts:16`:
```ts
const ok = list.some((prefix) => command === prefix || command.startsWith(prefix + " "))
```

If `allowlist_commands = ["git"]`, then `git push --force` is allowed BUT so is `git; rm -rf /` (because `spawn` uses `shell: true`, the semicolon creates a second command). The `command.startsWith("git ")` check passes, and the shell executes both commands.

**Fix**: For `{shell: true}`, reject commands containing `;`, `&&`, `||`, `` ` ``, `$()`.

### N8 — `resolveUnderWorkspace` TOCTOU on `fs.existsSync` *(LOW)*

`workspace.ts:30-34`:
```ts
let targetReal: string
try {
  targetReal = fs.existsSync(joined) ? fs.realpathSync(joined) : joined
} catch { ... }
```
The `existsSync → realpathSync` sequence is checked atomically-ish (sync, single-threaded), and then later `fs.statSync(resolved.abs)` or `fs.readFileSync(resolved.abs)` operates on `targetReal`. Between `realpathSync` and `readFileSync`, a symlink could be swapped. Acceptable in single-user companion context.

---

## 4. Architected defense review

### 4.1 L2 Confirmation Gate for shell_exec / netsec_port_scan ✅

Verified: `capabilityForceConfirm = true` for both, which sets `forceConfirm = true`, which **overrides** all skip paths (god-mode, auto-approve, domain whitelist, thread trust). The L2 dialog is **always shown**. The issued `security_token` is HMAC-bound to the exact command/targets. Token validation happens in `executeCompanionTool` before execution. This matches §8.3.

**But** N1 degrades the dialog's meaningfulness (empty preview for shell_exec).

### 4.2 Module Gate ✅

`setModuleEnabled` (L79-99) correctly gates shell/netsec behind `capability_profile === "enterprise"`. `requireModule` returns typed errors consumed by capability functions. Default: all modules `enabled: false`. **But** M2 allows bypass via `updateModuleConfig`.

### 4.3 NetSec Scope Matching ✅

`scope.ts`:
- Empty allowlist → `isTargetAllowed` returns `false` → hard-deny ✅
- IPv4 CIDR math: `(~0 << (32 - bits)) >>> 0` correct ✅
- `*.example.com`: multi-level suffix match, apex excluded ✅
- IPv6: `isIP(t) === 6` → `false` (reject) ✅
- Case-insensitive hostname normalize ✅

### 4.4 Zip-Slip Defense ✅

Two-pass: pre-extract `path.resolve` containment check + post-extract `realpathSync` recursive walk. Both validate against the real base directory. This is robust.

### 4.5 Audit Log Contract ✅

`audit-log.ts`: pre-create `0o600`, append via `openSync("a", 0o600)`, 256KB line cap, 10MB rotate ×3, no command bodies for shell. Matches §8.2.

**But** N6: no `result: "error"` emission path.

### 4.6 Validator ✅

`validator.ts`: `schema_version` gate, `PACK_ID_RE`, `knownToolNames()` hard-reject, `scanForbidden` recursive, `resolveContained` realpath on both root and target, file/total size caps, 16KB system_prompt_append cap. Comprehensive.

---

## 5. Test coverage gaps

| Gap | Risk |
|---|---|
| `workspace.set` arbitrary path acceptance (M1) | No test |
| `updateModuleConfig` enterprise gate bypass (M2) | No test |
| `netsec.authorize_task` no-confirmation (M3) | No test |
| Shell preview shows command text (N1) | No UI test |
| `shell_exec` scanning-tool rejection (N2) | No cross-module test |
| `intersect` mode non-null path | Not tested (only null-degrade is) |
| Switch-A-then-fail-B (Bug #1 fix) | Not tested |

---

## 6. Severity matrix

| Finding | Severity | Blast radius | Exploitability |
|---|---|---|---|
| **M1** workspace.set bypass | MEDIUM-HIGH | Host file read (512KB chunks) | Paired WS + devsec enabled |
| **M2** updateModuleConfig no gate | MEDIUM-HIGH | Silent allowlist rewrite | Paired WS |
| **N1** shell_exec empty preview | MEDIUM | User approves unseen commands | L2 confirmation always shown |
| **N2** shell bypasses netsec scope | MEDIUM | Unrestricted scanning via shell | Shell module enabled only |
| **M3** netsec.authorize_task no gesture | MEDIUM | Self-authorization | Paired WS |
| M4 missing validateWsMessage | LOW | Defense-in-depth | Handlers do own validation |
| M5 non-atomic install | LOW | Restart-only, auto-recovery next start | Intermittent, rare |
| N3 ShellShock on old bash | LOW | 2014 CVE, patched everywhere | Only on unpatched bash 3.2 |
| N5 stale taskAuth | LOW | Same-thread reuse | Auth persists indefinitely |
| N6 missing error audit | LOW | Scan crash leaves no trace | Rare |
| N7 prefix injection in allowlist | LOW | `{shell: true}` splits on `;` | Requires shell allowlist mode |
| N8 TOCTOU symlink | LOW | Single-threaded, single-user | Unlikely in companion context |

---

## Verdict: **APPROVE_WITH_CHANGES — Confidence 66%**

The P0 platform (pack engine, validator, audit log, apply/unapply/snapshot, builtin appsec-prd-review pack, system_prompt_append merge) is **solid and well-tested**. Prior review bugs were genuinely fixed.

The P1/P2 additions (workspace, shell, netsec) ship with **four authorization surfaces weaker than the spec demands**:

1. **M1** — `workspace.set` accepts arbitrary paths, bypassing the mandated native folder-picker → ~5 lines to fix (issue picker nonce, consume in `workspace.set`)
2. **M2** — `updateModuleConfig` has no enterprise gate or audit for shell/netsec allowlist changes → ~10 lines to fix
3. **N1** — `shell_exec` shows empty text in L2 confirmation dialogs because `code` extraction looks for `.code`/`.expression` not `.command` → ~5 lines to fix
4. **M3** — `netsec.authorize_task` trusts WS message without UI gesture → ~15 lines to add confirmation token

All four are **tractable fixes** (<100 LoC total). None is a direct RCE — all still require paired WS + module enabled. But they violate defense-in-depth that the spec explicitly prescribes.

**Recommended pre-merge action**: fix M1, M2, N1, M3, and add `validateWsMessage` entries (M4). M5/N3/N5/N6/N7/N8 can ship as known issues.

With those four fixes + 6 missing tests → **APPROVE — ~85%**.
