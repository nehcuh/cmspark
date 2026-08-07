I have enough evidence. Let me compose the independent review.

## Pi re-review: Path B Local STT SoT (post four-lane adversary)

### 1. Floor absorption — verified against real files

I cross-checked every mandatory floor (F-UX-B1–B18, F-S-B1–B16, F-C-B1–B20, F-I-B1–B12) against the SoT. All are present in substance:

- **F-S-B1/B11/B13/B14** (dual-engine residual matrix, no silent fallback, no `audioCapture`, Companion engine-truth): SoT §5, §5.3, §2.2, §7 ✓
- **F-S-B2** ack v2 with 6 mandatory clauses: §5.2 ✓ (v1 explicitly does NOT satisfy local)
- **F-S-B5** Pack cannot write voice keys: §4 `Compose: none — Pack 不得写 voice* / engine / ack / auto-send` ✓
- **F-S-B7** session/seq/caps: §8 (session-bound WS, global max-1, epoch, late no-op, byte cap 45s≈1.44MB + slack ≤2.5MB — math checks out: 16kHz·2B·45s = 1.44MB) ✓
- **F-S-B9/B10** download+binary hardening: §2.1#3, §9 (`execFile` fixed binary, model path server-side allowlist) ✓
- **F-C-B5** PCM/ffmpeg: §2.2 non-goal, §8 `format:"pcm_s16le"|"wav"`, §9 `pcm-encode` ✓
- **F-I-B1/B2/B5** Companion SoT, max-1, settings-only: §7, §8 ✓
- **F-UX-B3/B4/B9/B10/B18** medium-led UI, settings-only download, seconds/cap listening, explicit processing, no third status row at 320px: §6.1, §6.2 ✓
- **F-UX-B15** stop/abort/thread-switch: inherited via §2.1#6 (matches shipped `useVoiceInput.ts` reducer invariants — CHAT_ABORT/THREAD_SWITCH/UNMOUNT all present in the real hook) ✓

No floor is missing wholesale. Two are slightly **weakened** (nits below): F-UX-B6 (banner-level "not ready" copy — SoT §6.3 line 162 says `Disable +「去设置下载」`, no banner tag) and F-S-B8 (0o600 tmp mode not restated — only sandbox + GC at §13 R-B2).

### 2. Conflict resolutions — faithfully implemented

- **One-click switch to browser STT**: SoT §5.3 matches the synthesis exactly — allowed, real pref write (not ghost), same-row cloud disclosure, toast, silent switching banned. ✓ (One gap: the synthesis says "settings-gated 同源写" but §5.3 never ties the CTA write to the §8 `source:"settings"` dual-column validation — see nit N4.)
- **Prefs SoT split**: §7 is unambiguous — Companion owns `sttEngine`/`localModelId`, chrome.storage owns `voiceInputEnabled`/ack v2, extension mirrors only. No dual-write. ✓
- **PCM vs ffmpeg**: PCM locked, ffmpeg non-goal, spike S2 gates "无 ffmpeg". ✓
- **Medium as recommended**: locked, but see challenge below.
- **Qwen coexistence**: disk budget fail-closed + runtime confirm when Qwen loaded (§10) — matches synthesis. ✓

### 3. Privacy honesty — clean

§5 dual-engine matrix is honest: browser "常云端", local "Ext → 本机 Companion → tmp → whisper.cpp". §5.1 bans 完全本地/零风险 AND explicitly bans showing M1's "音频不经过 Companion" in local mode — this matters because the shipped `SettingsSlideout.tsx` (line 935–936) currently displays "不经过 CMspark Companion" **unconditionally**; the SoT correctly requires making it engine-conditional. §4 Trust residual honestly separates `[browser] vendor STT residual (may leave device)` from `[local] … not cloud-by-design` (careful, non-absolute wording). Residual risks R-B1–R-B7 are non-zero and documented. ✓

### 4. ADR-020 — conformant

§4: Surface L0 input only, `L2-classes: (none)`, Compose none + Pack-write ban, Autonomy single-thread. No Trust elevation via voice, no auto_approve. New `voice.*` WS family triggers ADR-020 §7 governance — SoT explicitly requires a Path B ADR. Matches ADR-020 rules and the dual-review checklist. ✓

### 5. M1 regression — protected

§2.1#8 "M1 browser 路径零回归（含 Companion 断连仍可 browser 听写）" and §6.3 line: `engine=browser 不要求 Companion`. Browser path never touches Companion WS — consistent with the shipped hook (pure Web Speech, no WS). ✓

### 6. REJECT triggers — none present

No silent cloud fallback (§5.3), no privacy lies (§5), no Surface/L2 elevation (§4), no dual-write prefs (§7), no ffmpeg requirement (§2.2/§8), no auto-send (§0/§6.4/§12). **No ship-blocker before spike/M0.**

### 7. Challenge: medium vs turbo

Whisper.cpp catalog: `small` q5_0 ≈ 466MB, `medium` q5_0 ≈ 1.5GB, `large-v3-turbo` q5_0 ≈ 809MB. For **short zh commands on CPU**, turbo is plausibly *better* than medium on every axis the SoT cares about: smaller disk, faster inference (distilled, ≈medium-speed), and higher accuracy (≈large-v3). Medium's only real defense is zh-multilingual training parity and lower RAM ceiling claims that lack data here. The SoT locks medium (§10 line 235, §6.1) **before** spike S3 produces an actual zh accuracy/latency/RAM table. **Recommendation:** keep medium as the documented default but make the S3 spike gate explicitly re-confirm the recommendation against turbo (and small) with measured numbers — if turbo wins, it's a one-line UI swap, not an SoT rewrite. Non-blocking; spike is the right place to settle it.

### Nits (non-blocking)

1. **F-UX-B14 partial absorption** — SoT §6.4 has timeout caps but no local error taxonomy. M1's §6.6 had an engine→user-text table (empty result / OOM / binary-missing / hash-fail / crash all need Chinese user text); Path B never restates it. Add a local error table (or explicit inheritance) before M1 copy freeze. (`2026-08-07-voice-local-stt-design.md` §6.4)
2. **Budget double-count risk on primitive reuse** — §9 says "复用 primitives" with an *independent* 4096MB voice budget (§10 line 232), but `model-download.ts` computes `budgetDir = path.dirname(destDir)` (line 189) and walks the whole parent tree (lines 141, 190). If whisper lives under the same `models/` root as Qwen, the two budgets will double-count each other's bytes. The forked whisper downloader must scope `budgetDir` to the whisper root (or the "独立" claim breaks).
3. **Chicken-and-egg in settings flow** — §7 line 190 locks "拒绝 set_engine local 直至至少一档 ready", but §6.1 shows the download panel only in the expanded 本机 radio state. If radio selection auto-commits `set_engine` and it's rejected, the user can't reach the download UI. Specify that the radio is a UI-local draft allowing download without committing the engine.
4. **CTA source token unspecified** — §5.3's banner CTA writes `sttEngine=browser` "（Companion 写）" but never ties it to §8's `source:"settings"` dual-column validation (line 207), which the synthesis explicitly promised ("settings-gated 同源写"). Name the write path/message + source token, or the 双栏 gate is bypassed by the CTA.
5. **Engine mirror durability (R-B5 edge)** — §7's "扩展镜像" is unspecified in storage. If the mirror is in-memory only, a Companion disconnect after a fresh extension load could leave engine unknown; defaulting to browser then silently routes audio to vendor cloud for a user who had chosen local. Persist last-known engine+model in chrome.storage.local so unknown ⇒ fail-closed Disable (local) while never-chosen ⇒ browser (M1 zero-regression) stays safe.
6. **F-UX-B6 wording** — §6.3 line 162 "Disable +「去设置下载」" reads as inline text; the floor requires banner-level copy. Tag it banner.
7. **F-S-B8 0o600** — not restated in SoT (only sandbox + GC at §13 R-B2); add file-mode to the tmp floor.
8. **Resource numbers** — §6.1 line 138 "约 xGB · 约 yGB 内存" placeholders must be resolved at spike before M0/M1 copy freeze (ties into nit 1 / challenge 7).

All nits are resolvable during spike/M0/M1 without an SoT rewrite; floors are absorbed, conflicts honored, privacy is honest, and the M1 contract holds.

VERDICT: APPROVE_WITH_NITS
