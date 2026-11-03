# #826 Release optional ONNX installer — independent nonauthor source review

**VERDICT: APPROVE the frozen three-code-path fix for the actual GLM source gate.** No supported blocker found. This is the existing CPU-build install-flag correction; it does not fix or validate the Windows MCP timeout. No dispatch, CDB/native UI execution or release acceptance was performed.

Base `3e48f26190cc9e0f37edc9f70b54b2b36532606b`. Read full three-path diff and the new persistent test, actual locked installer entry/utility control path, metadata/package contract, package CPU consumer assertions and the prior actual preflight failure. Manifest `/tmp/cmspark-826-release-ort-source-manifest.json` and full patch `/tmp/cmspark-826-release-ort-source.patch` bind this review. Independently verified **3 code hashes +8 unchanged critical hashes match**. I did not edit repository files, node_modules or live configuration, run npm ci, contact package/network providers, invoke models, dispatch/retry CI or run native UI.

## Concrete trigger and correction

Run41562258351 failed in normal Release preflight `npm ci`, where the locked onnxruntime-node1.29.0 postinstall entered its optional-provider NuGet download and received ETIMEDOUT/ENETUNREACH. The actual locked install metadata requests only `cuda12` for default linux/x64; the reviewed manifest destinations are CUDA, shared-provider and TensorRT libraries. Its CPU core and binding are already bundled. The package installer explicitly supports `ONNXRUNTIME_NODE_INSTALL=skip`; its real parser returns false and its actual install entry exits0 before manifest/filesystem/download work. This is narrower than disabling npm lifecycle scripts.

Release adds only that existing flag to the normal preflight and package `Install companion deps` steps. The commands remain plain `cd companion && npm ci`. Probe's already-existing flag remains. No lock, package version, npm script, test/audit command, package.sh, model consumer, native startup or runtime user setting is changed. The existing package path already declares CPU speaker embedding and removes optional CUDA/TensorRT libraries. This review does not infer GPU runtime functionality or Linux model inference from those facts.

## Test/consumer correctness

The persistent TS runs complete actual install.js and install-utils.js through controlled OS/HTTPS/filesystem/ZIP leaves. Its observing installPackages wrapper calls the actual implementation, so a hand-written parseFlag/download stub cannot decide the result. Default Linux/x64 exercises real metadata/feed/package formation and all three provider-copy destinations; envskip exercises the real parser/entry and proves zero optional exists/download/copy/write work for all six OS/arch combinations. The exact pinned version/postinstall and lock version are checked. It also checks actual nonempty CPU core/binding files for the three Release targets, existing package CPU preservation, and the existing speaker consumer not requesting CUDA/TensorRT.

A separate test invokes the actual onnxruntime-node native addon on supported Release hosts and consumes its real `listSupportedBackends()` DTO (`name`, `bundled`), requiring bundled CPU. My run was **macOS arm64**, not Linux/Windows, with no model load/inference or UI. File presence for other targets is not treated as their native load success. Unsupported Release-host combinations explicitly skip only that host-specific binding check.

Persistent Release assertions require exactly one matching normal install step per job, the unchanged plain npm ci command, envskip in both jobs, and unchanged real tests/audit commands. Missing either flag or both is rejected.

The temporary workflow inverse consumer separately asserts the **exact env object** for both normal installs, then permits only the two full exact reviewed install blocks before comparing complete original67 LF/CRLF raw seals. It cannot conceal an arbitrary normal workflow change. Normal Release install inputs intentionally changed; this is **not** a claim of complete byte-identical normal Release behavior. After removing these declared two additions plus the previously reviewed temporary probe, the original raw forms are exact. The parsed probe/tag/default-false truth matrix and upload permissions/path checks remain.

## Independent machine evidence

Node22.23.4 through nvm. Application/config-related test entry used the official isolated runner.

1. From companion: `node scripts/run-tests.mjs .test-dist/tests/release-cpu-install-826.test.js`.
   **3 PASS /0 FAIL /0 CANCEL /0 SKIP**. `/tmp/cmspark-826-release-ort-b-independent-machine.log`.
   This independently executes the real complete installer Linux-default versus envskip controlled-leaf branches, actual three-target bundled files, current macOS arm64 native CPU-backend load and real parsed Release assertions. Author's unchanged successful strict targeted compilation output was reused; no unnecessary recompilation deleted shared outputs.
2. Actual temporary workflow callback targeted run: **1 PASS /0 FAIL /0 CANCEL /0 SKIP**. `/tmp/cmspark-826-release-ort-b-workflow-machine.log`.
3. `/tmp/cmspark-826-release-ort-b-controls.mjs` and `.log`: **24 controls PASS**.
   - Actual AST-extracted current workflow callback accepts current LF and CRLF; its inverse produces both exact original67 Git-blob byte forms.
   - Actual `requireCpuInstalls` extracted from the new persistent test rejects real pre-fix3e48 Release with the missing-flag assertion and accepts the actual current Release.
   - Ten actual workflow mutations ×LF/CRLF =20 actual ERR_ASSERTION rejections: either missing normal flag, wrong preflight/package flag, duplicate preflight install, missing package install step, `--ignore-scripts`, ignore-scripts environment injection, audit bypass and changed normal package matrix. No missing-port/TypeError counts as rejection.
4. All3 frozen code/8 critical unchanged manifest hashes match; scoped diff-check PASS. Existing collector/probe/source opinions and unchanged test results are reused; this review did not reopen the COM/MCP investigation.

## Frozen source

- Release YAML: `72d65b48351f16c5b381c8309e8d4c52f9fcffe498636d6e763ac43629efcc10`.
- Temporary workflow consumer: `63d72a4a10e938df67a4e50d2451b1d2754f5747f86247478628e41dbbcc697e`.
- New persistent test: `ecee4f062a13bdedc0d26c0a51dd4c3288a2dd093b79e4b4f3d26dcf233f3e35`.

## Decision and remaining actual gates

**APPROVE.** Plain npm lifecycle execution, CPU packaging policy, normal tests/audit and original MCP20 remain. The previous two manual runs remain NOT_RUN for actual CDB and native MCP business. This fixes a supported Release preparation blocker and supplies no new MCP cause or physical stack evidence.

Because normal Release installation input has changed, **a fresh normal three-platform Release dry-run on the final shipping tree is required**; old d94/67 package evidence cannot clear this input. In particular, actual Linux/Windows CPU binding load and final packages remain platform gates. Source approval also does not substitute for the pending real CDB qualification, the one authorized native observation result, canonical all-green/main or the final tag/artifact checks.
