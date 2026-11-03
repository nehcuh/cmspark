# #826 normal three-platform preview — actual1e2fea18 receipt

**PASS for this exact preview head. Not final shipping-tree/CI/main/tag approval or publication.** [Run41572026005](https://github.com/nehcuh/cmspark/actions/runs/41572026005), attempt1, workflow_dispatch, completed SUCCESS2026-11-03T03:39:56Z. Actual full head `1e2fea18ceb82966bb09d1d424cfe32f79a51613`.

Real source at that head: Release SHA256 `7d0fdd3f1212d480760ec646ce492d709eb18e9ed6a79a7e00aeca3b51f0f4a4`; workflow_dispatch has no input; no probe job/route. Definitions are preflight/package/release, package matrix exactly macos-arm64/linux-x64/windows-x64, two normal CPU-install skip blocks. Source receipt `/tmp/cmspark-826-release-preview-1e2fea18-source.json`.

## Actual terminal jobs

| Job | ID | UTC start–end | Result |
|---|---:|---|---|
| Test + audit (preflight) |125706911978|03:24:39–03:32:40|SUCCESS|
| Build (linux-x64) |125709461054|03:32:43–03:35:12|SUCCESS|
| Build (macos-arm64) |125709461092|03:32:43–03:38:12|SUCCESS|
| Build (windows-x64) |125709461093|03:32:43–03:39:55|SUCCESS|
| Publish GitHub Release |125711752026|not executed|SKIPPED|

Metadata observed on45–60s cadence. Each executed job's complete log was downloaded once, only after its terminal state. Skipped publication metadata was captured; no executable job/log exists for that skipped route. No binary artifact downloaded or executed. No source change/dispatch/rerun/cancel/model API/native probe by this watch.

## Actual checks

- Preflight release guard, normal npmci, build, real tests and high+ audit completed successfully. Actual new locked-installer, bundled CPU native-runtime load and Release CPU-env tests all passed on Linux (log47981–47994). Extension batch1874PASS,0fail. Other Companion batches likewise0fail, with their normal platform skips; metadata, not inferred log totals, is the full preflight success authority.
- Linux staged ORT linux/x64; ZIP listing contained binding389424bytes and core44726808bytes; GPU-provider absence, qwen worker and systray2 checks succeeded. Relocated bilingual DOC conversion passed using packaged wasm sidecar.
- macOS staged ORT darwin/arm64; actual host signature verification and native build succeeded. ZIP host+tray+scpt+qwen content assertion passed. Relocated bilingual DOC conversion passed native sidecar.
- Windows staged ORT win32/x64; pinned NSIS installation succeeded; actual NSIS built `CMspark-Setup-v0.8.0.exe` (log reports102M). ZIP host-scripts-win+qwen and nonempty Setup.exe assertions passed. Relocated bilingual DOC conversion passed native sidecar. Both ZIP and Setup artifacts uploaded successfully.

CPU staging/build checks are not claims of model inference or real diarization quality. Preflight actual CPU-addon load ran on Linux; no extra runtime probe was added for other platforms.

## Actual Actions artifact inventory

All4exist, unexpired and bound by API to this exact head. Sizes below are Actions artifact archive bytes, not the six official release-asset sizes.

| Artifact name | ID | Size(bytes) |
|---|---:|---:|
|cmspark-linux-x64|13202640237|138239442|
|cmspark-macos-arm64|13201669300|155820076|
|cmspark-windows-x64|13201734403|161764620|
|cmspark-windows-x64-setup|13201944139|106634178|

Artifact digests from API:
- Linux `9dd2f0dd7f426c64da1142d40a6eefb7d968c455a65880407aa813a14edbc9bc`
- macOS `c95d53a22bcbf68f86a16689eae7dd353d8956b65b473ef085863bf68eb2b056`
- Windows ZIP `742ec18467bc953640c1454f6fcd6fd8d90510ad0581298176d2c4f85f95c741`
- Windows Setup `c955ead1d044d5274ad64752a5459f586178c6a286a2ca7a3484d7ddd3c29210`

## Reuse boundary

Root reports an independently found current CI Windows activity-fixture failure and a pending coherent fix. If that fix changes the final whole Git tree, this preview does **not** satisfy the final shipping preview. It retains concrete unchanged-input evidence for CPU installation and three-platform packaging. Final preview reuse requires identical merged-main whole tree and unchanged actual lock/package/workflow/build inputs; otherwise root decides the relevant new normal preview after new-head CI is green. No second preview was dispatched by this watch.

Normal required CI and merged-main CI must be green before tag/publication. Official tag Release still independently builds and verifies official assets/checksums. This completed workflow deliberately published nothing.

Saved local evidence prefix `/tmp/cmspark-826-release-preview-1e2fea18-`: run.json, artifacts.json, source.json, preflight/linux/macos/windows .json/.log, publish.json. API commands used read-only run/jobs/job/logs/artifacts endpoints; no artifact-content endpoint requested.
