All claims verified. Assembling the final review.

## Independent dual-review — clipboard image paste implementation

**Patch freshness**: working tree `feat/clipboard-image-paste` @ `8e3a24e`; only docs/memory/node_modules dirty — the source I inspected is the diff. Not stale.

**Machine (re-verified by execution)**
- companion full suite: 2972 tests / 2934 pass / **15 fail** — all 15 pre-existing on `main` (identical set re-run on main checkout: 2938/2900/15; branch adds 34 tests, all pass)
- chrome-extension: 698/698 pass; `tsc --noEmit` exit 0

**Adversary table check — Product REJECT confirmed.** I tried to knock down each Product blocker and could not:

| ID | Claim | Verdict | Evidence |
|----|-------|---------|----------|
| M1 | No history thumbs | **Confirmed** | Companion never generates `preview_jpeg_b64` — message-router.ts:717 comment "preview JPEG skipped — no canvas"; attachment payload (735-740) has no preview; thread-manager.ts:210 copies it only if present. ChatView.tsx:566-583 falls back to an empty name-only tile. Live thumbs are empty tiles too (adapter.ts:391 echoes attachments without preview). Spec §3.4/§5.5 lock companion-generated ≤8KB/96px preview; DoD "历史里看得到小图" fails. |
| M2 | Ghost user + chips cleared early | **Confirmed** | App.tsx:1137-1146 optimistic user bubble; App.tsx:1198-1199 `setSelectedFiles([])` on SW `ok` — but SW ok only means the WS write succeeded (background/index.ts:646-647). `file.upload_error` handler (useWebSocket.ts:1626-1651) adds ❌ but neither restores chips nor removes the ghost. Every companion refusal path (sniff mismatch, caps, paused thread, sidecar fail, vision-off plan) hits this. Spec §3.3-3 explicitly forbids it. |
| M3 | Dest ignores `config_override.base_url` | **Confirmed** | App.tsx:810-816: `effectiveModel` merges the override but `destHost` reads global `state.config.base_url`/`vision_base_url`; ack host App.tsx:1064 same; ack value is `true` not ISO (1072). Spec §3.6 explicitly requires override-derived hostname — this is a trust/consent mislabel of where pixels go. |
| M4 | Token ≈3 not 1600 | **Confirmed** | context-budget.ts:66 embeds `[image:1600]` in the serialized string; estimateMessagesTokens (73-77) runs `estimateTokens` over it — `chars/4` (summary-export.ts:42-49) → **3 tokens/image**. Budget passes under-count ~1600×N → overflow 400s instead of compaction. Violates §5.4. |
| M5 | Edit strips §5.1a | **Confirmed** | ChatView.tsx:720 seeds the edit box via `captionOnlyForEdit` (image-compose.ts:103-108, strips 📎 + vision block); message-router.ts:990-992 `updateMessage` overwrites disk content with the caption-only text. The exact regression §5.1a was locked to prevent. |
| M6 | Sidecar before plan; image/\* → doc lane | **Confirmed** | Sidecars written message-router.ts:727-742, plan checked at 746-751 → orphan `.files` on the text-model+vision-off path. `image/heic` etc. fall to the docs lane (split-upload-files.ts:52-65) and are refused by parseFile (file-parser.ts:427-432) with the generic doc message, not §7's image message — fail-closed outcome, so this half is routing/message correctness, not a hole. |

**Security lane — agree APPROVE_WITH_NITS.** Verified clean: sidecar containment (lstat non-symlink dir + realpath strictly-inside on load/write/delete/fork, image-sidecar.ts:116/172/243/366; write re-sniffs bytes at :134-135); client `rel` never a load path (:210-230); no fetch on the paste path (data:-only `parseDataImageUrl`, anthropic-convert.ts:99-105; uri-list refused); no `clipboardRead`; SW refuses over-budget frames with a stamped `file.upload_error` (background/index.ts:608-615). Confirmed nits: companion frame gate is 10MiB hard without the −256KiB parity (ws/lifecycle.ts:663); no `<untrusted-image>` system-prompt framing (grep: zero matches).

**Architecture lane — agree.** Hydrate-after-rebuild (adapter.ts:511-533), reserved-id + stampAttachments lockstep, native skips `analyzeImage`, Anthropic block-merge all hold and are tested.

**ADR-020 checklist**: declaration present and accurate (L0 / no L2 / none / single / no new confirm / community). No new runtime, tool, confirm family, or permission; axes fit correct; no P1-watchlist files touched. Pass.

**Judgment on blocking**: M1 defeats the feature's headline JTBD on every reload; M2 corrupts transcript state on a routine error path; M3 mislabels the egress destination in a codebase whose security posture treats destination labeling as the consent mechanism. These are locked spec clauses, not reviewer taste — I cannot argue them down to nits. M4–M6 are verified must-fix per the synthesis's own merge gate.

Blocking issues (before merge):
1. `chrome-extension/src/sidepanel/components/ChatView.tsx:566-583` + `companion/src/message-router.ts:717-740` — no `preview_jpeg_b64` ever generated; thumbs render as empty tiles (spec §3.4/§5.5).
2. `chrome-extension/src/sidepanel/App.tsx:1198-1199` + `1137-1146` + `chrome-extension/src/sidepanel/hooks/useWebSocket.ts:1626-1651` — chips cleared at SW-ok, ghost user retained on `file.upload_error` (spec §3.3-3).
3. `chrome-extension/src/sidepanel/App.tsx:814-816, 1064-1072` — destination host/ack ignores `config_override.base_url`; ack value not ISO (spec §3.6).
4. `companion/src/llm/context-budget.ts:66,73-77` — image tokens estimated at ~3 instead of 1600/2800 (spec §5.4).
5. `chrome-extension/src/sidepanel/components/ChatView.tsx:720` + `companion/src/message-router.ts:990-992` — edit+regen destroys the §5.1a vision description on disk.
6. `companion/src/message-router.ts:727-751` — sidecars written before `planStandaloneImageAnalysis` gate → orphan files on refusal.

VERDICT: REJECT
