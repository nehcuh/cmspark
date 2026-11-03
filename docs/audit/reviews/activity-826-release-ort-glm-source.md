# Release optional ONNX installer — actual GLM source gate

**APPROVE** the frozen three-path fix at commit level; after coordinator gate confirmation, permit one purposeful changed-source manual invocation toward the first actual CDB/MCP experiment. Not merge, acceptance or publication approval.

- Base: `3e48f26190cc9e0f37edc9f70b54b2b36532606b`.
- Manifest SHA256: `94abeea9daa6dc374504ac9bb41d7114b95ce1bf0062877e53bc5771b88b8657`.
- Full patch SHA256: `208cc5e30f224541a0e1f59eadbb10e3426aa6f1bb9a67d0bd6235d816415894`.
- Prompt SHA256: `f9c573d8bb5ebac5a630f76ca73fac8462ff4ba8464914b26d6f7983f1013a5c`; 154548 bytes.
- Actual reviewer: Claude CLI `2.1.153`, provider `open.bigmodel.cn`, sole actual `modelUsage` key `glm-5.3`; process exit `0`, status `success`, duration `119171ms, actual input/output tokens 40502/6569. Safe wrapper disabled tools/hooks/MCP.
- Inputs included all three complete current source files/full patch, complete previous/current Release, complete B proof and author real-installer controls/logs, complete pinned installer/utils/metadata/versions/package/binding declarations, actual CPU consumer and relevant full package functions. Eight unchanged critical hashes were matched. No live config, native UI, network installer, CDB or dispatch executed by this gate.
- Normal Release install inputs intentionally changed; **fresh normal three-platform dry-run on final shipping tree remains mandatory**. Current actual CDB/MCP business attempts remain zero.

## Coordinator evidence clarification

The model paragraph describing shipped content as unchanged or stricter is source-policy reasoning only, not verified artifact equivalence. Normal Release installation inputs intentionally changed; no new package has been produced or compared here. Fresh normal three-platform Release dry-run on the final shipping tree, real Linux/Windows CPU binding loading, and final package checks remain required, as the model disposition itself states. Cosmetic nits do not require a new edit or review.

## Actual model response (verbatim)

## SOURCE VERDICT: **APPROVE** (commit-level, gated)

Scope held to the frozen three-code-path installer correction at base `3e48f26`. B's nonauthor APPROVE conclusion is **confirmed, not refuted**.

### Defect analysis against embedded source

**1. Root cause is correctly targeted.** Actual `install-metadata.js`: `requirements['linux/x64'] = ['cuda12']`, all other five rows `[]`. Preflight runs on `ubuntu-latest` → linux/x64 → default path resolves `Microsoft.ML.OnnxRuntime.Gpu.Linux` from `https://api.nuget.org/v3/index.json` (real `install-utils.js` `nugetPackageUrlResolver`), matching the observed ETIMEDOUT/ENETUNREACH in run41562258351's `cd companion && npm ci` (NOT_RUN receipt confirms failure at exactly that step). Windows/macOS legs have empty manifests and already exit 0 with no network — the fix's effective delta is linux/x64 only.

**2. The flag is supported and exits before any optional work.** Real `parseInstallFlag()`: `case 'skip': return false`. Real `install.js`: `if (INSTALL_FLAG === false) { process.exit(0); }` — before platform metadata lookup, before the `existsSync` presence loop, before `installPackages`. The persistent test's controlled-leaf run proves `exists === 0, urls === 0, copies === 0, writes === 0` for all six platform/arch combos with `exit 0`. Materially narrower than `--ignore-scripts`: `companion/package.json` postinstall (patch-node-pty-worker + verify-systray2 + build-swift-tray) and plain `npm ci` remain; lock hash `33f50bb2…` unchanged in manifest.

**3. Bundled CPU runtime untouched.** No manifest lists `onnxruntime_binding.node` or the core `libonnxruntime.so.1`/`onnxruntime.dll` — those ship in the npm tarball (three-target nonempty stats embedded). Real consumer `diarize-embed.ts` calls `InferenceSession.create(modelPath)` with no `executionProviders`. `package.sh` `strip_ort_optional_providers` is `rm -f` (idempotent when providers were never downloaded); shipped content is unchanged or stricter — the Linux zip assert (binding + core required, providers must be absent) still holds trivially.

**4. Seal test remains sound after the declared addition.** New consumer asserts exact `env: {ONNXRUNTIME_NODE_INSTALL: 'skip'}` per job (any extra env var fails), `split(cpuInstall).length === 3` (exactly two occurrences), then `replaceAll` back to the plain block before hashing — the probe job's differently-shaped step cannot match, and any *other* workflow drift fails the original67 LF/CRLF sha256 seals. B's controls log independently shows both byte forms restored exactly plus 20 negative mutations (missing/wrong flag either job, duplicate step, `--ignore-scripts` command and env, audit bypass, matrix change) rejected by the actual assertions, and `requireCpuInstalls` red on pre-fix `3e48` / green on current.

**5. Test harness executes real code.** The observing `installPackages` wrapper delegates to the actual `install-utils.js` implementation; HTTPS/fs/OS/ZIP leaves only. Default-path assertions (3 URLs, index→package-index→`.nupkg`, 3 manifests = cuda/shared/tensorrt, 3 copies, 1 write) match the real script's behavior, not a stub. The host addon test consumes the actual `listSupportedBackends()` DTO per real `lib/binding.ts` `SupportedBackend {name, bundled}`; correctly `skip`s non-release hosts and makes no inference claim.

No supported, reachable defect found. Cosmetic nits only (stray blank line before the first test's closing brace; one long multi-concern test name) — non-blocking.

### Disposition

- **APPROVE committing** the three-path fix. Not merge/acceptance/publication.
- **Required before acceptance/shipping:** FRESH normal three-platform Release dry-run on the final shipping tree — install inputs changed, old 67/d94 packaging evidence cannot clear this. Actual Linux and Windows CPU binding load and final package output remain platform gates; the three file-presence observations and macOS arm64 load do not substitute.
- **Authorize ONE purposeful changed-source manual invocation** toward the FIRST actual CDB/MCP experiment, only after coordinator confirms gates. Both prior invocations remain NOT_RUN/zero samples. Preserved invariants: original MCP20 unchanged, mandatory actual close, configured 3/6/6 termination-request interpretation within nohard15, original failure outcome not replaced, one-outcome/retirement, canonical all-green/main/tag requirements. This installer fix supplies no MCP root-cause claim and no physical stack evidence.
