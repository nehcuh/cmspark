# Eval gate card — `<batch-id>`

> 模板来源：`.claude/skills/cmspark-eval-engineering-gate/SKILL.md`  
> 填完后附在 dual-review prompt 或 PR body。

**Blast tier**: T0 | T1 | T2 | T3 | T4  
**Date**:  
**Base**:  

## Capability declaration (ADR-020)

```text
Surface:      
L2-classes:   
Compose:      
Autonomy:     
Trust:        
Channel:      
```

## Machine (must pass first — paste commands + exit codes)

- [ ]  
- [ ] Outcome DoD (external observables only):  
- [ ] No forbidden tools/paths / no default-on surprise  

## Trajectory

- [ ] Diff scope matches claim  
- [ ] No thrash / duplicate tool spam / unrelated drive-by  

## Component

- Suspected hotspots (file:line):  

## Judges

- [ ] Internal adversary (T3+): path / verdict  
- [ ] `scripts/dual-external-review.sh` → both APPROVE*  
- [ ] Nits folded or owned  

## Blast

- [ ] Tier allows this merge path  
- [ ] Residual risks:  

## Verdict

| Gate | Result |
|------|--------|
| MACHINE | PASS \| FAIL |
| DUAL | APPROVE \| APPROVE_WITH_NITS \| REJECT \| N/A |
| MERGE | YES \| NO — reason |
