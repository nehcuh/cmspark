# Multi-Adversarial Code Review — main (#110 + #111 + #113 + #114)

**Date**: 2026-08-04  
**Range**: `2e7cf2f..79d7420` (after `git pull --ff-only origin main`)  
**Tip**: `79d7420` (Pi merge-gate docs for PR #114) · production merge: `ee26e19` (#114)  
**Method**: 4 independent adversarial lanes in parallel (Security / Correctness / Architecture / Compat)  
**Orchestrator**: Grok Build · omx-code-review style synthesis  
**External re-review**: Pi + Claude via `scripts/dual-external-review.sh` (see verdict JSON)

## Lane verdicts

| Lane | Status | Recommendation |
|------|--------|----------------|
| Security | WATCH | **REQUEST_CHANGES** |
| Correctness | WATCH | **REQUEST_CHANGES** |
| Architecture | WATCH | **APPROVE_WITH_NITS** |
| Compat/Platform | WATCH | **APPROVE_WITH_NITS** |

## Final synthesis

| Field | Value |
|-------|--------|
| **Architectural status** | WATCH |
| **Internal multi-lane** | **REQUEST_CHANGES** |
| **External dual** | Claude **REJECT** · Pi **APPROVE_WITH_NITS** · `both_approve: false` |
| **Final recommendation** | **REQUEST_CHANGES** (dual gate not green) |
| **Merge-ready?** | **No for “Trust-complete skill_install / S40 closed” claim** — core shell/cookie/FocusBand/outbound scaffold are sound; fix dual-confirmed packaging issues before treating this batch as closed |

### Deterministic merge gate
- Architect ≠ BLOCK  
- Security + Correctness both **REQUEST_CHANGES** → internal **REQUEST_CHANGES**  
- Dual gate requires Pi **and** Claude APPROVE/APPROVE_WITH_NITS → **failed** (Claude REJECT)  
- Compat APPROVE_WITH_NITS does not override Trust/correctness blockers  

### Dual re-review delta (Pi vs Claude)

| Topic | Claude | Pi | Orchestrator note |
|-------|--------|-----|-------------------|
| skill_install no L2 + free `content` + overwrite | **BLOCKING HIGH** (Trust monotonicity vs host_read) | Confirmed but **reframed MEDIUM**: `record_experience` already ungated durable skill write | Both agree packaging incomplete; severity splits on product precedent |
| Zip uncompressed budget | **BLOCKING** (with no L2) | **MEDIUM** confirmed | Confirmed real |
| dest_path honesty | **BLOCKING** correctness | **MEDIUM** confirmed | Confirmed real |
| config.test empty base_url | **BLOCKING** UX | **MEDIUM** (not security) | Confirmed real |
| POSIX `FOO=1` / `~` | **BLOCKING** regression | **MEDIUM-HIGH** fail-closed | Confirmed real |
| Build/tests | n/a | companion 2281 / ext 410 green `[executed]` | Pi executed suites |

**Pi key reframing** `[inspected by Pi]`: `record_experience` already writes into the same skillsDir without L2; so “first agent-callable permanent skill write” is overstated — residual is **destructive overwrite**, missing audit, no content cap, dest_path/zip budget, not a brand-new write class.

**Claude key hard line**: free `content` + silent `rmSync` overwrite + install→`use_skill` raw load without HITL is still inverted Trust packaging relative to host_read L2, and Trust declaration does not name the `content` bypass → REJECT until fixed or honestly HANDOFF’d.

---

## Scope (production)

| PR | Theme |
|----|--------|
| #110 | Shell tool card: command + stdout in ChatView |
| #111 | Cookie trust plain-language block + setup path |
| #113 | Anthropic P1 UI + protocol-aware `probeLlmConnection` |
| #114 | S40: FocusBand ST-4, `skill_install`, shell argv P1b, outbound MCP Phase 0, downloads_find broad fallback |

**Diff**: `docs/audit/reviews/s41-main-pull-diff-20260804-092610.patch` (~25 prod files, +1849/−191)  
**Lane reports**: `/tmp/cmspark-review-s41/lane-{security,correctness,architecture,compat}.md`

---

## P0 — must address (HIGH, multi-lane)

### 1. `skill_install` Trust incompleteness (no L2 + free `content` + silent overwrite)

- **Lanes**: Security F1, Architecture F1, Correctness F1/F5  
- **Evidence** `[inspected]`:
  - Not in `L2_GATE_TOOLS`; executor has no `security_token` (`server.ts` ~784, ~3244)
  - `content` branch installs arbitrary markdown with **zero** path allowlist (`skill-install.ts:114-127`)
  - Existing skill dirs: `rmSync` recursive overwrite without confirm (`skill-engine.ts` ~847)
  - Declared Trust “source path allowlist” does not cover agent-chosen body writes  
- **Risk**: Durable agent memory / prompt-injection foothold without HITL; weaker than L2 `host_read`/`shell_exec` (inverted Trust monotonicity)  
- **Fix direction**:
  1. L2 or Confirm Center for all install modes **or** drop `content` from LLM tool (keep panel import)
  2. ForceConfirm on overwrite of existing skill name
  3. Cap `content` length; `appendCapabilityAudit` on install
  4. Align capability Trust text with actual gates

### 2. Zip extract: compressed-only budget (zip-bomb)

- **Lanes**: Security F2, Architecture F3  
- **Evidence** `[inspected]`: `MAX_ZIP_BYTES` on zip file only; dir path uses `assertDirBudget`; extract loop has no uncompressed total (`skill-install.ts:151-155`, `skill-engine.ts` extract)  
- **Risk**: Disk fill under `~/.cmspark-agent/skills` from ≤25 MiB highly compressible zip  
- **Fix**: Post-extract / stream budget (bytes + entry count); cleanup partial dest on breach

### 3. Zip success `dest_path` honesty

- **Lanes**: Correctness F1  
- **Evidence** `[inspected]`: zip success returns `dest_path: root` (skills root), no `name` (`skill-install.ts:157-162`); engine writes `skillsDir/<safeName>`  
- **Risk**: Agent loops trust wrong path; cannot open installed skill without re-list  
- **Fix**: Return actual dest + `name`; unit-test with real/path-faithful engine (zip path currently stubbed)

### 4. `config.test` empty `base_url` clobbers stored URL

- **Lanes**: Correctness F2  
- **Evidence** `[inspected]`: `override?.base_url ?? stored` — empty string wins (`message-router.ts` ~346); Coding Plan preset sets `base_url: ""` (`SettingsSlideout.tsx` ~818)  
- **Risk**: Test connection fails after preset even when saved URL works  
- **Fix**: Treat blank override as absent: `trim() || stored` for base_url/model_name

### 5. POSIX argv: `FOO=1 cmd` / unexpanded `~`

- **Lanes**: Correctness F3; Architecture F9 (nit); Security F7 residual  
- **Evidence** `[inspected]`: `tryParseSimpleArgv` does not reject `ENV=val` prefix → argv spawn ENOENT; `~` literal  
- **Risk**: Behavior regression vs pre-P1b `shell:true` for common POSIX forms  
- **Fix**: Reject env-assignment tokens and unquoted `~` from argv mode; add unit cases

---

## P1 — should fix soon (MEDIUM)

| ID | Source | Summary |
|----|--------|---------|
| S-F3 / A-F2 / C-F5 | Sec/Arch/Compat | Downloads allowlist is segment `downloads`/`下载`, not real Downloads root |
| C-F4 | Correctness | Shell card: non-zero exit → companion `success:true` → glyph ✓ + red border |
| S-F4 / A-F3 | Sec/Arch | Zip-slip defense weaker than pack/office; share helper |
| Compat C4 | Compat | skill_install docs advertise `%TEMP%`/`%USERPROFILE%` but only expands `~` |
| Compat C5 | Compat | Non-EN/zh Downloads folder names fail closed |
| Compat C7 | Compat | Probe `fetch` ignores typical corp HTTP(S)_PROXY |
| A-F6 | Architecture | Outbound `disclosure_accepted` is caller bool — landmine for future bridge |
| S-F6 | Security | WS `config.test` lacks settings-web SSRF private-IP parity |

---

## What is solid (do not regress)

- **Cookie gate** still `isTrustedDomain` only; #111 is copy + `user_hint_zh`, not policy weaken  
- **shell_exec**: L2 forceConfirm + token; win32 argv only `.exe`/`.com`; `windowsHide` both paths; metachar ban retained for allowlist  
- **Outbound MCP Phase 0**: fail-closed profile, forbid shell/host/cookies, scaffold **unwired** to server  
- **downloads_find** narrow→broad still client-filters Downloads-only; conflict hint  
- **FocusBand ST-4**: priority Confirm→L2→Fleet→thread_tools; no new 一级 Side Panel entry  
- **Anthropic probe**: protocol-aware; no secret echo in status; headers redacted on config broadcast  
- **COMPANION_TOOLS routing** for `skill_install` present (prior M1 B1 fixed)

---

## Suggested fix batches

1. **skill_install Trust + honesty**: L2/content policy + zip budget + dest_path/name + audit + Downloads root tighten  
2. **config.test merge**: empty-string override ignore  
3. **shell argv POSIX edges**: ENV= / `~` reject from argv  
4. **UI polish**: shell glyph vs exit_code; %VAR% doc honesty  
5. **Outbound P1 gate**: origin-bound disclosure (before any stdio product)

---

## Follow-up implementation (2026-08-04 S41 fix) — landed locally

| Item | Fix |
|------|-----|
| P0 skill_install L2 | `skill_install` in `L2_GATE_TOOLS` + `capabilityForceConfirm` (god-mode never skips); `bindingPayloadFor` + `validateTokenFor` |
| P0 content cap | `MAX_CONTENT_BYTES` 256KiB; reject oversized |
| P0 zip budget | extract loop: 25MiB uncompressed + 500 files; cleanup partial dest |
| P0 dest_path honesty | `importSkill*` returns `{ name, destPath }`; skill_install surfaces them |
| P0 config.test | blank `base_url`/`model_name` override → fall back to stored |
| P0 argv ENV=/`~` | `tryParseSimpleArgv` returns null → shell:true path |
| P1 shell glyph | ChatView prefers `shellFailed` over `tc.status` |
| P1 Windows paths | `expandUserPath` expands `%VAR%` |
| Audit | `skill_install.ok` / `.fail` capability-audit lines |

**Tests** `[executed]`: companion skill-install + shell argv + skills zip budget + bindingPayload; extension 410 pass; companion tsc clean.

---

## Artifacts

| Artifact | Path |
|----------|------|
| Lane Security | `/tmp/cmspark-review-s41/lane-security.md` |
| Lane Correctness | `/tmp/cmspark-review-s41/lane-correctness.md` |
| Lane Architecture | `/tmp/cmspark-review-s41/lane-architecture.md` |
| Lane Compat | `/tmp/cmspark-review-s41/lane-compat.md` |
| Production diff | `docs/audit/reviews/s41-main-pull-diff-20260804-092610.patch` |
| Dual-review prompt | `docs/audit/reviews/s41-multi-adv-dual-prompt.md` |
| Claude re-review | `docs/audit/reviews/s41-multi-adv-claude-20260804-093256.md` → **REJECT** |
| Pi re-review | `docs/audit/reviews/s41-multi-adv-pi-20260804-093256.md` → **APPROVE_WITH_NITS** |
| Dual verdict JSON | `docs/audit/reviews/s41-multi-adv-verdict-20260804-093256.json` |
| Lane archives | `docs/audit/reviews/s41-lane-{security,correctness,architecture,compat}-20260804.md` |

## Evidence tags

- Pull fast-forward to `79d7420`: `[executed]`  
- Four-lane parallel review: `[inspected]` (source + tests; no live CU/arm e2e)  
- Pi + Claude dual via `scripts/dual-external-review.sh`: `[executed]` (Claude REJECT, Pi APPROVE_WITH_NITS)  
- Pi full suite: companion 2281 pass / extension 410 pass `[executed]`

---

## Prior context

- Multi-adversarial on #105–#107 (2026-08-03) already landed P0/P1 trust/platform fixes  
- S40 dual M1 REJECT → M1c Pi APPROVE_WITH_NITS; PR #114 merge Pi APPROVE_WITH_NITS  
- This pass re-opens Trust packaging on **first agent-callable permanent skill write** against full #110–#114 range
