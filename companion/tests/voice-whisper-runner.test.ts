// Path B M1 Task 3 — whisper-runner (fake binary + inject execFile)

import test from "node:test"
import assert from "node:assert/strict"
import { execFile as realExecFile, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

import {
  buildWhisperArgs,
  parseWhisperStdout,
  runWhisperTranscribe,
  WhisperRunnerError,
  type ExecFileImpl,
} from "../src/voice/whisper-runner"

// Fixture lives under source tests/fixtures (tsc does not copy .mjs into .test-dist)
const FIXTURE_CANDIDATES = [
  path.join(__dirname, "fixtures", "fake-cmspark-whisper.mjs"),
  path.join(__dirname, "..", "..", "tests", "fixtures", "fake-cmspark-whisper.mjs"),
]
const FIXTURE = FIXTURE_CANDIDATES.find((p) => existsSync(p))
if (!FIXTURE) {
  throw new Error(`fake-cmspark-whisper.mjs not found; tried: ${FIXTURE_CANDIDATES.join(" | ")}`)
}

test("buildWhisperArgs matches whisper-cli schema", () => {
  const args = buildWhisperArgs({ modelPath: "/m.bin", audioPath: "/a.wav", lang: "zh", threads: 4 })
  assert.deepEqual(args, [
    "-m",
    "/m.bin",
    "-f",
    "/a.wav",
    "-l",
    "zh",
    "-nt",
    "-ng",
    "-np",
    "-t",
    "4",
  ])
})

test("parseWhisperStdout strips logs and handles BLANK_AUDIO", () => {
  assert.equal(parseWhisperStdout(""), "")
  assert.equal(parseWhisperStdout("hello world\n"), "hello world")
  assert.equal(parseWhisperStdout("ggml_init: foo\nwhisper_model: bar\n你好\n"), "你好")
  assert.equal(parseWhisperStdout("[BLANK_AUDIO]\n"), "")
  assert.equal(parseWhisperStdout("heard\n[BLANK_AUDIO]\nlast"), "heard last")
  assert.equal(parseWhisperStdout("开会了\n[BLANK_AUDIO]\n请记录"), "开会了 请记录")
  assert.equal(parseWhisperStdout("开始 [BLANK_AUDIO] 结束"), "开始 结束")
  assert.equal(
    parseWhisperStdout("main: processing\nuse Metal\ntranscript line\n"),
    "transcript line",
  )
})

test("runWhisperTranscribe with fake fixture binary", async () => {
  const r = await runWhisperTranscribe({
    binaryPath: process.execPath,
    modelPath: "/tmp/model.bin",
    audioPath: "/tmp/audio.wav",
    lang: "zh",
    timeoutMs: 10_000,
    // node path/to/fake.mjs -m ... 
    execFileImpl: ((file, args, options, cb) => {
      // Prepend fixture script as node arg
      const nodeArgs = [FIXTURE, ...(args as string[])]
      return realExecFile(process.execPath, nodeArgs, options, cb)
    }) as ExecFileImpl,
  })
  assert.equal(r.text, "hello fixture")
  assert.ok(r.ms >= 0)
})

test("runWhisperTranscribe injects execFile and checks argv", async () => {
  let seenArgs: string[] | null = null
  const fakeExec: ExecFileImpl = (file, args, _options, cb) => {
    seenArgs = args as string[]
    assert.equal(file, "/bin/cmspark-whisper")
    queueMicrotask(() => cb(null, "injected text\n", ""))
    return { kill() { return true }, pid: 1 } as ChildProcess
  }
  const r = await runWhisperTranscribe({
    binaryPath: "/bin/cmspark-whisper",
    modelPath: "/models/small.bin",
    audioPath: "/tmp/a.pcm",
    lang: "en",
    execFileImpl: fakeExec,
  })
  assert.equal(r.text, "injected text")
  assert.ok(seenArgs !== null)
  const args: string[] = seenArgs ?? []
  assert.equal(args[0], "-m")
  assert.equal(args[1], "/models/small.bin")
  assert.equal(args[2], "-f")
  assert.equal(args[3], "/tmp/a.pcm")
  assert.equal(args[4], "-l")
  assert.equal(args[5], "en")
  assert.ok(args.includes("-nt"))
  assert.ok(args.includes("-ng"))
  assert.ok(args.includes("-np"))
  assert.ok(args.includes("-t"))
})

test("runWhisperTranscribe timeout via killed child", async () => {
  const fakeExec: ExecFileImpl = (_file, _args, _options, cb) => {
    const err = Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM", code: null })
    queueMicrotask(() => cb(err as any, "", ""))
    return { kill() { return true }, pid: 2 } as ChildProcess
  }
  await assert.rejects(
    () =>
      runWhisperTranscribe({
        binaryPath: "/bin/x",
        modelPath: "/m",
        audioPath: "/a",
        timeoutMs: 100,
        execFileImpl: fakeExec,
      }),
    (e: unknown) => e instanceof WhisperRunnerError && e.code === "timeout",
  )
})

test("runWhisperTranscribe abort signal kills child", async () => {
  const ac = new AbortController()
  let killed = false
  const fakeExec: ExecFileImpl = (_file, _args, _options, cb) => {
    const child = {
      kill(sig?: NodeJS.Signals | number) {
        killed = true
        // simulate abort kill
        queueMicrotask(() => {
          const err = Object.assign(new Error("aborted"), {
            killed: true,
            signal: sig || "SIGTERM",
            code: null,
          })
          cb(err as any, "", "")
        })
        return true
      },
      pid: 3,
    } as ChildProcess
    // abort shortly after start
    queueMicrotask(() => ac.abort())
    return child
  }
  await assert.rejects(
    () =>
      runWhisperTranscribe({
        binaryPath: "/bin/x",
        modelPath: "/m",
        audioPath: "/a",
        signal: ac.signal,
        timeoutMs: 30_000,
        execFileImpl: fakeExec,
      }),
    (e: unknown) => e instanceof WhisperRunnerError && e.code === "aborted",
  )
  assert.equal(killed, true)
})

test("runWhisperTranscribe pre-aborted signal rejects immediately", async () => {
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(
    () =>
      runWhisperTranscribe({
        binaryPath: "/bin/x",
        modelPath: "/m",
        audioPath: "/a",
        signal: ac.signal,
        execFileImpl: (() => {
          throw new Error("should not spawn")
        }) as any,
      }),
    (e: unknown) => e instanceof WhisperRunnerError && e.code === "aborted",
  )
})

const cudaRuntime = {
  backend: "cuda" as const,
  binaryPath: "/gpu/cuda.exe",
}
const cudaOpts = {
  binaryPath: "/cpu/whisper.exe",
  modelPath: "/models/medium.bin",
  audioPath: "/tmp/speech.wav",
  acceleration: { selectRuntime: async () => cudaRuntime },
}
const cudaDevice = "  Device 1: NVIDIA GeForce RTX 4080 SUPER, compute capability 8.9, VMM: yes\n"
const cudaEvidence = [
  "whisper_model_load:        CUDA1 total size = 1533.10 MB",
  "whisper_backend_init_gpu: using CUDA1 backend",
  "whisper_print_timings:     encode time = 150.00 ms",
].join("\n")

test("verified Windows CUDA runs without CPU flags and reports the chosen device", async () => {
  let ranGpu = false
  const result = await runWhisperTranscribe({
    ...cudaOpts,
    execFileImpl: (file, args, options, cb) => {
      ranGpu = file === "/gpu/cuda.exe" && !args?.includes("-ng") && !args?.includes("-np")
      queueMicrotask(() => cb(null, "heard", cudaDevice + cudaEvidence))
      assert.equal(options.shell, false)
      return { kill() { return true } } as ChildProcess
    },
  })
  assert.equal(ranGpu, true)
  assert.equal(result.text, "heard")
  assert.equal(result.execution?.backend, "cuda")
  assert.equal(result.execution?.device, "NVIDIA GeForce RTX 4080 SUPER")
})

test("CUDA enumeration or successful CPU output alone triggers one explicit CPU retry", async () => {
  const attempts: Array<{ file: string; args: readonly string[]; timeout: number | undefined }> = []
  const result = await runWhisperTranscribe({
    ...cudaOpts,
    timeoutMs: 3_000,
    execFileImpl: (file, args, options, cb) => {
      attempts.push({ file, args: args ?? [], timeout: options.timeout })
      if (file === "/gpu/cuda.exe") {
        setTimeout(() => cb(null, "unproven", cudaDevice + "whisper_backend_init_gpu: no GPU found\n"), 25)
      } else {
        queueMicrotask(() => cb(null, "CPU transcript", ""))
      }
      return { kill() { return true } } as ChildProcess
    },
  })
  assert.equal(result.text, "CPU transcript")
  assert.deepEqual(attempts.map((attempt) => attempt.file), ["/gpu/cuda.exe", "/cpu/whisper.exe"])
  assert.ok(attempts[1]?.args.includes("-ng"))
  assert.ok(attempts[1]?.args.includes("-np"))
  assert.ok((attempts[1]?.timeout ?? 0) < (attempts[0]?.timeout ?? 0))
  assert.equal(result.execution?.backend, "cpu")
  assert.equal(result.execution?.fallbackReason, "cuda_unproven")
})

test("GPU failure falls back only once when CPU also fails", async () => {
  const files: string[] = []
  await assert.rejects(
    runWhisperTranscribe({
      ...cudaOpts,
      execFileImpl: (file, _args, _options, cb) => {
        files.push(file)
        const error = Object.assign(new Error("process failed"), { code: 1 })
        queueMicrotask(() => cb(error, "", ""))
        return { kill() { return true } } as ChildProcess
      },
    }),
    (e: unknown) => e instanceof WhisperRunnerError && e.code === "nonzero_exit",
  )
  assert.deepEqual(files, ["/gpu/cuda.exe", "/cpu/whisper.exe"])
})

for (const failure of ["abort", "timeout", "model", "audio"] as const) {
  test(`GPU ${failure} does not launch CPU`, async () => {
    const files: string[] = []
    const controller = new AbortController()
    const timeout = Object.assign(new Error("timeout"), { killed: true, signal: "SIGTERM" as const })
    const badModel = Object.assign(new Error("model invalid"), { code: 3 })
    await assert.rejects(
      runWhisperTranscribe({
        ...cudaOpts,
        signal: controller.signal,
        execFileImpl: (file, _args, _options, cb) => {
          files.push(file)
          queueMicrotask(() => {
            if (failure === "abort") controller.abort()
            if (failure === "timeout") cb(timeout, "", "")
            if (failure === "model") cb(badModel, "", "whisper_model_load: invalid model data (bad magic)\n")
            if (failure === "audio") cb(null, "", "error: failed to read audio file '/tmp/speech.wav'\n")
          })
          return { kill() { queueMicrotask(() => cb(timeout, "", "")); return true } } as ChildProcess
        },
      }),
      (e: unknown) => e instanceof WhisperRunnerError &&
        e.code === (failure === "abort" ? "aborted" : failure === "timeout" ? "timeout" : "nonzero_exit"),
    )
    assert.deepEqual(files, ["/gpu/cuda.exe"])
  })
}

test("runtime selection shares the original deadline and aborts without spawning", async () => {
  let spawned = false
  await assert.rejects(
    runWhisperTranscribe({
      ...cudaOpts,
      timeoutMs: 15,
      acceleration: { selectRuntime: () => new Promise((resolve) => setTimeout(() => resolve(cudaRuntime), 60)) },
      execFileImpl: (_file, _args, _options, cb) => {
        spawned = true
        queueMicrotask(() => cb(null, "", ""))
        return { kill() { return true } } as ChildProcess
      },
    }),
    (e: unknown) => e instanceof WhisperRunnerError && e.code === "timeout",
  )
  assert.equal(spawned, false)
})
