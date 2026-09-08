# #481 / #482 / #483 review evidence

Design: independent Grok4.6 and DeepSeekV4Pro APPROVE_WITH_NITS.
Initial implementation: Grok4.6 APPROVE_WITH_NITS, DeepSeekV4Pro REJECT.
Delta: DeepSeekV4Pro APPROVE, explicitly correcting the alleged duplicate-final path after checking code/tests. Grok first delta response contained only a preface and exited max-turns; not counted as approval. A fresh Grok delta review is pending. **Do not merge on this checkpoint.**

See disposition.md and design/disposition.md for checked findings, fixes and #484 follow-up. Original reports remain intact including inaccurate claims, marked as such in disposition. Payloads are gzipped; manifests pin reviewed files. DeepSeek uses configured endpoint with thinking disabled; model response confirms deepseek-v4-pro. Case-insensitive explicit verdicts are inspected; the runner's older has_verdict field is case-sensitive and can be false despite an explicit heading verdict.

Final local machine tests: Companion5015 pass/23 skipped +20 auxiliary; extension1296 pass. Builds and synthetic actual-App/HTML/React-hook browsers pass. See machine.json. No real-ASR acceleration or Windows native UI claim. Final staging DMG built; not installed at this checkpoint. Project entity and native #476 management remain unimplemented.
