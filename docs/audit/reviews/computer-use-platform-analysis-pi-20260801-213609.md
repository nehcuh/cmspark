All required documents and code paths inspected. Here is my adversarial re-review.

## Summary

The analysis is **fundamentally sound and honest**. I spot-checked every load-bearing factual claim against the code and git history, and found no claim that misrepresents the system state. The HANDOFF is accurately reflected (not papered over): host_computer on device is still failing, `2c1437f` is not merged into main, and CLI-success ≠ product-success is stated plainly, not buried. The one deliberately-requested tension — "Grok does computer use well" vs "Grok has no CU product" — is resolved correctly and with calibrated confidence, not conviction. All five rejection gates are clear. Verdict: approve with nits.

## Grok Build section

Fair and accurate. `[inspected]` `~/.grok/docs/user-guide/` (10 files: getting-started … terminal-support) contains **no** screenshot/click/AX/SCK computer-control tools; images enter via paste (`03-keyboard-shortcuts.md`: `Cmd+V` / `Alt+V` for screenshots). `[inspected]` `~/.grok/config.toml` line 17 confirms `permission_mode = "always-approve"` — the analysis's core claim ("能力来自 shell + 宿主终端 TCC + 用户贴图") is empirically grounded. The 95% "no first-class CU API" claim holds. The "TCC 归因终端 70%" hedge is appropriately honest — attribution of Screen Recording to Ghostty-vs-grok is plausible but not directly verifiable from the CLI install. The section correctly refuses to use Grok as a CU reference while extracting the one transferable lesson (low-friction permission UX), and correctly flags what not to copy (no app whitelist, no L2, no estop → conflicts with ADR-017/L2 design).

## macOS vs Windows section

Root-cause ranking is sound and matches evidence. `[inspected]` `companion/src/host-use/darwin/host.swift`: `runEstop` throws `HostError(code: 4, …)` exactly when `CGEvent.tapCreate` returns nil (Accessibility/Input Monitoring untrusted); SCK denial surfaces as `code=-3801` in the SCStream error path. `[inspected]` `companion/src/server.ts` (lines ~3793–3799): macOS `host_computer` gates on `ensureEstopHelper().ok` and refuses with `host_computer refused: emergency-stop unavailable (…)` — byte-for-byte the user-visible HANDOFF error. So ranking #1 (fail-closed estop + code 4, 0.92) is the actual gate blocking the product path. `[inspected]` `companion/src/computer/darwin-estop.ts` confirms daemon-spawn (non-detached, env inherited) — the CLI-vs-daemon context gap (#3) is real. `[inspected]` `scripts/create-dmg.sh` (lines 80–117): `Resources/cmspark-host` is a symlink to `../MacOS/CMspark`, single Mach-O, CDHash-mismatch gate — exactly as the analysis states, and the ad-hoc re-sign/TCC drift mechanism (#2, 0.85) is consistent with how TCC tracks ad-hoc CDHashes. Windows claims verified `[inspected]` `computer-estop.ps1` (GetAsyncKeyState 50ms poll, no RegisterHotKey), `computer-capture.ps1` (PrintWindow + BitBlt fallback), `computer-input.ps1` (SendInput) — no TCC-equivalent wall. The "Windows is not better-architected, it's platform-tolerant" framing is exactly right and R3 is not triggered.

## Industry practices section

Correctly applied, not cargo-culted. Operator (cloud sandbox browser + takeover/watch/confirm/monitor), Anthropic (developer-provided Docker+Xvfb, pixel coords, max iterations), Browserbase/Stagehand (CDP-first, hybrid) are accurate public facts. The key judgment call — that CMspark's **local desktop** product cannot copy the cloud-sandbox isolation model — is stated explicitly, and the three local-desktop non-negotiables (single stable signing identity; capture/inject only inside that Mach-O; HITL with model-loop-external estop) are consistent with the repo's own ADR-017/020 and L2 design. The anti-pattern table ("假绿 + -3801", "ad-hoc 生产包每重装清授权", "教用户勾 node", "estop 硬门 + 脆弱 tap → CLI 能截、产品全灭") is each traceable to code or HANDOFF evidence. The recommended architecture (Extension L1 CDP + Companion policy + single Mach-O TCC subject) is a genuine synthesis, not template regurgitation.

## Roadmap

Actionable and correctly sequenced: **instrument first** (log bin + CDHash + stderr — partially shipped in `2c1437f`, `[inspected]` git: it hardens `resolvePackagedContentsDir` + estop stderr capture, but is **16 commits ahead of main, NOT merged** — HANDOFF accurate), then tray-owned estop, then Developer ID, then DoD. The DoD definition ("CLI 成功不算过；必须 Side Panel 批准后非 Chrome 截图成功") is the right gate. Missing blockers are minor: (1) Developer ID is not just a build step — it needs Apple Developer Program enrollment, a signing certificate in the CI keychain, and notarization changes; the analysis nods to "P0 可 ad-hoc" but never flags the procurement/account dependency; (2) the roadmap relies on Input Monitoring (not just Screen Recording) for CGEventTap — listed as root-cause #6 at 0.45 but never made an explicit verification step in the roadmap items (HANDOFF item 3 does); (3) no explicit Windows-side security narrative, which the analysis itself flags as an open question. None of these block execution of the top items.

## Factual errors

I found **no false claims that would mislead the next implementer**. Specific verifications:
- estop code 4 = CGEventTap failure ✓ (`host.swift` `runEstop`)
- -3801 = Screen Recording denial ✓ (`host.swift` SCK path)
- single Mach-O + symlink + one CDHash ✓ (`create-dmg.sh`)
- `com.cmspark.agent` bundle id ✓ (`scripts/macos/Info.plist`)
- PR #103 merged `9a911bd` ✓; `2c1437f` unmerged ✓ (git)
- daemon fail-closed gate error string ✓ (`server.ts:3798`)
- Windows PS1 mechanisms ✓ (three scripts)
- Grok: no CU tools, paste-images, `always-approve` ✓ (`~/.grok/docs`, `config.toml`)
- resolveHostBinary prefers `Contents/MacOS/CMspark` ✓ (`host-bin.ts`)

## Blocking

None of R1–R5 triggered:
- R1 (Grok has first-class CU API): contradicted explicitly, 95% hedge grounded in installed docs — not triggered.
- R2 (claims host_computer fixed): analysis states on-device failure repeatedly; P0 marked incomplete — not triggered.
- R3 (blames Windows as better architecture): analysis explicitly attributes the difference to the TCC platform gap, "平台更宽容，不是证明 macOS 应照抄 PS1" — not triggered.
- R4 (teach users to enable node): listed as an anti-pattern; HANDOFF's "不应再依赖勾 node" honored — not triggered.
- R5 (roadmap ignores estop outage amplification): estop fail-closed is root cause #1 and the roadmap's central lever; "estop 硬门 + 脆弱 tap → 产品全灭" is named — not triggered.

## Nits

1. **"Node daemon 拉起短命 host" (0.78)** — imprecise wording: the estop helper is *long-lived* once connected (`darwin-estop.ts` holds the socket, `child.unref()`); only screenshot/inject are one-shot short-lived spawns. The substantive hypothesis (spawn context / responsible-process TCC attribution differs from CLI) is correct; suggest "daemon spawn context (parent/session, responsible-process attribution) ≠ CLI context".
2. **"唯一用户可见权限主体"** is aspirational, not current-state: `shell_exec` via the bundled node remains a separate TCC-capable path (HANDOFF conversation `#7n9nvl` ran `screencapture` through node). The analysis should carry that caveat inline rather than leave it only in the HANDOFF.
3. **"code 4 硬门"** wording — since `2c1437f`, `ensureEstopHelper` retries once on code 4 (TCC-grant race); it's a fail-closed gate, not literally a one-shot hard door. Cosmetic.
4. **Developer ID** should be explicitly flagged as a business blocker (enrollment/certificate/notarization), not just a build step.
5. **Input Monitoring** deserves an explicit roadmap verification item, not just a 0.45-ranked hypothesis row.

## Verdict confidence

95%. Independent spot-checks confirmed every high-stakes factual claim; the only residuals are wording precision and roadmap completeness, not correctness.

VERDICT: APPROVE_WITH_NITS
