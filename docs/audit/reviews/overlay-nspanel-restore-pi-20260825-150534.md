I've verified the key claims against the live tree. Here's my re-review.

## Verification results

**Patch freshness** — Confirmed current. `git status` shows staged Slice A+B (HTML Darwin) + unstaged NSPanel restore; the working tree is the inverse of the locked spec. `SWIFT_TRAY_SHA256` == live binary `5d17fe…` (lockstep OK).

**R1 (ACL growth / HTML mic)** — NOT triggered. `summoner-acl.ts:12-37` (`SUMMONER_ALLOW`) and `summoner-web.ts:18-28` (`SUMMONER_WEB_DISPATCH_ALLOW`) contain no `knowledge.*` / `config.*` / `mcp.add` / confirm; no `getUserMedia` in summoner-web. Security AWN is the right *security* bar. ✓

**R2 (📎 dead + no HUD error) — CONFIRMED, full chain**:
- `SummonerOverlay.swift:653-658` always sends `"type": ""`.
- `companion/src/ws/validate.ts:781` `!f.type` → `invalid` → even a small `.txt` dies.
- WS stamps `file.upload_error` (`ws/lifecycle.ts:938-946`), but `summoner/client.ts:282-367` `mapChatMessageToSummonerCmd` maps zero `file.upload_error`/`file.uploaded`/`file.upload_status`; `menu-bar-agent.ts:1556` drops the null → no HUD line; Swift appends no local "📎" line either.
- Empty-thread path `menu-bar-agent.ts:1122-1135` does `createThread`+`bindSummonerThread`+hydrate **without** `claimOverlayIfLive` (contrast `handleSummonerNewThread` at 1145-1154) → OVERLAY_STANDBY.
- Size cap lie: Swift 8MiB raw (`SummonerOverlay.swift:655`) → base64 ≈10.67MiB > `WS_SOFT_MAX` ≈10.22MiB (`ws/lifecycle.ts:71-74`); >8MiB silently `continue`-skipped.

**R3 (stale `142137` describing HEAD) — CONFIRMED**: `overlay-dogfood-slice-ab-impl-verdict-20260825-142137.json` = both AWN (HTML Darwin, `both_approve: true`); spec `docs/superpowers/specs/2026-08-25-overlay-dogfood-slice-ab-design.md:4` still `状态: LOCKED`, no SUPERSEDED. HEAD is the negation. User override needs a **new** dual-locked spec.

**Product (Raycast/uTools 形态) — CONFIRMED dishonest**: `SummonerOverlay.swift:1029-1038` = `.titled`+`.closable`+`.nonactivatingPanel`, width **640**, min 140; `:966-971` = **200pt** 对话/MCP/场景 rail; title `CMspark 召唤器（实验）`. That is the mini workbench the user rejected in Chromium `--app`, repainted natively — not a one-bar HUD. Yet `Tray.swift:375` and `swift-tray-bridge.ts:58` stamp "Raycast/uTools 形态".

**R4 (tests green ≠ DoD) — CONFIRMED**: `companion/tests/summoner-overlay.test.ts:178-197` source-greps `attachFilesClicked`/`NSOpenPanel`/`summoner.files` and now *requires* the NSPanel path; the 95-pass suite is an inverted SoT and cannot detect the dead 📎. The eval gate itself records "PASS tests / FAIL DoD".

## Blocking issues

1. 📎 cannot upload even a small text file: `SummonerOverlay.swift:653-658` (`"type": ""`) → `validate.ts:781` (`!f.type`) → `file.upload_error`.
2. HUD never surfaces upload success/error: `summoner/client.ts:282-367` has no `file.upload_*` mapping; `menu-bar-agent.ts:1556` drops it; no Swift local ack.
3. Empty/new-thread attach skips overlay lease: `menu-bar-agent.ts:1122-1135` (no `claimOverlayIfLive`, vs `handleSummonerNewThread` at 1145-1154).
4. Size cap mismatch: `SummonerOverlay.swift:655` (8MiB raw) vs `ws/lifecycle.ts:71-74` (`WS_SOFT_MAX` ≈10.22MiB) — mid-range files die oversized, larger files silently skipped.
5. Process lie: `overlay-dogfood-slice-ab-impl-verdict-20260825-142137.json` (both-APPROVE HTML Darwin) + `2026-08-25-overlay-dogfood-slice-ab-design.md:4` (LOCKED) on disk while the tree inverts them; no new spec lock for the user override.
6. Product dishonesty: `Tray.swift:375` / `swift-tray-bridge.ts:58` claim "Raycast/uTools 形态" for a titled 640pt + 200pt rail workbench (`SummonerOverlay.swift:1029-1038`, `:966-971`).
7. Test gap: `summoner-overlay.test.ts:178-197` source-greps; green cannot certify the 📎 DoD.

ADR-020: declaration present/accurate; Surface-axis only; no "中层 Agent"; pack-first respected (Slice A kept distinct from radio); trust monotonic (ACL no-grow); no originWs surface. Security/capability axis is clean — the Security AWN stands. But the Product/Impl/External REJECTs are each independently verified with file:line, and REJECT conditions R2 + R3 + R4 (as process risk) are all live.

VERDICT: REJECT
