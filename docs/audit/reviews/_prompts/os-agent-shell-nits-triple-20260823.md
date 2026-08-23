# Triple rereview — OS Agent Shell reject-fold

You are an independent senior reviewer (not the implementer). Inspect the real tree. Do not rubber-stamp.

Repo: /Users/huchen/Projects/cmspark
Branch: feat/os-agent-shell (dirty)

## Prior five-lane VERDICTs (then a fold)

- Architecture REJECT: S23 rects in tray process, CU executor in daemon
- Correctness REJECT: stale hydrate releaseAll killed newer live overlay; submit before ready
- Product-UX REJECT: # + Esc search timer; empty # 1-hit; placeholder missing from binary
- Security / code-quality: APPROVE_WITH_NITS

Synthesis: docs/audit/reviews/os-agent-shell-nits-20260823-synthesis.md

## Fold claims (VERIFY)

1. releaseAll only when overlay closed (`live === false`)
2. handleSummonerReady begins session before listThreads
3. hide() cancels searchTimer; emitSearch guard isOpen
4. empty # → zero hits
5. companion.ui.rect WS to daemon applyCompanionUiRectEvent
6. chat.regenerate lease + conductor gated
7. Placeholder 说点什么，按回车发送… in Swift **and** binary
8. close clears summonerThreadId

## MACHINE you must run

```
cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json --pretty false
node --test .test-dist/tests/overlay-session.test.js .test-dist/tests/composer-lease.test.js .test-dist/tests/summoner-journeys.test.js .test-dist/tests/companion-ui-rects.test.js
shasum -a 256 dist/cmspark-tray
# must equal SWIFT_TRAY_SHA256
```

Capability (ADR-020): Surface L0 overlay; Trust lease + S23; Channel community.

Write a full review. Final line MUST be exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
