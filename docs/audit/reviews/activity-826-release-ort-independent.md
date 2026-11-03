# #826 Release optional ONNX provider installation — independent evidence

Conclusion: the scoped reuse of existing `ONNXRUNTIME_NODE_INSTALL: skip` for Release preflight/package companion installation is supported. It disables optional GPU-provider fetching; it does not disable npm lifecycle scripts or remove bundled CPU runtime files. No MCP/Windows timeout or CDB conclusion follows from this installer result.

Read the actual pinned `companion/node_modules/onnxruntime-node/script/install.js`, complete `install-utils.js`, `install-metadata.js`, package metadata, package-lock, package.sh, diarize-embed.ts and Release/CI YAML. Installed and locked package version is1.29.0, with actual postinstall `node ./script/install`.

## Actual installer experiment

`/tmp/cmspark-826-release-ort-independent.cjs` runs the full actual install.js and full actual install-utils.js, including the real parseInstallFlag, package resolution, NuGet URL formation and three-entry extraction/copy loop. Only OS, HTTPS, filesystem and ZIP leaves are controlled; global-agent bootstrap remains called. No fake parseInstallFlag result or fake installPackages implementation decides behavior. The observing wrapper records arguments then invokes the original full installPackages.

Node22.23.4 via nvm; command `node /tmp/cmspark-826-release-ort-independent.cjs`; log `/tmp/cmspark-826-release-ort-independent.log`: PASS.

- Metadata requirements: linux/x64 alone is `cuda12`; the other five listed OS/arch rows have no optional manifests.
- Default linux/x64 with missing providers resolves `Microsoft.ML.OnnxRuntime.Gpu.Linux`, starts at the real metadata NuGet feed and forms a package download. The only destination copies are `libonnxruntime_providers_cuda.so`, `libonnxruntime_providers_shared.so`, `libonnxruntime_providers_tensorrt.so`. Neither CPU core nor onnxruntime_binding.node is a destination.
- Envskip makes actual parseInstallFlag return false; all six platform/arch combinations exit0 before existence checking, optional download, copy or write. Bootstrap still runs. The ordinary already-present case also exits without download.
- Read-only filesystem checks confirmed actual bundled regular/nonempty binding and core for release darwin/arm64, win32/x64, linux/x64, plus the package's linux/arm64 and win32/arm64 rows. This observes the locked installed package contents, not a newly downloaded tarball.
- package.sh explicitly states CPU speaker embedding, selects target NAPI folder and removes CUDA/TensorRT providers while retaining the CPU core/binding. Actual speaker `getSession` invokes `ort.InferenceSession.create(modelPath)` without asking for CUDA/TensorRT. This is source evidence, not model inference evidence.

## Persistent real-entry regression tests (authorized follow-up)

Authored only `companion/tests/release-cpu-install-826.test.ts`. It is automatically discovered by the normal official test runner. It preserves the full real-installer controlled-leaf proof, actual three-release-platform CPU file checks, actual metadata/lock pin, and Release preflight/package assertions. Removing either new env or both fails the real assertion. Tests/audit and plain `npm ci` commands remain required; there is no `--ignore-scripts`.

A separate runtime test actually loaded the current macOS arm64 ONNX native addon and consumed `listSupportedBackends()` through its real producer. Actual DTO was `[{name:'cpu',bundled:true},{name:'webgpu',bundled:true},{name:'coreml',bundled:true}]`; upstream lib/binding.ts declares `SupportedBackend{name,bundled}`. Test asserts bundled CPU using those actual fields. It is required on darwin/arm64, win32/x64 and linux/x64; other host targets explicitly skip this release-host-specific assertion. This performs no model download/inference or UI. Fresh Linux/Windows loading remains for actual CI; local macOS success is not substituted for it.

Commands from companion:

`node node_modules/typescript/bin/tsc --strict --target ES2022 --module commonjs --esModuleInterop --skipLibCheck --types node --rootDir . --outDir .test-dist tests/release-cpu-install-826.test.ts`

`node scripts/run-tests.mjs .test-dist/tests/release-cpu-install-826.test.js`

Strict compilation PASS; official runner **3 PASS,0 skip**, log `/tmp/cmspark-826-release-ort-persistent.log`.

Read-only actual HEAD baseline Release is copied using git show; the exact `requireCpuInstalls` function extracted from persistent TS rejects that pre-fix baseline and accepts root's current two-env edit. Log `/tmp/cmspark-826-release-ort-before-after.log`. No YAML source was mutated by this control.

Frozen test SHA256 `ecee4f062a13bdedc0d26c0a51dd4c3288a2dd093b79e4b4f3d26dcf233f3e35`.

No real network, npm ci, package/node_modules writes, source edits outside the explicitly assigned test, CI/API/nativeUI or dispatch occurred. The one addon load above was specifically authorized and uses no model. Root owns the two YAML env additions and strict inverse adjustment; this report does not source-approve those author changes or publication. B independent source review + actual GLM source gate remain required.
