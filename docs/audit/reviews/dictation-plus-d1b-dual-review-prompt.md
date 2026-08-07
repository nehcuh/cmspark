# Dual external review — Dictation+ D1b ASR Refiner

**Batch**: `dictation-plus-d1b`  
**Branch**: `feat/dictation-plus-d1b`  
**Blast tier**: **T2** (pre-send transcript → user LLM residual)  
**Machine**:
- chrome-extension voice tests pass (549 suite / new reducer tests)
- companion `voice-asr-refiner.test.js` **13/13 pass**

## Capability declaration (ADR-020)

```text
Surface:      L0
L2-classes:   (none)
Compose:      none (Pack strip extended for asr_refiner*)
Autonomy:     n/a
Trust:        mic + STT residual + optional transcript→LLM (ack v3);
              fixed system prompt; no auto-send; no tools from voice
Channel:      community
```

## What shipped

### Companion
- `asr-refiner.ts`: SoT §7.4 constant prompt; `guardAsrRefineOutput` (length/URL/toolish/secretish); `runAsrRefine` via `llmExtract` temp≤0.2
- `refine-handlers.ts`: `voice.refine.request|abort`; chrome-extension origin fence; ignores client systemPrompt; in-flight AbortController
- `server.ts` validators; `message-router` cases
- Pack `VOICE_FORBIDDEN_KEY_RE` extended

### Extension
- Pref `asrRefinerEnabled` default false; settings checkbox + model disclosure
- Pipeline: stop → **raw-first** onDraft → START_REFINE → WS → REFINE_OK/FAIL
- Dirty draft ownership; stale refineGen; cancel/abort; **还原识别原文**
- v3 required when refine enabled (browser or local)

### Out of scope
- D1c local segments · D2 hotkey · Meeting · 书面化 mode · incremental refine

## Floors to verify

1. Default off; no auto-send  
2. Prompt immutable (server constant; client prompt ignored)  
3. Fail-open to raw on any error/guard  
4. Origin fence tray denied  
5. character-identical path unit-tested  
6. Pack strip covers new keys  

## Reviewer instructions

1. Diff vs `main` merge-base.  
2. Spec compliance to Dictation+ SoT §7 + ADR-024.  
3. End with:

`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
