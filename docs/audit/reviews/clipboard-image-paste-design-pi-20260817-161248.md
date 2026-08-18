Review complete. I read the locked spec, adversary synthesis, strawman, vision-reuse P0 brief, ADR-020 + capability checklist, and verified the design's claims against ~15 real code sites.

## Grounding check (all claims in the spec verified against code)

- **WS 10MB**: `companion/src/ws/lifecycle.ts:67` `MAX_WS_MESSAGE_SIZE = 10MB`; design keeps it. ✔
- **SW computes-but-sends**: `chrome-extension/src/background/index.ts:614-619` computes `json_bytes`/`over_companion_10mb` then `wsClient.send` anyway — §5.6's "改为拒发" fixes a real bug. ✔
- **Anthropic merge stringifies parts**: `anthropic-convert.ts:172` `String(next.content)` — A4/§5.3 block-wise merge is required, not hypothetical. ✔
- **`serializeMessage`/redact**: `context-budget.ts:51,61` `String(m.content)` on non-string; §5.4 part-stub handling is needed. ✔
- **Regenerate id 坑**: `chat.regenerate` resolves user msg by disk `message_id` (`message-router.ts:868` `findIndex(m => m.id === message_id)`), but optimistic file.upload bubble uses local `${uploadThreadId}_${Date.now()}` (`App.tsx:1054`) and the SW `chat.user` echo echoes the client id (`background/index.ts:525`). A7's disk-id echo fixes a real break. ✔
- **P0 heuristic mislabels**: `vision-reuse-logic.ts` `/kimi|moonshot/ → true` and `tests/vision-reuse-logic.test.ts:31-32` assert `kimi-k2`/`moonshot-v1-128k` → true; §4/DoD #15 correction is real and machine-checkable. ✔
- **Settings lies**: `vision-reuse-logic.ts:15`「主对话不会直接收图」, `settings-web.ts:668` "main loop does not receive image bytes", `SettingsSlideout.tsx:2155` — §8 rewrite list maps to real copy. ✔
- **Sidecar/persistence**: `thread-manager.ts` `Message.content: string`, `purgeExpiredTrash`/`cleanupEmpty` unlink only the JSON (no `.files/` today) — §5.5 CRUD additions are needed. ✔
- **`file.upload` validate**: `ws/validate.ts:712-723` max 10 files + truthy name/type/content; empty `File.type` from OS paste is indeed rejected today. ✔
- **No `onPaste`/`onDrop`/`onDragOver`** in `App.tsx`; `accept` is documents-only (`App.tsx:1244`). ✔

## Trajectory — locked table absorbs, doesn't paper over

Every one of the 3 lane blockers (Product P1–P6, Security S1–S8, Architecture A1–A8) maps to a concrete spec section with mechanism + machine-checkable DoD (sidecar containment w/ realpath+lstat+isStrictlyInside, block-wise Anthropic merge, hydrate as sole injection point, SW/panel refuse-before-send, exact magic-byte signatures, exact copy rewrites).

## ADR-020 checklist

Declaration present and complete in spec §0 and synthesis. Axes fit (L0 composer attachment — correct axis, no CDP/tool). Pack-first: paste/drop/picker on the existing composer is not new primary Side Panel chrome. No new confirm family (P5 explicitly non-L2, chip + one-line notice). Trust monotonicity holds: native images go to the same main LLM endpoint/key as chat text — same trust level, no god-mode interaction, screenshot rail unchanged. `originWs`: no new `securityConfirmations.request` (N/A). No new runtime (reuses `file.upload` + vision rail). Forbidden language honored.

## Nits (non-blocking)

1. **§3.3 preflight vs `enable_vision_analysis`**: preflight blocks only on `!vision.enabled`, but the vision rail is gated by `config.vision?.enabled && file_upload.enable_vision_analysis !== false` (as `message-router.ts:564` does today). Text-only main + vision enabled + embedded-analysis disabled → spec is ambiguous whether the image is analyzed (violating user config) or silently unanalyzed (violating U4). Recommend: preflight gate `!useNative && !(vision.enabled && enable_vision_analysis !== false)`.
2. **§5.4 1600 tok/image undercounts squares**: 1568px long edge matches Anthropic's 1600 base, but OpenAI high-detail tiles a 1568×1568 square to ~2800 tok; as-is oversized GIFs/WebP (§3.7) are also sent un-downscaled. Bounded by the 4-image cap (~11k worst-case vs 6.4k assumed) — say the estimate targets typical screenshot aspect, or use 1600 as floor for OpenAI-high-detail.
3. **Companion-side numeric caps not mandated**: §3.3/§5.6 enforce 4-image / 4MiB / 6MiB client-side only; a version-skewed or buggy client could still ship 5×1.5MiB and trip `maxPayload` 1009 (the exact death the design forbids). Recommend the router re-validate image count/decoded caps and return `file.upload_error` (cheap, consistent with DoD #4's 漏网 path).
4. **Existing P0 test flip not named in §10**: §10's file cut lists companion lockstep tests but not the update to `chrome-extension/tests/vision-reuse-logic.test.ts:31-32` (asserts kimi-k2/moonshot-v1 true). DoD #15 machine-checks the flip, so it's covered, but name the file so the implementer doesn't leave a stale green assertion.

Diff is fresh and pure-docs (4 staged files match `git diff HEAD`; patch timestamped today). This is a design review; the spec is complete, internally consistent, grounded in real code, and implementable as written.

VERDICT: APPROVE_WITH_NITS
