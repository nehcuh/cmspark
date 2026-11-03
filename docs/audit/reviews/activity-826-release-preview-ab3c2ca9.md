# Final main 0.8.0 normal Release preview

Result: PASS for the final shipping whole tree. This is a branch preview; no GitHub Release was published.

Run: https://github.com/nehcuh/cmspark/actions/runs/41585362043 (workflow_dispatch, main, attempt 1).
Actual checkout: `ab3c2ca9555a544ec3aacc67ee9c1a9a8cee3516`.
Whole tree: `2cdb5fba61d27adaa15444d68af1b7ddaace706a`.
Started 2026-11-03T05:41:22Z; terminal SUCCESS 2026-11-03T05:54:47Z.

## Actual gates

| Job | ID | Result | UTC duration window |
|---|---:|---|---|
| Test + audit (preflight) | 125749465373 | SUCCESS | 2026-11-03T05:41:24Z — 2026-11-03T05:46:47Z |
| Build (linux-x64) | 125751138808 | SUCCESS | 2026-11-03T05:46:49Z — 2026-11-03T05:49:14Z |
| Build (windows-x64) | 125751138856 | SUCCESS | 2026-11-03T05:46:49Z — 2026-11-03T05:54:46Z |
| Build (macos-arm64) | 125751138862 | SUCCESS | 2026-11-03T05:46:49Z — 2026-11-03T05:50:59Z |
| Publish GitHub Release | 125753600556 | SKIPPED | 2026-11-03T05:54:47Z — 2026-11-03T05:54:47Z |

- Release source has only preflight/package/release definitions, no dispatch inputs or temporary probe job. Matrix is exactly macos-arm64, linux-x64, windows-x64. Two normal companion installs retain ONNXRUNTIME_NODE_INSTALL=skip; npm scripts/tests/audit remain enabled.
- All four executed jobs passed the real strict branch release guard: version 0.8.0, clean tree, present empty Unreleased. All actual eligible steps succeeded; platform-only ZIP checks were skipped on the other platforms as intended.
- Preflight Companion official four TAP groups: 4881 tests / 4742 pass / 139 skip; 4090 / 4046 / 44; 646 / 642 / 4; 22 / 22 / 0. Total 9639 tests, 9452 pass, 187 platform skips, zero failures. Extension build and all 1874 tests passed. Actual locked ORT installer, supported-host CPU native load and both Release CPU install flags controls passed.
- Supply-chain command `npm audit --omit=dev --audit-level=high` succeeded. It reported 8 moderate vulnerabilities; this is not a claim of zero advisories.
- Linux staged target ORT napi linux/x64 and Office wasm runtime; bundled Node completed actual relocated bilingual DOC conversion. ZIP asserted CPU binding/core, Qwen worker and systray2, with no optional CUDA/TensorRT provider.
- macOS staged target ORT napi darwin/arm64 and native Office runtime; actual relocated bilingual DOC conversion passed. Host codesign/build and ZIP host/tray/scpt/Qwen checks passed.
- Windows verified pinned NSIS 3.12, staged target ORT napi win32/x64 and native Office runtime, built CMspark-Setup-v0.8.0.exe, passed actual relocated bilingual DOC conversion, ZIP host-scripts/Qwen checks and nonempty Setup.exe assertion.

## Current run artifact inventory

All four are nonempty, unexpired Actions artifacts, bound by API workflow_run.head_sha to the exact ab3 checkout. These sizes/digests describe the Actions artifact archives, not the later official tag release assets. No binary artifact was downloaded or executed.

| Name | Artifact ID | Bytes | SHA-256 (Actions archive) |
|---|---:|---:|---|
| cmspark-linux-x64 | 13208200434 | 138239774 | `046de36d73d0ad5e3a2cee09f018231f817e8d15307bf66c73d0dba8b1385012` |
| cmspark-macos-arm64 | 13207209157 | 155817624 | `196a246f89508da2a42f10dc59960bff50f01e43a699b7b6ed50d65964beb939` |
| cmspark-windows-x64 | 13208027741 | 161763786 | `9296adb5d5a8445cc3f11996308e6fdb50558015481300f224c595841ea575d6` |
| cmspark-windows-x64-setup | 13207992906 | 106683132 | `742956311bb5f9f42e202a0f31b9c5a7d9669b9354fc4280e833fd167fde13b1` |

## Metadata-only main commit reuse

The later empty metadata commit `38a1d6e9ce1f58a842c41fe589bc68a1dd1448e7` has parent ab3 and the same complete Git tree `2cdb5fba61d27adaa15444d68af1b7ddaace706a`; `git diff --name-only ab3... 38a...` is empty. This is the same final shipping tree, not the earlier 1e2 preview or PR-only validation.

A focused actual-source search of scripts/package.sh, build scripts, release-guard.sh and release.yml found no Git SHA/build-commit embedding consumer. Git identity usage is confined to release guard repository/tag/clean validation. Branch ref remains main; version, lockfiles, workflows, npm/runtime/native sources and the two CPU install env blocks are byte-identical. The preview checkout SHA remains ab3 and is reported honestly; no exact-38a preview execution is claimed.

Therefore this successful normal three-platform preview is reusable for the metadata-only 38a main shipping tree under the unchanged branch/build inputs. B independently owns the exact-38a full ordinary main CI gate. Tag/publish remains contingent on that full gate being green; the official v0.8.0 tag workflow must still perform its own strict guard/build and release-asset verification.

## Evidence and commands

- Read-only metadata every approximately 45 seconds: `gh api repos/nehcuh/cmspark/actions/runs/41585362043/jobs --paginate`.
- Each executed terminal job log downloaded once only: `gh api repos/nehcuh/cmspark/actions/jobs/<id>/logs`; skipped publish has metadata only.
- Run/job/artifact API snapshots: `/tmp/cmspark-826-release-preview-ab3c2ca9-{run,jobs,artifacts}.json`; per-job metadata/logs use `preflight`, `linux`, `macos`, `windows`, with `publish.json`.
- Source receipt: `/tmp/cmspark-826-release-preview-ab3c2ca9-source.json` (Release SHA-256 `7d0fdd3f1212d480760ec646ce492d709eb18e9ed6a79a7e00aeca3b51f0f4a4`).
- Reuse source scan: `/tmp/cmspark-826-release-preview-ab3c2ca9-reuse-inputs.log`; `git rev-parse <ab3>^{tree} <38a>^{tree}` gave the same tree twice.
- Actual API assertions checked completed success/exact head/ref/event/attempt, exact five terminal job names/results, exact four artifact names/head binding/nonzero sizes/unexpired.

No source/index changes, dispatch/rerun/cancel, artifact binary downloads, installer execution or private/sealed evidence reads were performed.

VERDICT: PREVIEW_PASS; PUBLICATION_NOT_PERFORMED.
