# #825 verification report — local pre-CI checkpoint

Date: 2026-11-03. Issue #825, target 0.8.0. This checkpoint records local implementation evidence; Windows native CI, final-head CI, release dry-run and publishing remain required before delivery.

## Goal and success criteria

Stable Windows process discovery independently of window visibility; scoped current-chat title recognition and content-only crop; 3-second minimum checks without overlap; visible embedded image extraction; preserve drafts and existing authorization. No automatic activation, scrolling, attachment opening or live configuration changes.

## Scenario matrix

| ID | Model/scenario | Expected and actual local signal | Evidence | Cleanup |
|---|---|---|---|---|
| A1 | Visible/minimized/hidden/windowless process; 201/4096/4097 inputs | Separate process DTO, stable names/identities/states; strict limit and sensitive-name rejection. CPU contracts pass; actual Windows states pending native CI. | apps design + backend cross-review; activity-apps-825 tests | Owned temp dirs |
| A2 | 2999/3000ms and slow model at 3/6/9s | 3000 accepted, 2999 refused; no concurrent capture or backlog | activity-interval-825 | Fake clock, no live scheduler |
| B1 | Sidebar/body mentions an allowed conversation | Unmatched title ROI admits no source, content crop or model request | scope825 tests + scope cross-review | Every pending PNG removed |
| B2 | Matched frozen frame with sidebar and embedded image | Same-frame crops; only content pixels reach persistence/model; embedded image survives | scope cross-review; Windows native case pending | Owned PNGs |
| B3 | Bad/out-of-bounds/ambiguous profile, resize, missing title | Explicit refusal, no full-window fallback | scope825 validation/adapter cases | No model calls |
| B4 | Preview/OCR, language/ROI/app change, cancel/unmount, late responses | Read-only local RPC; stale UI replies ignored; bounded 90s/45s waits | UI independent report + wire tests | Browser harness local only |
| C1 | Sources update while user calibrates | Fresh state once, same config/target fingerprint; latest revision saves draft bytes | activity-config-draft-825 (6 actual UI/Service scenarios) | Owned service dirs |
| C2 | Config/auth changes, failed read, peer loss, double click, post-read write | No stale configuration, no automatic retry; original atomic conflict retained | UI C regression + 39 auth changes against actual resolver | Isolated config runner |
| I1 | Direct execution of config-writing vision test | Refuses before changing an explicit sentinel config | vision-test-isolation-825 | Child and sentinel dir removed |
| V1 | Real browser calibration component with owned dual-column fixture | Two rectangles, OCR, draft and explicit save exercised; DOM confirms exact pixel values | docs/assets/activity-chat-scope-calibration.jpg | Temporary local harness pending final teardown |

Prompt-injection strings in screenshots remain untrusted input with no executable tool capability; extraction retains literal transcript quotes and user confirmation. No test instructs production tools to execute such text. Generic account/automation-state attack scenarios are outside this feature's supported path.

## Commands and outcomes

- Node 22.23.4 companion/extension builds: exit 0.
- Extension `npm test`: 1874 PASS, 0 FAIL.
- Frontend targeted UI/RPC regression: 36 PASS, 0 FAIL.
- Network-disabled Linux ARM64 `node:22.23.4-bookworm-slim`, read-only source/deps mount, official isolated runner: 35 PASS, 2 Windows-native SKIP, 0 FAIL. This is scoped service/adapter behavior validation, not a Linux native-addon/package or Windows proof.
- Auth/process independent suite: 12 PASS, 2 Windows SKIP; 8 auth groups / 39 configuration changes checked against the real resolver.
- Historical compiler inverse and MCP atomic controls with `DEEPSEEK_API_KEY` unset: 15 PASS. The compiler historical pin is unchanged; only the authorized Apps-consumer delta is explicitly inverted.
- Full local macOS suite was stopped: native acceptance fixtures were not built / hosted tests require GHA; three old config equality checks also observe the host's runtime-inherited key versus an intentionally empty persisted key. These are not counted as passing. Full portable and native acceptance stays required on clean hosted CI.

## Observed failures and corrections

1. A direct run of the old vision test bypassed the existing isolated runner and wrote two live vision fields. Last unaffected extension-cache record was validated and used to restore only those fields; the remainder was semantically unchanged. Config values/credentials are not included in this report.
2. This was an agent execution mistake. A first-import isolation guard and a negative subprocess/sentinel test now prevent this specific direct-run path. All further companion checks use `scripts/run-tests.mjs`.
3. Host inherited-key output from a failed old equality test was removed from local logs. Raw host-test logs are not review/publishing inputs.
4. Initial UI fixtures still assumed synchronous submission. They now exercise the actual fresh-read and workspace forwarding path; the new independent six-scenario suite keeps stale/failed/late reads as failures rather than weakening write assertions.

## Independent and GLM gates

A/B/C design records each contain independent experiments and an actual GLM-5.3 / Claude Code 2.1.153 verdict. Non-author cross-reviews cover UI, scope backend and process/auth backend. Final complete source review is a separate required gate.

## Remaining release gates

- Actual Windows process state and dual-column capture/crop/OCR/independent-window cases.
- Exact final PR/main checks and three-platform release workflow.
- Publish v0.8.0, update published status, rebuild/install app and reload the actually loaded extension.

No skip, observation marker or local prototype substitutes for those gates. No five-client version-by-version field certification is claimed.
