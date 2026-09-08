# #481 / #482 / #483 review evidence

Design: independent Grok4.6 and DeepSeekV4Pro APPROVE_WITH_NITS.
Initial implementation: Grok4.6 APPROVE_WITH_NITS, DeepSeekV4Pro REJECT.
Final delta: **Grok4.6 APPROVE_WITH_NITS; DeepSeekV4Pro APPROVE**. DeepSeek explicitly withdrew the alleged duplicate-final defect after checking the exact implementation and regressions. Grok independently confirms the same outcome. Its first delta attempt returned only a preface / max-turns; that attempt is archived and never counted as approval.

User-authorized judge pairing is Grok + DeepSeek (replacing Claude and the generic local Pi template). T3: exact overlay metadata payload expansion is declared and checked; no new method or authority. Review applies to implementation commit `5cea49c47dac418ee4753de95f767b0d8079f781`; the final evidence commit changes audit documents only. Exact reviewed files are pinned by `recheck/manifest.json`.

See disposition.md and design/disposition.md for verified findings and fixes. Nonblocking follow-ups: #484 bounded dismissed-session retention; #486 non-stream continuous capture-start feedback. Original reports remain intact, including inaccurate claims explicitly corrected in disposition. Payloads are gzipped; manifests pin reviewed files. DeepSeek response metadata confirms deepseek-v4-pro. Its runner's older has_verdict field is case-sensitive and can be false despite an explicit heading verdict; actual final verdicts were inspected.

Final local machine tests: Companion 5,015 pass / 23 skipped + 20 auxiliary; extension 1,296 pass. Production builds and synthetic actual-App / HTML / React-hook browser checks pass. See machine.json. Staging DMG built and signature/bundle verified; see staging-proof.json. No real-ASR acceleration or Windows native UI claim. Project entity and native #476 management remain unimplemented.

**Review and local machine gate: PASS. Merge still requires successful CI on the final PR head.** The first Linux smoke failed before compiling, while onnxruntime-node's install attempted an external HTTPS download (ETIMEDOUT / ENETUNREACH); it did not run a failing application assertion. PR #485 records final CI and installation outcome.
