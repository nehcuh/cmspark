# Multi-adversarial review — main tip after S61–S62 pull + Mac reinstall

**Date:** 2026-08-10  
**Tip:** `5c64604` (`origin/main`)  
**Range:** `9a8b444..HEAD` (#160 unattended silence + deep-diagnosis P0–P2 + #161 Windows voice-pack closeout)  
**Method:** Four independent read-only agents — Architecture / Design / Implementation / Documentation  
**Install:** `make package-macos` → ditto `/Applications/CMspark.app` (bak `~/CMspark.app.bak-20260810-090705`); daemon **23401** up; whisper pin match `40bca494…`

---

## Part 0 — Pull / build / install

| Step | Result |
|------|--------|
| `git fetch` + rebase | Local obsolete S61 memory commit skipped; main = `5c64604` |
| First `make package-macos` | **FAIL** at esbuild: `run-esbuild-bundle.mjs` invoked native `esbuild` via `node` → SyntaxError |
| Fix (local, uncommitted) | Spawn `esbuild` binary directly (not `process.execPath`) |
| Package + DMG | OK — `dist-package/CMspark-v0.5.0-macOS.dmg` ~53M; CDHash `c5e4613d…` |
| Replace app | OK — codesign valid; tray + daemon + estop; whisper staged |
| Dirty tree after install | `run-esbuild-bundle.mjs` (packaging fix) + `host-integrity.ts` (build-host SHA rewrite) |

---

## Executive synthesis

Four lenses converge: **#160/#161 close real holes** (WS fail-closed registry, shell/netsec token binding, unattended true silence, Whisper SEA sidecar, evaluate always-L2 unless three-flag). No consensus **P0 remote compromise**. Ship for **macOS arm64 personal reinstall is YES**, with residuals.

Highest cross-cutting risks:

1. **Dual Trust clocks** — unattended grant is process-memory; arm dual-writes durable cruise flags → restart clears badge/grant but **not** web/enterprise auto-approve.
2. **Safety UX honesty gap** — 急停≠解除 documented but **no toast**; Confirm Center empty during true silence looks “safe idle.”
3. **shell_exec cwd** — token binds `params.cwd`; execute may use `workspace_root` when empty.
4. **WS dual tables** — validators vs router vs extension SW not mechanically synced; next missing type = “Companion dead.”
5. **Stale parallel SoTs** — Aug-02 design/plans still teach “danger re-L2 still confirms.”

| Lens | Grade | Ship |
|------|-------|------|
| Architecture | **B−** | macOS arm64 YES + ops checklist |
| Design / honesty | **B−** | Soft-block marketing unattended until estop toast + cockpit banner |
| Implementation | **B+** | Conditional YES for reinstall |
| Documentation | **B−** | Fix SoT conflicts before agent-facing work |

---

## Consensus findings (deduped)

### P1 — ship residuals / next hardening

| ID | Title | Lenses | Evidence (abbrev) |
|----|-------|--------|-------------------|
| C1 | Unattended dual-write cruise sticks across restart; grant does not | Arch, Design | `message-router.ts` ~3197–3204 `saveConfig` auto_approve_*; grant process-memory |
| C2 | shell_exec token cwd ≠ effective cwd / L2 understates cwd | Arch, Impl | `security-policy.ts` bind cwd; `server.ts` exec uses workspace_root |
| C3 | Dual WS tables / god-file drift under production strict | Arch, Impl | `server.ts` validateWsMessage + message-router; partial sample tests |
| C4 | Unattended re-L2 full silence (incl. danger) — accepted residual | All | `executor.ts` ~642–657; ADR-021 |
| C5 | 急停≠解除 UX missing toast; cockpit no 值守 banner | Design | SafetyStrip abort only; docs claim toast |
| C6 | Stale SoT: danger re-L2 still confirms | Design, Docs | `docs/superpowers/specs/2026-08-02-unattended-desktop-design.md` vs ADR-021 |
| C7 | Whisper multi-arch pins incomplete; Mac auto-download limited | Arch, Design | pins: darwin-arm64 + win-x64 only; manifest win-first |
| C8 | Matrix unattended cell overstates spawn/skip | Design | autopilot-tier vs forceConfirm three-flag |
| C9 | CU enable path: AppsPanel has 坐标操作 UI; CU guide/ADR-017 still “config only” | Docs | `AppsPanel.tsx` computer.set_enabled |
| C10 | Tests weak / false-green on forceConfirm & unattended executor | Impl | security-gates OR; unattended tests skip executor silence |

### P2 / nits (selected)

- Token `threadId` default `"default"`; `bindingPayloadFor` empty default for unknown tools  
- Netsec omitted ports → COMMON_PORTS after bind `[]`  
- Package soft-warn on missing whisper/extension  
- privacy_ack_v2 is wire boolean, not durable storage-bound  
- mcp.md outbound default `require_grant` stale  
- CHANGELOG under-reports post-0.5.0-cut tip (#160/#161)  
- Memory tip lag (`57bad96` vs `5c64604`) — now tip is `5c64604`  
- Packaging bug this session: esbuild spawn via node (local fix)

### No consensus P0

No finding that is both (a) unintended vs current ADRs and (b) unauthenticated remote compromise. Design “P0” items are **mental-model / residual underestimation** under armed unattended.

---

## What landed well (keep)

- Unattended algebra matches revised ADR-021 (initial + re-L2 silence; hard deny throws)
- Dual-ack + phrase gates on arm; pack cannot arm unattended
- shell/netsec `issueTokenFor` / `validateTokenFor` same `bindingPayloadFor` (S62 root cause closed)
- Production WS fail-closed + core types registered (config.get / thread.list class)
- Whisper: HTTPS + sha256 + execFile shell:false; darwin-arm64 pin matches staged binary
- Windows SEA MCP/notifier bundle SoT; launch.bat port probe fail-closed
- Cookie trust no longer skips URL gate; evaluate force L2 unless three-flag
- Config redaction SoT

---

## Recommended next work (priority)

### Fix-before-promote (unattended marketing / enterprise claims)

1. 急停 toast: “任务已停 · 值守仍开”  
2. Cockpit banner when `unattended.armed`  
3. SUPERSEDED banners on Aug-02 unattended/Trust-IA SoTs re: re-L2  
4. Matrix spawn cell honesty (default 值守 ≠ three-flag)

### Hardening PR candidates

5. F1 dual-SoT: restore cruise flags on grant TTL / boot if unattended not armed, **or** stop durable dual-write  
6. shell_exec: resolve effective absolute cwd at issue + bind + preview  
7. CI assert router cases ⊆ WS validators  
8. CU guide + ADR-017: Apps 坐标操作 primary path  
9. Commit packaging fix for `run-esbuild-bundle.mjs` (this session)  
10. Whisper multi-arch pins when ready

### Backlog (deferred honestly)

- God-file split (server.ts / message-router)  
- Surface L0/L1 as Companion tool filter  
- Full npm suite gate beyond dual partial tests

---

## Ship checklist (macOS arm64 reinstall — done today)

- [x] main = `5c64604`  
- [x] DMG built; app replaced; codesign OK  
- [x] daemon listen 127.0.0.1:23401  
- [x] whisper pin match  
- [ ] Operator smoke: pair extension; arm 值守 with eyes open; estop; disarm clear_cruise  
- [ ] Operator smoke: god-mode alone still prompts host_computer / evaluate  
- [ ] Commit esbuild spawn fix + host-integrity if SHA intentional  

---

*Generated from four parallel adversarial explore agents + packaging install evidence. Code findings [inspected]; full e2e armed desktop not re-executed this session.*
