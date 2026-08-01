# Review: tray/Aqua-owned estop implementation

**Batch:** tray-estop-impl · **Branch tip:** `fix/macos-tcc-product-identity` (efed228 + c96faf0 + 3c6d559)

---

## Summary

The change moves estop ownership from the Node daemon to the Aqua-launched `MacOS/CMspark` Mach-O, exactly matching platform-analysis recommendation §4.2 #2 ("Tray 拥有 estop：Companion 只连 socket"). Verified against code, git history, and the blocked handoff's "勿宣称已修好" constraint.

**Architecture as shipped:**
- `host.swift launchAgentTrayAndExit()` — starts `estop --socket-path /tmp/cmspark-estop.sock` as a **child of the same Mach-O** (`execPath`) *before* spawning the Node tray; retains it in `gTrayOwnedEstopProcess`, terminates it on tray exit. Liveness is connect-tested first; a dead/stale socket file is unlinked *only* after the connect fails, so a live helper is never clobbered.
- `darwin-estop.ts ensureEstopHelper()` — held socket → **connect-first** with 3s grace (30×100ms) → `CMSPARK_ESTOP_NO_DAEMON_SPAWN=1` opt-out → logged 2-attempt daemon fallback. `unlinkEstopSocket()` lives only inside `spawnEstopOnce()` (post-grace).
- `menu-bar-agent.ts` — `startTrayOwnedEstopBestEffort()` on darwin tray start (dev path only; packaged app already has estop from host.swift).
- `server.ts` — macOS preflight refuses `EMERGENCY_STOP_UNAVAILABLE` on `!ok`; `abortCheck` polls `estopHeartbeatLost()` → `"estop-lost"` fail-closed (true when `liveSock === null || liveSock.destroyed`, i.e. before any successful connect).
- `runEstop` in Swift orders socket→accept→tap; on `tapCreate` failure (code 4) it throws and **exits**, so a dead tap cannot masquerade as a live kill switch (socket dies with the process).
- User docs (`computer-use-user-guide.md`) now explicitly say **只认 CMspark** / "不要去找或勾选 node、cmspark-host".

**Test verification performed:** `tsc -p tsconfig.test.json` compiles the new owner test; Windows `computer-estop.test.js` suite runs 15/15 green. I deliberately did **not** execute `computer-darwin-estop-owner.test.ts` on this machine because it `unlinkSync`s the *live production socket* of a running CMspark.app (see Nit 1).

## Must-verify checklist

| # | Item | Status |
|---|------|--------|
| 1 | Preferred owner = Aqua `MacOS/CMspark`, not Node daemon | ✅ |
| 2 | Companion does not unlink tray socket before connect | ✅ (unlink only in post-grace `spawnEstopOnce`) |
| 3 | Daemon spawn = fallback + logged | ✅ `computer.estop.daemon_fallback` warn + `owner:"daemon-fallback"` |
| 4 | No user-facing "enable node" | ✅ user guide actively forbids it; rg over user paths shows only sanctioned negation + dev stderr |
| 5 | Fail-closed if no estop at all | ✅ preflight refuse + `estopHeartbeatLost` null-socket abort |
| 6 | Tests for connect / NO_DAEMON_SPAWN | ⚠️ exist but shallow + destructive (Nits 1–3) |

## Rejection gates

| Gate | Verdict | Evidence |
|------|---------|----------|
| **R1** daemon spawn preferred/only | **Not tripped** | Connect-first with 3s grace; daemon spawn is last-resort, logged, has `CMSPARK_ESTOP_NO_DAEMON_SPAWN=1` opt-out |
| **R2** tray deletes estop socket before connect | **Not tripped** | Swift `estopSocketLive()` performs a real `connect()` first; `unlink` runs only when connect failed (dead socket) and precedes *spawn*, not connect. Companion's connect path contains zero unlinks |
| **R3** claims on-device fix without evidence | **Not tripped** | HANDOFF line 93 explicitly "勿宣称…已完全修好 — 真机 host_computer 仍失败"; platform analysis marks P0 daemon↔TCC 闭环 未完成; workflow scoped to "TCC ownership fix" |
| **R4** estop replaced by untrusted binary | **Not tripped** | Tray spawns `execPath` (same Mach-O). Daemon fallback uses `resolveHostBinary()`: override gated behind `CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1`; packaged path prefers `.app/Contents/MacOS/CMspark`; no un-gated substitution vector |

## Blocking

None.

## Nits

1. **Owner test is destructive on live dev machines.** `computer-darwin-estop-owner.test.ts` test 2 does `fs.unlinkSync("/tmp/cmspark-estop.sock")` — deleting the *live* proof-of-life socket of a running CMspark.app. This is precisely the behavior the production change was designed to avoid, and it will clobber the running app's estop (breaking new connections until restart/fallback) whenever the suite runs while the packaged app is up — the normal macOS dev condition. An injectable socket path would make the test non-invasive.
2. **"Connect" test doesn't exercise the module's connect path.** Test 1 only verifies raw `net.createConnection` semantics against a test socket (its own comment admits it). `tryConnectHeld`/`holdSocket`/the 3s-grace connect against the module's fixed path is never driven by a real tray-owned server. Only the refusal half (NO_DAEMON_SPAWN) reaches `ensureEstopHelper`.
3. **Environmental coupling / potential flake.** Test 2 passes only because the production socket happens to be absent. On a machine where a tray estop is live and the unlink is skipped/raced, `tryConnectHeld` would connect to the *real* helper and return `ok:true`, failing `assert.equal(r.ok, false)`. The test's result depends on external system state.
4. **Orphan estop adoption with no ownership verification.** At tray launch, a *live* pre-existing socket (e.g. daemon-fallback helper from a pre-upgrade session that survived a parent SIGKILL) is adopted silently — the tray neither spawns its own Aqua-owned helper nor terminates the orphan at exit, and the companion can't tell which owner it connected to. Same binary + same identity makes this benign in the common case, but the "Aqua-owned lifecycle" contract is only best-effort, not strict.
5. **`CMSPARK_HOST_SHA256` pin churned twice** within this branch (efed228, c96faf0). Manual dev-build hash pinning is a moving target after any rebuild; packaged installs bypass it via the codesign-identity path, so impact is dev-only — worth a build-time check or a note.
6. **TOCTOU + pre-bind residuals (documented, pre-existing).** The fixed `/tmp/cmspark-estop.sock` can be pre-bound by any same-account process before app launch, making the companion treat a fake socket as the kill switch; the C2 property only covers post-connect rebind. This predates the branch and is out of the gate scope, but the estop threat model should state explicitly that it defends fail-closed behavior vs the agent, not vs a local adversary (who can kill the agent anyway).

---

VERDICT: APPROVE_WITH_NITS
