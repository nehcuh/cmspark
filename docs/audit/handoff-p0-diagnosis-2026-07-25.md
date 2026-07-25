# Handoff — Deep Diagnosis + P0 Batches (2026-07-25)

> Resume from here next session. Session ended mid P0-D (Design phase).

## Branch / commits (local only — not pushed)

Current branch: **`fix/diagnosis-P0-D`** @ `c2784ed`

| Commit | Branch tip also | Scope |
|--------|-----------------|--------|
| `360de94` | `fix/diagnosis-P0-A` | P0-A security: selector inject, config fanout auth, confirmation fields |
| `29db352` | `fix/diagnosis-P0-B` | P0-B lifecycle: Stop→computer abort, stream thread_id, orphan tools |
| `c2784ed` | `fix/diagnosis-P0-C`, **HEAD of P0-D** | P0-C computer: session-trust carve-out + Darwin client→screen |

Stack: `main…fd00f94` ← P0-A ← P0-B ← P0-C (= current HEAD).  
**None of these have been pushed.**

## Diagnosis baseline

| Item | Path / value |
|------|----------------|
| Fanout report | `docs/audit/diagnosis-fanout-2026-07-25.md` |
| Summary JSON | `docs/audit/diagnosis-fanout-2026-07-25-summary.json` |
| Root copy | `audit-report-cmspark-2026-07-25.md` |
| Workflow | `.grok/workflows/deep-diagnosis-fanout.rhai` |
| Overall score | **5.8 / C+** (was 4.4/C on 2026-07-09) |
| Critical open | **0** (C1–C4 fixed_verify) |
| Confirmed High | **16** at audit time |

## Process (locked for this effort)

```
Design → Implement → Internal adversarial (2 skeptics, fail-closed)
  → ONLY IF pass: SEPARATE Claude Code + SEPARATE Pi
  → both APPROVE|APPROVE_WITH_NITS → VerifyBuild → commit
```

- Workflow: `.grok/workflows/p0-batch-fix.rhai`
- Dual review script: `scripts/dual-external-review.sh`
- Artifacts: `docs/audit/reviews/P0-*-*.md|json|patch`
- Claude flags: prefer `--permission-mode acceptEdits` (plan mode swallowed VERDICT lines)
- Pi can hang with empty stdout; user authorized **waive Pi** and proceed with Claude + adversarial + host tests

## Batch status

### P0-A — DONE & committed `360de94`

- SEC-1: `selectorJsLiteral` / JSON.stringify on getPageHTML, waitForSelector, getElementCenter
- SRV-1: `config.updated` via `broadcastToClients` + `redactConfigForBroadcast`
- XC-Integration-1: confirmation forwards nonce_response / add_to_thread_whitelist / stop_thread
- Dual: Claude APPROVE_WITH_NITS + Pi APPROVE (`P0-A-verdict-20260725-130727.json`)
- Tests: ext 14/14 + companion 8/8 P0-A targeted

### P0-B — DONE & committed `29db352`

- chat.abort → silent `flipAllComputerTaskAborts()`
- useWebSocket thread_id gate + streamingRef clear
- adapter: AbortError inter-tool, shouldStop deleteMessagesFrom no chat.done, rebuild skip orphans
- Dual: Claude APPROVE_WITH_NITS + Pi APPROVE (`P0-B-verdict-20260725-133741.json`)
- Tests: stream-thread-gate 5/5 + companion 24/24 P0-B targeted

### P0-C — DONE & committed `c2784ed`

- reL2: never auto-approve `computer.danger_detected` / `computer.experimental_suggestion` under session trust
- Darwin cuInject client→screen (CGWindow + AX origin); host-skylight lockstep staged
- Dual: Claude APPROVE_WITH_NITS; Pi late-finished also APPROVE_WITH_NITS (`P0-C-verdict-20260725-140515.json`); interim `P0-C-verdict-waive-pi.json` kept for history
- Tests: computer-executor **96/96**
- Residual nits (non-blocking): FORCE_INTERACTIVE set hoist; scroll/drag still no client→screen; docstring tidy

### P0-D — IN PROGRESS (resume here)

- Branch: `fix/diagnosis-P0-D` @ `c2784ed` (no P0-D code commit yet)
- Workflow display: **`p0-batch-fix-4`** — was in **Design** when session ended
- Scope (from diagnosis):
  1. `package.sh` / Makefile / release: hard-require `build:host` + `cmspark-host`/`cmspark-tray` or fail
  2. Stage TinyClick/ORT + host-scripts-win **or** explicit feature-cut notes in release body
  3. Fix `release.yml` body if it still claims WS auth deferred
- Next actions:
  1. Check `/workflows` — if `p0-batch-fix-4` still active, resume or re-launch with `args.batch=P0-D`
  2. Optionally stop zombie **`p0-batch-fix-3`** (P0-C ExternalReview/VerifyBuild leftover; code already committed)
  3. After dual APPROVE: commit on `fix/diagnosis-P0-D`, then consider PR stack A→B→C→D → main

## Unrelated dirty tree (do not mix into P0 commits)

```
?? companion/src/host-use/darwin/build-host-skylight.sh
?? companion/src/host-use/darwin/host-skylight-*.entitlements
?? docs/decisions/capability-token-*
?? docs/decisions/v1.3/
?? .omx/
```

## How to re-launch a batch

```text
workflow: .grok/workflows/p0-batch-fix.rhai
args: { "batch": "P0-D", "max_rounds": 3, "base_commit": "HEAD" }
agent_budget: 40
```

Or: `bash scripts/dual-external-review.sh P0-D /tmp/review.md HEAD` after manual implement+adversarial.

## Resume checklist

- [ ] Confirm HEAD is `c2784ed` on `fix/diagnosis-P0-D`
- [ ] Finish or re-run P0-D (package/release gates)
- [ ] Commit P0-D after adversarial + Claude (+ Pi if healthy)
- [ ] Optionally push stack / open PRs (user must approve push)
- [ ] P1 from diagnosis still open (originWs, god-mode step-up, skill craft allowlist, ADR-014 computer, …)
