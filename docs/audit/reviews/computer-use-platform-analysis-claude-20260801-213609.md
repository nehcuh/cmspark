All claims spot-checked out. Writing the verdict.

---

## Summary

Independent adversarial review of `docs/audit/reviews/computer-use-platform-analysis-20260801.md` against the BLOCKED HANDOFF and source code. Every load-bearing factual claim was verified against the codebase; all five rejection gates pass. Two methodology nits (root-cause ranking conflation; missing Windows-parity line in roadmap) but nothing that would mislead the next implementer.

`[inspected]` files: `computer-use-platform-analysis-20260801.md`, `2026-08-01-macos-tcc-estop-BLOCKED-HANDOFF.md`, `companion/src/computer/darwin-estop.ts`, `companion/src/computer/estop.ts`, `companion/src/server.ts` (host_computer + estop gate), `companion/src/host-use/darwin/host.swift` (runEstop + cuScreenshot + runCompiledScript), `companion/src/host-use/darwin/host-bin.ts`, `companion/src/host-use/win/scripts/computer-{capture,input,estop}.ps1`, `/Applications/CMspark.app/Contents/{MacOS,Resources}/`, `~/.grok/docs/user-guide/`.

## Grok Build section

Fair and accurate. `[inspected]` `~/.grok/docs/user-guide/` has 22 files, all generic agent/IDE topics (auth, shortcuts, slash-commands, mcp, skills, hooks, sandbox, plan-mode, headless). Zero files match `computer.use|screenshot|click|inject|host_computer|accessibility`. Doc's §1.1 "无一等公民 Computer Use" at 95% holds. §1.2's three-path decomposition (paste-image / shell-run `screencapture`/`osascript`/`cliclick` / MCP) is the correct characterization. **R1 gate passes** — doc explicitly denies first-class CU.

Minor: §1.1 tags the CLI as "~0.2.x" without an evidence pointer. Trivial.

## macOS vs Windows section

Sound. `[inspected]` host.swift:1949-1962 confirms `CGEvent.tapCreate(...) else { throw HostError(code: 4, …) }` — the code-4/CGEventTap gate is real. host.swift:1098-1115 confirms SCK -3801 / -38001 → "Screen Recording permission denied". Bundle layout verified on disk: `Resources/cmspark-host → ../MacOS/CMspark` symlink exists; `MacOS/CMspark` is a 306k Mach-O. `host-bin.ts:79-93` `resolvePackagedContentsDir` + `MacOS/CMspark` preference is the `2c1437f` strengthening the doc cites. Windows parity: `computer-capture.ps1` uses `PrintWindow` + `BitBlt` fallback; `computer-input.ps1` uses `SendInput` (unsigned medium-IL same-IL, per its header); `computer-estop.ps1` uses `GetAsyncKeyState` polling (50ms, no global tap). All match §2.1/§2.2 exactly. **R3 gate passes** — §2.5 explicitly: "不是 Windows 适配器写得更聪明，而是 从不进入 macOS TCC 身份数据库."

**Methodology nit on §2.4 root-cause ranking**: the table mixes *mechanisms* (#1 estop gate, #4 SCK residual) with *causes* (#2 CDHash, #3 daemon attribution, #5 resolve bug). The actual causal chain is cause → symptom (code 4 / -3801) → amplifier (estop fail-closed turns it into total outage). Calling estop fail-closed the "#1 root cause" risks misdirecting the implementer toward "fix CGEventTap mechanics" when the lever is upstream TCC attribution. The doc recovers in §3.3 ("estop 硬门 + 脆弱 tap | CLI 能截、产品全灭") and HANDOFF item 3 explicitly directs attention to "CGEventTap 在 daemon 子进程下的 TCC", so the implementer is not actually led astray. Non-blocking.

**R2 gate passes** — §0/§2.3/§4.1 all consistently describe macOS host_computer as blocked, not fixed. §4.2 explicitly leaves "DoD" open.

## Industry practices section

Correctly applied, no cargo-cult. §3.1 cleanly separates cloud-sandbox (Operator), developer Docker (Anthropic CU), and Browserbase/Stagehand (CDP-over-vision). §3.2 draws the local-desktop line (single signing identity, capture/inject only inside that Mach-O, HITL with estop outside model loop). §3.3 usefully self-flagellates — every anti-pattern listed is one CMspark has or had (CDHash drift, ad-hoc shipping, "teach user to check node" — which is also the **R4 gate**, passed). The "Cloud sandbox ≠ local desktop product" framing is the right guardrail against importing Operator-style choices into a HITL local agent.

## Roadmap

Actionable. §4.2 step 1 (instrument Side-Panel spawn path for bin + CDHash + stderr) is the correct first move given the daemon-vs-CLI attribution hypothesis is unconfirmed — `2c1437f` already partially landed this. Step 2 (tray-owned estop, companion only connects socket) addresses the right architectural fix but the doc doesn't quantify the migration risk (tray must outlive daemon disconnects; tray becomes the TCC principal; XPC boundary). Step 3 (Developer ID into release pipeline) is right but no timeline. Step 4 (DoD = Side-Panel-approved non-Chrome screenshot success) is concrete and falsifiable. **R5 gate passes** — §0 row 3 ("estop 硬门" as 运维脆弱) and §3.3 already acknowledge fail-closed estop as the outage amplifier; the roadmap does not ignore this, it tries to mitigate via tray-ownership.

**Roadmap gap (nit)**: §4.2 has no Windows parity line. The doc itself flags this as a review concern in §6.5 ("路线图是否缺 Windows 对等安全叙述"). One sentence — "Windows stays user-mode automation; parity = same L2 + tray-owned estop, NOT same TCC story; no signing redesign needed" — would close it.

## Factual errors

None found that would mislead an implementer. All spot-checks (`[inspected]`) confirmed the doc's claims:
- Code 4 = CGEventTap failure → host.swift:1958-1962 ✓
- SCK -3801 = Screen Recording denial → host.swift:1101 ✓
- Bundle: `Resources/cmspark-host` → symlink `MacOS/CMspark` ✓
- Daemon gate: server.ts:3790-3801 refuses with `EMERGENCY_STOP_UNAVAILABLE` when `ensureEstopHelper()` fails ✓
- darwin-estop.ts retry-once-on-code-4 logic at lines 164-174 matches doc's claim that the gate is fail-closed ✓
- Windows mechanism (PrintWindow/BitBlt, SendInput, GetAsyncKeyState) ✓
- Grok docs have no CU tool surface ✓

Minor unsupported: §1.1 "grok CLI ~0.2.x" version tag has no evidence pointer (assumed). §1.3 "TCC 归因终端" at 70% is the load-bearing claim distinguishing "Grok has CU" from "Grok rides the terminal's TCC"; confidence is honestly tagged but a wrong answer here weakens the shell-ceiling framing. Not a false claim, just under-evidenced.

## Blocking

Nothing. All rejection gates (R1–R5) pass; no factual claim that would mislead the next implementer survives spot-check.

## Nits

1. §2.4 root-cause ranking conflates mechanism with cause (see macOS vs Windows section).
2. §4.2 roadmap missing a one-line Windows-parity statement.
3. §1.1 `~0.2.x` version tag unsupported.
4. §1.3 "TCC 归因终端" at 70% is load-bearing for the shell-ceiling narrative; consider backing it with a `codesign -dv` / TCC DB spot-check before next revision.
5. §2.1 diagram labels the spawn path with the TS adapter class name (`MacScreenCapturer`) rather than the binary subcommand boundary; trivial.

## Verdict confidence

92%

VERDICT: APPROVE_WITH_NITS
