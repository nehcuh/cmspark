All checks executed. Here is my adversarial review.

## Verification table

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| Tests | `npx tsx --test tests/acp-*.test.ts tests/l2-admission-pure.test.ts` | ✅ pass (22+10, 0 fail) | run output |
| N1 | L2 preview shows mode+workspace; apply shows allow_delete | ✅ | `l2-admission.ts:322,329` (`mode=`/`workspace=`/`allow_delete=yes|no`); `handlers.ts:236` (`allow_delete=` in apply confirm) |
| N2 | Token binds mode+workspace on propose; L2+dispatch normalize before issue/validate | ✅ | `security-policy.ts:111-118` (`mode=…\|ws=…`); `l2-admission.ts:203-215`; `companion-dispatch.ts:255-265` (same thread-first precedence in both) |
| N3 | Unit: cruise cannot skip ACP forceConfirm | ✅ | `l2-admission-pure.test.ts` — `resolveL2ForceConfirm` stays true under `userFullAutonomy`; `l2-admission.ts:75-82` |
| N4 | Product SoT + ADR-020: gated apply GO; silent write/shell still NO-GO | ✅ | product-design §0/§6/§8 + ADR-025 §6 (S72), ADR-020 Composition row |
| N5 | Mode badge on chip; disclosure checkbox gates start CTA | ✅ | `CodingSessionChip.tsx:29-32,74`; `CodingTaskPackageModal.tsx:339` (`disabled` includes `!cloudDisclosure`) + re-check at :174 |
| Lock 1 | `acp.enabled` default false | ✅ | `config.ts:446-452` + `sanitizeAcpConfig` fallback :607-614 |
| Lock 2 | acp_* always L2, never cruise/god skip | ✅ | `isAcpL2ForceTool` + `resolveL2ForceConfirm`; `L2_GATE_TOOLS`; `familyOfTool("acp_*")` → null (no enterpriseSkip) |
| Lock 3 | Workers HARD_DENY acp_*; UI start refuses worker | ✅ | `orchestrator/constants.ts:16-31` (`WORKER_HARD_DENY` incl. all 7 acp_*); dispatch :248-251; `handlers.ts:189-192` (worker check before enabled gate) |
| Lock 4 | Apply containment; no free shell; no silent write | ✅ | `diff-apply.ts:173-196` (`realpathSync` root, `path_escape`/`outside_workspace` skip, delete gated by `allowDelete`) |
| Lock 5 | C5: 审查/起草, no OS sandbox 只读 claim | ✅ | no 「只读审查」 in src; catalog: "Mode is task intent, not OS sandbox"; copy.ts:26 comment |
| Lock 6 | FocusBand keeps closed chip when applyable/follow-up needed | ✅ | `FocusBand.tsx:96-100` (`hasCodingSession` includes `closed`); chip auto-dismiss skipped when `hasPendingDiff`, 追问/应用 diff CTAs stay reachable |
| Lock 7 | Cloud disclosure: UI checkbox + L2 confirm text | ✅ | modal checkbox + `handlers.ts:189` (`注意: 代码/页面摘要可能发送到该 Agent 的云模型`) |
| ADR-020 originWs | New confirms bound | ✅ | `ws/lifecycle.ts:1208-1218` (`{ originWs: ws }`); L2 gate `confirmOriginOpts` :1127 |
| ADR-020 no "中层 Agent" | Pack-first, no new runtime claim | ✅ | pack.yaml "Composition，不是中层 Agent / 第二 runtime"; ADR-020 table "Composition 门面，非 Side Panel IDE" |

## Nits (non-blocking)

1. `CodingTaskPackageModal.tsx:191` sends `cloud_disclosure_accepted: true`, but `handleAcpWsMessage` (acp.ui_start) never reads it. Not a hole — the real gate is the origin-bound L2 confirm dialog whose text carries the disclosure note, and a direct WS peer still hits that dialog — but the flag is purely cosmetic/untrusted and could be dropped or actually asserted.
2. No test asserts the WS confirm `code` strings themselves (mode label / `allow_delete=yes|no` / cloud note in `handlers.ts`). The pure binding payloads are tested; the human-facing strings are verified only by inspection.

No product lock is broken; all five claimed nits are genuinely fixed; tests pass; fail-closed behavior holds on every ACP path.

VERDICT: APPROVE_WITH_NITS
