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

## Judges（确认序：独立对抗 → Pi 复审）

- [ ] **独立对抗 agent** 报告：`docs/audit/reviews/<batch>-adversary-*.md` · VERDICT  
- [ ] **Pi 复审**（读对抗报告 + diff + 机核）：`…-pi-rereview-*.md` · VERDICT  
- [ ] Nits folded or owned  
- [ ] （可选）`scripts/dual-external-review.sh`  

## Blast

- [ ] Tier allows this merge path  
- [ ] Residual risks:  

## Verdict

| Gate | Result |
|------|--------|
| MACHINE | PASS \| FAIL |
| ADVERSARY | APPROVE \| APPROVE_WITH_NITS \| REJECT \| N/A |
| PI_REREVIEW | APPROVE \| APPROVE_WITH_NITS \| REJECT \| N/A |
| MERGE | YES \| NO — reason（须 MACHINE + 对抗 + Pi 均过） |
