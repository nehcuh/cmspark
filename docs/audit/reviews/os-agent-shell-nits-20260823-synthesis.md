# OS Agent Shell nits round — five-lane synthesis + reject fold

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Head | `feat/os-agent-shell` `659bbce` + dirty tree (reject fold applied after lanes) |
| Lanes | ARCHITECTURE REJECT · SECURITY APPROVE_WITH_NITS · CORRECTNESS REJECT · PRODUCT-UX REJECT · CODE-QUALITY APPROVE_WITH_NITS |

## Lane VERDICTs (pre-fold)

| Lane | VERDICT | Named BLOCK |
|------|---------|-------------|
| Architecture | REJECT | S23 window-rect map lived in tray process; CU executor in daemon never saw it |
| Security | APPROVE_WITH_NITS | process-continue deny held |
| Correctness | REJECT | stale hydrate `releaseAll` clobbered a newer live overlay session; submit before ready |
| Product-UX | REJECT | `#`+Esc 150ms search timer; empty `#` 1-hit newest; placeholder SSO absent from binary |
| Code-quality | APPROVE_WITH_NITS | grep glue, Tray.swift god-file |

## Fold applied (this tree, after lanes, before Claude/Kimi/Pi)

1. `hydrateOverlayIfLive` / `claimOverlayIfLive` only `releaseAll` when overlay is **closed** (`live === false`), not when a newer generation is live.
2. `handleSummonerReady` `beginOverlaySession()` before `listThreads`; hydrate/new-thread reuse that token.
3. Swift `hide()` invalidates `searchTimer`; `emitSearch` `guard isOpen`.
4. Empty `#` / empty needle → zero hits (no newest-thread steal).
5. Tray forwards `companion.ui.rect` over WS; daemon `applyCompanionUiRectEvent` (S23 SoT in executor process).
6. `chat.regenerate` gated by `gateChatCreateOnLease` + conductor.
7. Placeholder `说点什么，按回车发送…` (long enough for binary cstring).
8. Close clears `summonerThreadId`.

Implementer does not self-APPROVE. External triple review is the next gate.
