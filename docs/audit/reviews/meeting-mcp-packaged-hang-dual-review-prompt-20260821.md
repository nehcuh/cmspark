# Independent dual-review prompt — meeting stop hang + packaged MCP npx ENOENT

**Batch**: `meeting-mcp-packaged-hang-20260821`  
**Base**: `50869a9` (`main`)  
**Diff**: `docs/audit/reviews/meeting-mcp-packaged-hang-diff-20260821.patch`  
**Blast tier**: **T2** (L0 meeting UX + Compose mcp-server spawn env). No new L2 tools, no confirm family, no god-mode.

You are an **independent adversary**. You did **not** implement this. Do not rubber-stamp. Read the real files and the patch. Use Read/Grep/Bash. Do not invent file:line.

## Capability declaration (ADR-020)

```text
Surface:      L0 (会议工作台 STT / 结束并生成纪要)
L2-classes:   (none)
Compose:      mcp-server (stdio spawn PATH + npm_config_prefix)
Autonomy:     single
Trust:        无新确认门；MCP stdio env 仍走 allowlist（不 dump process.env / user_env）
Channel:      community
```

Apply `docs/audit/reviews/_templates/dual-review-capability-checklist.md`.
Do **not** call MCP a “中层 Agent”.

## Incident facts (executed, not folklore)

1. **Meeting hang** (`mtg_721938474f46daa0`, 2026-08-21): user clicked 「结束并生成纪要」; UI stayed on 「正在听…约 8 秒出第一段字」. Companion `SIGTERM` at `02:01:22Z` mid `voice.stt.start`; boot `meeting.recording_reconciled` → `ready` with **no** `meeting.generate_minutes`. Client adapter waited forever on `voice.stt.end` ACK (`stop()` while `phase===waiting` was a no-op besides `wantListening=false`).
2. **MCP death**: packaged `/Applications/CMspark.app/Contents/Resources/node` (v22, **no** npx/npm, **no** `Contents/lib`) prepended on MCP PATH; nvm `npx` ran under that node; npm `lstat /Applications/CMspark.app/Contents/lib` → ENOENT → `mcp.client.start_failed` / `-32000 Connection closed`. Reproduced with `PATH=Resources:nvm-bin`.

## Implementer claims (you must try to falsify)

1. Local STT adapter: pending wait for `voice.stt.result/error` times out (`pendingTimeoutMs` default 95s). After user `stop()`, timeout is `stopGraceMs` (12s), including **re-arming** if already waiting. Missing ACK → `empty_result` after stop (clean `onEnd`) or `infer_timeout` while still listening.
2. Meeting UI: stopping copy is 「正在结束…」 not 「正在听」. `MEETING_STOP_FAILSAFE_MS=20s` force-finalize if stuck stopping. `MEETING_DISCONNECT_FINALIZE_MS=5s` debounce: WS 1s blips must **not** kill capture; SIGTERM-length death must stop 「正在听」. `finalizeCapture` stays idempotent.
3. MCP: `dirHasNpx`; unpaired bundled node dir is **not** first ahead of an npx pair. `buildMcpStdioEnv` always sets `npm_config_prefix` to `$CMSPARK_DATA_DIR|~/.cmspark-agent/npm-prefix` unless `config.env` overrides. Operator `config.env.PATH` still verbatim.
4. Packaged launch: `scripts/launch-companion.sh` exports `npm_config_prefix` so the **next** DMG is not dependent on a user’s nvm PATH in config.json.
5. Tests exist and were run green (see Machine below). Live packaged `.app` at `/Applications/CMspark.app` is still the **10:00** build — source fix is **not** inside that binary. Do not claim the installed app is patched.

## External DoD (observable)

- [ ] `adapter.stop()` with no STT ACK → `onEnd` within stopGrace (classic + streaming tests)
- [ ] Stopping hint ≠ 「正在听…约 8 秒」
- [ ] Disconnect debounce constant 5s < stop failsafe 20s
- [ ] `buildSpawnPath({execPath: fake.app/Contents/Resources/node})` places an npx-paired dir before Resources
- [ ] `buildMcpStdioEnv()` has `npm_config_prefix` under `.cmspark-agent/npm-prefix`; secrets still excluded
- [ ] `launch-companion.sh` contains `npm_config_prefix` + `npm-prefix`
- [ ] No new L2 / confirm / default-on
- [ ] MCP allowlist still does **not** spread `process.env` / user-env secrets

## Machine (implementer-reported; re-run if you doubt)

```
chrome-extension: tsc --noEmit + 27 tests (meeting-caps, local-stt-adapter, continuous, ws) EXIT 0
companion: tsc --noEmit + mcp.test.js 28 pass / 1 skip + p0 prefix test EXIT 0
scripts/tests/test-package-gates.sh 112 passed, 0 failed EXIT 0
```

## Attack list (you must actually check)

1. **Double finalize / lost minutes**: stop failsafe + disconnect debounce + adapter `onEnd` racing `finalizeCapture` / `wantGenerateRef`.
2. **WS blip false stop**: 1s `ws.client_disconnected` during live meeting (log pattern every few minutes) vs 5s debounce.
3. **Last window dropped**: 12s stopGrace vs large-v3-turbo / slow medium infer; is the honesty copy enough or is product-broken?
4. **PATH override bypass**: `config.env.PATH` verbatim still includes `Contents/Resources` — does prefix still save? Did implementer test that combo?
5. **Windows**: `npx.cmd` pairing; SEA `cmspark-agent.exe` as execPath; launch-companion.sh is mac/linux zip — Windows gap?
6. **prefix write into app bundle** if override forgotten; codesign.
7. **Trust**: `npm_config_prefix` mkdir in data dir permissions; MCP child env leak.
8. **Incomplete recovery**: meeting `ready` without minutes; no “load last meeting” UI — is that in-scope residual or a blocker?
9. **Tests that would pass on old code**: demand they fail without the timeout (the new tests should hang/fail pre-fix — implementer claimed RED then GREEN).
10. **Drive-by / overclaim**: installed `.app` not rebuilt.

## Three layers

| Layer | Question |
|-------|----------|
| Outcome | DoD actually true? |
| Trajectory | Scope = two incidents only? |
| Component | file:line of remaining holes |

## Output

1. Findings: BLOCKER / NIT with file:line + evidence vs inference
2. What you executed
3. Capability checklist result
4. Residual risks
5. Final line **exactly** one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
