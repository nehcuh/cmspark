# Nits closeout — thread-graph Obsidian v1.1

| Field | Value |
|-------|--------|
| Batch | `thread-graph-obsidian-v11-20260812` |
| Date | 2026-08-12 |
| Source | Multi-adversary + Claude/Pi dual-review residual nits |

## Closed checklist

| Nit | Source | Resolution |
|-----|--------|------------|
| Reseed on focus jump | Correctness R1 | `layoutSignature` + preserve x/y/pin (prior fix) |
| fitView max-tick | Correctness | settled \|\| exhausted (prior) |
| Pointer leave pin | Correctness | capture + endDrag (prior) |
| Screen-constant hit pad | Correctness | `HIT_PAD / scale` (prior) |
| Sticky pin after drag only | Spec | `drag.moved` (prior) |
| Panel pref stomped by click | UX | `persistPanelPref` only on toggle (prior) |
| Mini color legend when panel closed | UX | Always-on bottom-left mini legend |
| Empty-state extract CTA | UX/Spec §3.1 | Button → `thread.extract_digest` (max 20) |
| Toolbar wrap vs panel `top: 64` | UX/Claude N4 | `barRef` ResizeObserver → dynamic `chromeTop` |
| Canvas a11y | UX/Claude N5 | `role="img"`, tabIndex, arrows/Enter/Esc/0, live region |
| Deep-link focus panel closed | Pi | `focus_id` / `?focus=` opens panel transiently |
| Resize no re-fit | Claude N2 / Pi | re-fit if `!userCameraRef` |
| `hoverId` unused state | Pi | hover ref-only (no React state) |
| colorById mid-render write | Claude N3 | `useEffect` for color/thread/isolated refs |
| Tag chips mono primary color | UX | per-tag `colorForTag(tg)` |
| Expand full color groups | UX | 「展开全部 N 组」 |
| Hash collision note | UX | 同色可能不同标签 |
| Cap warning chip | Spec §7 | 「仅显示最近 300 会话」chip |
| Close control | Spec §3.1 | toolbar 「关闭」→ `window.close()` |
| Fit control | UX | 「适应」+ key `0` |
| Strength aria | UX | aria-label / valuetext / title |
| Status when panel closed | UX | floating status toast |
| Snapshot runtime slim | Security | `slimThreadGraphRow` + tests |
| Layout signature unit tests | Claude N1 | `layout-signature.ts` + 3 tests |
| Tiny viewport force pad | Correctness | pad ≤ width/4, height/4 |
| Spec §3 vs §6 debt | Spec/Pi | §3 rewritten to floating pure canvas; v1.1 landed |

## Machine

`chrome-extension` npm test: **632 pass** (prior 628 + layout-signature×3 + slimThread×1) `[executed]`

## Out of scope (still not done)

| Item | Why deferred |
|------|----------------|
| Full canvas integration / pointer e2e | Needs browser harness; pure helpers covered |
| Real-time graph refresh after extract | Snapshot pipeline; status tells user re-open |
| `host-integrity.ts` dirty tree | Unrelated; do not co-commit |

## Verdict

**NITS_CLOSEOUT: DONE** — residual dual-review nits folded or explicitly deferred with reason.
