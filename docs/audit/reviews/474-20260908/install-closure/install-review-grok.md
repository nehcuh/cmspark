I'll read the frozen packet in full first, then review only that code for the #474 icon/Windows verdict.## VERDICT: **APPROVE_WITH_NITS**

Code gate only. Not approval of Mac replace or Windows native package. No P0/P1. Visual + pin + Windows artifact wiring match the authorized T2 slice.

### What holds
Shared 24-unit mark, colors `#16845d` / `#d54343` / `#b67c18`, red/stop hole r=1.9, static app/extension vs live tray are consistent across JS, Swift, and ICO.

- **Live tray:** green solid / red hollow / yellow solid; `isTemplate=false`; `title=""`; tooltip + Swift AX = 运行中 / 已停止 / 状态未知; header gone; start/stop/restart enablement and `seqMap[0..2]` unchanged.
- **Static brand:** extension PNG un-tiled green; macOS iconset + `cmspark.ico` tiled green; tray ICO 16/32/48 per state.
- **Windows:** app ICO 16/24/32/48/64/128/256; MUI_ICON/UNICON; shortcuts already `assets\cmspark.ico`; `DisplayIcon` `...,0`; staging fail-closed on app + three tray ICOs; missing-`cmspark.ico` test refuses before makensis.
- **Pin:** `e184528c…14fbb`, fail-closed, `checkIntegrity` true. Unknown copy no longer pretends “检测中”. No new states, no start/stop/permission edits.

### P0 / P1
None in this packet.

### MAJOR
None. Residual install (DMG replace, Windows `workflow_dispatch`) is out of this gate; NSIS PE-with-icon is enough for the Windows code path.

### NIT
1. `makeStatusIcon(..., ws:)` is unused after the WS-dot removal. Leave it; do not restore a connected-dot without spec.
2. Tray generator comment still says “1x/2x PNG”; only 32px PNG is written (ICO carries 16/32/48).
3. Missing-icon gate sits outside the `true(1)` block and falls back to `/usr/bin/true`; fine where Machine131 ran, brittle if `true` is absent and makensis skip yields 0.
4. `crc32` rebuilds its LUT per chunk; `MenuTag.header` is likely dead after header removal.

Merge still needs the other valid dual review. This lane does not authorize installing the tray or shipping the Windows native build.
