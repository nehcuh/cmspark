# Brief: Vision 配置复用主 LLM（多模态 UX）

**Date**: 2026-08-08  
**Stage**: Product design lock → P0 implement  
**Blast tier**: **T2**（设置 UI 文案 + 配置预填；不改 tool 语义 / 不改 security gate）  
**Status**: **Implemented (P0)** — multi-adversarial lock + dual Claude/Pi APPROVE_WITH_NITS + leftover nits folded 2026-08-08  
**Artifacts**: `docs/audit/reviews/vision-reuse-main-llm-adversary-synthesis-20260808.md` · `vision-reuse-main-llm-p0-verdict-20260808-144622.json`  
**Related**: `config.vision` · `llm/vision-pipeline.ts` · SettingsSlideout · settings-web · project-knowledge Vision 405 教训

---

## 0. Capability declaration (ADR-020)

```text
Surface:      L0 (settings UX only — no new browser/tool surface)
L2-classes:   (none)
Compose:      none (config hint + optional reuse of existing vision pipeline)
Autonomy:     single
Trust:        unchanged — vision still uses config.vision; no new confirm dialect
Channel:      community
```

**Axis**: pure **settings affordance** over existing Composition path (`config.vision` → `analyzeImage`). Not a new runtime, not native multimodal tool-loop.

---

## 1. Thesis

> When the user enables screenshot vision analysis, if the **main chat LLM is likely multimodal**, prompt them to **reuse main model credentials for the vision side-pipeline** instead of defaulting to a separate Ollama llava setup. Separate vision config remains fully available.

**Non-thesis (P0)**: Do **not** inject `image_url` into the main agent chat loop; keep pre-analyze → text description architecture.

---

## 2. Problem / JTBD

| Actor | Pain | Desired outcome |
|-------|------|-----------------|
| User with Claude / GPT-4o / Kimi / glm-4v as main LLM | Settings imply they must install Ollama + separate VLM | One click: vision uses same base_url / key / model |
| User with DeepSeek (text-only) | N/A | No false “multimodal” prompt; keep independent VLM path |
| User who wants cheap local VLM + strong chat model | Must not lose separate config | “仍单独配置” still works |

---

## 3. Current architecture (as-is)

```text
screenshot / analyze_image → base64
  → if config.vision.enabled: vision-pipeline (OpenAI-compatible chat.completions + image_url)
  → tool result becomes vision_description (text)
  → main LLM never receives image bytes in the agent loop
```

Defaults (`config.ts`): `vision.enabled=false`, `base_url=http://localhost:11434/v1`, `model_name=llava:7b`.

**Product confusion residual**: Side Panel help text still says “需要 Ollama 等本地推理服务” even when cloud multimodal is valid.

**Not the same rail**: Computer Use Qwen3-VL (`computer.modelEnabled`) is locate-only, not `analyze_image` description.

---

## 4. Proposed P0 design

### 4.1 Heuristic (pure function, testable)

```ts
likelyMultimodal(modelName, protocol?, baseUrl?): boolean
```

- **Exclude** known text-only families (deepseek, pure reasoner/coder without vl)
- **Include** known multimodal families (gpt-4o, claude, gemini, kimi/moonshot, glm-4v, qwen*vl, llava, pixtral, vision, …)
- Anthropic protocol + claude/sonnet/opus/haiku → true
- Unknown → **false** (fail closed: do not prompt reuse)

Optional later: `llm.supports_vision: boolean | "auto"` — **out of P0** unless adversary requires it.

### 4.2 UX (Side Panel primary; settings-web mirror)

On checking `vision_enabled` **from false → true**:

1. If `!likelyMultimodal(main model)` → current expand independent fields; **honest** help text (local *or* cloud VLM).
2. If `likelyMultimodal` → show non-blocking banner:

   > 当前主模型 **{model}** 看起来已支持图片理解。截图分析可复用主模型的 Base URL / API Key / Model，无需另配一套。
   >
   > [使用主模型]  [仍单独配置]

3. **使用主模型** → set:
   - `vision_enabled=true`
   - `vision_base_url = config.base_url`
   - `vision_model_name = config.model_name`
   - `vision_api_key` = copy of `config.api_key` if non-empty in UI; if empty but companion has main key set, leave vision key empty and rely on user saving (see §5 risk) **OR** document that empty vision key after reuse means “user must paste or already saved vision key”
4. **仍单独配置** → expand fields with current defaults (or leave user-edited values); dismiss banner for this session.
5. When already in “reused” state (vision url/model equal main url/model): show chip「已复用主模型 · 展开高级配置」; fields collapsible.

### 4.3 Help text honesty

Replace Ollama-only framing with:

> 开启后，截图 / analyze_image 会先经视觉模型转成文字再交给主对话。可使用本地 VLM（如 Ollama llava），也可使用云端多模态 API（与主模型相同亦可）。

### 4.4 Out of scope (P1+)

| ID | Scope | Why deferred |
|----|--------|--------------|
| P1 | `vision.use_main_llm: true` server-side resolve from llm | Needs config merge + mask key inheritance carefully |
| P2 | Native multimodal agent messages | Protocol + token + Anthropic/OpenAI dual path |
| — | Auto-enable vision when multimodal | Trust: user opt-in remains |

---

## 5. Risks for adversaries to attack

1. **False positive multimodal** → user reuses DeepSeek-like endpoint with image_url → vision fails / cost surprise  
2. **False negative** → multimodal user still sees only Ollama path (copy failure)  
3. **API key empty on reuse** when main key is only on companion (`api_key_set`) — UI cannot copy masked key  
4. **Anthropic protocol main LLM** but vision-pipeline is OpenAI-compatible only — reusing Anthropic base_url/model for vision may 404  
5. **Confusing with Qwen3-VL CU rail**  
6. **Silent overwrite** of carefully configured separate vision when toggling  
7. **settings-web vs Side Panel drift**

---

## 6. External DoD (machine-observable)

- [x] Pure `likelyMultimodal` unit tests: include/exclude matrix ≥ 12 cases  
- [x] Pure copy helpers unit tests (banner strings non-empty; no “必须 Ollama”)  
- [x] SettingsSlideout: enable vision + multimodal model → banner actions (pure `vision-reuse-logic` + UI wiring)  
- [x] “使用主模型” maps vision fields from main llm fields in pure helper  
- [x] Help text does not claim Ollama is required (Side Panel + settings-web)  
- [x] Companion key inherit on save when endpoints match; skip if `protocol=anthropic`  
- [x] Fail-closed: non-loopback + placeholder key → no image POST  
- [x] settings-web “Use main LLM for vision” + hostname disclosure  
- [x] No change to `analyze_image` security gates / tool definitions  
- [x] No new primary Side Panel chrome / no new tools  

---

## 7. Eval gate card

```text
Blast tier: T2
Capability: see §0
Machine: extension unit tests for pure logic + existing suites green on touched packages
Judges: multi-path independent adversary (Product · Security · Architecture) → synthesis → implement → dual Claude+Pi
Merge: only after MACHINE PASS + ADVERSARY APPROVE* + PI APPROVE*
```

---

## 8. Locked decisions (multi-adversarial 2026-08-08)

| # | Locked |
|---|--------|
| Q1 | **A** — never offer reuse when `protocol === "anthropic"` |
| Q2 | **Server inherit** on save when vision url+model match main and vision key empty/`ollama` |
| Q3 | Banner only false→true; session dismiss; chip when reused |
| Q4 | Side Panel full UX; settings-web honesty mandatory; full banner optional |
| Privacy | Banner/chip show destination hostname |
| Runtime | Fail closed: non-loopback + placeholder key → no image POST |

---

*Brief for multi-adversarial · implementer must not self-APPROVE*
