Review complete. All grounding and r1-closure verification done.

## Verification basis

The r2 patch file (`clipboard-image-paste-design-r2-diff-20260817-162716.patch`) matches the live staged diff exactly — 8 files, 981 insertions, no unstaged modifications to those files. Not stale. Diff is pure docs; no implementation code, as declared.

## r1 closure check (all 8 items verified in the folded spec + code)

| r1 item | Spec lock | Code ground | Status |
|---|---|---|---|
| Claude blocker: vision description had no persist/replay carrier | **§5.1a** — appended to disk `content` as `<!-- 用户附图分析 -->\n[图片: name] {description}`; explicitly forbids `vision_text`-only field; §5.1 addMessage block includes `[视觉轨时追加 §5.1a 描述]`; DoD #16 machine-checks it | Mirrors the real embedded-image carrier at `message-router.ts:607` (`<!-- 文档内嵌图片分析 -->` appended to content); regenerate replays persisted content with `skipUserMessage:true` (`message-router.ts:983,993`) so the description now survives | ✅ Closed |
| Pi nit 1: preflight ignored `enable_vision_analysis` | §3.3 preflight 1 + §4 table both use `vision.enabled && file_upload.enable_vision_analysis !== false` | Exactly matches the real gate at `message-router.ts:569` | ✅ Closed |
| Pi nit 2: 1600 tok under-counts squares | §5.4: aspect > 1.3 → +1600; near-square (short side ≥ 1200) → +2800 | — | ✅ Closed |
| Pi nit 3: companion re-validate caps | §5.1 step 6: re-checks 4 images / 4MiB / 6MiB / frame JSON | Consistent with DoD #4 漏网 path | ✅ Closed |
| Pi nit 4: extension test file unnamed | §10 item 1 names `chrome-extension/tests/vision-reuse-logic.test.ts` | Assertions for `kimi-k2`/`moonshot-v1-128k` → true confirmed at test lines ~31–32; heuristic `/kimi\|moonshot/ → true` confirmed in `vision-reuse-logic.ts` | ✅ Closed |
| Claude nit: `deleteMessagesFrom` orphans sidecars | §5.5: regenerate-trimmed lines delete their sidecars | `deleteMessagesFrom` exists in `thread-manager.ts` | ✅ Closed |
| Claude nit: sidecar written before LLM gates | §5.1 step 5: sidecar only after gates (paused/trashed/concurrency); 门拒则不落盘 | Real gates verified at `message-router.ts:640-664` (thread-not-found / trashed / paused / loop cap) | ✅ Closed |
| Claude nit: ack key not hostname | §3.6: keyed by hostname itself, including `thread.config_override.base_url` hosts | — | ✅ Closed |

## Independent re-grounding (spot checks beyond r1's citations)

- SW compute-but-send bug real: `background/index.ts:600-620` computes `json_bytes`/`over_companion_10mb` then calls `wsClient.send(payload)` unconditionally — §5.6's 拒发 fix is needed.
- `App.tsx:1244` accept is documents-only; zero `onPaste`/`onDrop`/`onDragOver` in the file.
- `thread-manager.ts:903-906` message-cap slice drops old JSON lines with no sidecar cleanup — §5.5 addition needed.
- `anthropic-convert.ts:167-176` consecutive-user merge does `String(next.content)` — §5.3 block-wise merge required.
- `context-budget.ts:48-61` `serializeMessage` stringifies non-string content — §5.4 parts handling required.
- `lifecycle.ts:67` `MAX_WS_MESSAGE_SIZE = 10MB` — frame budget math (4/6MiB decoded, 10MiB−256KiB envelope) holds.
- `companion/src/llm/likely-multimodal.ts` does not exist yet — consistent with §10.1 creating it new.

The §5.1a ↔ §5.1 ↔ §5.2 chain is internally consistent: vision-rail description lives in disk `content`, regenerate replays content, hydrate with `!useNative` strips parts and keeps the text (which now includes the description). DoD #16 covers both the content marker and the no-parts-on-regen invariant.

## ADR-020 capability check

Declaration present in spec §0 and matches the prompt. Surface L0 is the correct axis (composer attachments, no new CDP/tool); L2-classes none; Compose none (reuses `file.upload` + vision rail); Autonomy single; no new confirm dialect (destination disclosure is chip + one-line, not a `SecurityConfirmationManager` family); trust monotonicity intact (native images use the main key at the same trust class as chat text; vision rail keeps `shouldBlockVisionRequest`); no `clipboardRead`; no new runtime; `originWs` N/A (no new confirm `request(`). Diff is pure docs. **Passes.**

User locks (U1–U4, no silent fallback, no new L2) all preserved.

## Non-blocking nits

1. **§5.1 steps 3 vs 5 ordering tension**: step 3 ("图写入 sidecar") precedes step 5's constraint ("Sidecar 只在 LLM 门…通过之后写") in a numbered list that reads temporally. Step 5's sentence is explicit enough to gate-order the write, but annotating step 3 or reordering would remove the ambiguity for the implementer.
2. **§5.4 bucket gap**: an image with aspect ≤ 1.3 *and* short side < 1200 (e.g., 1300×1000) falls into neither the 1600 nor the 2800 bucket — the implementation plan should state the default (presumably 1600).
3. **§5.4 Anthropic note**: "Anthropic 原生同样用这张表（略保守即可）" — actual Anthropic cost for 1568² is ≈ (w·h)/750 ≈ 3.3k tok, above the table's 2800 max; "略保守" overstates. Bounded by the 4-image cap and compaction; fine for planning.
4. Untracked `clipboard-image-paste-design-r2-claude-20260817-162716.md` sits next to the patch (orchestrator capture artifact); make sure it's committed with the batch so the verdict trail stays complete.

The folded spec closed the r1 blocker and all seven r1 nits, remains internally consistent, and is grounded in real code. Nothing blocks writing the implementation plan.

VERDICT: APPROVE_WITH_NITS
