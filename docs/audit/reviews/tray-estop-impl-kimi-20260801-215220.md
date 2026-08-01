• Let me read the required files. I'll read them in parallel.

• I'll read the required files for this dual review.

• Now I need to read:
  - host.swift's `launchAgentTrayAndExit` function (the file is 2042 lines; I read the preview of first 1000). Let me grep for launchAgentTrayAndExit and read around it.
  - The docs: docs/audit/reviews/computer-use-platform-analysis-20260801.md §2–4 and docs/superpowers/plans/2026-08-01-macos-tcc-estop-BLOCKED-HANDOFF.md
  - Tests for connect / NO_DAEMON_SPAWN — search tests.

• Now the Swift tray-launch function, the docs, and the tests.

• Now read the Swift `launchAgentTrayAndExit` function (lines ~470-620), the BLOCKED HANDOFF doc, and the estop tests.Now the BLOCKED HANDOFF doc, and the existing computer-estop.test.ts. Also check resolveHostBinary for R4 (spawn uses resolveHostBinary — in darwin-estop.ts, spawnEstopOnce calls resolveHostBinary, good). Also verify "no user-facing enable node" — search for user-facing prompts about enabling node TCC.

  Also must verify:
  5. Fail-closed still holds if no estop at all — check how host_computer uses ensureEstopHelper (computer-executor?). Let me look at computer-estop.test.ts and where ensureEstopHelper is called.

  Also gate R2: tray path deletes existing estop socket before connect — in host.swift, it checks estopSocketLive() first, and only unlinks if not live. That's acceptable — it doesn't delete before connect; it connects first. Actually wait: "stale socket file (bind then crash) blocks re-bind — remove before spawn." The Swift code checks connect first, only unlinks if connect fails. That satisfies R2 (doesn't delete a live socket).

  However, there's a race: estopSocketLive() connect fails → unlink → spawn. Between connect fail and unlink, a live helper could have been... connect failing means no live listener at that moment. Reasonable.

  But note: in darwin-estop.ts, unlinkEstopSocket() is called at the START of spawnEstopOnce — before spawning. In the daemon fallback path, ensureEstopHelper already tried connecting for 3s, so unlinking there is fine. In startTrayOwnedEstopBestEffort, it tries connect 3 times first, then spawnEstopOnce which unlinks. Fine.

  Wait — R2 says "Tray path deletes existing estop socket before connect". The tray path: startTrayOwnedEstopBestEffort connects first (tryConnectHeld(3, 50)) before any unlink. Swift launcher connects first too. OK.

  Potential race: two processes (Swift launcher + Node tray) both could decide to spawn. Swift launcher spawns estop, then Node tray starts and calls startTrayOwnedEstopBestEffort which connects to the existing socket. Fine. But race at boot: Swift estop not yet bound when Node tray's tryConnectHeld(3, 50ms)=150ms fails → Node spawns its own estop → spawnEstopOnce unlinks the socket that Swift's estop may have just created! That's a potential race where Node tray deletes Swift estop's socket. tryConnectHeld only 3 attempts * (400ms connect timeout + 50ms gap)... actually connect fails fast (~instant for missing socket), so ~150ms+. Swift launches estop before starting node, and estop binding should take <150ms usually. But still a race window: Node could unlink Swift's freshly bound socket, breaking the socket path while Swift's estop process is alive and holding the CGEventTap. Then companion's ensureEstopHelper would connect to... the Node-spawned one? Node's spawn rebinds after unlink — Node's estop gets the tap under node TCC identity → code 4 risk returns. This is a real race nit, but is it blocking? The unlink in spawnEstopOnce happens only after tryConnectHeld failed. If Swift's estop bound between, Node unlinks its socket file. Then both estops run; Node's rebinds. The Node estop may fail CGEventTap with code 4 (TCC identity), then companion connect succeeds on socket but the tap doesn't work... Actually if tap fails, does the estop helper still bind the socket? Need to check the estop implementation. If estop binds socket only after tap succeeds, then Node's estop exits early, and socket path is gone entirely (unlinked) → fail-closed, companion fails to connect. Grace in ensureEstopHelper is 3s, may recover. It's a race but bounded; the daemon fallback would then spawn. Worth a nit, maybe not blocking.

  Actually more precisely: the ordering issue — Swift deletes stale socket only when connect fails. Same race in reverse. The unlink-before-spawn pattern is inherent. I'll note it as a nit (boot race could orphan a live estop's socket file; recommend flock or bind-unique + rename).

  R4: estop spawn uses resolveHostBinary in both Node path (darwin-estop.ts spawnEstopOnce) and Swift path uses execPath = own Mach-O (CommandLine.arguments[0]) — hmm, arguments[0] could be a symlink (Resources/cmspark-host → MacOS/CMspark). execDir computed from it, standardized. Not resolveHostBinary per se, but it's the app's own binary — running self is safe (TCC identity is the app). Gate R4: "estop can be replaced by untrusted binary without resolveHostBinary" — Swift uses its own executable path, which is fine. Node uses resolveHostBinary. OK.

  R3: claims on-device host_computer fixed without evidence — need to check the HANDOFF doc and whether any claims assert it's fixed. The HANDOFF is titled BLOCKED-HANDOFF, so presumably honest. Read it.

  Also must verify #4: no user-facing "enable node" — grep for user-facing strings mentioning node TCC. And #5: fail-closed — check computer-executor's use of ensureEstopHelper and estopHeartbeatLost.

  Let me read the HANDOFF doc and grep for enable node / estop usage in executor.

• Now the handoff doc and the fail-closed wiring in the executor.

• Now check how the darwin path gates host_computer: where ensureEstopHelper (darwin) is called — probably in executor or darwin-adapters. Check the fail-closed path: if no estop at all, host_computer must refuse. Grep for darwin-estop import usage.

  Also check test file computer-estop.test.ts briefly and whether there's a test for connect behavior in the production module. The owner test's first test doesn't actually import the module's connect (it just tests raw socket semantics — a weak test). The second test does test NO_DAEMON_SPAWN. Note the second test unlinks /tmp/cmspark-estop.sock — a test that deletes the production socket on a dev machine could kill a running estop's path... minor nit.

  Also verify R1: daemon spawn is fallback — yes, ensureEstopHelper connects first with grace (3s), then NO_DAEMON_SPAWN check, then daemon fallback logged. Good.

  R2: tray path — Swift launcher checks socket live before unlink; Node startTrayOwnedEstopBestEffort connects before spawnEstopOnce unlink. Good, but there's the race noted.

  Also check the git status / whether tests pass? Could run the tests quickly. Let me check where ensureEstopHelper is invoked for fail-closed, and run the estop tests.3c6d559 chore: host integrity SHA + tray-estop review prompt
c96faf0 fix(darwin): unlink stale estop socket; log tray-owned estop stderr
efed228 fix(darwin): tray/Aqua-owned estop for host_computer preflight
035be8e docs(audit): computer-use platform analysis + Kimi/Claude/Pi triple review
0c2b240 docs: handoff host_computer estop code 4 / -3801 blocked state
2c1437f fix(darwin): resolve host via .app Contents; harden estop spawn
eefd77d test(extension): align model-switch mirror lock with Qwen3-VL copy
fc3a4d0 test(computer): align G4/P7 executor tests with Qwen3-VL layer name
?? .grok/hooks/
?? .grok/rules/
?? docs/audit/reviews/tray-estop-impl-kimi-20260801-215220.md
?? docs/audit/reviews/tray-estop-impl-pi-20260801-215220.md
?? images/
Check server.ts around 3785 to verify fail-closed (if estop unavailable → refuse host_computer). Also run the tests.npm warn Unknown user config "//registry.npmmirror.com" (registry https://registry.npmmirror.com). This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
✔ darwin estop: connect succeeds when external helper already holds socket (2.547417ms)
✔ CMSPARK_ESTOP_NO_DAEMON_SPAWN refuses when socket down (3080.836ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3141.037333
Tests pass. Fail-closed verified: server.ts refuses host_computer when ensureEstopHelper fails (EMERGENCY_STOP_UNAVAILABLE), and mid-task EMERGENCY_STOP_LOST via estopHeartbeatLost.

  Check R3: any claims that on-device host_computer is fixed? HANDOFF explicitly says don't claim. The platform analysis §6 says device-side still blocked. Good.

  Check "no user-facing enable node": the estop error message says "check Accessibility + Input Monitoring for CMspark" — product identity, not node. HANDOFF says node ghosts can be turned off, shouldn't rely on node. Good.

  Now check host-bin resolveHostBinary quickly to confirm R4 — the Node daemon fallback uses resolveHostBinary. Swift uses own executable path. Quick look at resolveHostBinary to confirm it resolves inside the .app Contents.

  Also double-check one detail: in host.swift, entry: `if args.isEmpty || args[0] == "tray" || args[0] == "launch"` → launchAgentTrayAndExit. But when the estop child itself is spawned with args ["estop", "--socket-path", ...], it goes to subcommand dispatch — fine, no recursion.

  One subtle issue: launchAgentTrayAndExit spawns estop via `Process()` with executableURL = execPath (CommandLine.arguments[0]). If the app was launched via the symlink Resources/cmspark-host, arguments[0] would be the symlink path — execDir would be Resources, and resources would be execDir's parent's Resources = Contents/Resources? execDir = Contents/Resources, deletingLastPathComponent = Contents, + Resources = Contents/Resources. OK either way. The estop child identity: spawning via symlink still resolves to the same Mach-O, TCC attributes by the responsible process / bundle. Fine.

  Another check: does the Swift estop child bind the socket before or after creating the CGEventTap? If the tap fails (code 4) but socket still binds, companion would connect and think estop is OK while hotkey doesn't work — fail-open. Let me check runEstop in host.swift around line 698 / 1902.

• One more check — whether the estop helper binds the socket only after the CGEventTap succeeds (fail-open risk), and `resolveHostBinary`.

• Now I want to verify runEstop ordering: does it bind the socket only after tap creation succeeds? Search for runEstop in host.swift.Good — tap failure closes serverFD and throws code 4 before running the runloop, so no fail-open socket. Note: on tap failure the socket FILE remains on disk (bind succeeded, file created; close(serverFD) doesn't unlink). So a dead estop leaves a stale socket file — connect to it fails (no listener), so fail-closed still holds, and spawn paths unlink stale. Fine.

  One more subtlety worth noting: runEstop's own `unlink(socketPath)` at line 1969 — if a second estop instance starts while the first is alive, it unlinks the live one's socket and rebinds. Who could start a second estop? Node daemon fallback spawn after Swift estop already up: ensureEstopHelper connects first with 3s grace, so normally won't. But spawnEstopOnce also unlinks before spawn (darwin-estop.ts:101). Race window: Node tray's startTrayOwnedEstopBestEffort tryConnectHeld(3, 50) — only ~150-450ms grace — if Swift's estop hasn't bound yet (fresh app boot, estop spawning takes longer, e.g. AXIsProcessTrustedWithOptions prompt?), Node unlinks and spawns its own. Wait — Swift spawns estop BEFORE node tray, and node binary needs to load. Actually the AX prompt only shows if untrusted; tap creation happens after bind. The sequence in runEstop: bind+listen first (socket live quickly), then tap. So Swift's estop socket is live within ms of spawn. Node tray boots much later (node + bundle load ~seconds). So race is unlikely but non-zero (e.g., estop spawn delayed). If it happens: Node unlinks Swift estop's socket file, spawns its own estop → Node's estop's runEstop unlinks (already gone), binds. Now two estops, one orphaned socketless but holding a tap; Node's estop has node-attributed TCC → tap may fail code 4 → spawnEstopOnce catches early exit → fail-closed → falls back... it's fail-closed, not fail-open. Acceptable, worth a nit about the short 3-attempt grace in the tray path vs the 30-attempt grace in companion, plus a recommendation to use an flock-based single-instance guard.

  Also nit: the "connect succeeds when external helper already holds socket" test doesn't exercise the module's tryConnectHeld at all — it tests raw net semantics against its own server (comment admits this). Weak test. The NO_DAEMON_SPAWN test is real and passes. Also that test unlinks the production /tmp/cmspark-estop.sock — on a dev machine with live estop this would break the running helper's discoverability (fail-closed, but disruptive). Nit.

  Also check: menu-bar-agent startTrayOwnedEstopBestEffort is called in startMenuBarAgent on darwin — fire-and-forget. When packaged app runs: Swift already spawned estop; Node tray connects and holds the socket via tryConnectHeld → holdSocket. But then the tray process holds liveSock — and companion daemon is a separate process, whose ensureEstopHelper will also connect. Fine — estop accepts multiple clients (accept loop, listen backlog 8).

  One thing: holdSocket pauses the socket; estop holds accepted clients open. OK.

  Also verify claim "Companion does not unlink tray socket before connect": in ensureEstopHelper, tryConnectHeld first — no unlink. unlinkEstopSocket only in spawnEstopOnce after grace. And startTrayOwnedEstopBestEffort connects first. Swift launcher connects first (estopSocketLive) and unlinks only if connect failed. R2 passes.

  R1: daemon spawn is fallback, logged (logger.warn computer.estop.daemon_fallback). Pass.

  R3: docs explicitly say don't claim fixed; no claims of fixed on-device. Pass.

  R4: Node fallback uses resolveHostBinary (which prefers packaged Contents/MacOS/CMspark and gates CMSPARK_HOST_BIN override behind explicit opt-in). Swift uses its own executable. Pass.

  Must-verify #4: user-facing text — code-4 message says "grant Accessibility permission to CMspark" — product identity, no "enable node". HANDOFF says don't rely on node. Pass.

  #5: fail-closed — server.ts refuses host_computer if ensureEstopHelper fails; mid-task EMERGENCY_STOP_LOST via estopHeartbeatLost in executor abortCheck. Pass.

  #6: tests exist and pass (ran them).

  Now check abortCheck actually polls estopHeartbeatLost in executor for darwin... I saw executor.ts:318-322 mentioning EMERGENCY_STOP_LOST. Good enough.

  Verdict: APPROVE_WITH_NITS.

  Nits:
  1. Tray-path grace too short (3×~450ms) vs companion 3s — boot race can make Node tray spawn its own estop and unlink the Aqua estop's freshly bound socket; recommend increasing attempts or a single-instance lock (flock) in runEstop.
  2. First test in computer-darwin-estop-owner.test.ts doesn't import the module — only verifies raw socket semantics; connect-path coverage of tryConnectHeld is indirect. Also the NO_DAEMON_SPAWN test unlinks the real /tmp/cmspark-estop.sock on the dev machine.
  3. On tap failure (code 4), runEstop leaves the stale socket file on disk (bind succeeded before tapCreate) — harmless (fail-closed) but every failed start leaves litter; minor.
  4. Menu-bar-agent also could race: it runs startTrayOwnedEstopBestEffort even in packaged app — intended (connects to preexisting). Fine.

  Also note: unlink in Swift launcher after failed connect — a connect failure could also be transient (backlog full: listen backlog 8, held connections). If 8 held connections exist, connect would still succeed (backlog queues). Edge: if companion holds socket and tray restarts... connect succeeds. OK.

  Write the review. Should I write it to a file? The batch dir has existing review files docs/audit/reviews/tray-estop-impl-kimi-*.md and pi. This prompt is a dual review — likely Claude + ? I'm Kimi Code CLI. There are already kimi and pi review files (untracked). The prompt says "End with VERDICT" — just output. I won't write a file unless asked. Actually the existing files pattern suggests reviews are saved. But instructions say output Summary/Blocking/Nits/VERDICT. I'll just reply.

• All required files read, tests executed. Here is the review.

  ## Summary

  The change implements the tray/Aqua-owned estop model from the platform analysis (§4.2 item 2):

  - `host.swift:496` `launchAgentTrayAndExit` spawns `estop` as a child of the Aqua-launched `MacOS/CMspark` **before** starting the Node tray, retains the `Process` handle, and tears it down with the session. Socket liveness is probed via `connect()` first; `unlink` happens only when connect fails (stale-file cleanup).
  - `darwin-estop.ts` `ensureEstopHelper()` (`companion/src/computer/darwin-estop.ts:165`) now: (1) reuses held socket, (2) connects with 3s grace (`TRAY_OWNED_CONNECT_ATTEMPTS = 30`), (3) honors `CMSPARK_ESTOP_NO_DAEMON_SPAWN=1`, (4) only then falls back to daemon spawn — explicitly logged via `computer.estop.daemon_fallback` (warn) and `computer.estop.spawn` with `owner: "daemon-fallback"`.
  - `menu-bar-agent.ts:790` calls `startTrayOwnedEstopBestEffort()` on tray start (connect-first, then best-effort spawn) for the dev/node-only path.
  - Fail-closed is intact: `server.ts:3793` refuses `host_computer` with `EMERGENCY_STOP_UNAVAILABLE` when preflight fails; mid-task loss still aborts via `EMERGENCY_STOP_LOST` (`executor.ts:318`). On the Swift side, `runEstop` throws code 4 and closes the listen FD if `CGEvent.tapCreate` fails — no fail-open socket.
  - Tests exist and pass (ran `npx tsx --test tests/computer-darwin-estop-owner.test.ts`: 2/2 pass, including the NO_DAEMON_SPAWN refusal).

  Gate check: **R1** daemon spawn is fallback-only + logged ✓; **R2** no path unlinks before a connect attempt (Swift probes first; both TS paths connect first) ✓; **R3** the HANDOFF explicitly forbids claiming on-device `host_computer` is fixed and nothing claims it ✓; **R4** Node fallback goes through `resolveHostBinary()` (packaged `Contents/MacOS/CMspark` preferred, `CMSPARK_HOST_BIN` override double-gated); Swift spawns its own Mach-O ✓. No user-facing "enable node" anywhere — code-4 message names CMspark.

  ## Blocking

  None.

  ## Nits

  1. **Boot race window in the tray path** (`darwin-estop.ts:204`): `startTrayOwnedEstopBestEffort` uses only `tryConnectHeld(3, 50)` (~150ms real grace since failed connects return fast), while `spawnEstopOnce` unlinks the socket before spawning. If the Aqua-spawned estop is slow to bind on a cold boot, the Node tray can unlink the Aqua estop's freshly-bound socket and spawn its own — recreating the daemon-context TCC problem. Fail-closed still holds (no fail-open), but consider matching the 3s grace or adding a single-instance guard (e.g. `flock`) in `runEstop`.
  2. **Weak connect test** (`tests/computer-darwin-estop-owner.test.ts:20`): the "connect succeeds" test never imports the module — it verifies raw `net` semantics against its own server, not `tryConnectHeld`/`ensureEstopHelper` connect-preference. The module admits this in a comment; a real test would bind a server on the production path and assert `ensureEstopHelper()` returns `ok` without spawning.
  3. **Test mutates production state** (`tests/computer-darwin-estop-owner.test.ts:64`): the NO_DAEMON_SPAWN test unlinks the real `/tmp/cmspark-estop.sock`, which would break a live estop's discoverability on a dev machine running the app.
  4. **Stale socket litter on tap failure** (`host.swift:2027`): on code 4 the listen FD is closed but the bound socket file stays on disk. Harmless (fail-closed, next spawn unlinks), but an explicit `unlink` in the error path would be tidier.

  VERDICT: APPROVE_WITH_NITS

To resume this session: kimi -r session_f08084d6-98a7-41dc-85bd-c4f716d14d10
