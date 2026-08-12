# Dual external review — Meeting STT macOS hotfix absorb + live AI refine / smart segment

**Batch**: `meeting-stt-hotfix-refine`  
**Scope**: Uncommitted work on `main` after #177/#178 merge (field-ops hotfixes + adversary F-merge-1..6 absorb + meeting AI correct_only + smart segment)  
**Blast tier**: **T2** (local STT binary/path trust + optional transcript→LLM residual; no new tools)  
**Prior adversary**: `docs/audit/reviews/meeting-stt-macos-hotfix-adversary-synthesis-20260812.md` (was REJECT; claim is now absorbed)

## Capability declaration (ADR-020)

```text
Surface:      L0 (mic → local STT; optional text-only LLM refine)
L2-classes:   (none)
Compose:      none — Pack strip already covers asr_refiner*; no Pack keys for meeting soft-continue
Autonomy:     n/a
Trust:        voice_privacy_ack_v2 + meeting_privacy_ack_v1 (dual gate on start);
              install.manifest.json for user-cache whisper; pinned package binary;
              asr_refiner correct_only (ADR-024); no auto-send; no edge-listen continuous LLM
Channel:      community
```

## Machine checks (implementer — re-verify if stale)

```text
chrome-extension: npm test → 643 pass (incl. meeting-live-refine 6/6)
companion: voice-asr-refiner + voice-stt-session-service (tsconfig.test) → 31/31 pass
chrome-extension build: plasmo OK
companion: tsc + bundle:exe OK
```

## What shipped (must verify against diff, not prose)

### A. Adversary absorb (F-merge-1..6)

| ID | Claimed absorb |
|----|----------------|
| F-merge-1 pin bypass | User-cache path accepted only if `install.manifest.json` digests match; no bare pin skip |
| F-merge-2 soft-continue | Soft only: infer_failed / empty_result / infer_timeout / binary_broken / partial_skipped; streak≤3; conflict/busy abort+retry then hard; oom hard |
| F-merge-3 stream path | Start/end errors soft/hard aligned; soft does not finalize meeting via onEnd after streak |
| F-merge-4 packaging/UX | package.sh 0 dylib / homebrew absolute otool → hard fail; UI “安装” + macOS brew honesty |
| F-merge-5 error honesty | binary_broken vs timeout; soft banner: irreversible segment loss + default delete audio |
| F-merge-6 dual ack | Start disabled unless meeting ack **and** voicePrivacyAckV2 |

### B. Meeting AI refine + smart segment (product ask)

| Item | Claimed behavior |
|------|------------------|
| Live segment refine | Opt-in via `asrRefinerEnabled`; on STT final → serial queue → `voice.refine.request` with `priorContext` (≤2k tail) |
| Server | `buildAsrRefineUserContent`; guards still compare **raw segment** vs model out (not prior block) |
| Fail-open | Timeout/error → keep raw STT text |
| Smart segment | Live: `\n\n` between segments; stop: optional `meeting.apply_silence_cut`; button renamed 智能分段 |
| Source tag | append may use `asr_refiner` when refined |

### C. Out of scope / non-claims

- Full DMG re-package / new pin matrix SHAs for all arches  
- Edge-listen continuous LLM rewrite  
- System audio mix / true diarize identity  
- Semantic “polish” mode  

## Floors (blocking if broken)

1. Soft-continue must **not** soft-loop `resource_conflict` / `session_busy` / `oom` without reclaiming max-1.  
2. User-cache whisper without valid install.manifest must not execute as trusted unpinned.  
3. `voice.refine` remains chrome-extension origin; client systemPrompt ignored; correct_only guards intact.  
4. Meeting start requires **both** privacy acks (UI + path).  
5. Soft banner must not claim “retry this segment” when audio default-deleted.  
6. priorContext must not allow length-guard bypass (output still bounded vs raw segment).  
7. Default refine off; no auto-send to chat.  
8. ADR-024 job split: asr_refiner ≠ meeting_minutes.

## Reviewer instructions

1. Read the attached patch / run `git diff origin/main` on the files in this batch. Prefer **code** over implementer claims.  
2. Cross-check adversary synthesis blocking items vs actual control flow in:
   - `chrome-extension/src/sidepanel/voice/local-stt-adapter.ts`
   - `chrome-extension/src/sidepanel/components/MeetingPanel.tsx`
   - `chrome-extension/src/sidepanel/voice/meeting-live-refine.ts`
   - `companion/src/voice/binary-resolve.ts`
   - `companion/src/voice/asr-refiner.ts` + `refine-handlers.ts`
   - `companion/src/voice/stt-session-service.ts` + `whisper-runner.ts`
   - `scripts/package.sh`
3. Note residual risks (brew trust chain, SEA hot-swap, concurrent refine reordering, meeting.end race with in-flight refine).  
4. Apply ADR-020 checklist.  
5. End with **exactly one** line:

`VERDICT: APPROVE`  
or  
`VERDICT: APPROVE_WITH_NITS`  
or  
`VERDICT: REJECT`

If REJECT: list concrete blocking issues with file:line **before** the VERDICT line.  
If APPROVE_WITH_NITS: list non-blocking nits only before VERDICT.
