# Pi re-review R2: Voice Input M1 — blocking fixes

**Batch:** `voice-input-m1-r2`  
**Prior:** R1 **REJECT** (`voice-input-m1-pi-20260806-200603.md`)

## R1 blocking claims — verify fixed

### B1 — error banner clobbered by ENGINE_END

**Claimed fix:** `session-reducer.ts` ENGINE_END preserves `phase==="error"` banner; non-no-speech errorCode path preserves mapSpeechError message.  
**Tests:** `not-allowed → error banner survives ENGINE_END`, `network error → end keeps network banner`.

**Verify by reading + running:**
```bash
cd chrome-extension && npx tsx --test tests/voice-session-reducer.test.ts
```

Simulate: START → ENGINE_ERROR(network|not-allowed) → ENGINE_END → banner must match §6.6, not 「未识别到内容」.

### B2 — bootstrap only on denied, not prompt

**Claimed fix:** `useVoiceInput.ts` — if permission is not `granted`, open bootstrap tab; only `granted` calls `begin()`. `denied` also dispatches not-allowed error.

**Verify:** read `useVoiceInput.ts` toggle permission branch against SoT §7.1.

## Also fixed as nits (optional check)

- `USER_TOGGLE_STOP` while `stopping` forces idle  
- Send disabled while `voice.listening`  
- Dead `draftTextAfterEnd` removed  

## Scope

Do **not** re-litigate design SoT. REJECT only if B1/B2 still broken or new ship-blocker.

End with exactly:
VERDICT: APPROVE  
or VERDICT: APPROVE_WITH_NITS  
or VERDICT: REJECT  
