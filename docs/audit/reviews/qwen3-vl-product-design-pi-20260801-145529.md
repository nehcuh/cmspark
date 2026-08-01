## Summary

Design SoT is a genuinely honest, well-scoped product spec: the capability declaration is not weakened (L2 experimental-only, re-L2 per hit, `experimental_suggestion` never silent, session-trust carve-out), the §9 locks (D1–D11) are the right answers, and §16 converts every four-lane Blocking item into numbered, verifiable requirements (A1–A8). No rejection gate R1–R6 fails at the *spec* level — R1/R2/R3/R5 are locked to the safe variant, R4 has D8, and R6 is respected (the doc explicitly forbids claiming P0/可内测 while A1–A8 are open, §16.1/§16.5). [inspected] code confirms the §14 gap table is accurate (worker `_normalize` bug is real; `set_enabled(true)` has no canEnable check; companion copy still says "TinyClick 本地视觉定位"; license door hardcodes "从 Hugging Face 下载模型"; `modelDiskBudgetMB` 2048MB copy persists).

But the document is **not merge-ready as authoritative** because it contradicts itself on three points that define what "P0 / 可内测" means (§10 vs §16.2 priorities), and two locked decisions (D9, D7) are contradicted by their own phase table / state machine. These are design-level inconsistencies, not implementation debt.

## §9 decision locks

| Lock | Assessment |
|---|---|
| D1 (hard-disable `!canEnable`) | **Correct and mandatory.** Code currently only gates license+biometric in `set_enabled(true)` (model-handlers.ts) — a user can flip enabled with no model on disk → admission `BUILD_FAILED` → the exact 假绿 class §11's hard metric targets. Lock is right; **placement is wrong** (see Blocking 1). |
| D2 (insufficient → warn, can download) | Consistent with §5.3 ("不禁止下载，只警告") and code (`variantFit` warning only). OK. |
| D3 (pixel-only JSON) | Correct. [inspected] `qwen-vl-worker.py` `_normalize` misclassifies absolute pixels ≤1000 on wide frames (e.g. (200,50) on 1920×1080 → scaled to (384,54)) — the exact wide-screen bug; prompt already asks for pixel JSON but the parser still feeds the buggy 0–1000 branch. Lock + A1 are the right surgery. |
| D4 (copy commands; PEP 668) | Sound; P2 keeps "一键 pip" behind confirm-shell. OK. |
| D5 (no bundled runtime, P3) | OK. |
| D6 (TinyClick unwired, zero copy, CI grep) | Tension with §10 P1.5/B5: UI/companion runtime copy must be de-TinyClick at P0, but THIRD_PARTY_NOTICES keeps TinyClick marked legacy until P1. Distinguishable artifacts — not a contradiction, but the P0 "文案双源一致" (P0.3) only covers *runtime* copy; the notices delta is P1. Acceptable but easy to misread. |
| D7 (indeterminate, no fake 0→100%) | Locked but **not honored by the phase plan**: honest progress is P1 (§10 P1.3). [inspected] code emits `receivedBytes:0/1 → 1/1` progress and the UI's `downloadPercent` will render 0%→100% (model-switch-logic.ts). So P0/merge ships exactly the fake progress D7's rationale forbids. See Blocking 3. |
| D8 (delete 2048MB semantics or free-disk floor) | Correct resolution; preflight already warns on `freeDiskGb < variant+2GB` ([inspected] qwen-vl-preflight.ts). **Placement contradiction** (§10 P1.2 vs §16.2 A6 P0) — see Blocking 1. |
| D9 (settings-page reset of permanent license decline) | Correct (UX Blocking). **Directly contradicted by §4.2 S7** which still says "文案：手改 config 复位" and by [inspected] `LICENSE_DOOR_TEXT` ("复位 = 手改 config.json") + handler `LICENSE_DECLINED` ("复位路径 = 手改 config.json"). The SoT's own state machine and protocol weren't updated to match its lock. See Blocking 2. |
| D10 (door ACE at P0; revision+safetensors at P1; long-term remote-off/hash) | Correct bar given `trust_remote_code=True` in the worker ([inspected]). Door currently lacks ACE/SPDX/path and — worse — hardcodes "从 Hugging Face 下载模型" while the resolved source may be modelscope/hf-mirror: the *shipped* door is actively misleading today. A4 covers it at P0. |
| D11 (modelEnabled ⇒ no G1 initial-skip, or task banner) | Correct. [inspected] `g1InitialSkipEligible` only blocks when `experimental` is flagged on action records; at initial-L2 decision time (pre-locate) that flag can be false even though the task *will* use the qwen layer. A8 is genuinely open, as the doc says. |

## §16 coverage of prior gaps

All ten Blocking items from the synthesis (§2 table) are numbered and placed: A1–A8 in P0, B1–B9 in P1. Coverage is complete and each maps to a concrete code defect I verified [inspected] (D3/`_normalize`, D1 handler, TinyClick copy in `MODEL_SWITCH_COPY.switchLabel` + `model-file-missing` copy, door text, budget copy, missing S_PARTIAL, partial G1 gate). §16.3's S_DOWNLOADING/S_PARTIAL/S_VERIFYING patch is good. **The residual hole is not content — it's the P0/P1 contradiction between §10 and §16.2** (Blocking 1), which lets a reader conclude "P1 = 可内测" while D1/budget (which §16.2 demands closed *before* 内测) are still open.

## User journey / CN network

- Journey (§4.1) is shippable and honest: preflight → source → variant → license → download → deps → explicit enable → per-hit re-L2; "自动开启" is explicitly refused (B9, and user doc §3).
- No-Python path is designed end-to-end (S1 state, copyable pip commands, PEP 668 note, honest `python-missing` refusal) and code backs it (`canDownload = python && hub`, spawn-ENOENT guarded).
- Source resolution (§5.2 / [inspected] `resolveDownloadSource`) avoids IP geolocation, prefers ModelScope for zh locale, probes both endpoints, and surfaces `downloadSourceReason` — correct.
- Residuals: (a) B3 (one-click source-switch retry on auto failure) is P1 — acceptable; (b) `hf-hub-missing`/`modelscope-missing` pip commands in nextSteps are right, but PEP 668 / externally-managed-environment handling is only a copy note (D4) — acceptable; (c) user doc §2/§3 matches the *current* code (config.json-only readiness), so it inherits B1's partial-download gap — the doc must be updated in the §16.5 rewrite.

## Trust / supply-chain

- Bar is defensible *for an experimental opt-in layer that cannot be enabled until P1*: P0 = ACE disclosure in door (A4) + D3 + D1 + de-TinyClick copy; P1 = revision pin + safetensors existence + notices; P2 = hash pinning/long-term remote-off.
- Weakest link: **revision pin (P1) is the only authenticity control before 内测**, and there is currently *no* integrity manifest for the Qwen path at all ([inspected] `models.manifest.json` pins only TinyClick; `probeQwenModelDir` = config.json presence). Since the layer executes arbitrary model-directory code with `trust_remote_code=True` under the user's own privileges, I'd pull hash pinning from P2 → P1 (defense-in-depth even though HF/ModelScope revisions are content-addressed). Not blocking, but the P0/P1 bar is thinner than the threat table in §8.1 suggests.
- Budget: D8 resolves the 2048MB-vs-4.5GB lie at spec level; the stale copy in `model-state-messages.ts` ("默认 2048MB") is A6's job. Enforcement is warning-only in preflight ([inspected]); abort-enforcement is the A6 "enforce" leg — must land before 内测 per §16.2.
- Notices: `THIRD_PARTY_NOTICES` has zero Qwen entries ([inspected]) — B5/P1 is honest and adequate since weights are user-downloaded, but worker.py ships in the SEA/DMG at P0 (A5), so the *code* that executes untrusted model code ships before the notice does. Note, not blocker.

## Residual holes (design-level)

1. **§10 vs §16.2 priority contradiction** — D1 hard-disable and disk-budget resolution are P0 in §16.2 (A2, A6) but P1 in §10 (items 4 and 2). Since §10 P1 literally defines "可对内测用户", the two tables disagree on whether 内测 can proceed with `!canEnable` enabling possible. This must be resolved or the doc has two "P1" truths. (Blocking-adjacent; R6 doesn't trigger only because the doc makes no completion claim.)
2. **§4.2 S7 stale** — "许可拒绝 → 手改 config 复位" contradicts locked D9 and §16.4.7. State machine + protocol table need the reset path.
3. **D7 lock vs P1 placement** — fake 0→100% progress survives P0/merge per §10.
4. No §12.1 automated test for the wide-screen coordinate regression D3/A1 demands ("golden 必测" is stated in the lock but not enumerated in §12.1's list — add a `_normalize` wide-frame absolute-pixel unit test + a Chinese golden).
5. `delete` does not clear `modelEnabled` (code: delete disposes session + files only) → state shows 已开启+absent after delete. §11's "0 假绿" metric is safe only if the status line can't read "可用"; the design should pin the post-delete semantic explicitly.
6. `canEnable` omits hardware fit by design (D2 B) — correct, but the resourceTip/risk copy for "tight/insufficient + enable" should be a fixed string, not derived, so UI can't drift.
7. Download-before-license is possible (`computer.model.download` has no license gate, [inspected]); the design flow puts license first (§4.1 H→I) but the protocol section doesn't forbid direct download. Low risk (download ≠ execution), worth one sentence.
8. Preflight runs per `get_state` with up to ~15s spawn probes (B7 caching is P1) — fine, but should be a stated latency budget for the settings page.

## Blocking

1. **Resolve the §10 ↔ §16.2 priority contradiction for A2 (D1) and A6 (disk budget).** As written, one table says 可内测 requires them closed and the other lists them as P1 work *of* 可内测. Pick one authoritative mapping and cross-reference.
2. **Update §4.2 S7 (+ §7.1 protocol, if needed) to the D9 reset path** — the state machine currently documents manual config editing, directly contradicting a locked §9 decision.
3. **D7 enforcement phase** — if indeterminate progress is P0-legal, say so explicitly and require removing the misleading 0→100 events from the current code at P0; if not, move honest progress to P0. Right now the lock and the phase table disagree.

## Nits

- §5.4 item 5 ("是否硬禁用 = P1 决策") is stale text now that D1 locks A — delete the "产品建议" hedging.
- §12.1 should enumerate the D3 wide-screen coordinate test and a CN-source download-fail matrix (per §12.2 items exist; automated side is thin on source-resolution failure injection).
- `downloadGb` in `statePayload` comes from `QWEN_VL_VARIANT_META` while §5.1's table says ~4.5/8/16GB — fine, but the manifest (`models.manifest.json`) still pins only TinyClick; add a note that the Qwen path intentionally bypasses the manifest until C3.
- "至少一个 `*.safetensors`" readiness (B1) — also count a nonzero-size check; a 0-byte safetensors would pass "existence".
- User doc §2 says "未齐时「下载模型」会禁用或失败并给出原因" — with D1 locking enable-hard-disable, the doc should also state the enable switch is disabled until ready (it currently only lists canEnable *conditions*).

## Verdict confidence

0-100%: **78%**. Code spot-check was direct ([inspected] handlers, admission, session-trust, locate-chain, worker, preflight, download, runtime, settings UI, notices, manifest) and the §14 gap table is truthful; residual uncertainty is in server.ts initial-L2 flow details and whether the SEA packaging (A5) actually ships worker.py.

VERDICT: APPROVE_WITH_CHANGES
