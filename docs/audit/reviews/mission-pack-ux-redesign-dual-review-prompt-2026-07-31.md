# Dual external review: Mission Pack UX redesign (product)

**Batch:** `mission-pack-ux-redesign`  
**Stage:** Product / UX design SoT only（no implementation required for approve）  
**Date:** 2026-07-31  

## Capability declaration

```text
Surface:      n/a (UX of composition surface; no new L2 tools)
L2-classes:   (none)
Compose:      pack unapply + IA/copy; Pack remains composition
Autonomy:     n/a
Trust:        must not weaken L2 / enterprise channel; god-mode ≠ whitelist
Channel:      community | enterprise unchanged
```

## Documents

1. **Primary:** `docs/superpowers/specs/2026-07-31-mission-pack-ux-redesign.md`（全文）  
2. **Baseline ADR:** `docs/adr/014-mission-pack-enterprise-modules.md`（§1–5）  
3. **Ontology:** `docs/adr/020-capability-model-three-axes.md`（§1–3 如需）  
4. **Current UI:** `chrome-extension/src/sidepanel/components/PacksPanel.tsx`（skim）  
5. **Incident context:** thread `r21pj2` — skill install + mistaken `pack.apply` AppSec → `tool_not_allowed`

## Context

- CMspark Mission Pack engine is shipped; UI dumps modules + workspace + NetSec + pack apply in one panel.  
- End users confuse NetSec checkboxes with AppSec pack; no unapply; whitelist errors are developer jargon and non_recoverable.  
- God-mode does not bypass thread tool_whitelist (by design).  
- Author proposes product redesign: status-first IA, unapply, confirm-on-apply, recoverable errors, skill-install path diversion — **without** reopening ADR-014 security model.

## Your job

Independent senior **product + security UX** review. Use Read tools on the primary doc.

Check:

1. User-job fit (esp. skill install vs AppSec)  
2. Adversarial completeness (confused user / security officer / agent abuse)  
3. ADR-014/020 integrity  
4. P0 scope realism  
5. Naming / residual confusion risk  
6. Missing flows (clear workspace, multi-pack, enterprise)  

## Output format

```markdown
## Summary
## User-job fit
## Security / ADR fit
## IA & naming
## P0 plan
## Blocking
## Nits
VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT
```
