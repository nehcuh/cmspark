# Dual external review — voice draft flash + custom hotkey

**Batch**: `voice-draft-hotkey-fix`  
**PR**: https://github.com/nehcuh/cmspark/pull/147  
**Base**: main 36d5168  

## Bug
Continuous local STT: after first finals, phase=`processing` dropped liveOverlay → composer fell back to stale `text` → flash disappear; session looked stuck.

## Fix
1. `voiceLiveComposerText` includes `processing`
2. Flush `onDraft` on each ENGINE_RESULT finalChunk
3. Composer disabled only while mic open (`listening && !processing`)
4. Hotkey chord free-text + datalist presets

## Floors
- No auto-send change
- Pack/hotkey fences unchanged
- Unit tests for live text during processing

End with VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT
