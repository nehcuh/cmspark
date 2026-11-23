# Windows voice GPU implementation plan

> Execute with subagent-driven-development; continuous execution after the approved design.

**Goal:** Ship Windows CUDA/Vulkan automatic local STT with honest device status and RTX 4080 SUPER evidence.
**Architecture:** Isolated pinned runtime directories feed one selection/execution adapter around the existing runner. Existing model-state messages carry inventory and execution status.
**Tech Stack:** Node 22.23.4 x64, TypeScript, whisper.cpp v1.7.6, CUDA 12.4 runtime, Vulkan, Windows PowerShell CIM.
**Spec:** `docs/superpowers/specs/2026-11-23-windows-voice-gpu-design.md`

## Global constraints

- GitHub #892; Windows x64 only; preserve existing macOS/Linux behavior and CPU package pins.
- No automatic download or driver install; no live config.json modifications.
- Verify every manifest-listed file; keep GPU DLLs separate from CPU files.
- Existing overall deadlines and abort semantics; at most one CPU fallback, with visible reason.
- Never identify active GPU from vendor inventory or success exit alone. Use native backend execution evidence.
- Explicitly mark AMD/Intel as unverified on physical hardware here.

## Task 1: Backend execution and Companion state

Files: new `companion/src/voice/whisper-acceleration.ts` (split inventory/execution helpers if needed), modify `whisper-runner.ts`, `whisper-state.ts`, `whisper-handlers.ts`; tests `voice-whisper-acceleration.test.ts` and runner tests.

Interfaces: manifest keys `win-x64-cuda`, `win-x64-vulkan`; install locations `<dataDir>/bin/whisper/win-x64/{cuda,vulkan}`; download message `voice.binary.download` with optional `backend: "cuda" | "vulkan"` (default CPU). State DTO `acceleration` shared with Task 3. Public `runWhisperTranscribe` remains the entry point, legacy/injected calls keep CPU behavior unless a real Windows runtime is selected. Provide an injectable selection seam for deterministic tests and a strict-backend path usable by acceptance without CPU fallback.

- [x] Write failing tests for GPU argv/evidence, priorities, fallback, abort and original timeout budget; run with Node's test runner via tsx.
  `node --import tsx --test tests/voice-whisper-acceleration.test.ts tests/voice-whisper-runner.test.ts`
- [x] Implement adapter using fixed no-shell executable calls, Windows CIM inventory and NVIDIA query; retain all adapters, exclude virtual drivers from acceleration claims. Probe all runtime files using `probeWhisperBinaryInstall`.
- [x] Integrate shared runner for prewarm/partial/final without duplicating selection. Emit a lightweight `voice.acceleration.execution` record to authenticated extension peers, hydrate inventory/latest in full settings snapshots, and keep per-request progress and backend selection server-validated. Never rebuild full model state on the inference hot path.
- [x] Run focused voice tests and TypeScript compile; self-review and commit only owned files. Record test commands/results and API contract for UI in `.superpowers/sdd/windows-voice-gpu/task-1-report.md`.

## Task 2: Native distribution and real acceptance (controller)

Files: `companion/assets/whisper-binary.manifest.json`, new private Vulkan build/stage script, new real acceptance script, `docs/audit/windows-voice-gpu-20261123.md`.

Consumes Task 1 runtime keys/install layout and production runner. Produces real archives, exact size/SHA256 for all runtime dependencies, and actual CUDA/Vulkan/CPU speech results.

- [x] Download the official v1.7.6 CUDA archive, verify upstream release digest, inspect required DLL closure; build Vulkan from pinned source with private SDK/tooling and a reproducible build command. Never edit third-party sources to disguise capability.
- [x] Add actual manifest entries with observed digests; test missing and tampered runtime dependencies refuse use.
- [x] Prepare fixed real speech WAV (system speech synthesis explicitly labeled synthetic plus upstream recorded speech if useful); use existing medium or turbo model without changing live configuration.
- [x] Run compiled production adapter with forced CUDA, Vulkan and CPU, requiring matching native execution evidence and useful transcript. Record model/audio/runtime hashes, timings, GPU samples, cancellation/recovery, known limitations. Stage downloaded components only in task-owned data directories.
- [x] Document how distributions obtain the Vulkan runtime, with complete byte verification. No unreviewed publish is part of this step.

## Task 3: Settings consumer and verification

Files: `chrome-extension/src/sidepanel/types.ts`, `hooks/useWebSocket.ts`, `components/SettingsSlideout.tsx`, new voice acceleration UI helper/component and focused tests.

Consumes Task 1 DTO/backend download message. Produces UI showing detected adapters, installed candidates, actual backend, fallback reason, explicit install actions and honest unverified vendor copy.

- [x] Add failing tests for old payloads, candidate vs actual, fallback copy, missing drivers and vendor support claims.
- [x] Mirror and validate DTO; render focused component near existing voice hardware hint. Do not predict latency or conflate model ready with GPU use.
- [x] Compile both packages and run affected voice/model/downloader/settings tests. Inspect rendered UI with representative real state.
- [x] Task-scope review each implementation and broad final review; fix actionable findings, then report implementation and physical evidence without overstating AMD/Intel coverage.
