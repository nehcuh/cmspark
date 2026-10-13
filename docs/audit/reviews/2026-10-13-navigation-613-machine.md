# #613 machine gate

Base c570cb80c5799057e067ae0b55e6a3e4548288c3. Frozen9-file product/test/harness/spec patch SHA256 a779f888ed566bc5d3f0ec03143f420647e2a0089684c7c92c8eee583a33b52b. T2, ADR-020 capability declaration in spec. Node22.23.2 on macOS ARM64.

## Checks — all exit0

- Full frontend npm test:1517 passed,0 failed/skipped; /tmp/cmspark-613-frontend-tests.log. Production tsc and UI hygiene pass; actual production Plasmo build exit0, /tmp/cmspark-613-extension-build-final.log. First build before local dependency links failed tsc missing (not product evidence); final build with existing dependency links succeeded, no lock/dependency changes.
- Fresh Linux ARM64 Node22.23.2 container, independent npm ci from frontend lock plus test TypeScript: task-relationship/thread-timeline/thread-busy71 passed,0 failed/skipped. /tmp/cmspark-613-arm64.log. Host node_modules not mounted.
- uv run --no-project --with playwright python companion/scripts/test-task-navigation-ui.py: actual TaskRelationshipNav, relationship helper, reducer and production workspace CSS mounted in isolated Chromium fixture.320/390/900px long names;9 click/Enter/Space callbacks select direct parent and preserve busy; unavailable/missing/trash/cycle disabled, zero extra callbacks and no horizontal overflow/browser errors. /tmp/cmspark-613-ui-final.log, screenshots/evidence under the host temporary directory cmspark-613-navigation-shots. Earlier inspected screenshots /private/tmp/cmspark-613-navigation-shots/available-{320,900}.png use identical product code. This is isolated presentation integration, not a running complete extension or live Companion test.
- Real reducer Fleet-first selection, full-Thread/Fleet conflict, wrong ID, title refresh, missing/trashed/self/long-cycle/direct parent, actual React static render and message/busy/composer request invariants in task-relationship.test.ts.
- git diff --check exit0. Local dependency symlinks are validation-only and excluded from stage/commit.

## Outcome / case

1. Newly spawned Fleet worker selected before thread.list hydration.
2. Before: StatusRail showed new conversation and no return; after: same-ID Fleet fallback displays child and known parent's name with return control. Known Thread metadata wins; missing/trashed/invalid parent retains child identity with disabled reason.
3. Responsibility: UI metadata timing/visibility gap; backend persisted relationship already exists.
4. Protects: explicit direct-parent navigation, honest unavailable state, existing selection/message/busy/panel-wide draft semantics. No guessed parent, new protocol, worker control, restore-trash or nested spawning.

MACHINE: PASS. Independent adversary→Pi/Kimi/CI still required. No self approval.

Independent adversary: APPROVE; Pi second confirmation: APPROVE; supplemental Kimi: APPROVE_WITH_NITS. Nonblocking items assigned to @nehcuh in #619 (test-layout coupling and performance observation without bottleneck claim). Source hash rechecked before committing; CI still required before merge.
