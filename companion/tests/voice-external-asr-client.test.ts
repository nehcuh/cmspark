import assert from "node:assert/strict"
import test from "node:test"
import { transcribeExternal } from "../src/voice/external-asr-client"

const wav = Uint8Array.of(1, 2, 3, 4)
const publicLookup = async () => [{ address: "1.1.1.1", family: 4 as const }]

function formOf(body: FormData) {
  return {
    file: body.get("file"),
    model: body.get("model"),
    language: body.get("language"),
    response_format: body.get("response_format"),
    stream: body.get("stream"),
    prompt: body.get("prompt"),
  }
}

test("deepseek sends only file and openai sends model, file, language, json", async () => {
  const seen: Array<{ url: string; redirect: string; auth: string; fields: ReturnType<typeof formOf> }> = []
  const fetchImpl = async (url: string, init: { redirect: string; headers: Record<string, string>; body: FormData }) => {
    seen.push({ url, redirect: init.redirect, auth: init.headers.Authorization, fields: formOf(init.body) })
    return { status: 200, json: async () => ({ text: "你好" }) }
  }
  const deep = await transcribeExternal({
    style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
    wav, timeoutMs: 180000, signal: new AbortController().signal, lookup: publicLookup, fetchImpl,
  })
  assert.equal(deep.ok && deep.text, "你好")
  assert.equal(seen[0].redirect, "error")
  assert.equal(seen[0].auth, "Bearer secret")
  assert.equal(seen[0].fields.model, null)
  assert.equal(seen[0].fields.language, null)
  const open = await transcribeExternal({
    style: "openai", url: "https://api.openai.com/v1/audio/transcriptions", apiKey: "secret",
    wav, model: "whisper-1", language: "zh", timeoutMs: 180000, signal: new AbortController().signal, lookup: publicLookup, fetchImpl,
  })
  assert.equal(open.ok, true)
  assert.equal(seen[1].fields.model, "whisper-1")
  assert.equal(seen[1].fields.language, "zh")
  assert.equal(seen[1].fields.response_format, "json")
  assert.equal(seen[1].fields.stream, null)
  assert.equal(seen[1].fields.prompt, null)
  assert.equal(JSON.stringify(seen).includes("secret") && seen[0].auth === "Bearer secret", true)
})

test("redirect is not followed", async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return { status: 302, json: async () => ({ text: "no" }) }
  }
  const got = await transcribeExternal({
    style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
    wav, timeoutMs: 180000, signal: new AbortController().signal, lookup: publicLookup, fetchImpl,
  })
  assert.equal(calls, 1)
  assert.equal(got.ok, false)
  assert.equal(!got.ok && got.code, "external_redirect")
})

test("abort before the call does not fetch", async () => {
  let calls = 0
  const early = new AbortController()
  early.abort()
  const skipped = await transcribeExternal({
    style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
    wav, timeoutMs: 180000, signal: early.signal, lookup: publicLookup,
    fetchImpl: async () => {
      calls += 1
      return { status: 200, json: async () => ({ text: "late" }) }
    },
  })
  assert.equal(calls, 0)
  assert.equal(!skipped.ok && skipped.code, "aborted")
})

test("abort while lookup is pending does not fetch", async () => {
  let fetches = 0
  const live = new AbortController()
  let releaseLookup: (rows: Array<{ address: string; family: 4 }>) => void = () => {}
  let markLookup: () => void = () => {}
  const lookupStarted = new Promise<void>((resolve) => { markLookup = resolve })
  let timer: NodeJS.Timeout | undefined
  const withinOneSecond = <T,>(work: Promise<T>) => new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("abort test hung")), 1000)
    work.then(resolve, reject)
  })
  try {
    const pending = transcribeExternal({
      style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
      wav, timeoutMs: 180000, signal: live.signal,
      lookup: () => {
        markLookup()
        return new Promise((resolve) => { releaseLookup = resolve })
      },
      fetchImpl: async () => {
        fetches += 1
        return { status: 200, json: async () => ({ text: "late" }) }
      },
    })
    await withinOneSecond(lookupStarted)
    live.abort()
    releaseLookup([{ address: "1.1.1.1", family: 4 }])
    const got = await withinOneSecond(pending)
    assert.equal(fetches, 0)
    assert.equal(!got.ok && got.code, "aborted")
    assert.equal("text" in got, false)
  } finally {
    clearTimeout(timer)
  }
})

test("abort after fetch registers its listener drops late text", async () => {
  let fetches = 0
  const live = new AbortController()
  let markStarted: () => void = () => {}
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  let timer: NodeJS.Timeout | undefined
  const withinOneSecond = <T,>(work: Promise<T>) => new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("abort test hung")), 1000)
    work.then(resolve, reject)
  })
  try {
    const pending = transcribeExternal({
      style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
      wav, timeoutMs: 180000, signal: live.signal, lookup: publicLookup,
      fetchImpl: (_url, init) => new Promise((resolve) => {
        fetches += 1
        const onAbort = () => {
          init.signal.removeEventListener("abort", onAbort)
          resolve({ status: 200, json: async () => ({ text: "late" }) })
        }
        init.signal.addEventListener("abort", onAbort)
        markStarted()
      }),
    })
    await withinOneSecond(started)
    assert.equal(fetches, 1)
    live.abort()
    const got = await withinOneSecond(pending)
    assert.equal(!got.ok && got.code, "aborted")
    assert.equal("text" in got, false)
  } finally {
    clearTimeout(timer)
  }
})

test("non-json and empty text are not transcripts", async () => {
  const bad = await transcribeExternal({
    style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
    wav, timeoutMs: 180000, signal: new AbortController().signal, lookup: publicLookup,
    fetchImpl: async () => ({ status: 200, json: async () => { throw new Error("html") } }),
  })
  assert.equal(!bad.ok && bad.code, "external_bad_response")
  const empty = await transcribeExternal({
    style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
    wav, timeoutMs: 180000, signal: new AbortController().signal, lookup: publicLookup,
    fetchImpl: async () => ({ status: 200, json: async () => ({ text: "" }) }),
  })
  assert.equal(!empty.ok && empty.code, "external_empty")
})

test("lookup addresses in the blocked ranges send nothing", async () => {
  const blocked = [
    [{ address: "169.254.169.254", family: 4 }],
    [{ address: "fe80::abcd", family: 6 }],
    [{ address: "0.0.0.0", family: 4 }],
    [{ address: "::", family: 6 }],
    [{ address: "224.0.0.1", family: 4 }],
    [{ address: "1.1.1.1", family: 4 }, { address: "169.254.169.254", family: 4 }],
    [{ address: "2001:db8::1", family: 6 }, { address: "fe80::1", family: 6 }],
  ]
  for (const answers of blocked) {
    let fetches = 0
    let lookups = 0
    const got = await transcribeExternal({
      style: "openai", url: "https://asr.example.test/v1/audio/transcriptions", apiKey: "secret",
      wav, timeoutMs: 180000, signal: new AbortController().signal,
      lookup: async () => { lookups += 1; return answers },
      fetchImpl: async () => { fetches += 1; return { status: 200, json: async () => ({ text: "x" }) } },
    })
    assert.equal(lookups, 1)
    assert.equal(fetches, 0)
    assert.equal(!got.ok && got.code, "external_unreachable")
  }
})

test("mapped lookup answers use the embedded IPv4 policy", async () => {
  for (const address of ["::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:0:0", "::ffff:e000:1"]) {
    let fetches = 0
    const got = await transcribeExternal({
      style: "openai", url: "https://asr.example.test/v1/audio/transcriptions", apiKey: "secret",
      wav, timeoutMs: 180000, signal: new AbortController().signal,
      lookup: async () => [{ address, family: 6 as const }],
      fetchImpl: async () => { fetches += 1; return { status: 200, json: async () => ({ text: "x" }) } },
    })
    assert.equal(fetches, 0)
    assert.equal(!got.ok && got.code, "external_unreachable")
  }
  let fetches = 0
  const allowed = await transcribeExternal({
    style: "openai", url: "https://asr.example.test/v1/audio/transcriptions", apiKey: "secret",
    wav, timeoutMs: 180000, signal: new AbortController().signal,
    lookup: async () => [{ address: "::ffff:7f00:1", family: 6 as const }],
    fetchImpl: async () => { fetches += 1; return { status: 200, json: async () => ({ text: "ok" }) } },
  })
  assert.equal(fetches, 1)
  assert.equal(allowed.ok && allowed.text, "ok")
})

test("dns failure sends nothing, and loopback or private answers may proceed", async () => {
  let fetches = 0
  const fail = await transcribeExternal({
    style: "openai", url: "https://asr.example.test/v1/audio/transcriptions", apiKey: "secret",
    wav, timeoutMs: 180000, signal: new AbortController().signal,
    lookup: async () => { throw new Error("dns") },
    fetchImpl: async () => { fetches += 1; return { status: 200, json: async () => ({ text: "x" }) } },
  })
  assert.equal(fetches, 0)
  assert.equal(!fail.ok && fail.code, "external_unreachable")
  const empty = await transcribeExternal({
    style: "openai", url: "https://asr.example.test/v1/audio/transcriptions", apiKey: "secret",
    wav, timeoutMs: 180000, signal: new AbortController().signal,
    lookup: async () => [],
    fetchImpl: async () => { fetches += 1; return { status: 200, json: async () => ({ text: "x" }) } },
  })
  assert.equal(fetches, 0)
  assert.equal(!empty.ok && empty.code, "external_unreachable")
  for (const address of ["127.0.0.1", "192.168.1.9", "10.1.2.3"]) {
    const got = await transcribeExternal({
      style: "openai", url: "https://asr.example.test/v1/audio/transcriptions", apiKey: "secret",
      wav, timeoutMs: 180000, signal: new AbortController().signal,
      lookup: async () => [{ address, family: 4 as const }],
      fetchImpl: async () => { fetches += 1; return { status: 200, json: async () => ({ text: "ok" }) } },
    })
    assert.equal(got.ok && got.text, "ok")
  }
  assert.equal(fetches, 3)
})

test("deadline timer aborts a hung post and does not keep the late body", async () => {
  let timer: NodeJS.Timeout | undefined
  const withinOneSecond = <T,>(work: Promise<T>) => new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timeout test hung")), 1000)
    work.then(resolve, reject)
  })
  try {
    const got = await withinOneSecond(transcribeExternal({
      style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
      wav, timeoutMs: 30, signal: new AbortController().signal, lookup: publicLookup,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        })
      }),
    }))
    assert.equal(got.ok, false)
    assert.equal(!got.ok && got.code, "external_timeout")
    assert.equal("text" in got, false)
  } finally {
    clearTimeout(timer)
  }
})
