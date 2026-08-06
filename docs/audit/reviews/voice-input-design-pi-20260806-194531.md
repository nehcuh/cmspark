All key files inspected. Here's my independent review.

## Verified against real code

**Composer mode matrix (§6.3) matches `App.tsx` reality:**
- `resolveComposerMode` (thread-busy.ts:38-47) yields exactly the 4 modes in the matrix (`l2_task` | `thread_busy` | `run_busy` | `ready`)
- `canSend` (App.tsx:357-363) excludes `l2_task` and `thread_busy`; `run_busy` passes → matrix "现有（通常可发）" is accurate (the "通常" hedge is honest — canSend also needs content/thread/connection)
- `showStop = threadBusy || isStreaming` (App.tsx:365) → matrix "右侧为停止" row and §6.4 "Listening + 点停止（threadBusy/streaming）" are real; the edge case where streaming begins *during* dictation and the right slot morphs to Stop is actually well-handled by §6.4's recognition-first abort order
- textarea `disabled={needsThread||needsConnection||threadBusy}` (App.tsx:941/953) → SoT's "M1 不修改 disabled 合同" is consistent
- `handleStop` → `chat.abort` (App.tsx:748-765) exists; SoT's §6.4 (abort recognition first) is a *documented intentional* extension of the stop path, not a conflict
- Manifest (build/chrome-mv3-dev/manifest.json): no `audioCapture`, no `microphone`; `storage` present → F-S5 ✓, F-I2 (chrome.storage.local prefs) needs no manifest change ✓

**Floor absorption:** All 27 floors (F-UX1–6, F-S1–12, F-C1–6, F-I1–8) are present in substance in the SoT. ADR-020 declaration (§4) matches the checklist format at adr/020 lines 143-148 (L0, L2-classes none, Compose none, Trust gate, Channel). Privacy is honest — three-channel model, explicit ban on "完全本地", the allowed one-liner discloses cloud STT + no Companion audio + no auto-send. No Surface/Trust elevation, no new confirm dialect, no auto-send anywhere in v1 (banned as non-goal, absent from settings table, R3 mitigations, M2 requires re-adversary).

## Nits (non-blocking; M0.5 spike / dual-review can proceed)

1. **F-S8 sub-item 失焦 (blur) not absorbed.** The floor says "失焦/abort/切线程停听"; SoT §2.1(5)/§6.4 list Stop/chat.abort/切线程/卸载/断连 but not blur, and the §9 SM event set has no BLUR/VISIBILITY event. Either add `visibilitychange`-stop or consciously document "失焦不停" (side-panel blur is frequent when glancing at the page — arguably stopping on blur is worse UX, but the omission should be explicit, not accidental).
2. **F-S2's future forced-off rule (巡航/三旗/值守强制关 auto-send)** is only deferred via "M2 须重开对抗" + R3; the standing constraint isn't recorded in the SoT for the future adversary to inherit. One line in §11 M2 would fix it.
3. **F-C3 "error map"** is a bullet list (§2.1 item 4) rather than a table; substance present but an engine-error → user-copy map would help M1 impl.
4. **M0.5 spike should also validate cloud-STT reachability**, not just permission bootstrap: primary users are zh-CN, and Chrome cloud STT may not deliver `onresult` on networks where Google speech is unreachable — the 45s-timeout/network path must be proven, or the spike gate ("不过不写功能默认开") may pass on permission alone while failing on real dictation.
5. `chrome.tabs.create` bootstrap steals focus in the user's window — consider a small window/options page; verify in spike. Cosmetic.
6. The "diff" patch file is an empty stub and both specs + synthesis are untracked; harmless for doc-review but the LOCK should land with a commit so the diff is auditable.

**Ship-blocker assessment:** Permission bootstrap feasibility is genuinely unverified (known Chromium side-panel prompt-dismissal issue) and macOS system mic permission may not exist — but the SoT correctly gates this behind M0.5 with "不过不写功能默认开", so it is not a blocker for this review.

VERDICT: APPROVE_WITH_NITS
