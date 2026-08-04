# Security Lane

**Range:** `2e7cf2f..79d7420` (PRs #110/#111 cookie trust copy, #113 Anthropic P1, #114 S40 quad-track)  
**Scope:** Production focus `companion/src` + `chrome-extension/src`  
**Method:** Diff + live source inspection (not patch-only)  
**Status:** **WATCH**  
**Recommendation:** **REQUEST_CHANGES**

---

## Findings

### F1 [HIGH] — `skill_install` writes durable skills with no L2; `content` bypasses Trust allowlist entirely

- **File:line**
  - [`companion/src/skills/skill-install.ts:114-127`](companion/src/skills/skill-install.ts) (`content` branch)
  - [`companion/src/skills/skill-install.ts:129-162`](companion/src/skills/skill-install.ts) (`zip_path` / path)
  - [`companion/src/server.ts:784-796`](companion/src/server.ts) (`L2_GATE_TOOLS` — `skill_install` absent)
  - [`companion/src/server.ts:3244-3263`](companion/src/server.ts) (executor: no `security_token`)
  - [`companion/src/skills/skill-engine.ts:847-850`](companion/src/skills/skill-engine.ts) (`rmSync` overwrite)
- **Evidence** `[inspected]`
  - `skill_install` is correctly routed via `COMPANION_TOOLS` and injects into the tool catalog (`tool-definitions-inject.ts`).
  - It is **not** in `L2_GATE_TOOLS`. Executor does not require `security_token`.
  - Path/`zip_path` are constrained by `isSkillInstallSourceAllowed` (Downloads segment / tmp / `getConfigDir()`), but the **`content` parameter installs arbitrary markdown with zero path check**.
  - Existing skill dirs are deleted with `fs.rmSync(destDir, { recursive: true })` before rewrite — silent overwrite of user skills.
  - Cap note claims `Trust: source path allowlist` while `content` makes the write path unrestricted for agent-chosen bodies.
- **Risk**
  - Durable **agent-persistence / prompt-injection install** without HITL: LLM (or a page that steers the agent) can drop or replace skills under `~/.cmspark-agent/skills`, later loaded via ungated `use_skill`.
  - Overwrite can replace a known-good skill with an exfil/jailbreak playbook without a confirm dialog.
  - Host FS exfil via arbitrary path is partially mitigated for path/zip; **trust model does not cover “write agent memory”**.
- **Fix**
  1. Add `skill_install` to L2 (or a lighter Confirm Center prompt showing name + dest + overwrite flag), **or**
  2. At minimum: require L2 when target already exists (`overwrite: true` + forceConfirm); cap `content` length (e.g. same order as zip/dir budgets); reject `content` installs above N KB without confirm.
  3. Align ADR/capability Trust text with actual gates (`content` is a free write).

---

### F2 [MEDIUM] — Zip install: compressed-size budget only; no uncompressed expansion budget

- **File:line**
  - [`companion/src/skills/skill-install.ts:72-74,151-155`](companion/src/skills/skill-install.ts)
  - [`companion/src/skills/skill-engine.ts:854-885`](companion/src/skills/skill-engine.ts) (extract loop writes every entry)
- **Evidence** `[inspected]`
  - `MAX_ZIP_BYTES = 25 MiB` applied to the on-disk zip **before** base64 → AdmZip.
  - `assertDirBudget` (25 MiB / 500 files) applies only to **directory** `path` imports, not zip extract.
  - `importSkillFolder` writes `entry.getData()` with no running total of uncompressed bytes.
- **Risk**
  - Classic zip-bomb / disk-fill against `~/.cmspark-agent/skills` from a ≤25 MiB highly compressible archive under Downloads/tmp (agent-reachable without L2 per F1).
- **Fix**
  - While extracting: enforce max uncompressed total (e.g. 25–50 MiB) and max entry count; abort + cleanup partial dest on breach.
  - Prefer reusing pack-engine zip-slip + size patterns (`pack-engine.ts` already has stronger slip checks).

---

### F3 [MEDIUM] — `isSkillInstallSourceAllowed` uses name-segment allowlist, not real Downloads root

- **File:line**
  - [`companion/src/skills/skill-install.ts:48-69`](companion/src/skills/skill-install.ts)
  - Tests: [`companion/tests/skill-install.test.ts:60-79`](companion/tests/skill-install.test.ts) (only tmp/Downloads-named / Desktop)
- **Evidence** `[inspected]`
  - Allow if any path segment equals `downloads` or `下载` (case-folded), **or** under realpath of `getConfigDir()` / `os.tmpdir()`.
  - Not compared to OS “Downloads” directory (e.g. `path.join(homedir(), "Downloads")` + realpath containment).
  - Any project path like `…/src/downloads/…` or `…/下载/…` becomes a legal skill source after realpath.
  - realpath before check correctly collapses `Downloads/../.ssh`-style tricks for the **final** path — good.
- **Risk**
  - Broader read surface than docs imply; chains with workspace/agent write into a folder named `downloads` then install.
  - tmp + data-dir allow is intentional but wide (any file under `os.tmpdir()` that is `.zip`/`.md`/skill dir).
- **Fix**
  - Prefer realpath prefix of known roots: `~/Downloads`, `~/下载`, `os.tmpdir()`, `getConfigDir()`.
  - Keep segment fallback only as secondary, or drop it.

---

### F4 [MEDIUM] — Zip-slip checks exist but weaker than pack path; AdmZip normalization can hide intent

- **File:line**
  - [`companion/src/skills/skill-engine.ts:865-876`](companion/src/skills/skill-engine.ts)
  - Test honesty: [`companion/tests/skills.test.ts:1020-1052`](companion/tests/skills.test.ts) (“AdmZip normalizes … ends up under skill directory”)
- **Evidence** `[inspected]`
  - Rejects absolute, `startsWith("..")`, null bytes; containment via `path.resolve` + `startsWith(dest + sep)`.
  - Does **not** reject symlink-type zip entries as a class (writes via `writeFileSync` of file data — usually OK).
  - No central-directory pre-walk like `file-parser.ts` office zip-slip.
  - Pack install has explicit slip rejection messages; skill zip relies on normalize + resolve.
- **Risk**
  - Residual slip risk lower than pre-check era, but inconsistent hardening vs packs/office; future AdmZip behavior changes need regression tests that use raw CD entries, not only `addFile("../../../…")`.
- **Fix**
  - Share pack-engine zip containment helper; add a raw zip-slip fixture test that fails closed.

---

### F5 [LOW] — Cookie trust messaging (#111): gate solid; suggest-wildcard can over-broaden

- **File:line**
  - [`companion/src/security.ts:109-160`](companion/src/security.ts) (`isTrustedDomain`, `cookieTrustBlockedMessage`, `cookieTrustBlockedPayload`)
  - [`companion/src/server.ts:682-714`](companion/src/server.ts) (still `isTrustedDomain` only)
  - [`chrome-extension/src/sidepanel/components/ChatView.tsx:393-418`](chrome-extension/src/sidepanel/components/ChatView.tsx)
- **Evidence** `[inspected]`
  - Cookie tools still fail closed when domain ∉ `trusted_domains`; error_code `COOKIE_TRUST_DENIED`.
  - Copy correctly separates Cookie 信任域 vs 全自动巡航 / `auto_approved_domains` — does **not** open cookie access via autopilot.
  - Suggest line: ``*.${domain.split(".").slice(-2).join(".")}`` → for `foo.co.uk` / multi-label public suffixes can recommend overly broad patterns if the user pastes them blindly.
- **Risk**
  - No gate regression. UX footgun if users add `*.co.uk`-style trust.
- **Fix**
  - Suggest only exact host + optional `*.${registrableDomain}` with a public-suffix-aware helper, or “add exact domain first”.

---

### F6 [LOW] — Anthropic P1 `probeLlmConnection` / settings: no secret echo in probe status; WS `config.test` still lacks SSRF parity with settings-web

- **File:line**
  - [`companion/src/llm/connection-test.ts:70-118,152-203`](companion/src/llm/connection-test.ts)
  - [`companion/src/settings-web.ts:433-516`](companion/src/settings-web.ts) (`validateTestBaseUrl` + probe)
  - [`companion/src/message-router.ts:335-370`](companion/src/message-router.ts) (`config.test` → probe without SSRF)
  - [`companion/src/message-router.ts:1641-1650`](companion/src/message-router.ts) (`redactExtraHeaders` on config broadcast)
- **Evidence** `[inspected]`
  - Probe returns status-based Chinese errors only; comment “Does not log header values”; no body reflection.
  - settings-web `/api/test` keeps SSRF private/loopback block + does not return upstream body.
  - WS `config.test` merges override key carefully (`isMaskedApiKey`) and returns only `probe.message` / `probe.error` — **good secret hygiene**.
  - WS path still POSTs API key to **any** `base_url` (including RFC1918 / link-local) — settings-web would block the same URL. Pre-existing gap, re-touched by P1.
  - `extra_headers` values redacted on `config.get` / `config.set` replies.
- **Risk**
  - Credential-bearing request to attacker-chosen or cloud-metadata-ish hosts from **authenticated local** Side Panel test button. Lower than unauthenticated SSRF; still parity debt.
- **Fix**
  - Extract `validateTestBaseUrl` (or shared SSRF helper) and call it from `config.test` before `probeLlmConnection`.

---

### F7 [LOW] — `shell_exec` argv path residual: win32 correct; default policy still `shell:true` for metachar / bare names

- **File:line**
  - [`companion/src/capability/shell.ts:35-64,117-214,263-270`](companion/src/capability/shell.ts)
  - [`companion/src/server.ts:1242-1254,1312,3265-3270`](companion/src/server.ts)
  - Tests: [`companion/tests/shell-progress-windowsHide.test.ts`](companion/tests/shell-progress-windowsHide.test.ts)
- **Evidence** `[inspected]`
  - `shouldUseArgvSpawn`: win32 only if program ends with `.exe`/`.com`; never `.bat`/`.cmd`/bare PATH names — correct Node constraint.
  - POSIX uses `shell:false` when parseable and not shell-builtin.
  - Metachar ban (`;|&\`$()<>` + newlines) only under `policy=allowlist`; default `confirm_per_command` still allows metachar via `spawn(command, { shell: true })`.
  - L2: `shell_exec` ∈ `L2_GATE_TOOLS` + `capabilityForceConfirm`; executor requires valid `security_token`. God-mode alone does not skip (enterprise skip is separate opt-in).
- **Risk**
  - Residual injection surface under shell:true after user (or enterprise auto-approve) approval — known P1b residual, not a regression to unauthenticated RCE.
- **Fix**
  - Track P1c: expand argv coverage; keep forceConfirm; document enterprise skip blast radius (already partly documented).

---

### F8 [CLEAR / scaffold] — Outbound MCP façade fail-closed; not a live exfil bridge yet

- **File:line**
  - [`companion/src/outbound-mcp/profile.ts`](companion/src/outbound-mcp/profile.ts)
  - [`companion/src/outbound-mcp/facade.ts`](companion/src/outbound-mcp/facade.ts)
  - [`companion/src/outbound-mcp/audit.ts`](companion/src/outbound-mcp/audit.ts)
  - Tests: [`companion/tests/outbound-mcp-facade.test.ts`](companion/tests/outbound-mcp-facade.test.ts)
- **Evidence** `[inspected]`
  - Default allowlist is L1 browser subset + `downloads_find`; `shell_exec` / cookies / host / raw `evaluate` forbidden (`PROFILE_FORBIDDEN`).
  - Exfil-class (`get_page_text`, `screenshot`) requires `disclosure_accepted === true` or `DISCLOSURE_REQUIRED`.
  - Audit lines via `appendCapabilityAudit` without page body/screenshot bytes.
  - Module comments: stdio product bridge **intentionally incomplete** — gate only.
- **Risk**
  - None until wired to real MCP stdio dispatch; when wired, ensure disclosure is real HITL (not a free boolean from the external agent) and that allowlist cannot be client-overridden.
- **Fix**
  - Before product bake-off: bind disclosure to Confirm Center / one-shot token; never trust `disclosure_accepted` from untrusted MCP peer alone.

---

### F9 [CLEAR] — `downloads_find` broad-search fallback remains Downloads-only at result filter

- **File:line**
  - [`chrome-extension/src/background/downloads-find.ts:60-77,109-110,163-195,231-247`](chrome-extension/src/background/downloads-find.ts)
- **Evidence** `[inspected]`
  - Narrow → broad only widens `chrome.downloads.search` (drops `filenameRegex`, raises limit).
  - **Every** result still passes `filterCompletedDownloads` → `isPathUnderDownloads` (segment `Downloads`/`下载` or injected test roots).
  - URLs redacted (query/hash stripped) before LLM return.
  - Hints push `browser_download` + `skill_install`, not `shell curl`.
- **Risk**
  - Broad mode may surface more Downloads rows (intended); not Desktop/Documents leakage under default roots.
  - Same segment coarseness as F3 for Downloads naming — acceptable for this tool’s stated B1 model.
- **Fix**
  - Optional later: real Downloads-dir realpath (shared helper with skill_install).

---

## What is solid

1. **`shell_exec` forceConfirm + token binding** — critical capability not skippable by god-mode alone; enterprise skip is explicit config/session trust. `[inspected]`
2. **Win32 argv policy** — `.exe`/`.com` only; tests cover bat/npm bare-name refusal. `[inspected]`
3. **Cookie gate** — still `isTrustedDomain` only; #111 is copy + structured `user_hint_zh`, not a policy weaken. `[inspected]`
4. **LLM probe secret hygiene** — no header/body logging; masked keys on config broadcast; protocol-aware Anthropic/OpenAI mini probes. `[inspected]`
5. **Outbound MCP Phase 0** — fail-closed profile, forbid list covers high-risk tools, exfil disclosure stub + audit skeleton. `[inspected]`
6. **`downloads_find`** — broad fallback is query-side only; client filter remains Downloads-scoped; recovery copy avoids shell curl default. `[inspected]`
7. **`skill_install` routing** — companion-side execution (not extension CDP), dest forced to user skills root, compressed zip size + dir budgets for path imports, realpath before allow check. `[inspected]`
8. **Progress tails** — shell `tool.progress` unicast to origin only (commented secret-aware). `[inspected]`

---

## Verdict summary

S40/S41 security posture for **shell**, **cookies**, **outbound scaffold**, **Anthropic probe logging**, and **downloads_find** is sound and does not introduce a clear critical host RCE or cookie-trust bypass. The primary defect is **`skill_install` Trust incompleteness**: path allowlist helps against arbitrary FS read/exfil chains, but **ungated durable writes** (especially free `content`, silent overwrite, and zip extract without uncompressed budgets) are agent-integrity / persistence risks that the dual-review “no L2 vs write-to-disk” concern correctly flags. Treat F1–F2 as must-fix before calling skill install “Trust-complete”; F3–F6 as follow-ups. Outbound MCP must not ship past scaffold without real disclosure HITL.

**Final Recommendation: REQUEST_CHANGES**

---

## Severity index

| ID | Severity | Topic | Blocks? |
|----|----------|--------|---------|
| F1 | HIGH | skill_install no L2 + content bypass | Yes |
| F2 | MEDIUM | Zip uncompressed budget missing | Yes (with F1) |
| F3 | MEDIUM | Downloads segment allowlist coarse | Soft |
| F4 | MEDIUM | Zip-slip defense inconsistency | Soft |
| F5 | LOW | Cookie suggest-wildcard UX | No |
| F6 | LOW | config.test SSRF parity | No |
| F7 | LOW | shell:true residual | No |
| F8 | CLEAR | outbound-mcp scaffold | No (gate when wiring) |
| F9 | CLEAR | downloads_find broad fallback | No |

**Evidence tags:** All findings `[inspected]` (source + tests). No live exploit execution in this lane.
