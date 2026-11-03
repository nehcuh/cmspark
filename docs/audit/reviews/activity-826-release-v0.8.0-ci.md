# Independent official release acceptance — v0.8.0

**VERDICT: PASS. The real tag-push Release41588183961 completed all five jobs SUCCESS and published the stable v0.8.0 release with exactly six uploaded official assets.** This is the official invocation, not the old manual preview41585362043. Large release assets were neither downloaded nor executed by this reviewer; the coordinator independently owns their streamed-byte/checksum-list verification.

## Exact source/tag identity

- Official run [41588183961](https://github.com/nehcuh/cmspark/actions/runs/41588183961),event push,headBranchv0.8.0,headSha `38a1d6e9ce1f58a842c41fe589bc68a1dd1448e7` throughout45-second metadata observation.
- Independently verified remote annotated-tag object `6bcf23cf609b28ccc6010a4d10e991e7e3ef2d2a` equals the local annotated tag object and dereferences to exact38a. It is not an unreviewed branch tip/preview ref.
- Tree `2cdb5fba61d27adaa15444d68af1b7ddaace706a` is the same whole tree that passed PR7bb and exact-main38a's ten normal checks. Main evidence remains separately recorded in `/tmp/cmspark-826-main-38a1d6e9-ci.md`.
- Strict actual release guard passed: tag equals version0.8.0 anchor, clean tree, Unreleased archived; allow-untagged/allow-dirty off. No source/main change, rerun, cancellation, dispatch, permission/budget override, native/UI probe or model call was made by this reviewer.

## All five official jobs

| Job | ID | Final |
|---|---:|---|
|Test + audit (preflight)|125758470222|SUCCESS|
|Build (windows-x64)|125760200749|SUCCESS|
|Build (linux-x64)|125760200760|SUCCESS|
|Build (macos-arm64)|125760200928|SUCCESS|
|Publish GitHub Release|125762786000|SUCCESS|

Each actual job log was downloaded once after terminal status: `/tmp/cmspark-826-release-v0.8.0-job-<id>.log`. Metadata snapshot `/tmp/cmspark-826-release-v0.8.0-metadata.json`.

## Configured gates actually executed

Preflight performs tag/version/clean/archived guard, normal dependency scripts/install, companion build/full tests, actual permanent locked-installer/CPU-asset regression and real Linux bundled CPU native-addon load. Configured companion high+ supply-chain audit and extension build+tests all pass. This reports the configured audit's success, not an assertion that every development dependency has zero advisories.

All three platform package steps and upload steps pass. Conditional other-OS steps remain correctly skipped; no whole package job is skipped.

- Linux official ZIP: actual ONNX CPU napi/core files and absence of CUDA/TensorRT provider libraries pass content assertions; qwen worker and systray binary are present. Relocated Office sidecar performs actual bilingual DOC conversion via wasm, assertions-pass/dispose-settled, open_objects0, and verifies module loading without source resolution. ZIP content assert passes.
- MacARM official ZIP: native host/tray/script/qwen content assertions pass; required Mach-O binaries are verified. Actual relocated bilingual Office conversion via native darwin-arm64 runtime passes and disposes; ZIP content assert passes.
- Windows: pinned NSIS3.12 installer verification and availability pass; actual NSIS creates the official Setup.exe. Both portable ZIP and Setup.exe assertions/upload pass. Actual relocated bilingual Office conversion via native win32-x64 runtime passes, runtime loading without source module resolution and disposal complete. ZIP content assertions include the expected Windows scripts/qwen payload.
- Publish downloads its declared build artifacts, generates/uploads the two checksum lists and all four binaries, finalizes the release and succeeds. No preview Publish skip is treated as publication.

Independent closed source-of-result assertions for final job/step/asset metadata: `/tmp/cmspark-826-release-v0.8.0-independent-controls.log` — PASS. No additional package execution was introduced to obtain this receipt.

## Actual published release and six assets

[Official v0.8.0](https://github.com/nehcuh/cmspark/releases/tag/v0.8.0),Release ID432343273,stable (`draft=false`, `prerelease=false`),published at2026-11-03T06:23:26Z. Public metadata `/tmp/cmspark-826-release-v0.8.0-official-metadata.json`.

| Official asset | ID | Bytes | State |
|---|---:|---:|---|
|CMspark-Setup-v0.8.0.exe|704560804|106627995|uploaded|
|cmspark-v0.8.0-linux-x64.zip|704560809|140698076|uploaded|
|cmspark-v0.8.0-macos-arm64.zip|704560810|158689430|uploaded|
|cmspark-v0.8.0-windows-x64.zip|704560805|164229031|uploaded|
|SHA256SUMS|704560803|380|uploaded|
|SHA256SUMS.txt|704560800|590|uploaded|

Exactly four binaries plus two checksum lists, all nonzero uploaded, with SHA256 metadata and official tag download URLs. These are public server metadata checks; this report does not substitute metadata digests for the coordinator's separately streamed official-byte verification.

## Final disposition

Formal Release machine gate, stable publication and asset-metadata acceptance have no remaining blocker. Exact main's ten normal CI checks and the separate normal three-platform preview remain distinct prior receipts; neither is used to manufacture this official five-job success. The coordinator separately completed official streamed-byte verification: all four binary SHA256 values match both checksum lists and GitHub asset digests, and both checksum-list file digests match; its independent evidence is `/tmp/cmspark-0.8.0-official-verify/verification.json`. No binaries were executed. The remaining handoff is factual documentation synchronization. This report stays in /tmp, without changing the released/tested source tree merely to archive the pass.
