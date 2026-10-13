# #618 machine/eval card — round 1

UTC 2026-10-13 05:18. Base e44af42f0f3999f23306e41159edb8b12e3dbdff. Branch codex/itcra-enterprise-browser-618. Frozen full source diff `/tmp/cmspark-itcra-618-r1.diff`, SHA256 `e0eca1f21407925704bc1c6c27050ae841dc2944b9b99b0b32739f196e681aaa` (30 files, 1854 additions/6 deletions, including prior research commit). Review reports/card are excluded from source-diff hash.

Blast T4; no automatic merge. ADR-029 capability axes: authenticated enterprise REST/admin CLI; constrained existing browser capabilities; grant×subject×change×instance×session×document×target; verified normal autonomy/SSO continuation; branded immutable permits/live checks/single-use human proof; paired browser plus independent human audience. Ordinary grant/HITL/profile arrays unchanged.

## Machine evidence (exit 0 unless explicitly negative)

- Host Node22.23.2 canonical Companion `npm test`: 5894 tests, 5842 pass, 52 existing skips, 0 fail across canonical runner groups (4245/1629/20). Logs `/tmp/cmspark-itcra-companion-tests.log`. This broad regression preceded the final change_id field addition; subsequent **fresh exact-source** tsc + canonical five enterprise suites: 12/12 pass, build exit0. change_id is included in current session/challenge/audit/SDK and latest service test.
- Companion `npm run build` tsc + existing native assets exit0.
- Extension `npm test`: 1520/1520 pass, build exit0. After descriptor-budget guard addition: fresh tsc, enterprise test1/1 and fresh production `npm run build` exit0. Logs `/tmp/cmspark-itcra-front-{tests,build}.log`.
- Fresh Linux ARM64 image cmspark-office-val:node22.23.2; source-only copy, no host node_modules. Latest enterprise+grant+CLI+real WS outbound integration: 63/63 pass, tsc and build exit0. `/tmp/cmspark-itcra-arm64.log`. First build failed because rehearsal omitted root scripts/lib/brand-icon; corrected source-copy inventory, fresh container rerun passed. No product workaround.
- Joint acceptance validator3/3 pass: missing/skipped/fail/mock cannot pass a phase; receipt retrieval/hash verification/scalar whitelist; observed prompt/effect/real-SSO invariants required. No joint acceptance has passed.
- Fresh dedicated headless Chrome profile: actual renderer ISOLATED functions/native document IDs/CDP capture; target mutation, same-URL reload, credential field, coverage, owned-tab screenshot, same-origin login separation passed. `node scripts/itcra-browser-isolated-check.mjs` exit0. Extension API adapter is simulated; not installed-extension or real-enterprise SSO evidence. Images were not saved.
- SDK uv stdlib isolated HTTP: fixed-subject request cannot be overridden, real 403 JSON decoded to host error code; exit0. No private signing method/tool.
- git diff --check exit0. No live policy/grant issuance, installed application replacement, ITCra-source mutation or general profile expansion.

## External observations and limitations

Normal server pipeline emits no confirmation requests/tool.start parameter broadcasts under a valid permit. Raw JSON guard stripped; lookalike/cross-tool/mutated-argument/consumed permits rejected. Wrong grant/subject/profile/peer, revocation, policy change, malformed state, idempotency conflict, cancellation, ambiguous dispatch/restart and approval tamper/replay covered. Actual bridge→JSON recorded fixture is explicitly simulated and compared to its producer.

R1–R3 source endpoints available; real ITCra UI/RBAC/checkpoint signer and acceptance driver are ITCra-owned, absent in current adapter. Supplied project paths located deployments: Companion23401 health up, adapter23403 up, ITCra8080 service up. ITCra .env has business origins but **no login origins configured** (values not copied). User was asked for restricted site/SSO/instance configuration path. Existing installed0.6.13 does not establish new capability discovery. No real enterprise SSO/user isolation or offline-installed matching build claimed.

P0 joint required A1–A11,A13–A24 remain unmeasured. A12 P1 original workbook export is explicitly false/incomplete; phase=all must fail until implemented/verified. v1 main-frame redirect/same-origin markers supported; login iframe/popup explicitly unsupported. Text visible DOM incomplete; no full workbook claim. State bounded128 sessions/1024 operations; rejects rather than evicts live idempotency keys. Restart terminates pending; ambiguous dispatched actions never repeat. Cancellation after dispatch cannot undo effects. Review goal: code/contract safety and honest source delivery, **not release approval or joint acceptance**.

Actual current-deployment joint-runner preflight used existing restricted credential-file paths (contents not copied) and GET-only feature discovery. Expected exit1/report passed=false, prerequisites=failed, all23 required cases missing: `artifacts/itcra-browser-acceptance/2026-10-13-source-preflight.json`. No driver/action dispatch occurred. This is a negative gate demonstration and real deployment limitation, not a source regression or successful enterprise acceptance.

## Four-line regression case

1. A new WS test initially hand-built tool.result with top-level success/data.
2. Real handleToolResult consumes nested result; test failed with undefined result and did not validate its intended gate.
3. Implementer test-shape mistake; corrected against real producer/handler and added real bridge JSON fixture (no production change to accommodate test).
4. Protect actual transport contract; gate pass must reflect real payload shape, not an imagined success envelope.

Additional rehearsal mistakes: root-CWD npx selected an unrelated tsc shim (no source/package change); corrected to Companion local compiler. Missing source-copy build dependencies corrected above. Final positive results use correct Node22/local compiler/fresh container.

MACHINE: PASS for source/code gates. ADVERSARY/Pi/Kimi: pending. MERGE: NO — T4 human approval and real joint bake-off remain mandatory.
