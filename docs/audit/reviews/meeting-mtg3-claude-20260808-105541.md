Verification complete. Compiling my findings.

---

## Review summary

**Capability (ADR-020)** — declaration present and accurate. Surface=L0, Compose=Pack+system_prompt_append, Autonomy=n/a, Trust=privacy_ack_v1, Channel=community. No middle-agent runtime introduced.

**Floors** — all verified in real code:

1. **No real-name claim** — UI copy: `实验可标发言人N · 非身份识别`, `不是身份识别，也非 Otter 级 SLA`, title `弱：按行交替发言人N，非声学`. minutes-prompt.ts:13 forbids inventing names. ✅
2. **privacy_ack_v1 required** — server.ts:5929 (validator) AND meeting-handlers.ts:275 (handler) both gate. Double-checked. ✅
3. **Pack first / no voice\*/autoStart** — pack.yaml:1-60 has no `voice*`, `auto_start`, or new runtime; system_prompt_append only. ✅
4. **audio_cluster requires aligned features** — meeting-handlers.ts:302-308 returns `features_mismatch` on length drift. ✅
5. **Origin fence** — meeting-handlers.ts:85-92 gates ALL `meeting.*` (including `auto_diarize`) via `isChromeExtensionOrigin` regex `^chrome-extension:\/\/[A-Za-z0-9_-]+$`. ✅
6. **Labels 发言人N** — auto-diarize.ts:32-34 `diarizeLabel` produces `"发言人"+(i+1)`; minutes prompt explicitly allows only existing labels. ✅
7. **text_gap explicitly weak** — UI title + status text `已弱标说话人（按行交替 · 非声学）`; DiarizeResult.method=`text_gap`. ✅

**Tests** — `npm test` (tsc → node --test on compiled CJS) shows all 7 mtg3 tests green; both `companion` and `chrome-extension` `tsc --noEmit` are clean. (A direct `tsx --test` run of the file fails due to ESM import hoisting preempting `process.env.CMSPARK_DATA_DIR = …`; same pattern exists in mtg2 test and is a pre-existing test-infra quirk under tsx, not a regression — the official CommonJS runner is unaffected.)

**Trust monotonicity** — auto_diarize sits at the same L0/compose layer as other capture ops and inherits the same origin + ack gates. No looser semantics introduced. ✅

**No originWs concern** — auto_diarize is a fire-and-forget update op, not a confirmation flow.

### Nits (non-blocking)

- **`meeting.auto_diarize` text length not capped** — server.ts:5924-5942 validator checks features size (≤2000) but not `m.text`. For text_gap path a peer could send oversized text through `silenceCutText`. Origin fence limits blast radius, but mirror the 80 000 cap from `meeting.import_text`.
- **Auto-import line-count race** — MeetingPanel.tsx:770-805 sends `set_transcript{silence_cut:false}` then 120 ms later `auto_diarize{features}`. If any STT segment returns multi-line text (rare for Whisper-style output but possible), `body.split(/\n+/).filter(Boolean)` will diverge from `feats.length` and the server returns `features_mismatch`. Recoverable (user retries) but worth either joining text with a guaranteed-single-line separator or re-aligning features client-side after the set_transcript round-trip.
- **Per-element feature shape not validated at the wire** — server.ts validator only checks `Array.isArray(m.features)`. Malformed rows safely degrade to `[0,0,0]` in `diarizeByAudioFeatures` (Number coercion), so this is observability-only; a `logger.warn` on fallback would help spot client bugs.
- **No unit test for the new `server.ts` validator branch** — mtg3 test exercises the handler directly; a small test against `validateWsMessage` for the new case (privacy_ack missing / bad mode / oversized features) would close the loop.

VERDICT: APPROVE_WITH_NITS
