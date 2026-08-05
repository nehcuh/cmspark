# Lane: Security — S45 main pull multi-adversarial

**Date:** 2026-08-05  
**Range:** `4a2d02f..474df7e`  
**Tip SHA:** `474df7e`  
**Diff artifact:** `docs/audit/reviews/s45-main-pull-diff-20260805.patch`  
**Evidence base:** [inspected] patch + LIVE sources at tip (`server.ts`, `executor.ts`, `process-path.ts`, `shell.ts`, `cli-exec.ts`, `message-router.ts`, `file-parser.ts`, packaging scripts). No test run in this lane.  
**Prior:** run-state-review-bugs multi-lane (2026-08-05) APPROVE_WITH_NITS for #122-class forceConfirm — **re-verified LIVE tip still holds** (not re-litigated as open).

## Verdict: APPROVE_WITH_NITS

No CRITICAL/HIGH regressions introduced in range. Trust gates tighten or hold (M3' forceConfirm restore; cruise no longer silences `danger_detected`). PATH/osascript harden is net positive. Residual nits + one pre-existing upload path write issue remain.

---

## Findings

### F1 — forceConfirm algebra (M3' restored): LIVE tip correct
| | |
|---|---|
| **Severity** | — (positive / closed prior claim) |
| **Where** | `companion/src/server.ts:1444-1478`, L2 gate `1546` |
| **Evidence** | [inspected] `forceConfirm = criticalApis.length > 0 && !userFullAutonomy`; three-flag only: `auto_approve_dangerous ∧ auto_approve_enterprise_tools ∧ allow_all_schemes`. Removed `browserScriptTool && skipConfirmation` waive. Tests present: `security-gates.test.ts:854+` god-mode alone / domain / auto_approve alone forceConfirm; cruise positive paths. |
| **Impact** | Domain whitelist / god-mode alone / auto_approve alone no longer silent-execute critical evaluate/osascript (fetch/eval/Worker/…). Trust **not** silently raised — autonomy narrowed. ADR-020 monotonicity OK for this change. |
| **Fix** | None. Optional: Settings/CHANGELOG note for single-flag operators (product nit, prior C5). |

### F2 — Cruise re-L2 no longer auto-approves danger / experimental
| | |
|---|---|
| **Severity** | — (positive regression fix) |
| **Where** | `companion/src/computer/executor.ts:637-667`, `FORCE_INTERACTIVE_DANGEROUS` `91-94`; `session-trust.ts:117-121` PROMPT_ALWAYS |
| **Evidence** | [inspected] Cruise early-return only when `!forceInteractive && !reL2ShouldPrompt(dangerous)`. `computer.danger_detected` / `computer.experimental_suggestion` always re-L2. Test: `computer-executor.test.ts` “full autonomy cruise does NOT auto-approve computer.danger_detected”. |
| **Impact** | Closes prior hole where three-flag cruise returned `true` before force-interactive check. |
| **Fix** | None. |

### F3 — PATH harden: correctness good; residual bare-name hijack
| | |
|---|---|
| **Severity** | LOW |
| **Where** | `companion/src/process-path.ts:110-133`; consumers `shell.ts:25-32`, `cli-exec.ts:73-83`, `index.ts:28`, `server.ts` startup, `mcp/transport.ts:39-41` |
| **Evidence** | [inspected] Drops non-directory PATH segments (ENOTDIR root cause); preserves user first-wins order; appends essentials only if missing. Does **not** demote untrusted user dirs ahead of system bins. |
| **Impact** | Fix for file-in-PATH is correct. Attacker who already controls env PATH (or `user_env` PATH) can still place a real directory first and hijack **bare** `spawn("cmd")` / shell names — standard OS PATH semantics, not a new escalation beyond process compromise. `config.env.PATH` on MCP still overrides hardened path verbatim (`transport.ts` comments). |
| **Fix** | Prefer absolute bins for high-risk tools (done for osascript). Consider documenting that user_env PATH is trusted-local; optional: refuse MCP `env.PATH` override without allowlist. |

### F4 — OSASCRIPT absolute path: no bare-name reintroduction in range
| | |
|---|---|
| **Severity** | — (positive) |
| **Where** | `process-path.ts:22` `OSASCRIPT_BIN = "/usr/bin/osascript"`; wired: `server.ts:3789` osascript_eval, `platform.ts`, `folder-picker.ts`, `menu-bar-agent.ts:46`; pre-existing `darwin-adapters.ts:934` absolute. |
| **Evidence** | [inspected] grep: no bare `"osascript"` spawn left in companion/src for tool paths. execFile argv, not shell. |
| **Impact** | PATH corruption cannot redirect osascript_eval / tray notify / vault picker. |
| **Fix** | None. |

### F5 — Office upload tmp write uses raw `filename` (path join escape) — pre-existing
| | |
|---|---|
| **Severity** | MEDIUM (pre-existing; attack surface exercised by S44 upload path) |
| **Where** | `companion/src/file-parser.ts:246-248` (`path.join(tmpDir, filename)` + `writeFileSync`); callers pass client `name` via `message-router.ts:635,666` without `basename` |
| **Evidence** | [inspected] Zip-slip on **inner** zip entries is gated (`230-244`). Outer `filename` is not sanitized: `path.join(mkdtemp(...), "../../outside.docx")` can escape tmp on POSIX. Auth WS peer (or compromised extension) can send crafted `file.upload` name + base64 body. |
| **Impact** | Arbitrary file write of uploaded buffer under companion process UID (not RCE by itself). Requires WS auth. LLM does not own file.upload; extension UI uses OS file pick names (usually basename). Residual local-auth risk. **Not introduced by this range** — file-parser unchanged. |
| **Fix** | `const safe = path.basename(filename).replace(/\0/g,"")`; reject empty/`..`; write only under tmpDir; assert `realpath(tmpPath)` stays under `realpath(tmpDir)`. |

### F6 — Upload diagnostics: no content leak in range changes
| | |
|---|---|
| **Severity** | NIT / LOW residual |
| **Where** | `background/index.ts` `diag.file_upload` + `file.upload` meta; `server.ts` `ws.file_upload.received`; `message-router.ts:599-612` |
| **Evidence** | [inspected] Logs names, types, `content_b64_len`, sizes, WS state — **not** base64 bodies. Comments enforce “Never log base64 content”. |
| **Impact** | Filenames may be PII in logs; acceptable for local agent diagnostics. `diag.file_upload` trusts extension message shape (same-extension). |
| **Fix** | Optional: truncate/hash filenames; gate verbose diags behind debug flag (product). |

### F7 — Packaging / supply chain 0.4.0
| | |
|---|---|
| **Severity** | LOW residual |
| **Where** | `scripts/package.sh`, `build-windows-exe.ps1`, `.github/workflows/release.yml` |
| **Evidence** | [inspected] Removes TinyClick worker + ORT staging (smaller native attack surface). Hard-gates `qwen-vl-worker.py` only; models/weights **not** packaged (on-demand under `~/.cmspark-agent/`). No secrets/tokens in package scripts. Worker is repo-sourced Python; runtime resolves bundled path (`qwen-vl-runtime.ts:64-100`) — explicit path must exist, no remote fetch of worker script. |
| **Impact** | Positive: drop multi-arch ORT binaries from ship zip. Residual: worker integrity relies on package authenticity (same as main bundle); model download path is separate trust surface (pre-existing product). |
| **Fix** | Keep fail-closed worker gate; optional SHA256 of staged `qwen-vl-worker.py` in release notes. |

### F8 — originWs still conditional on main L2 gate (pre-existing residual)
| | |
|---|---|
| **Severity** | LOW (known; not regressed) |
| **Where** | `server.ts:1857-1862` — `originWs` only when `winL2NonceChallenge \|\| hostComputerGated`; evaluate/shell/etc. unbound |
| **Evidence** | [inspected] host_computer re-L2 channel still origin-bound via `createOriginBoundConfirmation` / executor deps. Outbound fan-out unbound by design (L8). Range comments claim originWs for computer gate — accurate for host_computer path. |
| **Impact** | Second authenticated loopback peer could race-approve non-origin-bound L2 (multi-peer local). Documented in older multi-agent reviews. |
| **Fix** | Default `{ originWs: ws }` for all non-outbound L2; keep outbound L8 exception only. |

### F9 — Windows PATH vs Path on process env rewrite
| | |
|---|---|
| **Severity** | NIT |
| **Where** | `process-path.ts:139-147` `applyHardenedProcessPath` only reads/writes `process.env.PATH` |
| **Evidence** | [inspected] Child builders (`cli-exec`) merge Path→PATH and delete Path. Process-level fix may leave stale `Path` on some Windows hosts. |
| **Impact** | Edge-case residual ENOTDIR / dual-key confusion; low likelihood under Node. |
| **Fix** | Harden both keys; delete `Path` after setting `PATH`. |

---

## Positives

1. **M3' critical forceConfirm restored** — three-flag only; god-mode / domain / auto_approve alone no longer waive critical browser/host scripts (`server.ts:1476-1478`). Matches prior dual-review claim; inverted tests retained.
2. **Cruise danger re-L2 fixed** — content-sensitive tags never short-circuit under full autonomy (`executor.ts:643-647`).
3. **OSASCRIPT_BIN + PATH harden** — addresses real packaged-.app ENOTDIR without reintroducing bare `osascript`.
4. **Upload error path** — try/catch → `file.upload_error` clears UI busy; no secret body logging in new diagnostics.
5. **Packaging** — drop ORT/TinyClick from ship gates; no secrets in release scripts; qwen worker staged, weights out-of-band.
6. **Cookie trust** still requires three-flag cruise to waive (`server.ts:861-898`); not loosened by single flags.

---

## Residual risks / nits

| ID | Item | Sev |
|----|------|-----|
| R1 | F5 outer-filename tmp escape (pre-existing) | MEDIUM |
| R2 | F3 bare-command PATH first-wins / MCP env.PATH override | LOW |
| R3 | F8 non-origin-bound evaluate/shell L2 (pre-existing multi-peer) | LOW |
| R4 | F9 Windows Path dual-key | NIT |
| R5 | Single-flag operators see more L2 dialogs (intentional UX shock) | product |
| R6 | hostComputerTrustSkip / enterpriseSkip still designed L2 bypasses (session corpus / enterprise scope — not silent global raise) | design residual |

**ADR-020:** Range does not silently raise autonomy. forceConfirm restore and cruise danger re-prompt are trust-preserving. Three-flag cruise remains explicit multi-opt-in with audit (`security.critical_api_waived` / `full_autonomy_cruise`).

---

## Recommendation summary

| Gate | Result |
|------|--------|
| forceConfirm / three-flag | HOLD — tip correct |
| Cruise danger re-L2 | HOLD — tip correct |
| PATH / osascript | HOLD — ship; F9 nit optional |
| File upload (range) | HOLD diagnostics; **track F5** as follow-up harden |
| Packaging | HOLD — no secret/supply-chain block |
| **Ship** | **APPROVE_WITH_NITS** — do not block main; schedule `path.basename` tmp write for next security micro-PR |

**Do not modify production code from this lane** — report only.
