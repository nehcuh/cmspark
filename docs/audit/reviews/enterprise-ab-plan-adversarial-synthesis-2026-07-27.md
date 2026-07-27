# Enterprise A+B Plan — Multi-agent Adversarial Synthesis

| Field | Value |
|-------|--------|
| Date | 2026-07-27 |
| Plan | `docs/decisions/v1.3/enterprise-session-trust-godmode-plan-2026-07-27.md` |
| Agents | Security (REJECT) · Product/UX (APPROVE_WITH_NITS) · Architecture (AMEND-REQUIRED) |
| Dual CLI | Claude CLI not on PATH; WSL distro unavailable for `dual-external-review.sh` — Pi invoked separately |

---

## Consensus blocking amends (must land in plan before Phase 1)

| ID | Source | Amend |
|----|--------|--------|
| **G1 Gate algebra** | Sec B1 · Arch B1 | `enterpriseSkip` is sibling of `hostComputerTrustSkip`: `mustInteract = (!skipConfirmation \|\| forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip`. **Never** only clear `forceConfirm` while leaving outer `!skipConfirmation` true. |
| **G2 Scope before skip** | Sec B5 · Arch B2 | Pure shared `checkNetsecScope` / `checkShellScope` **before** any skip; out-of-scope → hard deny, **no** `enterprise_auto_approved` audit. |
| **G3 Family-scoped grant** | Sec B2 · UX B1 · Arch B4 | v1 grant **only** the tool family being approved (netsec ≠ shell). 「同类」= same family. |
| **G4 Idle pure-read** | Sec B3 · Arch B5 | No `touch()` on auto-approve path; idle 30m + hard 8h from **last interactive** grant (mirror computer session-trust). |
| **G5 Grant anti-injection** | Sec B4 · Arch B3 | `enterpriseSessionTrustOffered` on pending; honor extras only for shell/netsec + offered + approved; tray `respond()` never grants A. |
| **G6 MinimalConfirm arm path** | UX B0 | A checkbox + payload on **MinimalConfirm** (primary path), not only ConfirmElevated. |
| **G7 Settings truth matrix** | UX B2 · Sec B6 | Fix overclaiming copy on `auto_approve_dangerous` / God-mode; B with red badge; forbid Pack key for B. |
| **G8 Revoke / status UX** | UX B3 · Arch B7 | Operator-visible chip + revoke (not PacksPanel-only); config flatten in message-router + types. |
| **G9 Tests** | All | Add T11–T20 (family isolation, inject, tray, fingerprint, allow_all_schemes alone, pack forbid, etc.). |

## Q1–Q5 synthesis

| ID | Final LOCK |
|----|------------|
| Q1 | Idle 30m + hard 8h; idle from **interactive** grant only |
| Q2 | **Per-family only** (AMEND from dual-family) |
| Q3 | B does **not** skip MCP critical |
| Q4 | Bulk multi-target dialog OOS |
| Q5 | shell `confirm_session` policy does **not** auto-enable A |

## Internal multi-agent scorecard

| Agent | Verdict | Role |
|-------|---------|------|
| Security | **REJECT** | Privilege / gate / forgery |
| Product UX | **APPROVE_WITH_NITS** (hard amends B0–B4) | Pentest path discoverability |
| Architecture | **AMEND-REQUIRED** | Gate rewrite, phases, file map |

**Phase 0 gate:** fold G1–G9 into plan → Pi re-review → only then implement.

---

*Artifacts: subagent transcripts in session; plan revision follows.*
