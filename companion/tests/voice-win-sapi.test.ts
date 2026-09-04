// #259 — Windows SAPI helper: line-JSON protocol + resolve/verify + runner.
// Spec: docs/superpowers/specs/2026-09-04-windows-sapi-fallback.md §3.2/§4/§6

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "cmspark-voice-win-sapi-"),
)

import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"

import {
  SAPI_HELPER_TIMEOUT_MS,
  WIN_SAPI_HELPER_EXE_NAME,
  WIN_SAPI_HELPER_SHA256_NAME,
  WinSapiError,
  encodeSapiRequestLine,
  mapSttLangToSapiCulture,
  parseSapiResponseLine,
  resolveWinSapiHelper,
  runWinSapiTranscribe,
  probeWinSapiSystemSpeech,
  type SapiChild,
  type SpawnSapiHelper,
} from "../src/voice/win-sapi"

// --- constants (spec §4) -------------------------------------------------------

test("SAPI_HELPER_TIMEOUT_MS = 15000 (spec §4)", () => {
  assert.equal(SAPI_HELPER_TIMEOUT_MS, 15_000)
})

test("helper artifact names are pinned (exe + sha256 sidecar)", () => {
  assert.equal(WIN_SAPI_HELPER_EXE_NAME, "win-sapi-helper.exe")
  assert.equal(WIN_SAPI_HELPER_SHA256_NAME, "win-sapi-helper.sha256")
})

// --- lang → culture mapping (spec §3.2 zh-CN / en-US) --------------------------

test("mapSttLangToSapiCulture: zh→zh-CN, en→en-US, exact culture passes through", () => {
  assert.equal(mapSttLangToSapiCulture("zh"), "zh-CN")
  assert.equal(mapSttLangToSapiCulture("zh-TW"), "zh-CN")
  assert.equal(mapSttLangToSapiCulture("en"), "en-US")
  assert.equal(mapSttLangToSapiCulture("en-US"), "en-US")
  assert.equal(mapSttLangToSapiCulture("zh-CN"), "zh-CN")
  assert.equal(mapSttLangToSapiCulture(""), "zh-CN")
  assert.equal(mapSttLangToSapiCulture(undefined), "zh-CN")
})

// --- line JSON protocol (pure encode/decode) ------------------------------------

test("encodeSapiRequestLine: probe + transcribe shapes", () => {
  assert.equal(encodeSapiRequestLine({ probe: true }), '{"probe":true}')
  const line = encodeSapiRequestLine({ wav_path: "C:\\t\\a.wav", lang: "zh-CN" })
  const parsed = JSON.parse(line)
  assert.equal(parsed.wav_path, "C:\\t\\a.wav")
  assert.equal(parsed.lang, "zh-CN")
  assert.equal(parsed.probe, undefined)
})

test("parseSapiResponseLine: text / error / available frames; garbage → null", () => {
  assert.deepEqual(parseSapiResponseLine('{"text":"你好"}'), { kind: "text", text: "你好" })
  assert.deepEqual(parseSapiResponseLine('{"text":""}'), { kind: "text", text: "" })
  assert.deepEqual(parseSapiResponseLine('{"error":"boom","code":"no_recognizer"}'), {
    kind: "error",
    error: "boom",
    code: "no_recognizer",
  })
  assert.deepEqual(parseSapiResponseLine('{"available":true}'), {
    kind: "available",
    available: true,
  })
  assert.deepEqual(parseSapiResponseLine('{"available":false,"reason":"system_speech_unavailable"}'), {
    kind: "available",
    available: false,
    reason: "system_speech_unavailable",
  })
  assert.equal(parseSapiResponseLine("not json"), null)
  assert.equal(parseSapiResponseLine('{"unrelated":1}'), null)
  assert.equal(parseSapiResponseLine(""), null)
})

// --- resolveWinSapiHelper (fs + sha256 sidecar; ADR-023 L5 spirit) ---------------

function stageHelper(dir: string, opts?: { exe?: Buffer; sha?: string | null }) {
  fs.mkdirSync(dir, { recursive: true })
  const exe = opts?.exe ?? Buffer.from("fake-helper-exe-bytes")
  fs.writeFileSync(path.join(dir, WIN_SAPI_HELPER_EXE_NAME), exe)
  if (opts?.sha !== null) {
    const sha = opts?.sha ?? createHash("sha256").update(exe).digest("hex")
    fs.writeFileSync(path.join(dir, WIN_SAPI_HELPER_SHA256_NAME), sha + "\n")
  }
}

test("resolveWinSapiHelper: not_win32 fail-closed on other platforms", () => {
  const r = resolveWinSapiHelper({ platform: "darwin", roots: [] })
  assert.equal(r.ok, false)
  assert.equal(r.reason, "not_win32")
})

test("resolveWinSapiHelper: missing exe → unavailable, honest reason", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "win-sapi-empty-"))
  const r = resolveWinSapiHelper({ platform: "win32", roots: [empty] })
  assert.equal(r.ok, false)
  assert.equal(r.reason, "missing")
})

test("resolveWinSapiHelper: sha256 sidecar match → ok pinned", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "win-sapi-ok-"))
  stageHelper(dir)
  const r = resolveWinSapiHelper({ platform: "win32", roots: [dir] })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.pinned, true)
    assert.ok(r.path.endsWith(WIN_SAPI_HELPER_EXE_NAME))
  }
})

test("resolveWinSapiHelper: hash mismatch → hash_fail (never run tampered helper)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "win-sapi-tamper-"))
  stageHelper(dir, { exe: Buffer.from("tampered-bytes") , sha: createHash("sha256").update(Buffer.from("original-bytes")).digest("hex") })
  const r = resolveWinSapiHelper({ platform: "win32", roots: [dir] })
  assert.equal(r.ok, false)
  assert.equal(r.reason, "hash_fail")
})

test("resolveWinSapiHelper: missing sidecar → unavailable unless dev unpinned env", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "win-sapi-noside-"))
  stageHelper(dir, { sha: null })
  const pinned = resolveWinSapiHelper({ platform: "win32", roots: [dir] })
  assert.equal(pinned.ok, false)
  assert.equal(pinned.reason, "unpinned")

  const dev = resolveWinSapiHelper({
    platform: "win32",
    roots: [dir],
    env: { CMSPARK_WIN_SAPI_UNPINNED: "1" },
  })
  assert.equal(dev.ok, true)
  if (dev.ok) assert.equal(dev.pinned, false)
})

// --- runner (injectable spawn) ---------------------------------------------------

/** Scriptable fake helper child for runner tests. */
function fakeSpawn(script: {
  lines?: string[]
  delayMs?: number
  exitCode?: number | null
  onCloseWrite?: (child: SapiChild) => void
}): { spawn: SpawnSapiHelper; children: FakeChild[] } {
  const children: FakeChild[] = []
  const spawn: SpawnSapiHelper = (p) => {
    const child = new FakeChild(p, script)
    children.push(child)
    return child
  }
  return { spawn, children }
}

class FakeChild implements SapiChild {
  written: string[] = []
  killed = false
  private lineCbs: Array<(l: string) => void> = []
  private closeCbs: Array<(code: number | null) => void> = []
  constructor(
    public readonly helperPath: string,
    private readonly script: {
      lines?: string[]
      delayMs?: number
      exitCode?: number | null
      onCloseWrite?: (child: SapiChild) => void
    },
  ) {}
  write(line: string): void {
    this.written.push(line)
    if (this.fired) return
    this.fired = true
    const fire = () => {
      for (const l of this.script.lines ?? []) {
        this.lineCbs.forEach((cb) => cb(l))
      }
      this.closeCbs.forEach((cb) => cb(this.script.exitCode ?? 0))
    }
    if (this.script.delayMs) this.timer = setTimeout(fire, this.script.delayMs)
    else setImmediate(fire)
  }
  once(event: "line" | "close", cb: (v: any) => void): void {
    if (event === "line") this.lineCbs.push(cb)
    else this.closeCbs.push(cb)
  }
  private fired = false
  private timer: NodeJS.Timeout | null = null
  kill(): void {
    if (this.timer) clearTimeout(this.timer)
    this.killed = true
    this.closeCbs.forEach((cb) => cb(null))
  }
}

test("runWinSapiTranscribe: text frame resolves; request line carries wav_path + culture", async () => {
  const { spawn, children } = fakeSpawn({ lines: ['{"text":"你好世界"}'] })
  const r = await runWinSapiTranscribe({
    wavPath: "C:\\tmp\\audio.wav",
    lang: "zh",
    spawn,
    timeoutMs: 1_000,
  })
  assert.equal(r.text, "你好世界")
  assert.equal(children.length, 1)
  const req = JSON.parse(children[0]!.written[0]!)
  assert.equal(req.wav_path, "C:\\tmp\\audio.wav")
  assert.equal(req.lang, "zh-CN")
  assert.equal(req.probe, undefined)
})

test("runWinSapiTranscribe: helper error frame → WinSapiError helper_error with code", async () => {
  const { spawn } = fakeSpawn({ lines: ['{"error":"no recognizer","code":"no_recognizer"}'] })
  await assert.rejects(
    runWinSapiTranscribe({ wavPath: "a.wav", spawn, timeoutMs: 1_000 }),
    (e: unknown) => {
      assert.ok(e instanceof WinSapiError)
      assert.equal((e as WinSapiError).code, "helper_error")
      assert.equal((e as WinSapiError).helperCode, "no_recognizer")
      return true
    },
  )
})

test("runWinSapiTranscribe: unsupported culture error → system_lang_unsupported", async () => {
  const { spawn } = fakeSpawn({
    lines: ['{"error":"culture not supported","code":"unsupported_culture"}'],
  })
  await assert.rejects(
    runWinSapiTranscribe({ wavPath: "a.wav", lang: "fr", spawn, timeoutMs: 1_000 }),
    (e: unknown) => {
      assert.ok(e instanceof WinSapiError)
      assert.equal((e as WinSapiError).code, "system_lang_unsupported")
      return true
    },
  )
})

test("runWinSapiTranscribe: timeout kills child → WinSapiError timeout", async () => {
  const { spawn, children } = fakeSpawn({ lines: [], delayMs: 5_000 })
  await assert.rejects(
    runWinSapiTranscribe({ wavPath: "a.wav", spawn, timeoutMs: 30 }),
    (e: unknown) => {
      assert.ok(e instanceof WinSapiError)
      assert.equal((e as WinSapiError).code, "timeout")
      return true
    },
  )
  assert.equal(children[0]!.killed, true)
})

test("runWinSapiTranscribe: process close before a response line → spawn_failed", async () => {
  const { spawn } = fakeSpawn({ lines: [], exitCode: 1 })
  await assert.rejects(
    runWinSapiTranscribe({ wavPath: "a.wav", spawn, timeoutMs: 1_000 }),
    (e: unknown) => {
      assert.ok(e instanceof WinSapiError)
      assert.equal((e as WinSapiError).code, "spawn_failed")
      return true
    },
  )
})

test("runWinSapiTranscribe: non-JSON line → protocol error, honest (no silent fallback)", async () => {
  const { spawn } = fakeSpawn({ lines: ["garbage output"] })
  await assert.rejects(
    runWinSapiTranscribe({ wavPath: "a.wav", spawn, timeoutMs: 1_000 }),
    (e: unknown) =>
      e instanceof WinSapiError && (e as WinSapiError).code === "protocol",
  )
})

test("runWinSapiTranscribe: abort signal cancels wait + kills child", async () => {
  const { spawn, children } = fakeSpawn({ lines: [], delayMs: 5_000 })
  const ac = new AbortController()
  const p = runWinSapiTranscribe({ wavPath: "a.wav", spawn, timeoutMs: 5_000, signal: ac.signal })
  setTimeout(() => ac.abort(), 10)
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof WinSapiError)
    assert.equal((e as WinSapiError).code, "aborted")
    return true
  })
  assert.equal(children[0]!.killed, true)
})

// --- probe (voice.system.state backing) ------------------------------------------

test("probeWinSapiSystemSpeech: non-win32 → available:false honest reason (no spawn)", async () => {
  const calls: string[] = []
  const spawn: SpawnSapiHelper = (p) => {
    calls.push(p)
    return new FakeChild(p, { lines: ['{"available":true}'] })
  }
  const r = await probeWinSapiSystemSpeech({ platform: "darwin", spawn })
  assert.equal(r.available, false)
  assert.equal(r.reason, "not_win32")
  assert.equal(calls.length, 0)
})

test("probeWinSapiSystemSpeech: helper available frame passes through", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "win-sapi-probe-ok-"))
  stageHelper(dir)
  const child = new FakeChild("helper", { lines: ['{"available":true}'] })
  const spawn: SpawnSapiHelper = () => child
  const r = await probeWinSapiSystemSpeech({ platform: "win32", roots: [dir], spawn })
  assert.equal(r.available, true)
  assert.deepEqual(JSON.parse(child.written[0]!), { probe: true })
})

test("probeWinSapiSystemSpeech: System.Speech absent → available:false with reason", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "win-sapi-probe-no-"))
  stageHelper(dir)
  const spawn: SpawnSapiHelper = () =>
    new FakeChild("helper", {
      lines: ['{"available":false,"reason":"system_speech_unavailable"}'],
    })
  const r = await probeWinSapiSystemSpeech({ platform: "win32", roots: [dir], spawn })
  assert.equal(r.available, false)
  assert.equal(r.reason, "system_speech_unavailable")
})

test("probeWinSapiSystemSpeech: helper missing → available:false (never throws)", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "win-sapi-probe-empty-"))
  const r = await probeWinSapiSystemSpeech({ platform: "win32", roots: [empty] })
  assert.equal(r.available, false)
  assert.ok(typeof r.reason === "string" && r.reason.length > 0)
})

// --- CI smoke source contract (review round-2 MAJOR-2 fix) ----------------------
// The helper only reads ONE stdin line (Console.ReadLine; argv unused). The CI
// smoke must feed JSON via stdin and must NOT count protocol-error frames as
// probe success — that was the round-1 fake green.

test("ci smoke feeds helper via stdin (never argv) and rejects protocol greens", () => {
  const smoke = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "scripts", "tests", "win-sapi-smoke.ps1"),
    "utf8",
  )
  // stdin feeding: probe + transcribe both pipe into the exe
  assert.match(smoke, /'\{"probe":true\}'\s*\|\s*&\s*\$exe/)
  assert.match(smoke, /\$req\s*\|\s*&\s*\$exe/)
  // never argv JSON
  assert.doesNotMatch(smoke, /&\s*\$exe\s+'\{/)
  assert.doesNotMatch(smoke, /&\s*\$exe\s+\$req/)
  assert.doesNotMatch(smoke, /&\s*\$exe\s+\$probe/)
  // probe pass requires 'available' (no error-frame fallback)
  assert.doesNotMatch(smoke, /-contains\s+'available'\)\s*-or/)
  // transcription frames with code=protocol fail the gate
  assert.match(smoke, /-ne\s+'protocol'/)
})

// --- helper source compiles against real .NET Framework System.Speech ----------
// Round-1 CI caught three CS errors the local (macOS) tree cannot: InstalledRecognizers()
// returns ReadOnlyCollection<RecognizerInfo> (not an array), and the API is
// SetInputToWaveFile ("Wave", not "Wav"). Pin both so a rename regresses loudly.

test("helper source uses .NET Framework System.Speech API shapes (CI S2 regression pin)", () => {
  const cs = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "voice", "win-sapi-helper.cs"),
    "utf8",
  )
  // InstalledRecognizers() → ReadOnlyCollection (CS0029 round-1)
  assert.doesNotMatch(cs, /RecognizerInfo\[\]\s+infos/)
  assert.match(cs, /ReadOnlyCollection<RecognizerInfo>\s+infos/)
  assert.doesNotMatch(cs, /infos\.Length/)
  // correct method name (CS1061 round-1)
  assert.match(cs, /SetInputToWaveFile\(/)
  assert.doesNotMatch(cs, /SetInputToWavFile\(/)
})
