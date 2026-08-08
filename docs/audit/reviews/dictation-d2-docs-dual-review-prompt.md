# Dual external review — Dictation D2 hold + docs

**Batch**: `dictation-d2-docs`  
**PR**: https://github.com/nehcuh/cmspark/pull/146  
**Branch**: `feat/dictation-d2-hold-and-docs`  
**Base**: `origin/main` (e6d659f)  
**Blast tier**: **T2** (mic control plane + prefs; no new audio path)

## Capability (ADR-020)

```text
Surface:      L0 composer draft only
Compose:      Pack strip extended for hotkey* keys
Autonomy:     n/a
Trust:        hold reuses continuous privacy v3 gates; no Pack auto hotkey
Channel:      community
```

## Shipped

### D2 hold
- Prefs default off; preset chords; ban bare fn / Meta+V
- Side Panel capture keydown/keyup → holdStart (force continuous) / holdStop
- meetingCaptureActive blocks; hold_state → companion origin fence + system notify 「CMspark · 草稿」
- Pack strip includes hotkey keys

### Docs
- meeting-and-dictation-user-guide.md + 真机清单
- GOAL G22, README ADR-024, mission-pack link
- Mtg3 enhancement parking note

### Honest limits
- Hold requires Side Panel open and focused for key capture (not OS-global Accessibility tray register yet)
- System audio still parking

## Floors
1. Default hotkey off  
2. No fn / Win+V as allowed default chord  
3. No auto-send  
4. Origin fence on hold_state  
5. Pack cannot set hotkey  
6. Meeting xor dictation  

End with: `VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
