# ADR-019 User Env (Secrets) — Ship Note

**Date**: 2026-07-29  
**Branch**: `feat/user-env-secrets` (HEAD `b4c8460`, 4 commits ahead of `origin/main`)  
**ADR**: [docs/adr/019-user-env-secrets.md](../../adr/019-user-env-secrets.md)  
**Status**: **SHIP READY** (gates APPROVE_WITH_NITS ×2; residual risks accepted per ADR §8)

---

## 1. What shipped

Product: Side Panel **环境变量（Secrets）** settings. Companion is sole source of truth at `~/.cmspark-agent/user-env.json` (0o600, atomic write). Values inject into child processes only; never into LLM context / WS public snapshots / default logs.

### Commits (worktree)

| SHA | Summary |
|-----|---------|
| `a6eed40` | docs(adr): ADR-019 user env secrets confirmed |
| `aa8924e` | feat(companion): user-env secrets for shell/MCP (ADR-019) |
| `6deb3af` | fix(companion): apply Gate1 dual-review nits for user-env |
| `b4c8460` | feat(extension): user-env secrets settings UI (ADR-019) |

### Core files (verified present)

| Path | Role |
|------|------|
| `companion/src/user-env.ts` | load/save/list/set/delete, denylist, `CMSPARK_*` ban, cache, `buildUserEnvPublic`, redact helpers |
| `companion/src/capability/shell.ts` | `buildChildEnv()`: `process.env → user_env → CMSPARK_SHELL=1` |
| `companion/src/mcp/transport.ts` | stdio env: `process.env → user_env → PATH harden → config.env` |
| `companion/src/message-router.ts` | WS `user_env.list` / `set` / `delete` → `user_env.updated`; log redact |
| `companion/tests/user-env.test.ts` | unit + shell printenv + MCP env merge |
| `chrome-extension/src/sidepanel/components/UserEnvSection.tsx` | Settings UI section |
| `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` | mounts `<UserEnvSection />` |
| `chrome-extension/src/sidepanel/utils/user-env-utils.ts` | chips (`DATAYES_TOKEN`), error ZH map, normalize public |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | `user_env.list` / `updated` / error routing |
| `chrome-extension/tests/user-env-utils.test.ts` | extension unit tests |

### Protocol

- `user_env.list` → redacted public snapshot (`keys[].masked === "***"`)
- `user_env.set` `{ vars: { K: V } }` — empty string is legal value; `"***"` means unchanged
- `user_env.delete` `{ keys: string[] }` — only delete path
- `user_env.updated` — success reply + multi-client broadcast (same public shape)

### Security properties (S1–S9 / R1–R7)

- Outbound only via `buildUserEnvPublic()` (forced mask)
- No LLM / system-prompt injection of secrets
- Logger/audit: `redactUserEnvVarsForLog` on set
- File 0o600 + atomic write
- Denylist + full `CMSPARK_*` prefix ban
- Does not bypass `shell_exec` L2 confirmation
- `getUserEnvVars()` → `{}` on corrupt/invalid file (S9)
- Empty string ≠ delete (R6)

---

## 2. Gates verdicts

| Gate | Timestamp | Claude | Pi | both_approve | Artifact |
|------|-----------|--------|-----|--------------|----------|
| **G1** (companion core) | 20260729-141517 | APPROVE_WITH_NITS | APPROVE_WITH_NITS | true | `user-env-g1-verdict-20260729-141517.json` |
| **G2** (full ship: PR-1+PR-2+MCP) | 20260729-143732 | APPROVE_WITH_NITS | APPROVE_WITH_NITS | true | `user-env-g2-verdict-20260729-143732.json` |

Gate1 nits were applied in `6deb3af`. Gate2 nits are non-blocking (see §4 remaining debt).

**Final gate verdict: APPROVE_WITH_NITS (both reviewers) → ship.**

---

## 3. Final verify (this run) — [executed]

```text
companion user-env.test.js     18 pass / 0 fail
companion capability-shell-netsec  4 pass / 0 fail
chrome-extension user-env-utils    8 pass / 0 fail
```

File presence: `user-env.ts`, shell inject (`buildChildEnv` + `getUserEnvVars`), MCP inject (`transport.ts` merge), Settings `UserEnvSection` + `SettingsSlideout` mount — all confirmed.

---

## 4. Residual risks (accepted — ADR §8 / R5)

### argv / process list

- Child process **argv** can contain secrets if the agent (or user command) puts them on the command line, e.g. `curl -H "Authorization: $DATAYES_TOKEN" …` after shell expansion, or explicit literals.
- On multi-user hosts, `ps` may expose argv. **Mitigation today**: L2 security confirmation on `shell_exec` (and enterprise module gate). No P0 argv scrubbing.

### stdout / stderr / tool results

- Agent can run `printenv DATAYES_TOKEN` or `echo $DATAYES_TOKEN`; secrets flow into tool result → thread → possible LLM round-trip.
- **Mitigation today**: L2 confirmation is the control plane; product copy steers users to Settings instead of chat paste.
- **Not in P0**: stdout secret redaction (listed as future evolution ADR §11).

### Other accepted limits

- Secrets at rest are file 0o600 only (no Keychain/DPAPI in P0).
- User pasting token into chat is outside this feature’s control.
- `osascript_eval` intentionally **not** given user-env inject (host-exec surface; invariant R4).

---

## 5. How to use `DATAYES_TOKEN` in Settings

1. Start Companion and open the Chrome Side Panel (pair if needed).
2. Open **设置** (Settings slideout).
3. Scroll to **环境变量（Secrets）**.
4. Click the chip **`DATAYES_TOKEN`** (or type the name manually — POSIX-style: `[A-Za-z_][A-Za-z0-9_]*`).
5. Paste the token value into the value field (password input; not shown in list later).
6. Click **添加** / save on that row (per-row write via `user_env.set` — **not** the bottom global config Save).
7. List shows `DATAYES_TOKEN` with **● 已配置** / `***` only — plaintext never reappears.
8. Run the Datayes skill / `shell_exec` path as usual; approve the L2 confirm dialog when prompted.
9. To rotate: enter a new value on the row → 保存. To remove: 删除.

**Storage**: `~/.cmspark-agent/user-env.json` (or `$CMSPARK_DATA_DIR/user-env.json`). Survives Companion restart.

**Do not**: paste tokens into chat, skill docs, or system prompts — this UI exists specifically so you don’t have to.

---

## 6. Remaining debt / nits (non-blocking)

From Gate2 dual review (not required for ship):

1. Error responses for `user_env.set`/`delete` omit `family: "user_env"` (extension falls back to `error_code` set — works today).
2. `handleAdd` clears draft name/value before companion ack; server reject loses typed input. Also `handleAdd` does not guard literal `"***"` the way `handleUpdate` does (silent no-op + “已保存” UX).
3. Extension pre-validates only `CMSPARK_*`, not full denylist (companion still rejects).
4. Update-save disabled when value is `***` without tooltip explaining sentinel.
5. Delete uses `window.confirm` (inconsistent with modal style).
6. Optional docs follow-ups from ADR §9 PR-3: `docs/user-env.md` / mission-pack mention / Claude.md Common Issues one-liner (partially covered by this ship note + ADR).
7. Future: Keychain, stdout redaction, skill `required_env` prompts (ADR §11).

---

## 7. Ship checklist

| Item | Result |
|------|--------|
| Companion core + inject | ✅ |
| Extension Settings UI | ✅ |
| G1 dual review | ✅ APPROVE_WITH_NITS |
| G2 dual review | ✅ APPROVE_WITH_NITS |
| Focused tests green (this run) | ✅ 18 + 4 + 8 |
| Residual argv/stdout documented | ✅ |
| ADR status | ✅ **已交付** |
| Push to origin | ⏸ not done (user did not request) |

**Recommendation**: merge `feat/user-env-secrets` when ready; no force-push.
