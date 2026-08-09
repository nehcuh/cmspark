## Independent re-review — voice-pack-windows-closeout

### Verification performed (real repo, not just the patch)

I read the current working tree (the provided patch was partially stale — the test-file cast fix landed concurrently and `chrome-extension/package-lock.json` is no longer modified), verified `git diff HEAD`, inspected all touched sources, and ran the gates myself.

**DoD 1 — launch.bat fail-closed: PASS.** `companion/launch.bat` now probes `127.0.0.1:23401 LISTENING` after launch and `exit /b 1` with crash-log pointers on failure. The probe target is correct: `server.ts:6663` binds `httpServer.listen(port, "127.0.0.1")`. `crash.log` path is real (`crash-handlers.ts:19` writes `~/.cmspark-agent/logs/crash.log`). `ping -n 6` gives ~5s probe window — heuristic but adequate.

**DoD 2 — skill.import-\* under WS strict: PASS.** Registered at `server.ts:6346-6358`; `ws-validate-strict.test.ts` updated with payloads; `voice.stt.start requires privacy_ack_v2` gate still enforced.

**DoD 3 — large-v3-turbo honesty: PASS.** `whisper-catalog.ts` notes (final-only), `SettingsSlideout.tsx:1366` inline note, user-guide table row, README. Honesty is also *enforced*: `stt-session-service.ts:229` returns `partial_skipped` for large-v3-turbo, and infer timeout rises to 180s.

**DoD 4 — no trust regression: PASS.** Diff touches no unattended/auto_approve/gate defaults.

**DoD 5 — WS core tests pass: PASS (independently run).** `npx tsc -p tsconfig.test.json` exit 0; `ws-validate-strict` + `voice-whisper-runner` = **13/13 pass** on compiled output. (Note: an earlier tsc run failed on a TS2352 cast in the test — the tree was concurrently fixed to `seenArgs ?? []`; current tree is clean.)

**ADR-020 checklist:** Capability declaration present in the batch's adversary synthesis (Surface: local STT binary download + WS validators; Trust: unchanged; Channel: fences retained) — and this diff adds no new tools/gates/primary UI, so any absence would be nit-level only. `originWs: ws` preserved on the re-indented `requestConfirmation` (server.ts:7236). No new agent runtime, no "中层 Agent" language, no new confirm family, trust monotonicity untouched.

### Nits (non-blocking)

1. `whisper-runner.ts` env block: this branch replaces the previous whitelist (with its "Avoid leaking secrets into child env" comment) with full `...process.env` inheritance. Justified by Windows CRT needs (SystemRoot), and the child is a pinned same-user binary — but a targeted whitelist + SystemRoot/WINDIR would keep secret hygiene. Recommend filtering known secret vars.
2. `server.ts:6346`: `skill.import-folder` validator is trivially `valid:true` while the router requires `zip_data` (`message-router.ts:2280`). Harmless (router throw is now caught → error response), but the validator should mirror the router.
3. On large-v3-turbo the client keeps polling `partial_request` every ~1.4s during recording; server silently no-ops (`stt-handlers.ts` returns undefined for `partial_skipped`). Wasted round-trips; a client-side skip would be cleaner.
4. `defaultWhisperThreadCount()`: `Math.floor(n/2) || 4` yields 4 threads on a 1-core machine (edge case).
5. Stray untracked artifacts at repo root (`.tmp-ci-jobs.json`, `.tmp-ci-jobs2.json`, `.tmp-ci-log.txt`, `.tmp-diagnosis-report.json`) should not be committed.
6. The reviewed patch file predates the concurrent test-file fix — regenerate before archival so the record matches the merged tree.

All five DoD items hold in the current tree; no blocking issues.

VERDICT: APPROVE_WITH_NITS
