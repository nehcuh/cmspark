# Triple rereview — OS Agent Shell reject-fold

Branch `feat/os-agent-shell` @ `659bbce` + dirty tree. Independent review; real tree inspected, machine run. Full record saved to `docs/audit/reviews/os-agent-shell-nits-20260823-triple-rereview.md`.

## Machine [executed]

| Step | Result |
|------|--------|
| `tsc -p tsconfig.test.json --pretty false` | exit 0 |
| `node --test` overlay-session + composer-lease + summoner-journeys + companion-ui-rects | **48 pass / 0 fail** |
| `shasum -a 256 dist/cmspark-tray` | `ad1bb716…53596b` == `SWIFT_TRAY_SHA256` (`swift-tray-bridge.ts:59`) |
| Placeholder in binary | `说点什么，按回车发送…` byte-exact ×1 (UTF-8 byte scan; `strings` misses multibyte CJK) |

## Fold claims — all 8 verified in source

1. **releaseAll only when closed** — `overlay-session.ts:44-50,58-63`: stale token with newer live generation returns `"abandoned"` before any release; `releaseAll` only when `live === false`. Held by behavioral tests (`stale hydrate does not releaseAll…`, `close during claim releases…`).
2. **Ready begins session before listThreads** — `menu-bar-agent.ts:672` `beginOverlaySession()` precedes `listThreads()` at `:683`; token threaded into hydrate/new-thread. Submit-before-ready closes structurally: `client.ts:150-151` aborts without `chat.create` when the claim no-ops.
3. **hide() cancels searchTimer; emitSearch guards isOpen** — `Tray.swift:1619-1621` + `:1856-1858`; Esc → `hide()` can't leak a post-close search.
4. **Empty `#` → zero hits** — `client.ts:85-89` (Node) and `Tray.swift:2031-2035` (Swift local); tested with `#`, `#   `, `""`; single-hit auto-hydrate only on exactly 1 hit.
5. **rect WS → daemon** — full chain verified: Swift emits (`Tray.swift:42-58`) → tray forward (`menu-bar-agent.ts:1233-1241`) → validate + ACL allow → `message-router.ts:1038-1041` applies in the **daemon** → `executor.ts:1371-1383` hard-denies click/scroll/drag. S23 SoT now lives in the executor process; process-continue deny (`self-ui.ts:53-56,91-102`) still holds. Architecture BLOCK closed.
6. **chat.regenerate gated** — `message-router.ts:1106-1111`, mirroring `chat.create` at `:306-309`; conductor denial is summoner-only while CU is LIVE.
7. **Placeholder in Swift and binary** — `Tray.swift:1436` + byte-exact in the hash-pinned binary.
8. **Close clears summonerThreadId** — `menu-bar-agent.ts:699-705` (invalidate → null → release), plus server-side release on summoner-socket death.

## Full-suite failures — not fold-caused

15 failures reproduced (12 executor dialog/L2/budget/X1/M1, 2 uia-watch, 1 config). The fold's entire `executor.ts` delta is 10 lines of rect asserts that are provably inert with an empty rect map; no test in that file registers rects; new S23 tests append after the failures. Failure set matches the prior lane's clean-worktree diff against `origin/main` — pre-existing debt, outside this fold.

## Nits (non-blocking)

1. **New** — `#`-mode Enter with zero hits falls through to `submitComposer()` (`Tray.swift:1841→1892`): sends literal `"#"` / `"#needle"` as a chat message. Visible, but violates the "`#`=检索，其余=说话" contract.
2. **New** — idle-resume setting inert: `shouldStartNewSummonerThread` (`client.ts:187-194`) never compares timestamps, so 10/30-minute options behave as always-resume while the UI promises "超时后新对话" (`Tray.swift:2407`).
3. Drag → stale S23 rect (no `windowDidMove`); security-lane NIT-5, fail-closed for L2.
4. Dead tray-side rect copy (`swift-tray-bridge.ts:543`); 5. stale `2b4c23…` pin in `dist/tray/swift-tray-bridge.js` — run `npm run build` before ship; 6. rect events accept all surfaces, no size cap (local self-DoS residual); 7. narrow reopen-during-claim race can leave a stale overlay lease (typed `OVERLAY_STANDBY`, self-heals); 8. carried: `claim.holder` not surface-bound, `key`/`type` skip rect gate, `sawBrowserUnavailable` persistence, Tray.swift god-file.

## Capability (ADR-020)

Surface L0 overlay with lease-gated compose and conductor gate — holds. Trust: lease + S23 enforced in the executor process, binary in SHA lockstep — holds modulo the drag nit. Channel community: honest title-only search, no newest-thread steal — holds.

VERDICT: APPROVE_WITH_NITS
