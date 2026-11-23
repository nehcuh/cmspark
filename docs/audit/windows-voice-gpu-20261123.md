# Windows local Whisper GPU acceptance — 2026-11-23

GitHub: #892. Approved scope: NVIDIA CUDA first, cross-vendor Vulkan, CPU fallback, truthful UI. Working branch: `codex/windows-voice-gpu`, base `5d4d80df`.

## Physical evidence

Windows x64, Node 22.23.4 x64, i9-14900KF, NVIDIA GeForce RTX 4080 SUPER, 16,376 MiB, NVIDIA driver 610.88. Windows inventory also exposes an Oray virtual display; it remains visible in settings but never qualifies for acceleration. No live `config.json`, installed application files or system drivers were changed. All component installations and executions used a task-owned data directory.

Compiled production `runWhisperTranscribe` executed each backend with the same audio/model, requiring native backend initialization, positive model allocation on that backend and its corresponding real device name. GPU requests omitted both `-ng` and `-np`. CPU retained `-ng`. Timings include request selection, pin validation, native process creation, model load and inference; they exclude recording and UI latency and are single local observations, not performance guarantees.

| Model / input | CUDA | Vulkan | CPU |
|---|---:|---:|---:|
| medium / 11.0s recorded English | 3.108s | 2.499s | 24.891s |
| large-v3-turbo / 9.1s synthetic Mandarin | 1.927s | 1.842s | 11.214s |

All three backends produced identical words for each clip. English came from upstream [`samples/jfk.wav`](https://github.com/ggml-org/whisper.cpp/blob/v1.7.6/samples/jfk.wav). Mandarin was generated locally using Windows Microsoft Huihui Desktop, 16kHz mono PCM16: “这是本地语音转写测试，使用英伟达显卡进行加速。请把这句话转换成文字。” This is a synthetic speech test, not a microphone or end-to-end recording test. The existing user's medium and turbo model files were read without altering their configuration.

Actual native evidence included:

```text
Device 0: NVIDIA GeForce RTX 4080 SUPER, compute capability 8.9, VMM: yes
whisper_model_load:        CUDA0 total size = 1533.14 MB
whisper_backend_init_gpu: using CUDA0 backend
ggml_vulkan: 0 = NVIDIA GeForce RTX 4080 SUPER (NVIDIA) | uma: 0 | fp16: 1
whisper_model_load:      Vulkan0 total size = 1533.14 MB
whisper_backend_init_gpu: using Vulkan0 backend
```

The English model allocation above belongs to medium. Native device enumeration alone is insufficient; the production parser also requires matching initialization and allocation. nvidia-smi activity was sampled during runs, but those counters are host-wide and can lag between successive runs, so they are supplemental observations only.

Both acceptance runs additionally confirmed automatic CUDA selection and a state snapshot reporting the actual GPU. A process-local `CUDA_VISIBLE_DEVICES=-1` mask left Windows inventory intact but prevented CUDA execution: each request finished once on CPU with `fallbackReason=cuda_unproven` and the expected transcript. No driver was disabled. A real spawned CUDA child was aborted, its process exit checked, and the next CUDA transcription succeeded. Strict backend acceptance never substitutes CPU silently. Controlled tests separately cover original deadline accounting, no retry on abort/timeout/input failure, damaged runtime files and vendor/device boundaries.

Machine-readable model/audio hashes, actual execution records and fallback/cancellation results are in [windows-voice-gpu-20261123.json](windows-voice-gpu-20261123.json). The English run preceded addition of licensing metadata to the Vulkan archive; native executable and DLL hashes were unchanged. The Mandarin run used the final archive with notices.

## Distribution and build

CUDA uses the official whisper.cpp v1.7.6 CUDA 12.4 archive (443,253,884 bytes), upstream release SHA256 `3fc4d3ebd9a678313de50c04d9e59c43117ae190f0cb7bff602d4aeefc4efe3d`. Each installed executable/DLL is separately pinned. A minimal verified closure contains Whisper/ggml, ggml-cuda, cudart, cuBLAS and cuBLASLt. CUDA 11.8's smaller upstream archive failed `--help` here with Windows status `0xC0000135` because its cuBLAS dependencies were not included; it was not used for acceptance or distribution.

Vulkan is an approximately 7 MB optional archive in `companion/assets/whisper-vulkan-win-x64.zip`, with exact archive and per-file pins in `whisper-binary.manifest.json`. Existing Windows packaging copies the entire assets directory. An explicit install action can install this bundled archive without network; a corrupt bundle is refused. Its remote fallback URL becomes available from the repository after this branch merges; packaged offline installation does not depend on that URL. GPU directories are isolated from the CPU helper. End users need a compatible graphics driver/Vulkan loader, not a developer SDK.

The native resource supplier is `companion/scripts/build-windows-whisper-vulkan.ps1` (PowerShell 7.2+, MSVC 2022, CMake, unpacked Vulkan SDK). This session used MSVC 19.44.35228, CMake 4.4.5 and private Vulkan SDK 1.3.296.0. Upstream source zip SHA256 is `8c579f4468fc23ddd64092ca9d8f3933d831a358ae9b7fcc09b43d9496a020c5`; the SDK installer hash was `acb4ae0786fd3e558f8b3c36cc3eba91638984217ba8a6795ec64d2f9ffd8c4b`. No global SDK installation occurred. Native build warns about upstream numeric conversions; compilation succeeded without changing third-party native code. An initial nested shader build failed due to MSBuild MAX_PATH; the supplier enforces a short build path. It verifies source archive and source files, excluding only upstream CMake's generated JavaScript package metadata.

Rebuild example (supply installed tool paths):

```powershell
pwsh companion/scripts/build-windows-whisper-vulkan.ps1 -VulkanSdk C:\VulkanSDK\1.3.296.0 -BuildDir C:\cmspark-vulkan-build
```

Review regenerated native resources and pins together. A new compiler/SDK can produce different binary bytes; source provenance does not imply byte-reproducible builds.

Real acceptance command after compiling Companion:

```powershell
node companion/scripts/verify-windows-voice-gpu.mjs --data-dir C:\task-owned\voice-gpu --model C:\models\ggml-medium.bin --audio C:\audio\jfk.wav --lang en --output C:\task-owned\receipt.json
```

This explicit developer acceptance installs components in the supplied private directory and requires the local 4080 SUPER. It is not a first-run automatic download. `--cuda-archive` can supply the already downloaded, pinned official archive.

## Boundaries

AMD/Intel/other physical adapters have vendor-aware inventory and use the shared Vulkan candidate/execution path. Software/virtual display entries cannot establish actual GPU use. AMD and Intel physical execution remains unverified because those devices were not present. A detected adapter and installed loader are candidates, not proof of usable Vulkan features; successful native execution establishes the actual device. Unsupported architectures and platforms retain existing behavior. No Windows ARM64, macOS Metal, cloud audio, resident-model service or new microphone behavior is included.

## Checks

- Companion task 1: 186 affected tests passed; source and test TypeScript checks passed.
- Distribution: new bundled-install and corruption tests failed before the change, then passed; existing downloader tests also passed (7 tests total).
- CUDA/Vulkan/CPU real speech, automatic selection, genuine unavailable-CUDA fallback and real child cancellation/recovery passed for both model/input pairs above.
- UI and final review results are recorded below when completed.
