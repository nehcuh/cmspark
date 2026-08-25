# Dual external review — overlay-nspanel-restore (Claude lane)

**Patch freshness** `[executed]`: `overlay-nspanel-restore-diff-20260825-150534.patch` matches current `git status`/`git diff` exactly (MM files = NSPanel restore on top of staged HTML Slice B). Not stale.

**Machine re-run** `[executed]`: 95 pass / 0 fail (overlay/protocol/web/acl); markdown-breaks 2 pass; `validateWsMessage({files:[{name:"a.txt",type:"",content:"YQ=="}]})` → `{"valid":false,"error":"每个文件需要 name, type, content 字段"}` while `text/plain` → valid; `shasum -a 256 companion/dist/cmspark-tray` == `SWIFT_TRAY_SHA256` == `5d17fe…`. Tests green is real — and irrelevant to the 📎 DoD, as shown below.

## Adversary conclusions: confirmed, not falsified

**Impl REJECT — confirmed.** The full kill chain, each hop verified:

1. `companion/src/tray/SummonerOverlay.swift:658` — `"type": ""` hardcoded; Swift never sends a MIME, so **every** NSPanel attach dies, not just edge cases.
2. `companion/src/ws/validate.ts:781` — `!f.type` → invalid `[executed]`.
3. `companion/src/ws/lifecycle.ts:938-944` — stamps `file.upload_error` back to the summoner socket.
4. `companion/src/summoner/client.ts:282-367` — `mapChatMessageToSummonerCmd` maps chat.token/done/enqueued/error/chat.error/tool.start/mcp.confirm.pending only; no `file.upload_error`/`file.uploaded` case → `null`.
5. `companion/src/menu-bar-agent.ts:1556-1557` — `if (!cmd) return` drops it. HUD unchanged.

The HTML shell already knew the answer Swift is missing: `f.type||"application/octet-stream"` (`summoner-web.ts:670`). **R2 triggered**: 📎 cannot upload a small text file *and* cannot surface the failure.

**Second, independent kill** — `handleSummonerFiles` empty-thread path (`menu-bar-agent.ts:1124-1138`) creates+binds+hydrates without `claimOverlayIfLive` (contrast `handleSummonerNewThread` at :1154-1169). Lease default is `holder:"panel"` (`composer-lease.ts:41`); summoner surface maps to `overlay`; `gateChatCreateOnLease` at `message-router.ts:759-760` → OVERLAY_STANDBY. Even with a fixed MIME, first-open attach on a fresh thread is lease-killed.

**Product REJECT — confirmed.** `SummonerOverlay.swift:1030-1033`: `[.titled, .closable, .nonactivatingPanel]`, width **640**, titled window; `:971`: **200pt** 对话/MCP/场景 rail. That is a mini workbench, not a Raycast/uTools one-bar HUD. The comments at `Tray.swift:375` and `swift-tray-bridge.ts:58` stamp the rejected metaphor onto the code — dishonest, and collides with F-UX-NOUN-1 / Slice B §4's Raycast-remake ban.

**External REJECT — confirmed.** `docs/superpowers/specs/2026-08-25-overlay-dogfood-slice-ab-design.md` still says `状态: LOCKED` with no SUPERSEDED; `overlay-dogfood-slice-ab-impl-verdict-20260825-142137.json` still says `both_approve: true` with no STALE stamp; **no new spec exists** for the restore direction. The user's `--app` rejection licenses a *new* dual-locked spec, not an untracked inversion of a locked one. **R3 stands** for any merge that cites 142137 as coverage of HEAD.

**Security AWN — confirmed as the correct *security-axis* bar.** `SUMMONER_WEB_DISPATCH_ALLOW` (`summoner-web.ts:18-33`) has no `knowledge.*`/`voice.stt.*`/`config.*`/`mcp.add`/confirm; zero `getUserMedia` in companion/src `[executed grep]`; `voice.stt.*`/`file.upload` on `SUMMONER_ALLOW` are pre-existing (`summoner-acl.ts` untouched by the diff); empty MIME **fails closed** — do not "fix" 📎 by loosening `validate.ts:781` without a UTI/allowlist design. **R1 not triggered.** But security was never the blocking lane here.

**Test gap — confirmed.** `summoner-overlay.test.ts:191-198` greps for the *existence* of `attachFilesClicked`/`NSOpenPanel`/`summoner.files` strings; the protocol round-trip (`summoner-protocol.test.ts:167-176`) uses `type: "text/plain"`, which Swift never emits. The suite is structurally incapable of failing a dead 📎 — the inverted-SoT problem the external lane flagged.

**Slice A — fine.** `breaks: true`/`gfm: true` at ChatView.tsx (module + parse site), meeting card conditional accent, exclusive `itemActive`; tests pass `[executed]`. Non-controversial; it should not be held hostage by Slice B's restore.

**ADR-020 checklist**: declaration present in prompt + eval-gate card and accurate (L0 Surface, no L2, pack UI pre-existing, autonomy n/a, trust no-grow, community). Axes fit, pack-first respected, trust monotonic (overlay strictly weaker; fail-closed), originWs n/a. Checklist itself clean — the blocks below are functional-honesty and process, where the locked eval order says REJECT blocks merge.

## Blocking issues

1. **📎 dead on arrival, silently** — SummonerOverlay.swift:658 → validate.ts:781 → lifecycle.ts:938-944 → client.ts:282-367 (no `file.upload_error` map) → menu-bar-agent.ts:1557 drop. R2.
2. **Empty-thread attach skips lease claim** — menu-bar-agent.ts:1124-1138 vs :1154; OVERLAY_STANDBY via composer-lease.ts:41 + message-router.ts:759. Survives a MIME fix.
3. **Workbench IA labeled Raycast/uTools 形态** — SummonerOverlay.swift:1030-1033/:971; comments Tray.swift:375, swift-tray-bridge.ts:58.
4. **Locked spec inverted with no supersede trail** — spec still LOCKED, 142137 both-APPROVE unstamped, no new direction spec. R3.
5. **Tests assert string presence, not behavior** — summoner-overlay.test.ts:191-198; summoner-protocol.test.ts:171.

Minimum to re-review: Swift sends a real MIME (or mapper maps `file.upload_error`/`file.uploaded` so failure is visible — ideally both), `handleSummonerFiles` claims the lease like its siblings, comments stop claiming 形态 they don't deliver, a new dual-locked spec supersedes Slice B with 142137 stamped STALE, and at least one test that can fail when the attach path breaks end-to-end.

VERDICT: REJECT
