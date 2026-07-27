# Finish ship note — multi-agent + MissionBoard Stage 3/4

**Date**: 2026-07-27  
**Branch**: `feat/multi-agent-p0`

## Added in this finish pass

| Item | Status |
|------|--------|
| Intent claim / heartbeat / reap | `companion/src/board/intent-claim.ts` |
| `spawn_worker` + `intent_id` claim | spawn + server |
| `board_claim_intent` / `board_heartbeat_intent` tools | server + tool-definitions |
| `wait_workers` reaps stale intents | server |
| `board.get` / `board.add_hint` WS | message-router + background |
| Side Panel **任务板** tab | `BoardPanel.tsx` + BottomBar |
| FleetStrip open-intent badge | FleetStrip + fleet snapshot |
| Measurement harness doc | `mission-board-measurement-harness-2026-07-27.md` |

## Still out of scope (explicit)

- Full graph visualization
- Live 5–10 PRD measurement runs (harness only)
- shared-observer / auto-spawn
- Formal Claude/Pi re-stamp after this commit (optional; unit suite is ground truth)

## Test command

```bash
cd companion && npx tsc -p tsconfig.test.json && \
  node --test .test-dist/tests/board-*.test.js .test-dist/tests/orchestrator-*.test.js
```
