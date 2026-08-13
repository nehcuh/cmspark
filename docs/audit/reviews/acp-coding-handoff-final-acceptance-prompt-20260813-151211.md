# Dual-review: ACP coding-handoff final acceptance (feat/coding-handoff)

You are an independent product+security reviewer for CMspark PR coding-handoff.

## Scope (worktree)
Read key paths under companion/src/acp/, chrome-extension coding-handoff UI, docs/adr/025, docs/coding-handoff-user-guide.md, pack coding-handoff.

## Locks
- acp.enabled default false
- L2 never cruise-skip for start/apply
- workers HARD_DENY acp_*
- apply workspace containment
- C5: 审查/起草 not OS sandbox 只读
- FocusBand keeps closed chip for apply CTA
- no free shell / silent write

## Output format (machine)
```json
{"verdict":"APPROVE|APPROVE_WITH_NITS|REJECT","blockers":[],"nits":[],"evidence":[]}
```
Plus short prose. Be adversarial.
