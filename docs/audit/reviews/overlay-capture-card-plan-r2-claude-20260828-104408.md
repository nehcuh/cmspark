All verification complete. Compiling the review.

---

# Plan dual r2 review — Overlay Capture 卡片 #241

## Patch freshness
`git status`/`git diff` match the attached patch exactly: 4 staged new doc files (744 insertions), base 6a3bfe2. Not stale. `[executed]`

## r1 blocker folding — verified against the real tree

Every r1 blocker is folded into a pin that matches actual code:

1. **No generic `/api/dispatch` (pin 16)** — `JSON_BODY_MAX = 64*1024` (summoner-web.ts:85), `STT_MAX_CHUNK_BYTES = 256*1024` (voice/session-caps.ts:16). Dedicated routes with server-side type fill are implementable; `dispatchAllowed` (summoner-web.ts:191) is the existing narrow pattern. ✓
2. **`sendAppRequest` (pin 17)** — exists at companion-client.ts:454 (Promise, id, 5s default, reject-on-error); `sendAppMessage` (:440) is boolean fire-and-forget. Plan's distinction is accurate. ✓
3. **④ origin inversion (pin 18)** — overlay-shell.ts:25-26 requires `chrome-extension://` origin; `ui.open_sidepanel` is the reverse direction. `session.broadcast` fans out to all authenticated peers (lifecycle.ts:1343-1356) and the session carries real `origin`/`surface` (lifecycle.ts:1349-1351), so tray-request → broadcast → extension-SW-receive works mechanically. ✓
4. **Meeting `surface` (pin 20)** — confirmed live bug-shape: MeetingHandlerContext (meeting-handlers.ts:41-45) has no `surface`; global extension-only origin gate at :88-94; router meeting call (message-router.ts:2452-2462) omits `surface` while the stt call (:2397-2403) passes it. Fix is exactly as pinned. ✓
5. **SW test slicing (pin 19)** — the only existing `chrome.sidePanel.open` in background/index.ts is at :1456 inside `thread_graph.open_thread` (runtime onMessage), not `handleCompanionMessage` (:313). Whole-file assertion would false-green; the slice technique is proven in chat-shell-popout.test.ts:51-57. ✓
6. **CSS/empty-state (pins 27/31)** — `var w=720` at summoner-web.ts:883, `${SUMMONER_MIC_SIDEBAR}` in `empty.innerHTML` at :969, title at :664, disabled mic title at :812, footnote at :830 — all present; all cited test anchors (test :125/:129/:131/:140/:145, shell-open test :93 vs src :62) exist verbatim. ✓
7. **`audio_retained=false` (pin 21)** — `applySummonerPayloadPolicy` is invoked on both paths (lifecycle.ts:1084 and summoner-web.ts:195), so one branch covers WS + HTTP dispatch. ✓
8. **`ui.open_sidepanel` literal ban (pin 23)** — `ui.open_sidepanel` appears nowhere in the tree today; the #239 lock at overlay-shell-open.test.ts:57-64 is real. Lockstep coverage via existing ws-router-validator-lockstep.test.ts. ✓

## ADR-020 checklist
Declaration present in plan + spec + prompt. Surface=L0 overlay, no new confirm family (reuses `VOICE_PRIVACY_ACK_V2_CLAUSES` six clauses and meeting five verbatim, per-window ack), trust monotonicity preserved (meeting additions narrower than existing stt origin precedent; `generate_minutes`/`auto_diarize`/`import_text` stay extension-only; `list_tabs`/confirm stay off), no new runtime, no originWs implications (no new `securityConfirmations.request`). No violations.

## Nits (non-blocking)

- **Plan line ~241 (Task 2 Step 3):** voice.stt.start field list omits `v:1`, which validate.ts:496 requires. In-tree builder (summoner/client.ts:532-545) includes it and the plan points at validate.ts, so low risk — but list it.
- **Pin 16:** "chunk 路由 cap ≥ STT_MAX_CHUNK_BYTES（256KiB 解码后）" — 256KiB decoded is ~342KiB of base64 on the wire; a literal 256KiB JSON-body cap silently shrinks usable chunks. Cap should be ≥ base64(STT_MAX_CHUNK_BYTES) ≈ 350KiB.
- **Pin 26 sequencing:** cta-foot footnote removal isn't assigned to any task step; summoner-web.test.ts:157 and :622 (`SUMMONER_ATTACH_FOOTNOTE` lock) will force red whenever it lands, so it can't go silent — but the plan should say which task owns it.
- **Task 2 Step 3:** `local-stt-adapter.ts` is in chrome-extension/src/sidepanel/voice/, not companion/src — unprefixed path could mislead an implementer searching companion only.
- **Shared-session side effect (pre-existing):** HTML dictation pushes also hit menu-bar-agent's `mapVoiceSttToSummonerCmd` (menu-bar-agent.ts:1897), which fills the Swift HUD composer on the same overlay WS. Not new to this plan, worth a sentence.

No pin reopens an r1 blocker; all red-step anchors exist at cited locations; the dispatch → summoner WS → validate → ACL → router → handler and broadcast → SSE bridges are verified against current code. Tasks 1–4 cannot go silent-green or dead-at-runtime as written.

VERDICT: APPROVE_WITH_NITS
