# Dual/Pi external review: PR-G3 — FocusBand floating + tool cards

**Batch:** `uiux-v2-PR-G3`  
**Stage:** Implementation review (visual only; FocusBand priority machine must be unchanged)  
**Date:** 2026-07-31  
**Branch:** `feat/uiux-v2-shell`

## Capability declaration

```text
Surface:      n/a (presentation of existing FocusBand / tool cards)
L2-classes:   (none new)
Compose:      none
Autonomy:     n/a
Trust:        soft confirm must NOT bury 急停; notice-rate on shell/netsec/host_computer
Channel:      n/a
```

## Spec

Primary: `docs/superpowers/specs/2026-07-31-gemini-inspired-visual-comparison.md` §5 FocusBand + Tool cards, §8 PR-G3

### PR-G3 must deliver

1. **FocusBand floating card** — inset 8–10px horizontal, `border-radius: 16`, `shadowMd`; not full-bleed warning bar  
2. **Confirm soft surface** — `tokens.dangerSurface` / soft tint, **not** solid red bar; actions high-contrast  
3. **Tool card hairline** — white elevated, **2px left accent** (status color), no heavy full-border cage  
4. **Safety watch** — 急停 still visible when L2+confirm; priority table unchanged; ≤80px hard cap preserved  

### Must NOT change

- `resolveFocusBandSlot` priority (Confirm > L2+急停 > Fleet > L1)  
- ADR-020 IA / 装配 / Board  
- Non-compact MinimalConfirm (Cockpit / chat embedded dark confirm) logic  

## Files in scope (expect)

- `chrome-extension/src/sidepanel/components/FocusBand.tsx`
- `chrome-extension/src/sidepanel/components/MinimalConfirm.tsx` (compact path only)
- `chrome-extension/src/sidepanel/components/ChatView.tsx` (toolCard style)
- `tokens.dangerSurface` already in SoT from G1 — do not invent a second danger soft token

## Rejection gates (any fail → REJECT)

| Gate | Fail if |
|------|---------|
| Full-bleed solid danger bar remains for FocusBand confirm | solid `darkDangerBg` gradient as outer band |
| 急停 buried when L2 task active + confirm | secondaryAbort path removed or hidden |
| Priority machine rewritten | `focus-band-priority.ts` logic changes |
| Tool status only color-on-full-border cage | `borderColor: statusTone` on all four sides without left hairline |
| Soft confirm = low-contrast text-only danger | actions not clearly tappable / contrast lost |

## Your job

Read the working tree diff for the three components above. Verify against gates. Comment on:

1. Floating card geometry vs 80px budget  
2. Compact MinimalConfirm on light soft surface (button contrast)  
3. Tool card left hairline + status override  
4. Nits only if non-blocking  

## Output format

```markdown
## Summary
## Spec trace (G3)
## Safety / 急停
## Tool cards
## Blocking
## Nits
VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT
```
