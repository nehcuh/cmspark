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
