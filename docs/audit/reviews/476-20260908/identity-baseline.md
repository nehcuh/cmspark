# Existing identity audit (before desktop implementation)

Read-only evidence, 2026-09-08. No identity implementation changed.

| Connection | Actual baseline | Evidence |
|---|---|---|
| Tray menu | CompanionClient options omit surface, but the emitted handshake explicitly defaults to `tray` | menu-bar-agent.ts:2078, tray/companion-client.ts:648 |
| Summoner HTTP/SSE proxy | A separate CompanionClient explicitly emits `summoner`; it must remain restricted | menu-bar-agent.ts:2139–2144 |
| Extension | Omits wire surface, Origin identifies extension; server resolves `panel` | chrome-extension/src/background/ws-client.ts:186, ws/handshake-surface.ts |
| Tray Origin with omitted/unknown surface | REJECT (`omit_tray`) after authentication, not full tray | ws/handshake-surface.ts:surfaceFromOrigin |
| Extension claiming tray | Coerced to panel; claiming summoner rejected | ws/handshake-surface.ts |
| Desktop | Not a current supported wire role; must not add it to the existing tray pass-through | ws/validate.ts, ws/handshake-surface.ts, ws/lifecycle.ts |

The helper `assertSummonerAllowed(surface !== summoner)` alone appears permissive, but lifecycle first applies validation, HMAC authentication and surfaceFromOrigin. Do not misreport a reachable omitted-tray privilege bypass from the helper alone. Future desktop identity must still be an independently authenticated role with its own explicit allowlist, not merely another string accepted by this helper.
