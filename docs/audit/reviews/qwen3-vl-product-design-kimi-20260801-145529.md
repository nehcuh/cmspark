• I'll read the review prompt and related documents first.

• Now let me read the synthesis and user doc.

• I've read all three required documents. Now a quick code spot-check of the implementation files.

• ## Summary

  Design SoT read end-to-end (`docs/superpowers/specs/2026-08-01-qwen3-vl-experimental-layer-product-design.md` [inspected]), plus the four-lane synthesis [inspected], user doc [inspected], and spot-checked code: `qwen-vl-worker.py` [inspected], `model-handlers.ts` [inspected], `model-license.ts` [inspected], `model-state-messages.ts` [inspected], `model-download.ts` [inspected].

  Verdict up front: the amended design **passes all six rejection gates at spec level** — D1/D3/D8 are locked in the right direction, §16.4 contains the ACE/path/source checklist, and §16.2 explicitly forbids claiming 可内测 before A1–A8 close. But the document is **not internally consistent yet**: three §9 locks are contradicted by stale text elsewhere in the same file, and two "locks" are disjunctions, not decisions. The code spot-check confirms the design's own §14 honesty: A1–A4 and budget are all still open in implementation, which the spec admits. As a design SoT it is directionally sound but needs one consistency pass before it can govern implementation.

  ## §9 decision locks

  - **D1 (canEnable hard refuse)** — correct and necessary. However §5.4 item 5 still says 是否硬禁用 = "P1 决策（见 §9）" while §9 already locked A. Same document, two answers. Also §10 phases "D1 硬禁用开关" under **P1**, while §16.2 lists A2 (the same lock) under **P0 未完成不得宣称可内测**. Pick one phase; given R2, it must be P0.
  - **D2** — consistent with §5.3 (fit=insufficient warns, doesn't block). OK.
  - **D3 (pixel-only)** — correctly locked. Code confirms why it matters: `qwen-vl-worker.py:65-77` `_normalize` still contains a nested, effectively non-deterministic 0–1000 relative heuristic (four levels of overlapping conditions) — on a 2560px-wide screenshot an absolute pixel coordinate ≤1000 will be silently remapped. This is exactly the R3 hazard; the lock is right, the code hasn't caught up.
  - **D4–D7** — coherent, honest (indeterminate progress, no fake 0→100%).
  - **D8 (budget)** — **not actually locked**: "删除 modelDiskBudgetMB 产品语义**或**改为可用磁盘下限" is an open alternative. Current code (`model-download.ts:188`) enforces the 2048MB default against ~4.5GB variants, i.e. a default install fails its own budget — the exact R4 contradiction. The spec resolves it *in principle* but leaves the choice to implementation. A lock should name the chosen semantics.
  - **D9 (license reset UI)** — locked, but contradicted in-file: §4.2 S7 CTA says "文案：手改 config 复位" and §8.2 says "拒绝 = 永久跳过（复位手改 config）". Stale pre-lock text. (Code door text `model-license.ts:120` also says 手改 config — downstream of the same contradiction.)
  - **D10 (trust_remote_code ACE)** — locked correctly as disclosure + P1 pinning. One design-level gap: the spec never asks whether Qwen3-VL still *needs* `trust_remote_code` at all. Current transformers integrate Qwen3-VL natively; if the runtime pins a transformers version with native support, remote code can be off at P0, eliminating the ACE rather than disclosing it. The design should state the intended runtime path explicitly.
  - **D11 (modelEnabled ⇒ no G1 initial-skip)** — right lock, but again a disjunction: "禁止 initial-skip **（或**任务横幅）". A banner is strictly weaker than forbidding the skip; leaving the choice open re-introduces the exact ambiguity the adversary flagged.

  ## §16 coverage of prior gaps

  The A1–A8 union faithfully covers every Blocking row in the synthesis §2 table — no dropped item. Spot-check confirms the list is accurate, not aspirational:

  - A1 open: worker heuristic above [inspected].
  - A2 open: `model-handlers.ts:306-365` — `set_enabled(true)` checks license + biometric but **never checks canEnable/modelReady/inference deps** before writing `modelEnabled: true`. Fake-green is live in code today.
  - A3 open: `model-state-messages.ts:28,222` still TinyClick-branded, including the switch label users see.
  - A4 open: `LICENSE_DOOR_TEXT` (`model-license.ts:97-125`) has no SPDX, no trust_remote_code ACE, no disk path, and hardcodes "从 Hugging Face 下载" even when the resolved source is ModelScope/mirror — violating §16.4 items 1–4 in its current form.
  - A6 open: 2048MB budget enforcement above.
  - A7 addressed well at design level (S_DOWNLOADING/S_PARTIAL/S_VERIFYING patch), though S_PARTIAL's "清理并重试/续传" has no defined detection rule for what counts as a partial directory (vs. B1's readiness rule) — the two should share one definition.

  §16.5's acceptance checklist is the right closing mechanism and is honestly unchecked.

  ## User journey / CN network

  Honest and mostly shippable as written: connectivity probing + locale over IP geolocation is the right call; `downloadSourceReason` mandatory display prevents silent source switching; the no-Python journey (S1, disabled download, copyable commands) is truthful. Gaps:

  - **Python acquisition itself in CN**: G1 covers `pip` commands but python.org is itself slow/unreliable from mainland networks; no mirror guidance (e.g. huaweicloud/python mirrors) or `pyenv`/uv alternative. For a design whose stated #1 user goal is 能下， the first dependency's acquisition path is undirected. B8 covers torch-CN but not Python-CN.
  - §11's "大陆下载成功率 ≥70%" has no measurement mechanism until P3 telemetry — the headline success metric is unmeasurable for the entire period it matters most. Either define a local-log measurement in P1 or downgrade the metric.
  - Download cancel is P1 but S_DOWNLOADING is defined as a P0 state — a user with a stalled 4.5GB download on a bad connection has no designed escape at P0 except deleting the directory manually.

  ## Trust / supply-chain

  - re-L2-always + session-trust exclusion + god-mode never skipping experimental: sound, and D11 closes the one residual bypass. R1 passes.
  - source:"settings" mutators + biometric channel-required (code confirms fail-closed `NO_CONFIRMATION_CHANNEL`): good.
  - License door: §16.4 checklist satisfies R5 at spec level (ACE, path template, source family, hash-bound versioning, D9 reset). Remaining weakness: item 1's "SPDX（**如** Apache-2.0）以快照 LICENSE 为准" is hedged — the door must ship verified per-variant SPDX, not an example; and item 4 says source is stated "以当前选择为准" but the door can be accepted before the resolved source is known (auto probing), so the text must bind to `downloadSourceResolved` at acceptance time, not render statically. Current code text shows what happens when this is left loose.
  - Mirror trust: hf-mirror is a third-party relay; §8.1 defers hash pinning to P1/C3. For P0 the door should at minimum state that mirror downloads are unverified against upstream. Currently unstated.
  - Notices: B5 (THIRD_PARTY Qwen) correctly P1.

  ## Residual holes (design-level)

  1. **Stale text contradicting locks**: §5.4(5) vs D1; §4.2 S7/§8.2 vs D9; §10 phasing vs §16.2 phasing of A2/D1. An SoT whose §9 says "locked" while body sections say "P1 decision / 手改 config" will be implemented wrong by whoever reads the body first.
  2. **D8 and D11 are alternatives, not locks** — decide one branch each.
  3. **trust_remote_code necessity never evaluated** — design assumes it; a pinned-native-transformers path could remove the ACE entirely.
  4. **License door source binding**: door text must render from `downloadSourceResolved` at acceptance time; current design says "以当前选择为准" without saying when the snapshot is taken.
  5. **Python-in-CN acquisition path** missing from the no-Python journey.
  6. **Success metric measurability** (≥70% CN download) undefined pre-P3.
  7. **S_PARTIAL detection rule** undefined and potentially inconsistent with B1 readiness rule.
  8. **No P0 escape from stalled download** (cancel deferred to P1).

  ## Blocking

  None against the six rejection gates — R1–R6 all pass at spec level (D1=A locked, D3 pixel-only locked, D8 resolves the 2048MB contradiction in principle, §16.4 contains ACE/path/source, and the doc explicitly forbids claiming 可内测 with A1–A8 open). However, items 1 and 2 above must be fixed before this document is cited as merge-ready SoT, because they are self-contradictions *about* the gates (R2's phasing, R4's chosen semantics).

  ## Nits

  - §16.4 item 6 ("不随包分发 torch/transformers") is good and should also appear in the user doc §2, which currently reads as if pip install is the only path.
  - User doc §7 mentions TinyClick by name while D6 mandates 文案零 TinyClick — user-facing copy should say "旧实验层" or similar; also user doc §2/§6 not yet rewritten per §16.5 checklist item 3 (acknowledged, but note the user doc currently promises "下载按钮灰" behavior that predates D1's hard-disable semantics).
  - §5.1 readiness "config.json + 体积统计" and B1 "至少一个权重文件" should be one rule stated once.
  - §4.1 mermaid skips the S6 circuit-breaker entry path entirely.
  - Worker docstring (`qwen-vl-worker.py:40`) advertises three accepted coordinate formats; D3 pixel-only should name the single accepted wire format to make the golden test meaningful.

  ## Verdict confidence

  82%

  VERDICT: APPROVE_WITH_CHANGES

