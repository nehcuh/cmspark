All claims now grounded. Summary of my independent verification:

## r1 closure verification (fold delta confirmed via r1↔r2 spec diff + real code)

| r1 item | Fold lock | Code ground | Status |
|---|---|---|---|
| Claude blocker: vision description vanishes on regen | §5.1a — description appended to disk `content` w/ `<!-- 用户附图分析 -->`, no `vision_text`-only carrier, DoD #16 | Regenerate replays persisted `userMsg.content` (`message-router.ts:877,983,993`); §5.1a mirrors the existing `<!-- 文档内嵌图片分析 -->` pattern (`message-router.ts:607`) | ✅ CLOSED |
| Pi 1: preflight ignored `enable_vision_analysis` | §3.3 + §4 use `vision.enabled && file_upload.enable_vision_analysis !== false` | Real gate is exactly that (`message-router.ts:496,569`) | ✅ CLOSED |
| Pi 2: 1600 tok under-counts squares | §5.4 aspect >1.3 → +1600; near-square short side ≥1200 → +2800 | — | ✅ CLOSED |
| Pi 3: companion re-validate caps | §5.1 step 6 | — | ✅ CLOSED |
| Pi 4: extension test file unnamed | §10.1 names `vision-reuse-logic.test.ts` | File real, asserts `kimi-k2`/`moonshot-v1-128k` true (`tests/vision-reuse-logic.test.ts:31-32`); heuristic `/kimi\|moonshot/ → true` (`vision-reuse-logic.ts:94`) | ✅ CLOSED |
| Claude: `deleteMessagesFrom` orphans sidecars | §5.5 | Real method slices JSON only (`thread-manager.ts:997`) | ✅ CLOSED |
| Claude: sidecar before LLM gates | §5.1 step 5 ("门拒则不落盘") | — | ✅ CLOSED |
| Claude: ack not hostname-keyed | §3.6 keyed by hostname incl. `thread.config_override.base_url` | — | ✅ CLOSED |
| Claude non-blocking: §4 protocol sentences read contradictory | §4 rewritten: `likelyMultimodal(modelName)` 不读 protocol; Claude by name; `shouldOfferVisionReuse` hard-block preserved | Hard-block real (`vision-reuse-logic.ts:110-112`) | ✅ CLOSED |

## New-contradiction scan (fold-introduced)

- §5.1a content format ↔ §5.1 `chatCreate` content block ("[视觉轨时追加 §5.1a 描述]") ↔ §4 routing row ("文字写入磁盘 content") ↔ DoD #16: mutually consistent.
- DoD #16 "不 POST image parts" consistent with §5.2 (!useNative strips parts) and skipUserMessage replay.
- §3.3 preflight `!(vision.enabled && enable_vision_analysis !== false)` = negation of §4 gate formula — consistent.
- No forbidden language, no reopened user locks, no new L2/confirm family.

## ADR-020 capability checklist

Declaration present in §0 and matches the diff's scope. Axes fit (L0 composer attachment, no CDP/tool); Compose none; no new runtime; Pack-first N/A (existing composer chrome); no new confirm dialect (chip + one-line is P5-explicitly-non-L2); trust monotonicity intact (native pixels → same main LLM key/endpoint as chat; vision rail keeps `shouldBlockVisionRequest`; no `clipboardRead`); originWs N/A (no new `request(`). **Passes.**

## Non-blocking nits

1. §5.1 steps 3 vs 5: "图写入 sidecar" (step 3) is listed before the gate-deferral rule (step 5, "Sidecar 只在 LLM 门…通过之后写；门拒则不落盘"). The gate rule is explicit and wins, but the numbered order reads as a process sequence — reorder or annotate so the implementer doesn't write the sidecar pre-gate.
2. §5.4: Anthropic-native tokens still use the OpenAI-calibrated 1600/2800 table with only "略保守即可"; the r1 Claude note (Anthropic ≈ (w·h)/750 ≈ 3.3k at 1568²) is acknowledged but not quantified. Fine for planning; pin a test vector at impl time.
3. §3.6: ack storage is specified semantically ("按 hostname 本身记，含 override 解析主机") but the concrete `chrome.storage.local` key shape isn't — implementation detail, lock it in the plan.

r1 is fully closed; the fold introduces no contradiction; nothing blocks writing an implementation plan.

VERDICT: APPROVE_WITH_NITS
