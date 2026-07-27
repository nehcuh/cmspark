# [RIPER: Plan] — Approach C-minus Production Swap (v3)

**Status**: Draft v3 (2026-07-24) — incorporates Grok + Claude Code parallel review on v2
**Predecessors**: see v1/v2 + `adversary-approach-c-plan-round1.txt` + `review-grok-plan-v2.txt` + `review-claude-code-plan-v2.txt`

**v3 deltas vs v2** (post-review patches):

- **F4 scope expanded**: integrity gate now covers BOTH spawn paths — `host-use/darwin/adapter.ts:138-144` AND `computer/darwin-adapters.ts` inject sites (click/type/key/scroll/drag at lines 497-580). Shared helper in `host-integrity.ts`. Grok finding #2.
- **F5 path corrected**: `companion/src/computer/darwin-adapters.ts` (not `host-use/darwin/darwin-adapters.ts` which doesn't exist). Grok finding #1.
- **NEW F9**: inject paths must `parseComputerJson` + `checkOk` to surface `SKYLIGHT_SPI_FAILED` as typed `ComputerError`. Currently inject discards stdout → silent SPI failure. Grok finding #3.
- **NEW F10**: TCC bundle ID corrected to `com.cmspark.host` (matches `host-Info.plist:6`). Grok finding #4.
- **Plist floor stays 14.4** — counter to Claude Code's "raise to 26.5" suggestion. Grok's reasoning accepted: host binary does mail/biometric/etc; raising floor blocks all host features on Sonoma/Sequoia. Computer-use gated by runtime SPI feature-detect instead. Grok finding #6.
- **CI SHA**: option A — "if `host.swift`/`host.entitlements` change → `host-integrity.ts` must also change in the PR". No cross-machine reproducibility claim. Grok finding #5.
- **Env split**: `CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1` (path override, existing) stays for `host-bin.ts:22-30`; new `CMSPARK_SKIP_HOST_INTEGRITY=1` for integrity bypass. Claude Code Q5c.
- **F1 hardening**: CGEvent nil → `CGEVENT_CONSTRUCT_FAILED` (was "optional" in v2, now required — closes residual silent-success path).
- **F7 scope note**: explicit DEV-TIME auto-rewrite; documented dirty-tree friction.

---

## 1. Goal

Replace the global HID event tap (`CGEvent.post(tap: .cghidEventTap)`) in production `cmspark-host` with SkyLight's per-PID auth-signed primitive (`SLEventPostToPid`). Resolves Chrome renderer rejection, cursor steal, frontmost coupling. Empirical status: dlopen+dlsym verified on Tahoe 26.5.2; real click delivery pending G1 manual lab.

## 2. Scope

### In scope (v1.3 ship)

Computer-use inject primitive swap on **Tahoe 26.5+**. Runtime feature-detect on older macOS (SPI missing → hard error → LLM surfaces).

- **S1**: Merge `host-skylight.swift` → production `host.swift`.
- **S2**: `checkIntegrity()` + post-spawn re-stat covering BOTH `host-use/darwin/adapter.ts:138-144` AND `computer/darwin-adapters.ts` inject spawn paths.
- **S3**: Drop `ensureForeground(hwnd)` from computer-use inject paths (correct file: `companion/src/computer/darwin-adapters.ts:497-580`).
- **S4**: `SKYLIGHT_SPI_FAILED` hard error — end-to-end typed ComputerError contract (no silent success).
- **S5**: Replace production binary contents at `dist/cmspark-host` (file name unchanged; cdhash changes; TCC re-prompt expected).
- **S6**: Canonical build-host.sh with auto-SHA-rewrite.
- **S7**: Bundle ID `com.cmspark.host` documented in recovery instructions.

### Support matrix (per Grok Q5b)

| macOS version | cmSpark features | Computer-use inject |
|---|---|---|
| Tahoe 26.5+ | All supported | SkyLight per-PID |
| Sonoma 14.4 – Sequoia 15.x | All supported (host binary plist floor: 14.4) | **Unsupported** — SPI fails → `SKYLIGHT_SPI_FAILED` → user sees upgrade prompt |
| pre-14.4 | Binary refuses launch (plist) | n/a |

Plist floor stays at 14.4 to preserve non-computer-use features on older macOS.

### Deferred (v1.4+)

- **D1**: Software cursor overlay
- **D2**: AX-first dispatch (`AXPress` / `AXSetAttributeValue`)
- **D3**: Long-lived host daemon
- **D4**: `SLPSPostEventRecordTo` re-resolution with verified signature
- **D5**: Sequoia/Sonoma SkyLight support (pending hardware verification)
- **D6**: HID fallback with L2 confirmation gate (only if real-world SPI failure rates on supported OSes demand it)
- **D7**: Multi-monitor coordinate normalization
- **D8**: Deterministic codesign for CI cross-machine SHA oracle

### Out of scope (never)

- **O1**: Loading non-Apple dylibs. `disable-library-validation` stays `false`.
- **O2**: Bypassing SkyLight auth signing.
- **O3**: HID fallback in v1.3.

## 3. File-by-file changes

### F1 — `companion/src/host-use/darwin/host.swift` (production)

Merge fork (`host-skylight.swift`) → production. Bring over:

- `cuResolveSkyLight()` with null-safe dlsym + stderr diagnostic
- `slPostToPid(_:_:)` returning Bool
- 7 swap sites in `cuInject` with `if !slPostToPid(...) { return cuError("SkyLight SPI post failed", code: "SKYLIGHT_SPI_FAILED") }`
- Dispatch-level fail-fast at inject entry with distinct error codes:
  - `cuResolveSkyLight()` returns false → `cuError("SkyLight SPI unavailable on this OS", code: "SKYLIGHT_SPI_UNAVAILABLE")`
  - `slPostToPid` returns false → `cuError("SkyLight SPI post failed", code: "SKYLIGHT_POST_FAILED")`
  - (Claude Code Q2 refinement: split unavailable vs post_failed for better LLM hints.)
- Right-click mouseType branch
- **Required hardening**: if `CGEvent(...)` constructor returns nil on a required path, return `cuError("CGEvent construction failed", code: "CGEVENT_CONSTRUCT_FAILED")` instead of silent `ok: true`.

NOT brought over:
- `CMSPARK_SKYLIGHT_FORCE_FG` env gate — **removed in Stage 3** post-canary (Q-adv-4 resolution).
- `SLPSPostEventRecordTo` resolution — already removed.

### F2 — `companion/src/host-use/darwin/host.entitlements`

`disable-library-validation` → `false`. Matches `host-skylight-nolibval.entitlements`. Preserves v1.3 Batch 1 lockdown.

### F3 — `companion/src/host-use/darwin/host-integrity.ts` (NEW)

Mirrors `swift-tray-bridge.ts:42-184`. Exports:

- `checkHostIntegrity(binPath): HostIntegrityCheck`
- `statInodeDev(p): { inode, dev } | null`
- `spawnHostBin(bin, args, opts): Promise<string>` — the shared spawn wrapper. Hashes pre-spawn, spawns via realpath, re-stats post-spawn, returns stdout. Used by BOTH `defaultDarwinRunner` and `computer/darwin-adapters.ts` inject paths.
- `CMSPARK_HOST_SHA256` constant (auto-rewritten by build script).

Dev escape hatch: `CMSPARK_SKIP_HOST_INTEGRITY=1` (separate from `CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1`).

### F4 — `companion/src/host-use/darwin/adapter.ts:138-144` + `companion/src/computer/darwin-adapters.ts` inject sites

Replace `defaultDarwinRunner`'s body with a call to `spawnHostBin(bin, args, opts)`. Update `computer/darwin-adapters.ts` click/typeText/keyChord/scroll/drag inject calls to also use `spawnHostBin` instead of bare `execFileAsync`.

Grok finding #2: this is the load-bearing change. Without covering both spawn paths, the integrity gate protects mail/biometric but NOT computer-use.

### F5 — `companion/src/computer/darwin-adapters.ts:497-580` (correct file!)

Drop `ensureForeground(hwnd)` from:
- `click(hwnd, x, y, kind)` line 498
- `typeText(hwnd, text)` line 512
- `keyChord(hwnd, keys)` line 534
- `scroll(hwnd, x, y, delta)` line 546
- `drag(hwnd, x, y, x2, y2)` line 562

`ensureForeground` function itself stays (used by screenshot/capture paths).

### F6 — ~~HID fallback~~ REMOVED (adversary N2)

### F7 — `companion/src/host-use/darwin/build-host.sh` (canonical, replaces spike variant)

Pipeline:
1. swiftc compile (production `host.swift`)
2. codesign with `host.entitlements` (no flip)
3. Compute SHA256 of `dist/cmspark-host`
4. **Auto-rewrite** `host-integrity.ts`'s `CMSPARK_HOST_SHA256` via perl in-place.
5. Print result + dirty-tree warning.

**Regex**: anchored on `CMSPARK_HOST_SHA256\s*=\s*"[^"]*"`. Fail-closed if no match.

```bash
HASH=$(shasum -a 256 "${OUTPUT_BIN}" | awk '{print $1}')
perl -i -pe 's/(CMSPARK_HOST_SHA256\s*=\s*")[^"]*"/${1}'"${HASH}"'"/' "${SCRIPT_DIR}/host-integrity.ts" \
  || { echo "[build-host] ERROR: SHA rewrite failed"; exit 1; }
```

**DEV-TIME scoping note** (Q3c): auto-rewrite runs at developer-build time only. Packaged DMG installs ship with the constant pre-baked into the bundled JS; end users never run `build-host.sh`.

**Dirty-tree note** (Q3a): every `build-host.sh` run mutates a tracked source file. Commit the constant change in the same commit as any binary-affecting change. CI enforces this (option A below).

**CI assertion** (option A per Grok): "if `host.swift`/`host.entitlements` change in a PR → `host-integrity.ts` must also change in the same PR". No cross-machine reproducibility claim. Deterministic codesign deferred to D8.

### F8 — Acceptance criteria

**G1 — Tahoe click lab** (15 min user time):
```
# 1. Open TextEdit → type text → save window visible.
# 2. ./dist/cmspark-host window-list --foreground  → get TextEdit window-id.
# 3. ./dist/cmspark-host inject --action click --window-id <ID> --x 100 --y 30
#    Expected: stderr "resolved SLEventPostToPid=true", click lands, cursor doesn't move.
# 4. Repeat with Safari → click bookmark bar item.
# 5. Repeat with Chrome → click chrome://settings sidebar link. LOAD-BEARING.
```

**G2 — Unit tests** (`companion/test/host-integrity.test.ts`):
- T1: known content + correct SHA → ok: true
- T2: known content + wrong SHA → ok: false (load-bearing)
- T3: `CMSPARK_SKIP_HOST_INTEGRITY=1` → bypass
- T4 (mock): statInodeDev returns different inode on second call → throws TOCTOU

**G3 — End-to-end inject failure contract test** (`companion/test/computer-adapters.test.ts`):
- T5: mock `spawnHostBin` to return `{"ok":false,"error_code":"SKYLIGHT_SPI_UNAVAILABLE"}` → `click()` throws `ComputerError("SKYLIGHT_SPI_UNAVAILABLE", ...)`. Validates F9 contract.

### F9 — End-to-end failure contract (NEW per Grok finding #3)

In `companion/src/computer/darwin-adapters.ts`, wrap inject paths:

```typescript
async click(hwnd: number, x: number, y: number, kind: ClickKind): Promise<void> {
  // ensureForeground dropped (SkyLight per-PID)
  const bin = resolveHostBinary()
  const args = ["inject", "--action", kind, "--window-id", String(hwnd),
                "--x", String(Math.round(x)), "--y", String(Math.round(y)),
                "--check-occlusion"]
  if (this.estopFlagPath) args.push("--estop-flag", this.estopFlagPath)
  let result: { stdout: string }
  try {
    result = await spawnHostBin(bin, args, { timeoutMs: DARWIN_INJECT_TIMEOUT_MS })
  } catch (err) {
    rethrowDarwinExecError(err as ExecFileException | Error, "inject")
  }
  const parsed = parseComputerJson(result.stdout, "inject")
  checkOk(parsed, "inject")  // surfaces SKYLIGHT_SPI_UNAVAILABLE / SKYLIGHT_POST_FAILED as typed ComputerError
}
```

Same pattern for `typeText`, `keyChord`, `scroll`, `drag`.

### F10 — TCC bundle ID + recovery instructions (NEW per Grok finding #4)

Bundle ID is `com.cmspark.host` (per `host-Info.plist:6`). Update:

- Stage 3 ship comms: `tccutil reset Accessibility com.cmspark.host && killall tcc`
- Release notes, side-panel banner, DMG README
- In-agent first-run detection (optional refinement): AXIsProcessTrusted probe on binary startup → emit `TCC_RENEWAL_REQUIRED` diagnostic that companion surfaces as banner with deep link to System Settings.

## 4. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Sonoma/Sequoia SPI unavailable | medium | low (documented unsupported) | Runtime feature-detect; SKYLIGHT_SPI_UNAVAILABLE surfaces clearly. Plist floor stays 14.4 to preserve other host features. |
| Chrome renderer rejects SkyLight | low | critical | G1 step 5 verifies. Document known-bad Chrome versions. |
| Future macOS removes SLEventPostToPid | low | critical | Runtime feature-detect; typed error. |
| Partial-sequence failure (button stuck) | low | medium | Document recovery: LLM issues corrective action. No auto-recovery. |
| Multi-monitor click coords wrong | medium | medium | v1.3 known limitation. D7 in v1.4. |
| TCC grant burned on binary replacement | certain | low (one-time prompt) | Stage 3 comms with correct bundle ID `com.cmspark.host`. In-agent detection optional. |
| Developer forgets to bump SHA constant | medium | high | F7 auto-rewrite + CI option A gate. |
| CMSPARK_SKYLIGHT_FORCE_FG left in production | low | medium | Stage 3 removes post-canary. |
| CI does not catch SHA drift | medium | low | CI option A asserts host-integrity.ts changed if host.swift/entitlements changed. |

## 5. Rollout strategy

**Stage 1 — Plan implementation** (this Plan; no user gates):
- F7 → F3 → F4 → F2 + F5 → F1 + F9 → F8/G2/G3 unit tests

**Stage 2 — Canary** (user runs G1):
- Tahoe end-to-end click lab (TextEdit → Safari → Chrome)
- Records results in `spike-skylight-tahoe-results.md`
- Chrome click pass → ship. Fail → return to Plan.

**Stage 3 — Ship**:
- Remove `CMSPARK_SKYLIGHT_FORCE_FG` from `host.swift`
- Run `build-host.sh` (auto-updates SHA constant)
- All tests pass
- Tag release

**Stage 3 user-comms** (F10):
- Release notes: explain TCC re-prompt, link to docs
- Side-panel banner on first v1.3 launch
- DMG README: same
- Recovery: `tccutil reset Accessibility com.cmspark.host && killall tcc`

**Stage 4 — P1 follow-up (v1.4)**: D1-D8 per scope.

## 6. Resolved design questions

| # | Question | Resolution |
|---|---|---|
| Q-adv-1 | HID fallback regression | Removed F6 |
| Q-adv-2 | SHA constant drift | F7 auto-rewrite |
| Q-adv-3 | --primitive argv attack | Removed with F6 |
| Q-adv-4 | FORCE_FG env gate | Stage 3 removes |
| Q-adv-5 | Post-spawn content hash | Declined (inode+dev sufficient) |
| N1 | Sonoma/Sequoia unverified | Tahoe-only ship claim |
| N2 | HID fallback re-opens cursor steal | F6 removed |
| N3 | CI SHA oracle theatrical | Option A (PR-diff assertion) |
| N4 | Multi-monitor coords | D7 in v1.4 |
| N5 | TCC grant burn | F10 comms + correct bundle ID |
| N6 | Sonoma hardware assumption | Resolved by N1 |
| N7 | Stale-SHA window | F7 lands FIRST |
| N8 | Theatrical TOCTOU test | G2 T1-T4 honest tests |
| Q5b (CC) | Plist floor collision | **Keep 14.4** per Grok — gate via SPI feature-detect |
| Q5c (CC) | Env dual meaning | Split into CMSPARK_SKIP_HOST_INTEGRITY |
| Grok-1 | Wrong F5 path | Corrected to computer/darwin-adapters.ts |
| Grok-2 | Integrity misses inject spawn | F4 expanded to both paths |
| Grok-3 | SPI failure not surfaced | F9 end-to-end contract |
| Grok-4 | Wrong bundle ID | F10 corrects to com.cmspark.host |

## 7. Implementation order

1. **F7** (`build-host.sh` canonical, auto-SHA-rewrite)
2. **F3** (`host-integrity.ts` new module with `spawnHostBin` shared helper)
3. **F4** (both spawn paths use `spawnHostBin`)
4. **F2** (entitlements) + **F5** (drop ensureForeground in computer/darwin-adapters.ts)
5. **F1** (host.swift merge) + **F9** (parseComputerJson/checkOk in inject paths)
6. **F8/G2/G3** unit tests
7. Notify user for **G1** Tahoe click lab
8. After G1 passes: **Stage 3** (remove env gate, rebuild, tag, publish comms)

Each step is its own commit. Per `grok_review_every_fix`, each commit passes Grok review before advancing.

## 8. Success criteria

The Plan is complete when:

- All F1-F10 changes merged to feature branch
- All unit tests pass (host-integrity + computer-adapters)
- CI option A assertion green
- Grok + Claude Code final review on merged diff returns PROCEED
- User runs G1 (Tahoe click lab incl. Chrome) successfully
- Production binary `dist/cmspark-host` is SkyLight variant, no-flip entitlement
- Stage 3 ship comms published with correct bundle ID

What success does NOT require: D1-D8 (all v1.4+).
