# Ship note — CMspark v0.3.0 macOS DMG (2026-08-02)

## Artifacts (local; `dist-package/` is gitignored)

| File | Size (approx) | Notes |
|------|---------------|--------|
| `dist-package/CMspark-v0.3.0-macOS.dmg` | ~76MB | Ad-hoc signed `.app` |
| `dist-package/cmspark-v0.3.0-macos-arm64.zip` | ~75MB | Same payload, zip form |
| Install target | `/Applications/CMspark.app` | ditto from `dmg-staging` after build |

**Built from branch tip at package time:** `fix/macos-tcc-product-identity` (includes soft-fail estop + spatial describe OCR).

**Main executable CDHash (this build):** `dae886806b23f1fce67fa5915624f03b838133ad`  
**Identifier:** `com.cmspark.agent` (product TCC identity — not `node`)

## Included fixes (vs 2026-08-01 21:51 DMG)

1. **Estop soft-fail** — CGEventTap fail → hotkey DEGRADED, UNIX socket stays live (`host_computer` preflight no longer hard-blocks on code 4).
2. **Tray/Aqua-owned estop** — preferred ownership under `MacOS/CMspark`.
3. **Spatial `describe` OCR** — reading-order lines + untrusted marker; prompts discourage shell Vision bypass.
4. **Product identity** — Screen Recording / Accessibility list as **CMspark**.

## Still true for recipients (not “fully fixed” UX)

| Topic | Status |
|-------|--------|
| Ad-hoc code signature | Recipients must grant **Screen Recording** + **Accessibility** to **CMspark** themselves |
| Reinstall / new CDHash | May need toggle off→on + full quit/relaunch |
| Global hotkey | Often **DEGRADED** under LaunchServices; use Side Panel / tray stop |
| Developer ID | Not in this DMG — long-term for less TCC churn |
| TinyClick/ORT in zip | Package log may note ORT budget; experimental Qwen path separate |

## Device smoke after install (this machine, 2026-08-02)

- [executed] `SOCKET_LIVE` after open app  
- [executed] estop-tray.log: `hotkey DEGRADED` + soft-fail message (not code-4 exit)  
- [executed] agent bundle contains `untrusted host-ocr` / `formatOcrWordsAsDescribeText`

## Distribute to others

1. Send `CMspark-v0.3.0-macOS.dmg` (or zip).  
2. User: open DMG → drag to Applications → first launch → grant **录屏 + 辅助功能** for **CMspark** only (not node).  
3. Pair extension with companion as usual.  
4. Do **not** claim Computer Use 100% DoD on every Mac until they pass screenshot + click on their hardware.
