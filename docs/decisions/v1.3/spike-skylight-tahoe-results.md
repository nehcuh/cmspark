# Spike: SkyLight per-PID primitive — Tahoe 26.5 Results

**Date**: 2026-07-24
**Machine**: macOS 26.5.2 Tahoe (Darwin 25.5.0, Apple Silicon arm64)
**Source**: `companion/src/host-use/darwin/host-skylight.swift` (fork of `host.swift`)
**Variants**:
- `cmspark-host-skylight` — flip variant (260112 bytes, SHA256 `c585dd3fc9247bed8b49116b33b3d75e36c759145b353f23a0925889204ea2d0`)
- `cmspark-host-skylight-nolibval` — production target (260128 bytes, SHA256 `624d0c6ac8daee2829c5a7b40754ac60d62f9b2e156d83bd08ca881563f8dc91`)

## Blockers under test (from `adversary-approach-c-round1.txt`)

### B1 — Library validation flip → **NOT REQUIRED** ✅ (2026-07-24 A/B)

**Empirical A/B result**: built two variants of the same `host-skylight.swift`:

| Variant | `disable-library-validation` | `dlopen` + `dlsym(SLEventPostToPid)` |
|---|---|---|
| `cmspark-host-skylight` | `true` | resolves non-null ✅ |
| `cmspark-host-skylight-nolibval` | `false` | **resolves non-null ✅** |

Both binaries load SkyLight and resolve the SPI under hardened runtime + library validation ON. This confirms Grok's hypothesis: **Apple library validation permits loading Apple-signed dylibs, and SkyLight is Apple-signed.** The flip was accepted by codesign (B1 original PASS) but is not required for runtime load.

**Implication**: Ship Approach C with `disable-library-validation=false` (no S-P0-2 regression). Preserves the full v1.3 Batch 1 hardened-runtime + library-validation lockdown. The host spawn-path integrity gap (separate concern, see threat model) becomes a "harden before Plan implementation" item but not a "must fix before SkyLight can work" item.

- `host-skylight-nolibval.entitlements` (new): flip set to `false`.
- `build-host-skylight.sh` (updated): builds BOTH variants for future A/B regression catches.
- Production target: `cmspark-host-skylight-nolibval` shape.

### B2 — SPI resolution on Tahoe 26.5 → **PASS** ✅

```
$ ./companion/dist/cmspark-host-skylight inject --action click --window-id 1 --x 50 --y 50
[host-skylight] resolved SLEventPostToPid=true SLPSPostEventRecordTo=true
[host-skylight] skipping forceForeground (SkyLight per-PID path)
{"action":"click","ok":true,"x":50,"y":50}
```

- `dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY | RTLD_GLOBAL)` returns non-null handle.
- `dlsym(handle, "SLEventPostToPid")` returns non-null function pointer on Tahoe 26.5.2 (Build 25F84).
- `dlsym(handle, "SLPSPostEventRecordTo")` returns non-null function pointer.
- The hook is invoked via `unsafeBitCast` to a Swift `@convention(c) (pid_t, CGEvent?) -> Void` closure.
- No `unrecognized selector sent to class` crash (which is what cua issue #1503 reports on Sonoma).

### B2 — SPI resolution on Sonoma 14.4 / Sequoia 15.5 → **NOT TESTED** ⚠️

- Single-machine lab; only Tahoe 26.5 available locally.
- cua issue #1503 (Sonoma crash on `SLSEventAuthenticationMessage` selector family) and yabai issues #2634/#2638/#2707 (Tahoe 26.0 + 26.2 breaks) demonstrate SPI stability is OS-version-sensitive.
- **De-risk options** (any of):
  - (a) User runs `cmspark-host-skylight` binary on Sonoma + Sequoia Macs (cheap, ~30 min).
  - (b) UTM/VMware macOS VMs (licensing gray area for macOS guest on Apple Silicon).
  - (c) Defer to community bug reports post-ship.
- Recommendation: **(a)** before production ship. Block Approach C Plan-phase on this data point.

### B3 — Daemon vs S-P0-2 → **OPEN** (see `spike-daemon-threat-model.md`)

Not addressed by this spike. Decision deferred to threat-model addendum.

## What was NOT tested by this spike

1. **Real click landing on TextEdit / Safari / Chrome** — needs Accessibility TCC prompt for the new cdhash + visual verification. **Manual lab test required** (see click-test procedure below).
2. **Chrome mouse click via SkyLight** — the headline claim (Chrome renderer IPC accepts auth-signed SkyLight events but rejects public `postToPid`). Must verify before Plan.
3. **Right-click on Chromium web content** — cua documented as occasionally broken. Acceptable per Approach C contract.
4. **AX-first dispatch (`AXPress` / `AXSetAttributeValue`)** — orthogonal to primitive swap; not yet implemented in `host-skylight.swift`.
5. **Software cursor overlay** — orthogonal; not yet implemented.

## Manual click-test procedure (for the user)

```bash
# 1. Open TextEdit (or Safari, or Chrome with a fresh tab) — make sure it's visible.

# 2. Get the target window-id:
./companion/dist/cmspark-host-skylight window-list --foreground

# 3. First run will prompt for Accessibility permission — approve in
#    System Settings → Privacy & Security → Accessibility (add cmspark-host-skylight).

# 4. Click somewhere safe (e.g. the title bar of TextEdit):
./companion/dist/cmspark-host-skylight inject --action click --window-id <ID> --x 100 --y 30

# Expected (if SkyLight works):
#   - stderr: "resolved SLEventPostToPid=true ..."
#   - stderr: "skipping forceForeground (SkyLight per-PID path)"
#   - The TextEdit window receives the click WITHOUT being raised to frontmost
#   - The user's real cursor does NOT move
#   - stdout: {"action":"click","ok":true,...}

# 5. Repeat on Chrome — open chrome://settings in a tab, click a known link.
#    This is the load-bearing test: Chrome renderer IPC rejects public postToPid.
```

Record per-app results in this doc under "Real click test results" once run.

## Build artifacts

- `companion/src/host-use/darwin/host-skylight.swift` (fork, 1255+ lines)
- `companion/src/host-use/darwin/host-skylight.entitlements` (flip=true, A/B variant)
- `companion/src/host-use/darwin/host-skylight-nolibval.entitlements` (flip=false, **production target**)
- `companion/src/host-use/darwin/build-host-skylight.sh` (A/B build script)
- `companion/dist/cmspark-host-skylight` (flip variant, ad-hoc signed)
- `companion/dist/cmspark-host-skylight-nolibval` (no-flip variant, ad-hoc signed)

Production `host.swift` / `host.entitlements` / `cmspark-host` **untouched**.
