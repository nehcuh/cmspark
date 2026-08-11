# Adversarial Review — default-workspace-sandbox Scheme 1

| Field | Value |
|-------|--------|
| **Batch** | `default-workspace-sandbox-scheme1` |
| **Date** | 2026-08-11 |
| **Reviewer** | Independent adversarial (did not implement) |
| **Blast tier** | T2 (DevSec `workspace_*` UX) + security-adjacent FS fallback |
| **Repo** | `/Users/huchen/Projects/cmspark` |
| **Evidence level** | Runtime tests **[executed]**; call-path / shell / UI / catalog **[inspected]**; symlink probes **[executed]** |

---

## 1. Summary

Scheme 1 **runtime contract is met**: when `thread.workspace_root` is null/empty, `workspace_list_dir` / `workspace_read_file` fall back to `~/CMspark-projects` (mkdir `0o700` if missing), **without** writing `thread.workspace_root`. Explicit bind still wins; `setWorkspaceRoot` still requires `consumeNativePick`; module gate `devsec-workspace` still applies; `shell_exec` cwd is **not** forced to the sandbox.

Containment against `../` escape and against `~/CMspark-projects` → **outside home** symlink is solid. Recoverable classification for `default_sandbox_unavailable` works.

**Residual / trajectory issues (non-blocking for security DoD, material for product completeness):**

1. **Stale LLM tool catalog** still claims `workspace_root` must be set and instructs the model to stop and demand folder pick — undercuts Scheme 1 happy path.
2. **In-home symlink root** is accepted after `realpath` (e.g. `~/CMspark-projects` → `~/secret-dir`); expands host_read surface under home without folder-picker.
3. **UI/docs drift**: ChatView hard-bind hint, CLAUDE.md / ADR-014 still describe old “must pick folder” gate; pre-existing dir mode not re-chmodmed to `0o700`.

**Outcome**: Scheme 1 security + core product DoD **pass** with nits.  
**Trajectory**: Scope tight (8 tracked files + docs); no shell/module gate regression.  
**Verdict**: **APPROVE_WITH_NITS**

---

## 2. Machine evidence (commands + exit)

### 2.1 Git surface (implementer delta)

```text
$ git status -sb / diff --stat
 M chrome-extension/src/sidepanel/components/PacksPanel.tsx
 M chrome-extension/src/sidepanel/utils/gate-error-copy.ts
 M companion/src/capability/user-gate-copy.ts
 M companion/src/capability/workspace.ts
 M companion/src/security.ts
 M companion/tests/capability-workspace.test.ts
 M companion/tests/security-thread.test.ts
 M docs/mission-pack-usage.md
?? .grok/workflows/default-workspace-sandbox.rhai   # untracked; out of batch DoD
```

`project-dir.ts` / `shell.ts` **not** modified in this batch (correct for Scheme 1 — inspected for non-regression only).

### 2.2 Required test command

```bash
cd companion && npx tsx --test tests/capability-workspace.test.ts tests/project-dir.test.ts
```

| Metric | Result |
|--------|--------|
| **Exit code** | **0** |
| Tests | 12 pass / 0 fail |
| Duration | ~72 ms |

Coverage observed **[executed]**:

- `effectiveWorkspaceRoot(null)` → under `HOME`/`CMspark-projects`
- null root `workspaceListDir` / `workspaceReadFile`
- explicit root preferred over sandbox
- `../` escape rejected under sandbox fallback
- module gate still blocks when disabled
- pre-existing project-dir tests still green

### 2.3 classifyError probe **[executed]**

| Message sample | Class |
|----------------|--------|
| `cannot create default sandbox … [default_sandbox_unavailable]` | `recoverable` |
| `… path escapes home [default_sandbox_unavailable]` | `recoverable` |
| `module_disabled: devsec-workspace` | `recoverable` |
| `path escapes workspace_root` | `non_recoverable` (pre-existing; not Scheme 1 token) |

### 2.4 Symlink / mode adversarial probes **[executed]**

| Scenario | Result |
|----------|--------|
| `~/CMspark-projects` → symlink **outside** home | `ok:false` + `default_sandbox_unavailable` / escapes home |
| `~/CMspark-projects` → symlink **inside** home (secret dir) | `ok:true`, `path` = realpath of secret — **read surface expands** |
| Path exists as regular file | `ok:false` + not a directory |
| Pre-existing dir mode `0755` | ensure succeeds; **mode stays 755** (no re-chmod) |

---

## 3. Contract checklist (Scheme 1)

| # | Requirement | Result | Evidence |
|---|-------------|--------|----------|
| 1 | Unset/empty `workspace_root` → list/read use `~/CMspark-projects` (mkdir `0o700` if missing) | **PASS** | `workspace.ts` `ensureDefaultSandboxRoot` + `resolveUnderWorkspace`; tests null list/read |
| 2 | MUST NOT write/auto-bind `thread.workspace_root` | **PASS** | Fallbacks only return paths; dispatch `workspaceListDir(thread?.workspace_root, …)` does not call `threadManager.update`. Bind only via `workspace.pick` / `workspace.set` |
| 3 | When `workspace_root` set: explicit path wins | **PASS** | `resolveUnderWorkspace` trim-nonempty branch; test “explicit preferred over default sandbox” |
| 4 | Path containment; no escape | **PASS** (with residual in-home symlink-root note §4) | `../` rejected; absolute rel rejected; realpath + `path.relative` gate |
| 5 | `shell_exec` cwd must NOT force CMspark-projects | **PASS** | `shell.ts` `normalizeShellCwd`: params → workspaceRoot → `process.cwd()` only; no project-dir import **[inspected]** |
| 6 | `setWorkspaceRoot` still requires native folder-picker | **PASS** | `consumeNativePick` gate unchanged; router `workspace.pick` → `recordNativePick` → `setWorkspaceRoot` |
| 7 | `requireModule('devsec-workspace')` still gates list/read | **PASS** | First lines of `workspaceListDir` / `workspaceReadFile`; test “module gate blocks when disabled” |

**Product soft requirements (not numbered, but Scheme 1 UX):**

| Item | Result |
|------|--------|
| UI does not claim “bound” when only sandbox | **PASS** — PacksPanel: “默认沙箱 ~/CMspark-projects（可绑定真实项目）”; clear only when explicit root |
| Create-fail / hard gate recoverable + human copy | **PASS** — `security.ts` tokens + user-gate-copy + gate-error-copy |
| LLM tool surface documents new happy path | **FAIL (nit)** — catalog still requires pre-set `workspace_root` (§4 N1) |

---

## 4. Findings

### Blocking

*None for Scheme 1 security / core runtime DoD.*

### High nits (should fix before calling UX “done”)

#### N1 — Stale tool catalog undercuts Scheme 1 agent path

**File:** `companion/src/bridge/tool-definitions-catalog.json` ~L657–658

```text
"description": "… Requires modules.devsec-workspace enabled AND workspace_root already set.
If error says workspace_root not set, stop and ask the user to click Side Panel → 任务包 → 「选择工作区」 first …"
```

Runtime no longer hard-gates on unset root, but the **LLM-facing contract still does**. Models will often refuse to call `workspace_*` or force an unnecessary pick — partial defeat of Scheme 1 UX without a security regression.

**Fix:** Update both `workspace_list_dir` and (for consistency) `workspace_read_file` descriptions: module required; unset root → default sandbox `~/CMspark-projects` (no bind); optional explicit pick for real repos; relative paths only.

#### N2 — In-home symlink as sandbox root expands host_read without picker

**File:** `companion/src/capability/workspace.ts` `ensureDefaultSandboxRoot` ~L78–101

Post-create check only requires `realpath(sandbox)` ⊆ `home`. Adversarial probe: symlink `CMspark-projects` → another directory **under home** → ensure **succeeds** and list/read operate on that tree (e.g. secrets dir). Outside-home symlink correctly fails.

Threat model: needs ability to place/replace the symlink under home (local user, malware, or prior high-privilege tools). Not a classic remote escape, but **widens FS read without user gesture** relative to a literal directory node named `CMspark-projects`.

**Hardening options (pick one, document):**

- `lstat` and reject if root is symlink; or
- require final realpath basename == `CMspark-projects` **and** parent == homeReal; or
- document residual risk as accepted Trust trade for Scheme 1.

### Medium nits

#### N3 — ChatView still shows hard-bind user hint on legacy tokens

**File:** `chrome-extension/src/sidepanel/components/ChatView.tsx` ~L840–841

```ts
if (/workspace_root not set|需要先绑定工作区|pick a folder first/i.test(err)) {
  return "需要先绑定工作区：侧栏「场景」→「选择工作区」。…"
}
```

Gate-error-copy was updated; this parallel path was not. If any path still surfaces `WORKSPACE_ROOT_NOT_SET_ERROR` (or old strings), UI reverts to “must bind” messaging while companion soft-path says sandbox is fine.

#### N4 — No unit test for `default_sandbox_unavailable` recoverability

`security.ts` adds tokens; `security-thread.test.ts` only softens legacy `WORKSPACE_ROOT_NOT_SET_ERROR`. Manual probe confirms recoverable — add a one-liner test to lock it.

#### N5 — No automated assertion that list/read never persist `workspace_root`

Contract item 2 is **[inspected]** only. A thin integration test (dispatch + mock threadManager) would lock “runtime fallback ≠ bind”.

### Low nits

#### N6 — mkdir `0o700` not applied if directory already exists

Probe: pre-existing `0755` remains `0755` after `ensureDefaultSandboxRoot`. Contract says “mkdir 0o700 **if missing**” — compliant, but weaker than “ensure mode”. Consider `chmod 0o700` best-effort after ensure (umask/ACL caveats).

#### N7 — `path escapes workspace_root` is `non_recoverable`

Pre-existing classify behavior. Agent path-typo `../` can kill the turn. Optional: mark recoverable so model can list `.` and retry.

#### N8 — Peripheral doc drift (outside implementer file list)

- `Claude.md` / `CLAUDE.md` Common Issues still: pick workspace before `workspace_*`
- ADR-014 / architecture still frame `workspace_root not set` as primary DevSec recoverable story

User-facing `docs/mission-pack-usage.md` **was** updated correctly.

#### N9 — Untracked workflow file

`.grok/workflows/default-workspace-sandbox.rhai` present but not part of claimed capability surface; ignore or land intentionally.

### Trajectory

| Axis | Assessment |
|------|------------|
| Scope creep | **Low** — focused on workspace fallback + copy + classify + tests + usage doc |
| Unnecessary files | **None** material; `project-dir.ts` / `shell.ts` correctly untouched |
| Capability declaration vs code | Aligns: L1 host_read under effective root; no auto-bind; module still required; community channel OK |
| Autonomy | Still single-turn tools; mkdir on first list/read is a **side effect on a read surface** — acceptable per Scheme 1 text, should stay documented |

### Component map (file:line anchors)

| Area | Path | Notes |
|------|------|--------|
| Sandbox ensure + containment | `companion/src/capability/workspace.ts:44-102` | Core Scheme 1 |
| Resolve / list / read | same `:109-264` | Explicit wins; module gate |
| Bind still picker-gated | same `:166-183` | Unchanged contract 6 |
| Dispatch (no auto-bind) | `companion/src/tool/companion-dispatch.ts:524-536` | Passes `thread?.workspace_root` only |
| Shell cwd | `companion/src/capability/shell.ts:201-216` | No CMspark-projects force |
| Recoverable tokens | `companion/src/security.ts:762-768` | `default_sandbox_*` |
| Companion UX copy | `companion/src/capability/user-gate-copy.ts:4-66,97-104` | Soft vs hard gate |
| Extension gate copy | `chrome-extension/.../gate-error-copy.ts:18-38` | Aligned |
| PacksPanel label | `chrome-extension/.../PacksPanel.tsx:943-971` | Sandbox label; clear only if bound |
| Stale catalog | `companion/src/bridge/tool-definitions-catalog.json:657-658` | **N1** |
| Stale ChatView hint | `chrome-extension/.../ChatView.tsx:840-841` | **N3** |
| Docs | `docs/mission-pack-usage.md:101-107,258-276` | Good |

---

## 5. ADR-020 notes

| Axis | Assessment |
|------|------------|
| **Surface** | Still **L1 host_read** via `workspace_*` under an effective root — not L2 shell/CU. Expanding default root from “none” → `~/CMspark-projects` **increases blast radius within L1 host_read** without elevating Surface label. Acceptable if Trust + module gate remain the consent story (they do). |
| **Composition** | Pack / module `devsec-workspace` unchanged; no new runtime; no pack-written god-mode. |
| **Autonomy** | Single-tool autonomy; first call may **mkdir** under home — mild autonomy side effect of a “read” tool; document as Trust packaging, not Surface upgrade. |
| **Trust** | Explicit folder-picker bind still required for `setWorkspaceRoot`; default sandbox is **opt-in via module enable**, not via silent thread mutation. God-mode still must not impersonate workspace bind (copy correctly states this). |
| **Channel** | community-appropriate (no enterprise shell/netsec coupling). |

**Discipline check:** Scheme 1 correctly avoids inventing a parallel “sandbox agent” runtime; it reuses DevSec workspace tools with a default root — consistent with ADR-020 “single tool-loop”.

---

## 6. Verdict

Core Scheme 1 runtime + security containment + non-bind + module/picker/shell contracts are **verified by execution and inspection**. Product completeness is reduced by **stale LLM tool descriptions** and residual **in-home symlink-root** expansion; neither is a containment escape past home or an auto-bind of `workspace_root`.

VERDICT: APPROVE_WITH_NITS
