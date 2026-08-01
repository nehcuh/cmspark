# Dual external re-review: TinyClick → Qwen3-VL replacement

**Batch:** `qwen3-vl-replace`  
**Stage:** Post-implementation dual review (Pi + Claude)  
**Date:** 2026-08-01  
**Branch:** `main` (working tree, uncommitted)  
**Diff artifact:** `docs/audit/reviews/qwen3-vl-replace-diff-20260801-143131.patch`  
**Repo root:** `/Users/huchen/Projects/cmspark`

## Capability declaration (ADR-020)

```text
Surface:      L2 computer experimental locate only (L0 UIA / L1 OCR unchanged)
L2-classes:   experimental_suggestion (re-L2 human gate preserved)
Compose:      none
Autonomy:     single-thread task; no multi-worker
Trust:        modelEnabled + license door + biometric enable + per-hit re-L2;
              never auto-inject from VLM hit
Channel:      community (local HF download + local Python inference)
```

## What changed (intent)

1. **Replace TinyClick (Florence-2 ONNX / ORT worker)** as the Computer Use **L2 experimental locate layer** with **Qwen3-VL Instruct**.
2. **Default variant:** `2b` (`Qwen/Qwen3-VL-2B-Instruct`).
3. **User-selectable:** `4b` / `8b` via Settings UI + WS `computer.model.set_variant`.
4. **UI resource tips:** download size + recommended RAM / VRAM for smooth use.
5. **Download:** Hugging Face `snapshot_download` via Python `huggingface_hub` (real host; no `.invalid` placeholder gate).
6. **Inference:** long-lived Python worker (`qwen-vl-worker.py`) line protocol; Node `QwenVlRuntime` manages process.
7. **macOS:** experimental locator admission now attempted (was hard-null for TinyClick).
8. **Chinese commands allowed** (TinyClick ASCII envelope removed for this layer).
9. **Legacy config:** `hybrid`/`int8` → migrate to `2b`.

### Key new files

- `companion/src/computer/qwen-vl-catalog.ts`
- `companion/src/computer/qwen-vl-download.ts`
- `companion/src/computer/qwen-vl-runtime.ts`
- `companion/src/computer/qwen-vl-session.ts`
- `companion/src/computer/qwen-vl-locator.ts`
- `companion/src/computer/qwen-vl-worker.py`
- `companion/tests/computer-qwen-vl-locator.test.ts`

### Key rewired files

- `model-admission.ts`, `model-handlers.ts`, `model-license.ts`, `model-state-messages.ts`
- `locate-chain.ts` (layer name `qwen-vl`), `executor.ts` (re-L2 caption), `server.ts`, `config.ts`
- Settings: `SettingsSlideout.tsx`, `model-switch-logic.ts`, `useWebSocket.ts`, `background/index.ts`

### Explicit non-goals (do not demand in this PR)

- Full golden eval parity vs TinyClick S-3 freeze
- GGUF / llama.cpp path
- Deleting dead TinyClick ONNX sources (left unwired)
- Shipping model weights in the install package

## Your job

Independent **security + architecture + product honesty** review of the working tree / patch.

**Method:** Read the patch file and live sources under the repo with tools. Do **not** rubber-stamp. Prefer file:line evidence.

### Must verify

1. **Safety gates still hold**
   - L2 hit still `experimental: true` + re-L2 human confirmation before inject.
   - `source:"settings"` belt on mutators (`download` / `delete` / `set_enabled` / `set_variant` / license).
   - License door + text hash drift still re-prompts.
   - Circuit breaker / busy / fail-closed locate outcomes do not break UIA/OCR chain.

2. **Product honesty**
   - Resource tips for 2b/4b/8b are present and not understated into “always fine on laptop”.
   - Download/runtime failures surface to Settings (`python-missing`, `hf-hub-missing`, `download-failed`), not silent no-op.
   - License text matches Qwen3-VL reality (not leftover TinyClick MIT/Samsung claims).

3. **Runtime architecture**
   - Python worker protocol safety (no shell injection via command/path).
   - Process lifecycle: load / infer / dispose / crash handling.
   - Coordinate parsing heuristics (0–1000 vs absolute pixels) — correctness risk on real screenshots.
   - macOS path actually wires admission (not still null).

4. **Config / migration**
   - `modelVariant` enum `2b|4b|8b`; legacy hybrid/int8 migration.
   - Disk layout `~/.cmspark-agent/models/qwen3-vl-<variant>/`.

5. **Tests**
   - New unit coverage for locator envelope + handlers set_variant/download fail reasons.
   - Residual risk from deleted TinyClick-specific handler tests (coverage gap?).

### Rejection gates (any fail → REJECT)

| # | Gate |
|---|------|
| R1 | VLM hit can inject **without** re-L2 / experimental gate |
| R2 | Settings mutators accept non-`settings` source or unauthenticated WS can trigger download |
| R3 | Arbitrary path/command reaches shell without validation (RCE / path escape) |
| R4 | UI claims TinyClick is gone but runtime still calls TinyClick ONNX path on win/mac task path |
| R5 | License door still requires accepting TinyClick-only MIT narrative while downloading Qwen weights |
| R6 | `set_variant` changes config but leaves old session/model loaded without dispose → wrong model serves hits |

### Also check

- Dead code / dual naming (`tinyclickLocator` dep name) — WATCH not auto-reject if documented.
- Progress reporting honesty for HF snapshot (best-effort).
- Disk budget: old TinyClick budget still meaningful for multi-GB Qwen?
- Dependency surface: requiring Python+torch on companion machines.

## Output format (strict)

```markdown
## Summary
(2–4 sentences)

## Safety / Trust gates
## Runtime / Architecture
## Product honesty / UX
## Config / Migration
## Tests / Coverage gaps
## Blocking
(numbered; empty if none)

## Nits
(numbered)

## Verdict confidence
(0–100%)

VERDICT: APPROVE | APPROVE_WITH_NITS | APPROVE_WITH_CHANGES | REJECT
```

Write the full review to stdout. Be adversarial but fair. Tag evidence `[inspected]` / `[executed]` when you run commands.
