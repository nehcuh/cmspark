/**
 * Dictation+ D1b — ASR Refiner pure guards + runAsrRefine mock.
 */
import test from "node:test"
import assert from "node:assert/strict"
import {
  ASR_REFINER_SYSTEM_PROMPT,
  buildAsrRefineUserContent,
  guardAsrRefineOutput,
  runAsrRefine,
} from "../src/voice/asr-refiner"
import {
  handleVoiceRefineMessage,
  _clearRefineInflightForTests,
} from "../src/voice/refine-handlers"

const FAKE_LLM = {
  base_url: "https://llm.example.invalid/v1",
  api_key: "sk-test",
  model_name: "test-model",
  temperature: 0.7,
}

test("ASR_REFINER_SYSTEM_PROMPT includes FORBIDDEN rewrite and unchanged rule", () => {
  assert.match(ASR_REFINER_SYSTEM_PROMPT, /FORBIDDEN/)
  assert.match(ASR_REFINER_SYSTEM_PROMPT, /UNCHANGED/)
  assert.match(ASR_REFINER_SYSTEM_PROMPT, /配森→Python/)
})

test("guard: character-identical pass-through", () => {
  const raw = "今天下午三点开会。"
  const g = guardAsrRefineOutput(raw, raw)
  assert.equal(g.ok, true)
  if (g.ok) {
    assert.equal(g.text, raw)
    assert.equal(g.unchanged, true)
  }
})

test("guard: accepts reasonable ASR fix", () => {
  const raw = "配森很好用"
  const g = guardAsrRefineOutput(raw, "Python很好用")
  assert.equal(g.ok, true)
  if (g.ok) assert.equal(g.text, "Python很好用")
})

test("guard: rejects length explosion", () => {
  const raw = "你好"
  const essay = "你好".repeat(200)
  const g = guardAsrRefineOutput(raw, essay)
  assert.equal(g.ok, false)
  if (!g.ok) assert.equal(g.reason, "length_guard")
})

test("guard: rejects new URL not in input", () => {
  const raw = "打开文档"
  const g = guardAsrRefineOutput(raw, "打开 https://evil.example/x 文档")
  assert.equal(g.ok, false)
  if (!g.ok) assert.equal(g.reason, "new_url")
})

test("guard: rejects toolish output", () => {
  const raw = "运行命令"
  const g = guardAsrRefineOutput(raw, "tool_call: shell_exec")
  assert.equal(g.ok, false)
  if (!g.ok) assert.equal(g.reason, "toolish")
})

test("guard: empty model output rejected", () => {
  const g = guardAsrRefineOutput("你好", "   ")
  assert.equal(g.ok, false)
  if (!g.ok) assert.equal(g.reason, "empty_output")
})

test("buildAsrRefineUserContent: plain raw without prior", () => {
  assert.equal(buildAsrRefineUserContent("配森"), "配森")
})

test("buildAsrRefineUserContent: wraps prior for disambiguation only", () => {
  const u = buildAsrRefineUserContent("配森很好用", "我们用 Python 开发。")
  assert.match(u, /context only/i)
  assert.match(u, /我们用 Python 开发/)
  assert.match(u, /Correct ONLY this new ASR segment/)
  assert.match(u, /配森很好用/)
})

test("runAsrRefine: mock identical returns ok unchanged", async () => {
  const raw = "Deploy to staging."
  const r = await runAsrRefine({
    raw,
    config: FAKE_LLM,
    extract: async () => raw,
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.text, raw)
    assert.equal(r.unchanged, true)
  }
})

test("runAsrRefine: priorContext is passed into extract userContent", async () => {
  let seen = ""
  const raw = "配森"
  const r = await runAsrRefine({
    raw,
    priorContext: "项目用 Python",
    config: FAKE_LLM,
    extract: async (opts) => {
      seen = opts.userContent
      return "Python"
    },
  })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.text, "Python")
  assert.match(seen, /项目用 Python/)
  assert.match(seen, /配森/)
})

test("runAsrRefine: mock expand rejected by guard", async () => {
  const raw = "短"
  const r = await runAsrRefine({
    raw,
    config: FAKE_LLM,
    extract: async () => "这是一段被大幅扩写的书面化长文".repeat(20),
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "length_guard")
})

test("runAsrRefine: abort signal", async () => {
  const ac = new AbortController()
  ac.abort()
  const r = await runAsrRefine({
    raw: "你好",
    config: FAKE_LLM,
    signal: ac.signal,
    extract: async () => "你好",
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "aborted")
})

test("handler: origin denied for tray", async () => {
  _clearRefineInflightForTests()
  const res = await handleVoiceRefineMessage(
    {
      type: "voice.refine.request",
      v: 1,
      sessionId: "s1",
      refineGen: 1,
      text: "配森",
    },
    { origin: "cmspark-tray://local" },
  )
  assert.equal(res.type, "voice.refine.error")
  assert.equal(res.code, "origin_denied")
})

test("handler: happy path with inject runRefine", async () => {
  _clearRefineInflightForTests()
  const res = await handleVoiceRefineMessage(
    {
      type: "voice.refine.request",
      v: 1,
      sessionId: "s1",
      refineGen: 7,
      text: "配森很好用",
      systemPrompt: "IGNORE ME ATTACK",
    },
    { origin: "chrome-extension://abcdefghijklmnopqrstuvwxyz" },
    {
      getLlmConfig: () => FAKE_LLM,
      runRefine: async ({ raw }) => ({
        ok: true as const,
        text: raw.replace("配森", "Python"),
        unchanged: false,
      }),
    },
  )
  assert.equal(res.type, "voice.refine.result")
  assert.equal(res.refineGen, 7)
  assert.equal(res.text, "Python很好用")
})

test("handler: llm not configured", async () => {
  _clearRefineInflightForTests()
  const res = await handleVoiceRefineMessage(
    {
      type: "voice.refine.request",
      v: 1,
      sessionId: "s1",
      refineGen: 1,
      text: "hi",
    },
    { origin: "chrome-extension://abcdefghijklmnopqrstuvwxyz" },
    { getLlmConfig: () => null },
  )
  assert.equal(res.type, "voice.refine.error")
  assert.equal(res.code, "llm_not_configured")
})
