# Issue 490 backend lane regression evidence

Runtime: Node v22.23.2, selected with `nvm use 22` before each command.
Working directory: `/Users/huchen/Projects/cmspark/companion`.
Tests use the existing isolated temporary knowledge/config fixtures and production
`normalizeGraphOrganize` / `buildKnowledgeGraph` functions. No real user knowledge
or configuration was accessed for fixtures.

1. Before the production fix:
   `./node_modules/.bin/tsx --test --test-name-pattern='#490' tests/knowledge-graph.test.ts`
   Exit 1; 2 tests failed. Log: `backend-lane-red.log`.
2. After the production fix:
   `./node_modules/.bin/tsx --test tests/knowledge-graph.test.ts tests/knowledge-graph-organize.test.ts`
   Exit 0; 52 tests passed. Log: `backend-lane-green.log`.
3. `./node_modules/.bin/tsc -p tsconfig.test.json --noEmit`
   Exit 0. Log: `backend-typecheck.log` (empty on success).
4. `git diff --check -- companion/src/skills/knowledge-graph.ts companion/tests/knowledge-graph.test.ts`
   Exit 0, run from the repository root.

Production scope: only apply unlocked cached LLM groups in the LLM lane. The
existing explicit lock overlay remains after grouping and still applies at 20+
documents. Shared index cache persistence behavior is unchanged. No commit,
full suite, or merge approval performed by this implementation agent.

## Organize operation state follow-up

Added an additive boolean `organizing` to normal and rebuilding graph responses.
The existing single-flight controller remains the authority; its existing
`finally` clears the controller before the terminal push is serialized.

- Red: `./node_modules/.bin/tsx --test --test-name-pattern='#490 organize lifecycle' tests/knowledge-graph-organize.test.ts`
  exited 1, two failures; `backend-organizing-red.log`.
- Green: `CMSPARK_TEST_GRAPH_ARTIFACT_DIR="$PWD/../.omx/artifacts/knowledge-graph-490" ./node_modules/.bin/tsx --test tests/knowledge-graph.test.ts tests/knowledge-graph-organize.test.ts`
  exited 0, 54 tests passed; `backend-organizing-green.log`.
- `./node_modules/.bin/tsc -p tsconfig.test.json --noEmit` exited 0;
  `backend-organizing-typecheck.log`.
- Targeted `git diff --check` exited 0.

`organize-success-frames.json` and `organize-failure-frames.json` contain actual
`handleMessage` responses and `sendToExtension` pushes from the isolated deferred
LLM fixture. Each records initial ACK, intermediate refresh, rebuilding response,
final push and subsequent refresh. Busy is true until success/failure settles;
the failure case starts with an existing organized cache and preserves it.
