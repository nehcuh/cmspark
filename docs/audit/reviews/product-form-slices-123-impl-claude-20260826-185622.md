## Independent re-review: product-form-slices-123-impl (151ca31 vs origin/main)

**Evidence levels:** all code claims below are `[inspected]` against the working tree at HEAD; test/tsc claims are `[executed]`.

### Six pinned spot-checks — all confirmed

1. **grant-cli.ts consent lines** `[inspected]` — `companion/src/outbound-mcp/grant-cli.ts:121-141`: token prints once with 「这把钥匙只出现一次。它不是扩展配对码。」; `--allow-page-export` honest copy states first-exfil still requires 确认台; without flag, copy says exfil is rejected (no confirm prompt). No `listen(`/`createServer(`/`fetch(`/`acceptOutboundDisclosure` anywhere in the module. Win32 launch spec is path-honest (`grant-cli.ts:81-107`).
2. **打开确认台** `[inspected]` — lives in `summoner/client.ts:43` (`SUMMONER_OPEN_CONFIRM`) + `SummonerOverlay.swift:53`, plus `MCP_OVERLAY_CONFIRM_NOTICE`/`UNAVAILABLE` in `mcp/confirm-target.ts:6-10`. (Prompt said "summoner-web"; see nit 2.)
3. **bridge.ts passHitlToHttp** `[insuted→inspected]` — `outbound-mcp/bridge.ts:64-68`: only `DISCLOSURE_HITL_REQUIRED` defers to the HTTP dispatcher; `NOT_GRANTED`/`PROFILE_FORBIDDEN` fail-closed in the child; defense-in-depth re-check at `:107-110`.
4. **waitFirstExfilOperatorConfirm** `[inspected]` — `outbound-mcp/companion-http.ts:119-229`: uses `resolveConfirmBinding(isOutboundMcpCall=true)` → unbound origin (tray wins); `autoConfirmEligible: false`; approve arms only the session Map (`acceptOutboundDisclosure`, `:220`) with explicit never-persist-grant-flag comment; deny/timeout → `OUTBOUND_CONFIRM_REQUIRED` fail-closed.
5. **summoner-acl no confirmation.response** `[inspected]` — `ws/summoner-acl.ts:14-45`: `security.confirmation.response` absent from `SUMMONER_ALLOW`; enforced at `ws/lifecycle.ts:1060` **before** the response intercept at `:1086`, so the overlay socket can never resolve a confirm even when unbound.
6. **rejectAll unbound survive** `[inspected, executed]` — `security-confirmation.ts:508-548`: with `ws`, only `pending.originWs === ws` entries reject; unbound entries survive single-peer close (45s timeout remains reaper); no-arg form still drains for shutdown. Overlay close path (`lifecycle.ts:1421-1437`) cancels tray dialogs keyed on the closing socket only.

### Overlay never Allow/Deny — triple-verified `[inspected]`
`mcp/confirm-fanout.ts`: `resolveConfirmBinding` never returns the summoner socket as `originWs` (:113-129); `fanOutConfirmRequest` sends Allow/Deny only to authenticated non-summoner peers (:77-87); overlay receives `mcp.confirm.pending` notice only (:88-94). L2 (`l2-admission.ts:1196-1299`) and URL admission use the same helper; tray map keyed by `trayOwnerWs`, never overlay. Gate algebra in `facade.ts:50-99` matches spec (`NOT_GRANTED` → `HITL_REQUIRED`); stdio `META_ACCEPT` acknowledge returns `ACK_NOT_OPERATOR` and never arms (`stdio-server.ts:146-161`).

### Machine `[executed]`
`companion` tsc (tsconfig.test.json) exit 0. Slice suites run fresh by me: 102 pass (confirm-fanout, security-confirmation-origin, l2-summoner-confirm-origin, wait-for-extension-peer, mcp-confirm-target, grant CLI, grants, facade, docs-grant, summoner-acl) + 159 pass (executor/companion-http/http-e2e integration, summoner overlay/web/compose/client). 0 failures.

### ADR-020 checklist
Declaration present in the plan (Surface/L2-classes/Compose/Autonomy/Trust/Channel). Axes fit (confirm retarget is Surface, not a new runtime); no new primary Side Panel chrome (checkbox on existing settings section); reuses `SecurityConfirmationManager` — no new confirm dialect; trust monotonicity **increases** (HTTP/stdio caller ack demoted from consent); originWs bound on all new confirm paths (outbound intentionally unbound per locked design). No violations.

### Four-lane synthesis — confirmed
Product r2's two blockers (CLI lying, no 打开确认台) are demonstrably fixed in 151ca31's actual tree. AWN is justified.

### Nits (non-blocking)

- **Stale/incomplete patch artifacts** `[executed]`: the prompt-attached `product-form-slices-123-impl-diff-20260826-185622.patch` contains only a git-status snapshot plus the uncommitted spec-doc diff — zero implementation content. The committed `...-183806.patch` was cut 18:38:06, before the r2 fix commit 151ca31 (18:51:43); I applied it to a clean origin/main worktree and the resulting tree is 87 lines / 11 files short of 151ca31 (grant-cli, bridge, summoner-web, Swift HUD, SHA bump, tests). The code is fine; the audit trail under-represents it. Regenerate the diff after the final commit of a review batch.
- **Spot-check naming**: "summoner-web 打开确认台" — the CTA constant is in `summoner/client.ts:43` and the Swift HUD, not `summoner-web.ts`. Prompt inaccuracy only; behavior verified where it actually lives.
- **Swift tray SHA256** `[inspected]`: `swift-tray-bridge.ts:59` was updated in-range, but no `.build` artifact exists locally so I could not re-derive the binary hash; source-regex tests cover the HUD behavior. `bash companion/src/tray/build-tray.sh` on the release machine remains the verification step.
- Uncommitted modification to `docs/superpowers/specs/2026-08-26-summoner-strategy-rethink-design.md` sits in the tree — out of scope for 151ca31, but it will pollute the next diff capture if not committed or stashed first.

VERDICT: APPROVE_WITH_NITS
