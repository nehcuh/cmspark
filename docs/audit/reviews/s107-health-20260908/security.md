# Lane C — SECURITY adversarial residual (s107 health 2026-09-08)

**LANE:** C security (independent; did not implement; did not edit product code)  
**HEAD:** `4a63de56` (`main`, `fix(workspace): 修复听写与代码任务归属，补齐对话分类 (#485)`)  
**PRODUCT:** 0.6.6  
**DATE:** 2026-09-08  
**SCOPE:** residual recode A–N against current tree. Frozen: #230 overlay-acl (do not expand). T1 #228 scored (do not expand default outbound profile).

```text
Verdict:      APPROVE_WITH_NITS
BLOCK:        none
MAJOR:        2 residual (C assistant-args persist; overlay WS mcp.toggle_server mutation)
Evidence:     [inspected] current source + [executed] INSTDIR/dist-package leftover SEA probe
Trust:        paired loopback WS (ws_secret) · outbound grant (cmg_) · overlay surface ACL
```

Did **not** re-litigate cookie `trusted_domains`, #228 outbound L1 default tools, or #230 overlay-acl expansion. Overlay mutation residual is reported, not a request to grow the allowlist.

---

## Verdict

**APPROVE_WITH_NITS.** No unauthenticated RCE, no confirmed pairing-bypass, no network secret-exfil evidenced in current code. Core residual gates (A, B stdio spawn, D, E, F, G, H, J, K, L, M-SEA) hold. Two MAJOR residuals remain: (C) assistant `tool_calls[].function.arguments` still land unredacted in `threads/*.json`; overlay WS still mutates MCP via `mcp.toggle_server` while the tray-pipe path is a documented no-op. Neither is BLOCK under this charter.

---

## Threat-model one-pager

| Surface | Attacker | Trust boundary | What must not happen |
|---|---|---|---|
| Companion WS `127.0.0.1:23401` | Local process forging Origin | `ws_secret` handshake; unauthenticated frames terminate | `config.set` / `mcp.add` / `history.export` before `auth.ok` |
| Overlay (`surface=summoner`) | Overlay stdin + overlay WS | ACL + payload policy; never originWs for Allow/Deny | Confirm chrome; trust elevation; MCP spawn; execution upgrade |
| Outbound MCP (HTTP/stdio) | External agent with `cmg_` grant | Grant profile + origin bind; **must not inherit** operator cruise flags | Page/knowledge export without grant; session handle/token in audit; splat `auto_approve_*` |
| Embedded PTY | Panel `terminal.*` | `user_gesture` + L2 + `plan_readonly` deny + cwd start-jail | Overlay/PTY; cruise skip L2; `CMSPARK_*`/ws_secret in child env; keystroke audit |
| Thread JSON / history.db | Disk at `~/.cmspark-agent` | 0o600 atomic write; redaction before persist | Path escape via `thread_id`; cookie/shell/MCP secrets on disk |
| Voice / meeting embed | Model download + ONNX | https-only rewrite fail-closed; on-device inference | http/file URL rewrite; audio leaving the machine |
| Windows installer | Leftover SEA from prior local build | NSIS `Delete` + wrapper refuse SEA staging; VBS node-first | Official tree launching leftover `cmspark-agent.exe` |
| Tests | CI / local `node --test` | live `getConfigDir()` / pin `CMSPARK_DATA_DIR` before import | Fixture write into real `~/.cmspark-agent/config.json` |

Unauthenticated loopback peer: handshake-required (`lifecycle.ts` ~1127–1135). Overlay is a second tray-origin WS, not a public client. Outbound is L4+ grant, not Extension pairing.

---

## Recheck table (A–N)

| ID | Item | prior_status | Evidence (current) |
|---|---|---|---|
| A | `threadFilePath` / `sanitizeId` all readers/writers | **fixed** | `ThreadManager.isSafeThreadId` `/^[a-zA-Z0-9_-]{1,64}$/` fail-closed on every path op (`thread-manager.ts:553–575,648,1103,1123,1179,1253,1276`). `create()` still `sanitizeId` (strip+regen). Sidecar uses the same regex + realpath containment (`image-sidecar.ts:15–66`). Tests: `thread-path-sanitize.test.ts`. |
| B | `mcp.add` / stdio L2 | **fixed** (overlay toggle residual → I) | `requireMcpStdioSpawnConfirm` fail-closed if no `requestConfirmation`; `autoConfirmEligible: false` (`handlers/mcp.ts:33–76`). Add / spawn-surface update / enable false→true all gated (`257–281`, `341–347`, `407–423`). Loader keys rejected (`isUnsafeLoaderEnvKey`). Overlay `mcp.add` denied (ACL); tray-pipe `handleSummonerMcpAdd` is a no-op (`menu-bar-agent.ts:975–977`). |
| C | Thread JSON tool redaction before persist | **partial** | Tool-role rows go through `createToolResultMessage` → `redactToolPayloadForPersistence` (`tool-batch-heal.ts:8–19`; `tool-persistence-redact.ts`). History.db shares `redact-rules.ts` (lock-step tests). **Hole:** `persistAssistantDraft` writes raw `function.arguments` (`adapter.ts:1159–1178`). `updateMessage` has no redactor (quarantine/heal callers pass already-redacted or placeholder rows). |
| D | `chat.create` supersede generation CAS + drain | **fixed** | `llmLoopGeneration` CAS in `finally` (`message-router.ts:188–191,1369–1380`). `drainNextRun(threadId, myGeneration)` no-ops if generation moved (`356–362,1382–1386`). `abortThreadChat` bumps generation then frees the multi-agent gate (`230–246`). |
| E | `pendingToolCalls` originWs + per-socket close | **fixed** | `originWs` on pending (`tool-forward.ts:75–76,195–200`). `handleToolResult` origin mismatch returns (`138–148`). `applyConnectionCloseGracePeriod(closedWs)` skips other peers and unscoped entries (`lifecycle.ts:328–337`). Tests: `pending-tool-origin-ws.test.ts`. |
| F | MCP list/env/header redaction | **fixed** | `redactMcpServersForBroadcast` masks env/headers to `***` (`handlers/mcp.ts:141–161`); list/update broadcasts use it. `redactConfigForWire` same for `config.updated` (`config-redact.ts:47–74`). Update restores `***` from disk (`restoreMaskedRecord`, `107–120`). |
| G | god-mode / `auto_approve_*` vs outbound grants | **fixed** | `#410` blast: `if (isOutboundMcpCall) skipConfirmation = false` (`l2-admission.ts:926–936`). Outbound-mcp has **zero** reads of `auto_approve_dangerous` / `auto_approved_domains`. Three-flag cruise is operator HITL algebra only (`isFullAutonomyCruise` `114–123`); grants are a separate store (`outbound-grants.ts`). |
| H | Embedded terminal: gesture + L2, plan_readonly, env strip, cwd jail, audit | **fixed** | Panel-only (`handler.ts:53–57`). `user_gesture !== true` deny (`68–70`); L2 via origin-bound `requestConfirmation` (not l2-admission skip path; cruise cannot waive) (`101–127`). `plan_readonly` deny on open and on later ops (`89–91,137,185`). Env strip `CMSPARK_*` + `api_key`/`ws_secret` (`pty/env.ts:5–16`). Start cwd realpath-contained (`pty/cwd.ts:36–40`); login shell may `cd` (documented, not a sandbox). Audit `terminal.open/close` is id/cwd/pid/thread — no b64 (`session.ts:147–155,282–289`). |
| I | Summoner background task arm: triple gate, overlay must not render confirm, downgrade-only | **fixed** with overlay MCP-toggle residual | Triple: (1) `user_gesture:true` (`message-router.ts:3135–3136`); (2) overlay lease bind `gateOverlayCurrentThread` (`3128–3133`; `composer-lease.ts:128–150`); (3) `armLoop` refuses `plan_readonly` (`3163–3171`). Overlay may only set `plan_readonly` (`summoner-acl.ts:162–186`; router `3046–3051`). `task_loop.stop` ACL-denied on summoner (`3200–3202`). Overlay never originWs (`confirm-fanout.ts:3–5,121–128`); pending notice only (`summoner/client.ts:413–418`); no `summoner.confirm.*` dialect (`protocol.ts:7–8,507–513`). **Residual:** overlay WS still allows `mcp.toggle_server` (see findings). |
| J | `outbound_context_v1` export: origin bind, revoke-before-return, no handle/token in audit | **fixed** | Exact https origin, no `*` (`context-permission.ts:4–13`). `projectOutboundContext` re-reads grant after async target work; no `await` after final `requireContextGrant` (`context-projection.ts:23–39`). HTTP path re-checks live grant before and after the read (`companion-http.ts:687–710`). Audit fields: caller/tool/profile/grant_id/`session_invalid` boolean — **no** handle, **no** token (`audit.ts:8–39`). Session handle is returned to the authorized caller only (`companion-http.ts:831–833`). |
| K | Voice model download URL rewrite fail-closed; meeting embedding on-device | **fixed** | `normalizeModelDownloadEndpoint` https-only or throw (`whisper-download.ts:180–198`). Invalid endpoint throws **before** fs/network (`615–621`). Rewrite only `huggingface.co` host; unparsable URL returned as-is then `isHttpsUrl` fail-closed (`223–236,648–670`). Redirects refuse non-https (`697–701`). Diarize download uses the same rewrite (`diarize-model.ts:138–141`). Embeddings: ONNX local, “Audio never leaves this machine” (`diarize-embed.ts:1–8`). |
| L | Page-read provenance #452 bind | **fixed** | Extension samples before/after/observed target; mismatch → `capture_status: TARGET_CHANGED` and `target` omitted (`page-read-provenance.ts:36–67`). Companion store skips `TARGET_CHANGED` / missing schema (`business-evidence/store.ts:115–116`). Outbound context throws `TARGET_CHANGED` on navigation_key drift (`context-projection.ts:33–34`). |
| M | Installer/INSTDIR leftover + VBS preferring SEA | **fixed** (non-SEA leftovers remain) | `installer.nsi:88–89` `Delete "$INSTDIR\cmspark-agent.exe"` before File. Wrapper refuses SEA staging (`build-windows-installer.sh:95–96`). VBS Priority 1 = bundled `node.exe`+`cmspark-agent.js`; SEA is last resort (`launch-hidden.vbs:21–40`). **[executed]** `%LOCALAPPDATA%\CMspark\cmspark-agent.exe` **absent**; `dist-package\cmspark-windows-x64\cmspark-agent.exe` **absent**. Leftover `gif.jpg` / `gifcode_test` still present (installer overlay does not wipe). |
| N | Tests writing real home config (#404/#405/#406) | **partial** | Config/grants/ws_secret/.paired/obsidian/pid/logs live-resolve via `getConfigDir()` (`config.ts:1537–1540`; `outbound-grants.ts:34–38`; `ws-auth.ts:35–38,127–129`). `DATA_DIR` export is still import-time. Remaining freeze: `user-env.ts:148` default `DATA_DIR`; `computer/evidence.ts:91`; `computer/unattended-grant.ts:109`; `computer/qwen-vl-download.ts:37`; `computer/python-runtime.ts:450`. Tests that pin `CMSPARK_DATA_DIR` **before** import (e.g. `user-env.test.ts:9–11`, `computer-model-test-env.ts`) are safe. `loop-route-engine.test.ts` **reads** live `getConfig()` without pin — no `saveConfig`, not a write-pollution. |

---

## Findings

### BLOCK

None. Charter: unauthenticated RCE, confirmed authz bypass, or secret exfil evidenced in code. None of those landed.

### MAJOR

**M1 — SEC-C residual: assistant tool-call arguments persist unredacted**  
`[inspected]` `companion/src/llm/adapter.ts:1159–1178` `persistAssistantDraft` writes `tool_calls: assistantMsg` with raw `function.arguments`. Tool **results** are folded by `createToolResultMessage` (`tool-batch-heal.ts:8–19`) before `addMessage`. Disk file is `threads/<id>.json` at 0o600 (`io.ts:16–18`, `thread-manager.ts:1163`). Failure mode: `shell_exec` command, `evaluate` code, cookie `value`, MCP secret-shaped args survive reload/export of the assistant row even though the matching tool row is hashed. In-flight LLM context is intentionally unredacted (module comment `tool-persistence-redact.ts:12–13`); the durable assistant row is the hole. Not network exfil. Not BLOCK.

**M2 — Overlay WS can still mutate MCP (`mcp.toggle_server`)**  
`[inspected]` `summoner-acl.ts:17–47` allowlist includes `mcp.toggle_server` while the file comment says overlay `mcp.list` is read-only and `mcp.add` stays denied. Tray-pipe handlers are explicit no-ops (`menu-bar-agent.ts:971–977`, “Capture overlay does not mutate MCP”). Overlay WS `mcp.toggle_server` **does** call `replaceMcpServers` (`handlers/mcp.ts:393–427`). Stdio enable still hits L2, but `requestConfirmation` is origin-bound to the overlay socket (`lifecycle.ts:1424–1432`) which cannot `security.confirmation.respond` (not on `SUMMONER_ALLOW`) → 45s timeout deny (fail-closed). **Disable** and **HTTP enable** skip that spawn gate. Overlay is a paired local peer, not an unauthenticated client — authz residual vs documented list-only overlay, not pairing bypass. #230 freeze: do not grow ACL this round; do not treat this as a request to add more overlay verbs.

### NIT

**N1 — INSTDIR leftover files (not SEA).** `[executed]` `%LOCALAPPDATA%\CMspark` still has `gif.jpg` (6593 B) and `gifcode_test` (157 B) from 2026-08-30. NSIS overlay copy does not wipe extras. **No** `cmspark-agent.exe`. Harmless clutter; VBS cannot prefer a missing SEA.

**N2 — Import-time `DATA_DIR` still used for some writes.** `[inspected]` `getConfigDir()` is live (#404/#406). `userEnvFilePath()` defaults to frozen `DATA_DIR` (`user-env.ts:148`). CU evidence / unattended cruise snapshot / Qwen-VL models / python-env still `path.join(DATA_DIR, …)`. A future test that static-imports those modules *before* pinning `CMSPARK_DATA_DIR` can write the real home tree (the #404 class). Current tests sampled (user-env, computer-model-handlers) pin first.

**N3 — Overlay stdio-enable confirm is a dead origin.** `[inspected]` If overlay WS toggles a disabled stdio server on, L2 binds `originWs` to overlay; overlay cannot respond; panel/tray cannot steal the nonce (`security-confirmation.ts:417–444`). Fail-closed. UX deadlock, not a skip.

**N4 — PTY cwd jail is start-path only.** `[inspected]` `pty/cwd.ts:1–2,36–40`. Login PTY (`zsh -l`) can `cd`. Documented; L2 copy already says “非只读沙箱” (`handler.ts:121`).

**N5 — `rewriteWhisperFileUrl` passthrough on unparsable URL.** `[inspected]` `whisper-download.ts:226–230` returns the raw string; download then `isHttpsUrl` throws `scheme-denied`. Fail-closed. Do not “fix” by rewriting unknown hosts.

**N6 — `loop-route-engine.test.ts` reads live config.** `[inspected]` Top-level `import { getConfig }` without `CMSPARK_DATA_DIR` pin; asserts `coordinateEnabled` is not flipped. Read-only; do not let a later edit `saveConfig` here.

### Closed / holding (no finding)

- WS unauthenticated terminate before `mcp.add` (`lifecycle.ts:1127–1135`).
- MCP stdio child env is allowlist + per-server `config.env`, not `process.env` dump (`mcp/transport.ts:210–248`).
- Outbound never inherits operator exemptions (`l2-admission.ts:926–936`).
- Overlay confirm fan-out: Allow/Deny only to non-summoner peers; overlay gets `mcp.confirm.pending` (`confirm-fanout.ts:24–27,88–94`). Tests: `l2-summoner-confirm-origin.test.ts:163–164`.
- `search_threads` / `search_knowledge`: titles+snippets, `redactSecrets`, workers/orchestrators skipped (`llm-search.ts`; `read-search.ts:23–30`).
- Execution-contract shadow is log-only, default off, summoner-denied (`execution-contract.ts:13–31`; `companion-dispatch.ts:2119–2129`).
- Hex PTT / Windows SAPI / diarize download: no new L2 skip path found; voice.stt is origin-classed (extension or summoner+tray).

---

## Open questions

1. Should overlay WS `mcp.toggle_server` be removed to match the tray-pipe no-op and the file comment (list-only)? That is an ACL **shrink**, not an expansion — compatible with #230 freeze as a residual close, but it is a product call, not a BLOCK.  
2. Should `persistAssistantDraft` run `redactCodeishParams` / `redactSensitiveKeysDeep` on `function.arguments` before disk write, or is the assistant row considered in-flight until the matching tool row exists? Current comment says only `createToolResultMessage` is the persist gate.  
3. Should `userEnvFilePath` / CU evidence / unattended snapshot switch to `getConfigDir()` so the last #404-class freeze points die? Not a live-config write today if tests keep pinning first.  
4. Overlay `mcp.toggle_server` stdio-enable: bind confirm via `resolveConfirmBinding` (panel/tray) instead of raw overlay `originWs`? Today fail-closed; a bind change would make overlay-initiated enable *approvable* from the panel — which may be the wrong product.

---

## Evidence index

| Claim | Level | Source |
|---|---|---|
| HEAD | `[executed]` | `git rev-parse` → `4a63de56f1cd32da5470ab8dab09d9b61b6818d8` |
| INSTDIR no SEA | `[executed]` | `%LOCALAPPDATA%\CMspark` listing; `cmspark-agent.exe` absent; leftover `gif.jpg`/`gifcode_test` |
| dist-package no SEA | `[executed]` | `dist-package\cmspark-windows-x64` has `node.exe` + `cmspark-agent.js`, no exe |
| A–L, N code paths | `[inspected]` | files cited above; tests named in the recode table |
| No `~/.cmspark-agent/config.json` contents read | — | per mission |

---

## Skill / method

VibeSOP routed `builtin/code-review`. This assignment is a residual adversarial recode with a fixed output path, not a pre-push diff walkthrough; the user’s A–N structure and BLOCK charter take precedence. Correctness+security passes were done as the recode table. No product code edited.
