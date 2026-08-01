I have enough evidence. Now I'll write the review in the exact required format.

---

## Summary

The design SoT (`docs/superpowers/specs/2026-08-01-qwen3-vl-experimental-layer-product-design.md`) is **internally consistent at the design level** and the §9 decision locks (D1–D11) are the right locks in the right direction. The capability declaration in the prompt (`L2 experimental locate only` / re-L2 every hit / god-mode never skips / community local download) is preserved end-to-end through §2, §5.5, §8, and §16. §16 successfully absorbs the four-lane adversary union (A1–A8) and adds the new locks (D8–D11) the prior round was missing. The China download journey is shippable as P1 with one honest gap (ModelScope resume). All six rejection gates (R1–R6) **fail to trigger** at the design level.

However, the design is **marked `PASS_WITH_CHANGES`** for a reason, and my code spot-checks confirm the implementation is materially behind the design's own P0/A1–A8 list — in some places on the exact items the design claims to have locked (D1 server-side refuse, D3 worker `_normalize`, D6 companion copy, D9 UI license reset, D10 ACE disclosure, A5 worker SEA packaging, A8 G1 skip × `modelEnabled`). The design is honest about this; anyone treating the doc as "design locked → ship P0" is contradicted by the design itself (§16.1: "不得在 A1-A8 关闭前宣称 P0/可内测"). I am reviewing the **design**, not the code, and the design is sound — but the gaps I list below must be closed in the doc before merge, and the code must catch up before any "P0 / 可内测" claim.

**Verdict leaning: APPROVE_WITH_CHANGES.** The design is good enough to anchor implementation work, but residual doc-level inconsistencies (state machine duplication, §10 vs §16 P0 mismatch, two unsorted items below) need a revision pass.

`[inspected]`: design SoT (full), synthesis (full), user doc (full), `qwen-vl-worker.py`, `qwen-vl-locator.ts`, `qwen-vl-session.ts`, `qwen-vl-runtime.ts`, `qwen-vl-preflight.ts`, `qwen-vl-catalog.ts`, `qwen-vl-download.ts`, `model-handlers.ts`, `model-license.ts`, `model-admission.ts`, `model-state-messages.ts`, `session-trust.ts`, `server.ts:975–1030`, `config.ts` (relevant lines), `SettingsSlideout.tsx:740–940`, `model-switch-logic.ts`.

## §9 decision locks

| Lock | Verdict on sufficiency & consistency | Evidence / spotting |
|------|--------------------------------------|---------------------|
| **D1** (A: hard disable + server refuse `set_enabled(true)`) | **Lock is correct and sufficient.** Forces canEnable authoritative, prevents "假绿". | Spec §9 row D1; §5.4 enable gate. Spot-check of `model-handlers.ts:306–366`: `set_enabled(true)` only checks license state, **does NOT consult `preflight.canEnable`**. Implementation gap, not design gap. |
| **D2** (B: warn-but-allow download, still bound by D1/canEnable) | Internally consistent with D1. Recommend-but-don't-forbid matches the China audience reality. | §5.3 `variantFit: insufficient` "不禁止下载"; §9 D2. ✅ |
| **D3** (A: pixel-only JSON, delete 0–1000 wide-screen branch, golden test) | Lock is correct and sufficient. "Coordinates + re-L2 = 安全事故" framing is the right severity. | Spot-check of `qwen-vl-worker.py:65–82` `_normalize`: the broken nested `if 0 <= x <= 1000 …` heuristic is **still present unchanged**. Design is locked; code is not — which is exactly what §16.2 A1 says. ✅ as design. |
| **D4** (A: copy pip commands; structured nextSteps + python path; PEP 668 copy) | Sufficient at design level. PEP 668 (externally-managed-environment) is the right call-out — Debian/Ubuntu users will hit this. | §5.6 MVP row; §16.2 B2. Slight gap: §6 IA does not list a "PEP 668 + system Python" warning slot. |
| **D5** (A: no bundling this version; P3 reconsider; SEA must still pack `worker.py`) | Internally consistent, but **A5 (worker.py packaging) is a P0 implementation item that the §10 P0 list omits** (see below). | §9 D5 vs §16.2 A5. |
| **D6** (A: keep TinyClick unwired; zero TinyClick copy; CI grep) | Sufficient. CI grep is the right enforcement. | Spot-check: `MODEL_SWITCH_COPY.switchLabel` in `companion/.../model-state-messages.ts:222` still says `"实验层：TinyClick 本地视觉定位"`; `MODEL_STATE_MESSAGES["model-file-missing"].detail` still says `"TinyClick 模型未下载或已被删除"`. Extension's `switchLabel` was updated but the error message was not. Design locked; code half-done. ✅ as design. |
| **D7** (MVP = honest indeterminate; P1 = real bytes; ban fake 0→100%) | Correct and correctly honest. | §10 P1.3; §16.2 A7. ✅ |
| **D8** (delete `modelDiskBudgetMB` OR redefine as "free disk ≥ variant + 2GB") | Lock resolves the contradiction. **Mild residual ambiguity**: design says "删除**或**改为…" — pick one in the design before merge, otherwise implementers will guess. | §9 D8 vs spot-check: `config.ts:103` still has `modelDiskBudgetMB?: number`; `config.ts:500` normalizer still falls back to `2048`; `MODEL_STATE_MESSAGES["disk-budget-exceeded"].detail` still references `默认 2048MB`. Direction is locked; specifics undecided. |
| **D9** (UI license reconsider reset; not only config edit) | Correct. UX-blocking was real. | Spot-check: `model-handlers.ts:329` and `licenseDeclinedNotice` copy in extension still say "复位 = 手改 config". Implementation not done. Design ✅. |
| **D10** (P0: door copy must disclose ACE; P1: revision + safetensors; long-term: hash pin or remote off) | Sufficient and properly staged. ACE disclosure at P0 is the right call — it's the highest-residual-risk item in the supply chain. | §16.4 item 2 mandates this. Spot-check of `LICENSE_DOOR_TEXT` in `model-license.ts:97–125`: **no mention of `trust_remote_code`, no model-dir execution warning, no SPDX, no path template, no ModelScope/hf-mirror source**. Design ✅; code must catch up. |
| **D11** (modelEnabled ⇒ forbid G1 initial-skip OR force task banner) | Lock is correct, but **the OR makes it ambiguous which branch is the SoT**. Pick one. Spot-check shows neither is actually enforced today (see §Residual holes). | §9 D11 vs `session-trust.ts:83–103` `g1InitialSkipEligible` and `server.ts:979–998`: `experimentalFlag` is set only when an action self-declares `experimental:true`; it is **NOT** derived from `cfg.modelEnabled === true`. So a task that uses the Qwen locator at runtime (because UIA/OCR miss) can still land on a G1-skipped session. Design lock ✅; code wiring ❌. |

**§9 internal consistency**: D1↔D2↔D8 form a coherent enablement chain (warn on download, hard-refuse on enable, honest disk budget). D3↔D11 form the coordinate/injection safety pair. D4↔D5↔D6 form the packaging/copy cluster. No decision contradicts another. **Sufficiency**: with the §16 additions, the lock set is sufficient to block every R1–R6 gate. **Caveat**: D8 and D11 each leave an "OR" branch unresolved at the design level — pick one before merge.

## §16 coverage of prior gaps

§16.2 P0 union **A1–A8** maps cleanly onto the four-lane synthesis's Blocking column (synthesis §2 table):

| Synthesis Blocking | §16 P0 | Coverage |
|---|---|---|
| 坐标像素 only | A1 | ✅ |
| canEnable 硬禁用 | A2 | ✅ |
| 去 TinyClick 文案 | A3 | ✅ |
| trust_remote_code 明示 | A4 | ✅ (also restated in §16.4 license door checklist) |
| disk budget 谎言 | A6 | ✅ |
| 下载中/半成品态 | A7 | ✅ (and §16.3 adds the three states) |
| worker 打包 SEA | A5 | ✅ |
| 许可路径/源/SPDX | A4 (folded) | ✅ |
| S7 UI 复位 | B4 (D9) | **Partial** — D9 is locked but the §16.2 P0 row B4 sits in P1, not P0. Inconsistent with synthesis which listed "S7 UI 复位" as 🔴 UX Blocking. |
| modelEnabled×G1 skip | A8 | ✅ |

**Residual holes vs synthesis:**
1. **S7 license-decline reset**: synthesis flags UX-blocking; design locks D9 but keeps the implementation item in **B4 (P1)** rather than A8-cluster (P0). The synthesis says it's 🔴 Blocking. Either promote B4 to P0, or explicitly justify the P1 placement (e.g., "internal-test users can hand-edit config once"). Right now §9 D9 and §16.2 B4 disagree on priority.
2. **§16.3 state machine patch is appended, not integrated.** §4.2 still lists S0–S7 with no `S_DOWNLOADING / S_PARTIAL / S_VERIFYING`. Two state machines in one SoT is a drift seed; a reader building the UI from §4.2 alone will miss download/partial/verifying states. Fix: patch §4.2 in place.

## User journey / CN network

**Design honesty**: ✅. §0, §1.2, §4.1, §5.2, and the user doc are candid about "扩展不跑模型" and the real Python-dependency reality. The user doc §1 mermaid matches §4.1. No "插件内推理" framing anywhere.

**Shippability as written (P1)**:
- `auto` source resolution (`qwen-vl-preflight.ts:241–292`) does HF/MS HEAD probes + `LANG=zh*` heuristic. Reasonable, no IP geo, honest about edge cases ("两源探测均失败 → 默认 ModelScope, 下载时再报错"). ✅
- ModelScope path **does NOT pass `resume_download`** (`qwen-vl-download.ts:101` `ms_dl(model_id, local_dir=local_dir)`). HF branch passes `resume_download=True`. For the primary CN audience on flaky links, a failed ModelScope download restarts from zero. **This is a real CN-network usability bug the design does not flag.** Add to §16 P1.
- `huggingface_hub` usage is correct (`local_dir_use_symlinks=False` with `TypeError` fallback) — survives the 0.x→1.0 API churn. ✅
- `LANG=zh_CN` heuristic is correct for glibc; **does not handle macOS** (`LANG` is typically `en_US.UTF-8` even on CN macOS users). Design should mention this or accept the false-negative (CN macOS users defaulting to HF). Minor.
- Disk path `~/.cmspark-agent/models/qwen3-vl-<variant>/` is consistent across spec/user doc/code. ✅
- User doc §1 step ⑤ says "可能生物识别" — slightly softer than §5.4 ("若通道缺失则失败"); the user doc should mention the "no channel → fail" case for honesty parity.

**Verdict**: honest and P1-shippable, with ModelScope resume as a real gap to add to §16 P1.

## Trust / supply-chain

**P0 bar (merge gate)**: design requires (§16.4) license door to disclose (1) SPDX, (2) **`trust_remote_code` ACE**, (3) on-disk path template, (4) actual source family, (5) volume/RAM/uncalibrated, (6) torch/transformers not redistributed, (7) default-off + per-hit re-L2 + D9 reset. The 7-item checklist is **correct and sufficient for P0**. Spot-check shows current `LICENSE_DOOR_TEXT` satisfies only items 5 (partly) and 7 (partly) — items 1–4, 6 missing. Design ✅; code must catch up before P0 claim.

**P1 bar (internal test)**: design says "钉 revision + safetensors". This is the right P1 — `revision=` pin on `snapshot_download` + post-download `.safetensors` existence check (already on §16.2 B1 readiness path). Reasonable.

**Long-term**: design says "long-term 关 remote 或哈希". For Qwen3-VL specifically, `trust_remote_code=True` is currently required (transformers needs the model's `modeling_qwen3_vl.py` etc. from the snapshot). The long-term "remote off" path is therefore **not actually available today** for this model family unless you vendor + audit the model code. The design should add a one-line note: "长期「关 remote」须先 vendor + 审计模型仓自定义代码（单独工作项，不在本方案 P3 范围）". Otherwise the long-term commitment reads as achievable-soon when it isn't.

**Hash pinning vs mirror integrity**: design's "镜像可配；哈希钉死为 P1 加固" is correct. Currently `probeQwenModelDir` only checks `config.json` exists — no sha256, no safetensors check. This is acknowledged (§5.1 "MVP… 后续加固"). P1+ story is sufficient.

**Acceptable for P0/P1 bar?** Yes at the design level. The bar is correctly set; the implementation laggardliness does not lower the bar.

## Residual holes (design-level)

These are gaps in **the design itself**, not the implementation backlog:

1. **§4.2 state machine vs §16.3 patch duplication.** Two state machines in one SoT. Integrate §16.3 into §4.2 in place.
2. **D8 "OR" undecided.** Lock the resolution: "删字段" or "改为 free-disk 下限". Currently leaves the `disk-budget-exceeded` reason (`MODEL_STATE_MESSAGES` entry) without a clear fate. Add a row mapping the old reason under the new model.
3. **D11 "OR" undecided.** Pick "禁止 G1 initial-skip" **or** "强制任务横幅" — the code wiring is dramatically different.
4. **D11 wiring ambiguity in spec.** D11 says "modelEnabled ⇒ …", but the implementation flag (`experimentalFlag` in `server.ts:979–985`) is per-action, not per-config. The design should make explicit *where* the `modelEnabled` signal feeds the G1 gate (e.g., "在 `g1InitialSkipEligible` 入参增加 `cfg.modelEnabled`，与 `experimental` 取或"). Without this, an implementer reading the spec may keep the per-action flag and believe D11 is satisfied.
5. **§10 P0 list omits A4/A5/A8.** §10 P0 has 4 items (spawn, coords, copy, design-pass); §16.2 P0 has 8. §10 is the canonical "merge gate" list, so its omission of license-door rewrite, worker.py packaging, and G1-skip block makes §10 weaker than §16. Either promote §16.2 P0 items into §10, or explicitly state "§10 P0 = 设计层 P0; 代码 P0 = §16.2 A1–A8". As written, a reviewer scanning only §10 will under-scope.
6. **S7/B4 priority mismatch** (see §16 coverage above).
7. **ModelScope resume-download gap** not in §16 P1.
8. **No update / migration flow.** §10 P3 mentions "模型增量更新策略" without even a sketch. When Qwen3-VL ships a `-Instruct-v2` or a security-relevant revision, what's the user-facing flow? At least name the work item: "model revision pin + user-visible upgrade notification".
9. **No telemetry schema for the success metric.** §11 targets ≥70% CN download success but the design has no concrete plan for how this is measured. P3 mentions "本地日志：预检失败原因直方图" — promote a minimal version (anonymous local enum counter of preflight failure reasons) to P1 so the success metric is actually observable for the internal test.
10. **Infer latency SLO absent.** §5.5 lists envelope/collapse but no per-infer p95 target. Without one, "实验层永远可选、默关" is fine, but the re-L2 UX (a 30s infer blocks the confirm panel) is unspecified. Add a "soft target: p95 < N seconds at 2B on recommended hardware, else skipped after timeout" line.
11. **Off-screen / degenerate-output detection.** Worker clamps to `[0, width-1]` but a model that always returns (0,0) or center-pixel will pass the collapse detector (single-frame). Design does not require a "consensus-bad" heuristic; honest disclosure handles it, but worth a sentence in §8.1.
12. **No A11y / i18n note.** All copy is zh-CN. For non-zh users selecting the experiment, no EN fallback is in spec. At least acknowledge as non-goal.

## Blocking

**Design-level blocking (must fix in doc before merge)**:
- B1: §4.2 state machine not patched in place (duplicates §16.3).
- B2: §10 P0 list inconsistent with §16.2 P0/A1–A8 — must explicitly reconcile.
- B3: D8 and D11 each leave an "OR" unresolved at design level.
- B4: D11 wiring ambiguity — specify where `cfg.modelEnabled` enters the G1 gate (otherwise the existing per-action `experimental` flag will be mis-read as satisfying D11).
- B5: S7/B4 priority — synthesis says 🔴 Blocking, design places it in P1. Reconcile.

**Non-blocking (implementation backlog the design honestly flags)**:
- All A1–A8 implementation items (worker normalize, canEnable hard-disable server-side, copy de-TinyClick in companion, license door rewrite, worker.py SEA, disk budget enforcement, G1 skip × modelEnabled wiring, structured nextSteps).

**Rejection gates R1–R6**: all six **pass** at the design level. R1: §2 + §5.5 enforce re-L2 + experimental gate (✅). R2: D1 is locked A (✅). R3: D3 is locked A (✅). R4: D8 locks resolution (✅). R5: §16.4 covers ACE + path + source + SPDX (✅). R6: status header is `PASS_WITH_CHANGES`, not "P0 complete" (✅).

## Nits

- §16.4 item 1 typo risk: "SPDX（如 Apache-2.0）以快照 LICENSE 为准" — Qwen3-VL is **not Apache-2.0**, it's released under a custom Qwen license (research+commercial with clauses). Either drop the "如 Apache-2.0" or replace with "（如 Qwen License）". Getting this wrong in the door copy would mis-disclose.
- §1.1 table row "中文 golden ~13%" lacks a source citation. Either cite the TinyClick evaluation or mark as "internal measurement".
- §5.1 model size for 8B "~16GB" — Qwen3-VL-8B-Instruct safetensors at BF16 is closer to 16–17GB; the spec is fine but the rounding direction should be conservative (round up).
- §6 "下载源 [自动|魔搭|HF镜像|HF]" order differs from §5.2 table order (`auto / modelscope / hf-mirror / huggingface`) vs IA hint order. Align.
- §4.2 S2 says "canDownload ∧ ¬modelReady" — fine — but §4.3 reason `model-not-ready` overlaps confusingly with the S3 "已下缺推理" state name. Consider renaming the reason to `model-not-downloaded` for S2 and reserving `model-not-ready` for S3+runtime.
- §11 metric "L2 注入未经确认 = 0" is correctly a hard metric, but the verification path is unspecified. Add: "via re-L2 emit-site test in executor (already covered by `experimental_suggestion` PROMPT_ALWAYS_TAGS test)".
- User doc §7 says "许可证需重新接受" on TinyClick→Qwen migration — but the migration path in `config.ts:541–545` does NOT invalidate `modelLicenseAcceptedAt`/`TextHash`. Hash will change because `LICENSE_DOOR_TEXT` will change (when the door is rewritten per A4), but the design should make this dependency explicit: "license door rewrite → text hash change → existing accepts fail hash check → re-prompt".
- §14 "companion 文案仍 TinyClick 镜像" — the row is marked P0 but does not list which file (`model-state-messages.ts`) — implementer must grep. Add filename.

## Verdict confidence
86%

The 14% residual is split: (a) I may have under-weighted a synthesis Blocking item the design actually covers under a different name; (b) D11's runtime wiring has subtle interactions with the per-action `experimental` flag that I traced but did not exhaustively test against existing session-trust tests; (c) the supply-chain "long-term remote off" path is more constrained than the spec acknowledges for Qwen3-VL specifically, and a reviewer with deeper transformers-internals knowledge might raise the bar.

VERDICT: APPROVE_WITH_CHANGES
