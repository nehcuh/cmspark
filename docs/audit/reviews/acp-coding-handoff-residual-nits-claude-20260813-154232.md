I have completed my adversarial review of the residual-nits delta. Here is my report.

## Verification table

| Check | Status | Evidence |
|-------|--------|----------|
| N1: L2 preview mode+ws; apply preview allow_delete | PASS | `companion/src/tool/l2-admission.ts:319-327` — preview strings include `mode=… workspace=…` (propose) and `allow_delete=yes/no` (apply) |
| N2: Token binds mode+ws on propose; normalize before issue/validate | PASS | `companion/src/security-policy.ts:97-102` (bindingPayloadFor adds `mode=`/`ws=`); gate normalizes at `l2-admission.ts:205-225`, dispatch normalizes at `companion-dispatch.ts:252-269` before `validateTokenFor` |
| N3: cruise cannot skip ACP forceConfirm | PASS | `companion/src/tool/l2-admission.ts:69-91` (pure `isAcpL2ForceTool`+`resolveL2ForceConfirm`); 3 new tests in `companion/tests/l2-admission-pure.test.ts:83-133` pass |
| N4: Product SoT + ADR-020: gated apply GO; silent write/shell NO-GO | PASS | `docs/adr/025-acp-coding-agent-client.md:3,55-68`; product design §0/§6/§8 updated; ADR-020 Composition table line 66 adds ACP Coding Client row |
| N5: Mode badge on chip; disclosure checkbox gates start CTA | PASS | `CodingSessionChip.tsx:29-32,74-80` (modeBadge); `CodingTaskPackageModal.tsx:72,91,174-177,327-339` (checkbox + `disabled` gate + flash) |
| Lock 1: `acp.enabled` default false | PASS | `acp-handback-workspace.test.ts:77-95` sanitizes; ADR-025 L2 |
| Lock 2: propose/start/apply always L2; never cruise skip | PASS | `L2_GATE_TOOLS` includes all three; `resolveL2ForceConfirm` short-circuits `true` for ACP (`l2-admission.ts:87`) |
| Lock 3: workers HARD_DENY all `acp_*` | PASS | `handlers.ts:124-128` (ui_start refuses worker **before** enabled gate); `companion-dispatch.ts:248-251` (propose refuses worker) |
| Lock 4: apply workspace containment; no free shell; no silent write | PASS | `handlers.ts:221-258` (L2 confirm + `applyPendingDiffs`); catalog:1294 "Never free shell" |
| Lock 5 (C5): user modes 审查/起草, not OS sandbox 只读 | PASS | `copy.ts:26-30` modeFootnote disclaims OS sandbox; grep of `chrome-extension/src` + ADR/decision/user-guide dirs finds **no** user-facing 「只读审查」 (only archival patch files under `docs/audit/reviews/`) |
| Lock 6: FocusBand keeps closed chip when applyable | PASS | `FocusBand.tsx:96-101` `hasCodingSession` includes `"closed"`; `CodingSessionChip.tsx:19-27` does not auto-dismiss while `hasPendingDiff` |
| Lock 7: disclosure checkbox gates start CTA | PASS | Modal disables start when unchecked + flashes; L2 confirm text at `handlers.ts:190` adds cloud note |
| Capability declaration present and matches diff | PASS | Surface L0/L1, L2 forceConfirm for all acp_*, compose coding_handoff, single-thread + worker HARD_DENY, originWs confirm, community default-off |
| originWs on ACP confirms | PASS | `companion/src/ws/lifecycle.ts:1208-1217` wires `requestConfirmation` with `{ originWs: ws }` (P1-2 honored) |
| Test suite green | PASS | 22/22 (`l2-admission-pure` + `acp-handback-workspace` + `acp-handlers-gates`) |

## Blockers

None. Every claimed nit is actually fixed, every product lock still holds, and ACP force-confirm survives three-flag cruise.

## Nits (non-blocking)

1. **Token-binding resolver asymmetry (fail-closed).** L2 gate resolves thread via `actingThreadId || __thread_id || _thread_id` (`l2-admission.ts:206-212`); dispatch resolves via `params.__thread_id || params._thread_id` only (`companion-dispatch.ts:239`). If they ever diverge the token mismatch rejects closed — safe direction, but a single shared resolver would be cleaner.

2. **`workspace_root` precedence.** Both gate and dispatch prefer `thread.workspace_root` over the LLM-supplied `params.workspace_root`. Correct (thread anchor wins), but the catalog still lists `workspace_root` as "Optional workspace override" — the word "override" overpromises vs actual behavior.

3. **`cloud_disclosure_accepted` is sent but not enforced server-side.** Modal sends `cloud_disclosure_accepted: true` (`CodingTaskPackageModal.tsx:187`), but `handleAcpWsMessage` doesn't check it. The L2 confirm text at `handlers.ts:190` carries the disclosure, so Confirm Center approval is the real disclosure moment — but a non-UI caller could skip the flag. Server-side belt would be cheap.

4. **ACP handback taint list omits `acp_apply_diff`** (`l2-admission.ts:803-811`). Harmless because apply is always `forceConfirm`, but the asymmetry is mildly surprising.

5. **Disclosure resets on modal open (`CodingTaskPackageModal.tsx:91`)** but not after a successful `acp.ui_start` dispatch — moot since the modal closes, but worth noting if the modal ever stays open.

6. **`resolveL2ForceConfirm` test does not exercise `hostComputerGated=true` with ACP** — covered implicitly by the ACP short-circuit, but an explicit `hostComputerGated=true, userFullAutonomy=true, toolName=acp_*` row would document the invariant.

VERDICT: APPROVE_WITH_NITS
