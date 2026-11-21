import "./meeting-test-data-dir"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { clearConfigCache, getConfig, getConfigDir, getConfigRevision, saveConfig } from "../src/config"
import { redactConfigForWire } from "../src/config-redact"
import { handleConfigFamily } from "../src/message-router/handlers/config"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"
import { handleMessage } from "../src/message-router"
import { validateWsMessage } from "../src/ws/validate"
import { llmExtract } from "../src/llm/llm-extract"

const origin = { origin: "chrome-extension://fixture", peerId: "owned-panel" }
const request = { type: "meeting.generate_minutes", v: 1, text: "Meeting material" }
const saveProfile = (name: string) => change({ kind: "save_current", name })
const change = (action: object, revision = getConfigRevision()) =>
  handleConfigFamily("model.center.save", { id: "model-req", config_revision: revision, action })
const read = () => handleConfigFamily("model.center.get", { id: "model-req" })

async function setProvider(model_name: string, base_url: string, api_key: string) {
  return handleConfigFamily("config.set", { config: { llm: { model_name, base_url, api_key, protocol: "openai" } } })
}

test("named profiles restore chat settings and never expose service credentials", async () => {
  const firstEndpoint = "https://vendor-a.invalid/v1"
  const secondEndpoint = "https://vendor-b.invalid/v1"
  await setProvider("first-model", firstEndpoint, "model-first-fixture-key")
  saveConfig({ llm: { ...getConfig().llm, extra_headers: { "x-allowed": "fixture-header-secret" } } })
  const saved = await saveProfile("Research")
  assert.equal(saved?.type, "model.center.state")
  const profile = saved.model_center.profiles[0]
  assert.deepEqual(profile, { id: profile.id, name: "Research", model_name: "first-model", base_url: firstEndpoint, has_key: true })
  assert.equal(saved.model_center.meeting_minutes_profile_id, null)
  assert.ok(!JSON.stringify(redactConfigForWire(getConfig())).includes("fixture-header-secret"))
  assert.ok(!JSON.stringify(redactConfigForWire(getConfig())).includes("model-first-fixture-key"))
  assert.equal(redactConfigForWire(getConfig()).model_center, undefined)
  await setProvider("second-model", secondEndpoint, "model-second-fixture-key")
  const stale = await change({ kind: "bind", scope: "chat", profile_id: profile.id }, saved.config_revision)
  assert.equal(stale.error, "CONFIG_REVISION_CONFLICT")
  assert.equal(getConfig().llm.model_name, "second-model")
  const bound = await change({ kind: "bind", scope: "chat", profile_id: profile.id })
  assert.equal(bound.model_center.chat_profile_id, profile.id)
  clearConfigCache()
  assert.equal(getConfig().llm.model_name, "first-model")
  assert.equal(getConfig().llm.base_url, firstEndpoint)
  assert.equal(getConfig().llm.api_key, "model-first-fixture-key")
  assert.equal(getConfig().llm.extra_headers?.["x-allowed"], "fixture-header-secret")
  assert.equal(getConfig().llm.native_vision, "auto")
  await handleConfigFamily("config.set", { config: { llm: { reasoning_effort: "low", temperature: 0.1 } } })
  assert.equal((await read()).model_center.chat_profile_id, profile.id)
  assert.equal((await change({ kind: "remove", profile_id: profile.id })).error, "MODEL_PROFILE_IN_USE")
  assert.equal((await change({ kind: "rename", profile_id: profile.id, name: "Renamed" })).model_center.profiles[0].name, "Renamed")
  assert.equal((await change({ kind: "bind", scope: "meeting_minutes", profile_id: profile.id })).model_center.meeting_minutes_profile_id, profile.id)
  await handleConfigFamily("settings.set", { settings: { model_name: "manual-edit" } })
  assert.equal((await read()).model_center.chat_profile_id, null)
  assert.equal((await read()).model_center.meeting_minutes_profile_id, profile.id)
  assert.equal((await change({ kind: "bind", scope: "meeting_minutes", profile_id: null })).model_center.meeting_minutes_profile_id, null)
  assert.deepEqual((await change({ kind: "remove", profile_id: profile.id })).model_center.profiles, [])
})

test("paired model center methods reject non-panel and retired sessions", async () => {
  const request = { type: "model.center.get", id: "paired-test" }
  const panel = {
    ...origin, surface: "panel" as const, panelId: "paired-panel", isCurrentSession: () => true,
    sendToExtension() {}, async executeTool() { throw new Error("unexpected tool call") },
  }
  const services = { threadManager: {}, skillEngine: {}, historyStore: {} } as any
  assert.equal(validateWsMessage(request).valid, true)
  assert.equal(validateWsMessage({ type: "model.center.save", action: { kind: "save_current", name: "Fixture" } }).valid, false)
  assert.equal((await handleMessage(request, services, panel)).type, "model.center.state")
  assert.equal((await handleMessage(request, services, { ...panel, isCurrentSession: () => false })).error, "MODEL_CENTER_DENIED")
  assert.equal((await handleMessage(request, services, { ...panel, origin: "cmspark-tray://local", surface: "summoner" })).error, "MODEL_CENTER_DENIED")
})

test("an environment-backed profile stays runtime-only when saved and selected", async () => {
  const disk = path.join(getConfigDir(), "config.json")
  const oldEnv = process.env.DEEPSEEK_API_KEY
  const fixtureKey = "owned-ephemeral-env-key"
  process.env.DEEPSEEK_API_KEY = fixtureKey
  try {
    const oldConfig = JSON.parse(fs.readFileSync(disk, "utf8"))
    fs.writeFileSync(disk, JSON.stringify({ ...oldConfig, llm: { ...oldConfig.llm, api_key: "" } }))
    clearConfigCache()
    const saved = await saveProfile("Environment model")
    assert.equal(saved.model_center.profiles[0].has_key, true)
    assert.ok(!fs.readFileSync(disk, "utf8").includes(fixtureKey))
    await setProvider("manual", "https://manual.invalid/v1", "manual-owned-key")
    await change({ kind: "bind", scope: "chat", profile_id: saved.model_center.profiles[0].id })
    assert.equal(getConfig().llm.api_key, fixtureKey)
    assert.equal(JSON.parse(fs.readFileSync(disk, "utf8")).llm.api_key, "")
    assert.ok(!fs.readFileSync(disk, "utf8").includes(fixtureKey))
  } finally {
    if (oldEnv === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = oldEnv
  }
})

test("an independent profile can be configured without replacing the active chat service", async () => {
  await setProvider("active-chat", "https://chat.invalid/v1", "owned-active-key")
  saveConfig({ llm: { ...getConfig().llm, extra_headers: { "x-allowed": "owned-old-header" }, native_vision: "off", native_vision_detected: true } })
  const active = getConfig().llm
  const provider = { protocol: "anthropic", base_url: "https://notes.invalid/v1", model_name: "minutes-model" }
  assert.equal((await change({ kind: "create", name: "Incomplete", provider })).error, "MODEL_NOT_CONFIGURED")
  assert.equal((await change({ kind: "create", name: "Invalid", provider: { ...provider, base_url: "http://169.254.169.254", api_key: "owned-fake" } })).error, "MODEL_ENDPOINT_INVALID")
  const saved = await change({ kind: "create", name: "Independent provider", provider: { ...provider, api_key: "owned-independent-key" } })
  assert.equal(saved.type, "model.center.state")
  assert.equal(getConfig().llm.model_name, active.model_name)
  assert.equal(getConfig().llm.api_key, "owned-active-key")
  assert.ok(saved.model_center.profiles.some((item: { model_name: string }) => item.model_name === "minutes-model"))
  assert.ok(!JSON.stringify(saved).includes("owned-independent-key"))
  const profile = saved.model_center.profiles.find((item: { model_name: string }) => item.model_name === "minutes-model")
  assert.equal((await change({ kind: "bind", scope: "chat", profile_id: profile.id })).model_center.chat_profile_id, profile.id)
  clearConfigCache()
  assert.equal((await read()).model_center.chat_profile_id, profile.id)
  assert.equal(getConfig().llm.protocol, "anthropic")
  assert.equal(getConfig().llm.extra_headers, undefined)
  assert.equal(getConfig().llm.native_vision, "off")
  assert.equal(getConfig().llm.native_vision_detected, undefined)
})

test("summary sends confirmed material to the chosen profile and rejects stale or replayed consent", async () => {
  const seen: { model: string; text: string; auth?: string }[] = []
  let failProvider = false
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    seen.push({ model: body.model, text: body.messages[1].content, auth: req.headers.authorization })
    res.setHeader("Content-Type", "application/json")
    if (failProvider) {
      res.writeHead(401)
      res.end(JSON.stringify({ error: { message: `Provider reflected ${req.headers.authorization}` } }))
      return
    }
    res.end(JSON.stringify({ choices: [{ message: { content: `### TL;DR\n${body.messages[1].content}` }, finish_reason: "stop" }] }))
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address() as { port: number }
  const base = `http://127.0.0.1:${addr.port}/v1`
  const prepare = (overrides = {}) => handleMeetingMessage({ ...request, ...overrides, type: "meeting.prepare_minutes" }, origin)
  const generate = (token?: string, overrides = {}, ctx = origin) => handleMeetingMessage({ ...request, ...overrides, consent_token: token }, ctx)
  try {
    await setProvider("meeting-model", base, "meeting-fixture-key")
    const saved = await saveProfile("Minutes service")
    const profile = saved.model_center.profiles.find((item: { name: string }) => item.name === "Minutes service")
    await setProvider("chat-model", base, "chat-fixture-key")
    const inherited = await prepare()
    assert.equal(inherited.type, "meeting.minutes_prepared")
    assert.deepEqual(inherited.target, { base_url: base, model_name: "chat-model", profile_name: null })
    await change({ kind: "bind", scope: "meeting_minutes", profile_id: profile.id })
    assert.equal((await generate(inherited.consent_token)).code, "minutes_consent_changed")
    assert.equal((await generate()).code, "minutes_consent_required")
    const prepared = await prepare()
    assert.deepEqual(prepared.target, { base_url: base, model_name: "meeting-model", profile_name: "Minutes service" })
    assert.deepEqual(prepared.material, { transcript_chars: 16, reference_chars: 0, reference_name: "", template_chars: 0 })
    assert.equal((await generate(prepared.consent_token, { text: "changed" })).code, "minutes_consent_changed")
    const withNotes = await prepare({ reference_notes: "Reviewed context", reference_name: "notes.txt", template_md: "First format" })
    assert.equal(withNotes.material.reference_chars, 16)
    assert.equal(withNotes.material.reference_name, "notes.txt")
    assert.equal(withNotes.material.template_chars, 12)
    assert.equal((await generate(withNotes.consent_token, { reference_notes: "Reviewed context", reference_name: "notes.txt", template_md: "Second format" })).code, "minutes_consent_changed")
    assert.equal((await generate((await prepare()).consent_token, {}, { ...origin, peerId: "another-panel" })).code, "minutes_consent_changed")
    assert.equal(seen.length, 0)
    const token = (await prepare()).consent_token
    const result = await generate(token)
    assert.equal(result.type, "meeting.minutes_result", JSON.stringify(result))
    assert.equal((await generate(token)).code, "minutes_consent_changed")
    assert.deepEqual(seen, [{ model: "meeting-model", text: "Meeting material", auth: "Bearer meeting-fixture-key" }])
    failProvider = true
    const failed = await generate((await prepare()).consent_token)
    assert.equal(failed.code, "llm_error")
    assert.ok(!JSON.stringify(failed).includes("meeting-fixture-key"))
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test("summary refuses cross-origin redirects for OpenAI and Anthropic while ordinary extraction follows them", async () => {
  const listen = async (server: http.Server) => {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`
  }
  const close = (server: http.Server) => new Promise<void>(resolve => server.close(() => resolve()))
  const redirected: string[] = []
  const target = http.createServer((req, res) => {
    redirected.push(req.url ?? "")
    res.setHeader("Content-Type", "application/json")
    const text = "### TL;DR\nredirect reached"
    const body = req.url?.endsWith("/messages")
      ? { content: [{ type: "text", text }], stop_reason: "end_turn" }
      : { choices: [{ message: { content: text }, finish_reason: "stop" }] }
    res.end(JSON.stringify(body))
  })
  const targetOrigin = await listen(target)
  const requested: string[] = []
  const source = http.createServer((req, res) => {
    requested.push(req.url ?? "")
    res.writeHead(307, { Location: `${targetOrigin}${req.url}` })
    res.end()
  })
  const sourceOrigin = await listen(source)
  try {
    const inherited = await change({ kind: "bind", scope: "meeting_minutes", profile_id: null })
    assert.equal(inherited.model_center.meeting_minutes_profile_id, null)
    for (const [protocol, route] of [["openai", "/v1/chat/completions"], ["anthropic", "/v1/messages"]] as const) {
      const config = { protocol, base_url: `${sourceOrigin}/v1`, model_name: "owned-redirect-fixture", api_key: "owned-key", temperature: 0.2 }
      await handleConfigFamily("config.set", { config: { llm: config } })
      const prepared = await handleMeetingMessage({ ...request, type: "meeting.prepare_minutes" }, origin)
      assert.equal(prepared.type, "meeting.minutes_prepared")
      const result = await handleMeetingMessage({ ...request, consent_token: prepared.consent_token }, origin)
      assert.equal(requested.at(-1), route, JSON.stringify(result))
      assert.equal(result.code, "llm_error")
      assert.deepEqual(redirected, [])
      assert.match(await llmExtract({ config, systemPrompt: "Fixture", userContent: "Ordinary extraction" }), /redirect reached/)
      assert.deepEqual(redirected.splice(0), [route])
    }
  } finally { await Promise.all([close(source), close(target)]) }
})

test("named profiles reject endpoint credentials and parameters while legacy config keeps its address", async () => {
  const profileInput = { protocol: "openai", model_name: "fixture-model", api_key: "fixture-api-key" }
  for (const address of ["https://api.invalid/v1?token=private", "https://api.invalid/v1#private", "https://user:private@api.invalid/v1"]) {
    const created = await change({ kind: "create", name: "Unsafe URL", provider: { ...profileInput, base_url: address } })
    assert.equal(created.error, "MODEL_ENDPOINT_INVALID")
    await setProvider("legacy-model", address, "legacy-fixture-key")
    assert.equal(getConfig().llm.base_url, address)
    assert.equal((await saveProfile("Unsafe legacy URL")).error, "MODEL_ENDPOINT_INVALID")
  }

  const id = "9ca250ec-33ad-4c3d-b642-2dcafb24131c"
  const oldProfile = { id, name: "Preloaded address", llm: { ...getConfig().llm, base_url: "https://api.invalid/v1?saved=private" } }
  saveConfig({ model_center: { profiles: [oldProfile], chat_profile_id: null, meeting_minutes_profile_id: null } })
  for (const scope of ["chat", "meeting_minutes"]) {
    assert.equal((await change({ kind: "bind", scope, profile_id: id })).error, "MODEL_ENDPOINT_INVALID")
  }
  saveConfig({ model_center: { profiles: [oldProfile], chat_profile_id: null, meeting_minutes_profile_id: id } })
  const prepared = await handleMeetingMessage({ ...request, type: "meeting.prepare_minutes" }, origin)
  assert.equal(prepared.code, "llm_not_configured")
  assert.ok(!JSON.stringify(await read()).includes("saved=private"))
})
