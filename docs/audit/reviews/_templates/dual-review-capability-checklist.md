# Dual-review checklist — ADR-020 capability declaration

> 嵌入每次 dual-review prompt，或由 `scripts/dual-external-review.sh` 自动附带。  
> 规范源：[ADR-020](../../../adr/020-capability-model-three-axes.md) · 排期：[optimization-plan-post-adr-020.md](../../../optimization-plan-post-adr-020.md)

## Required from implementer (PR or prompt body)

```text
Surface:      L0 | L1 | L2 | n/a
L2-classes:   host_computer | host_read | host_write | host_app | shell | netsec | (none)
Compose:      skill | knowledge | mcp-server | pack | user-env | none
Autonomy:     single | multi-worker | board | n/a
Trust:        <gate>
Channel:      community | enterprise | n/a
```

If missing and the diff is not pure docs/test/refactor, treat as **nit** at minimum; if the change adds tools/gates/UI entry points, treat missing declaration as **blocking**.

## Reviewer checks

1. **Axes fit**: Does the change hang on the correct axis (Surface vs Composition vs Autonomy)?  
   - Do **not** call Skill/MCP/Pack a “中层 Agent” / middle agent runtime.
2. **Pack-first**: New scenario without Pack alternative + new primary Side Panel chrome → challenge or REJECT.
3. **Confirm dialects**: New confirmation family when existing L2 / domain / CU / enterprise gates suffice → challenge.
4. **Trust monotonicity**: Deeper Surface must not inherit looser L0 semantics; god-mode / auto_approve must not silently skip CU task L2 or shell/netsec forceConfirm (unless explicitly designed + tested).
5. **originWs**: New or changed `securityConfirmations.request` should bind `{ originWs: ws }` when a requesting socket exists (MCP/navigate historically weak — do not regress further).
6. **No new runtime**: Prefer tools + pack whitelist + skill over a second agent framework.
7. **Experimental layers**: TinyClick / model locators must not be success-critical on write paths without explicit experimental labeling + confirm.

## Security P1 watchlist (open as of 2026-07-29)

See [p1-security-open-items-2026-07-29.md](../../p1-security-open-items-2026-07-29.md):

| ID | Topic | If this PR touches… |
|----|--------|---------------------|
| P1-1 | god-mode step-up | `config.set` / `allow_all_schemes` / `auto_approve_*` |
| P1-2 | originWs | MCP confirm, navigate L2, any new `request(` |
| P1-3 | evaluate integrity | `browser-bridge` evaluate / sanitizer / token bind |
| P1-4 | shell structure | `capability/shell.ts`, shell policy, spawn |

## Eval Engineering (optional but T3+ recommended)

See [eval-gate-card.md](eval-gate-card.md) and skill `cmspark-eval-engineering-gate`:

1. Prefer **machine-checkable** claims over prose quality.  
2. Score **outcome + trajectory + component**, not length.  
3. **Blast radius** decides human-required vs dual-only — not model confidence.  
4. REJECT must block merge; APPROVE_WITH_NITS lists only non-blockers.

## Verdict reminder

End with exactly one of:

- `VERDICT: APPROVE`
- `VERDICT: APPROVE_WITH_NITS`
- `VERDICT: REJECT`
