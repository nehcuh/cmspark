---
target: chrome-extension/src/sidepanel
total_score: 27.5
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 4
timestamp: 2026-08-11T08-18-24Z
slug: chrome-extension-src-sidepanel
---
# Critique — chrome-extension/src/sidepanel

Method: dual-agent (A: design director · B: detector/integrity)
Mode: Operate · Target: Side Panel ~320px

## Design Health Score (Nielsen)

| # | Heuristic | Score | Key Issue |
|---|-----------|------:|-----------|
| 1 | Visibility of System Status | 3 | Mode/conn strong; multi-strip redundancy |
| 2 | Match System / Real World | 2 | 装配 / Surface / intent / cruise jargon |
| 3 | User Control and Freedom | 3.5 | pin, abort, stop, Escape-deny |
| 4 | Consistency and Standards | 2.5 | DESIGN↔tokens drift; EN/ZH mix |
| 5 | Error Prevention | 3 | L2 send gate, confirm, typed arm |
| 6 | Recognition Rather Than Recall | 2.5 | chips/slash good; deep settings recall |
| 7 | Flexibility and Efficiency | 3.5 | slash, Cmd+K, pin, mode chips |
| 8 | Aesthetic and Minimalist Design | 2.5 | quiet tokens; status stack density |
| 9 | Error Recovery | 3 | banners, disconnect, tool expand |
| 10 | Help and Documentation | 2 | thin first-run teaching |
| **Total** | | **27.5/40** | **Good (weak: clarity & minimalism)** |

## Design Specificity
Strong product ontology (L0/L1/L2, FocusBand, 确认台) with moderate generic "premium AI" skin residue. Specificity ~7.5/10.

## Detector (parent CLI + Assessment B)
CLI: 4 warnings (side-tab×2, layout-transition×2). Product verification: all false positives (blockquote, status stripe, progress bars). Integrity score 2/4 from hex residual + DESIGN drift + a11y gaps.

## Priority Issues
P0 DESIGN.md vs tokens.ts palette drift
P0 Vertical status stack vs density budget
P1 textMuted contrast ~2.4:1 fails WCAG AA
P1 Jargon / bilingual IA
P1 Settings cognitive cliff
P1 Secondary panel hex residual
P2 Stale discoverability copy; type scale leakage; title-only icon a11y
P3 Emoji residual in chrome toasts

## Cognitive load
4/8 checklist failures under multi-agent load
