import test from "node:test"
import assert from "node:assert/strict"
import { SettingsAssistant, validateSettingsAssistantMessage } from "../src/settings-assistant"

function fixture(changes: any[] = [{ settingId: "coding.autoSuggest", after: false, reason: "减少不相关建议" }]) {
  const config: any = { history_retention_days: 30, log_retention_days: 14, coding_handoff: { auto_suggest: true },
    llm: { api_key: "provider-private-key", extra_headers: { "x-private": "configured-header-secret" } },
    vision: { api_key: "vision-private-key" }, mcp: { servers: { chat: { env: { TOKEN: "configured-mcp-secret" } } } } }
  let clock = 1000, writes: Record<string, any>[] = [], prompts: string[] = []
  let raw = JSON.stringify({ intent: "减少干扰并保留必要能力", candidates: [{ title: "减少主动建议", reason: "按需打开助手", tradeoffs: "需要自行打开编程助手", changes }] })
  let saveFail = false, ignoreSave = false, readFail = false
  const service = new SettingsAssistant({ read: () => { if (readFail) throw new Error("private internal error"); return config }, now: () => clock,
    save: async patch => { writes.push(patch); if (saveFail) throw new Error("disk private path"); if (!ignoreSave) for (const [key, value] of Object.entries(patch)) config[key] = value && typeof value === "object" ? { ...config[key], ...value } : value },
    extract: async (system, user) => { prompts.push(system + user); return raw },
  })
  const propose = (text = "少打扰我", owner = "owned-panel") => service.handle({ type: "settings.assistant.propose", id: "propose-test", text }, owner)
  const apply = (proposal: any, more: Record<string, any> = {}, owner = "owned-panel") => service.handle({ type: "settings.assistant.apply", id: "apply-test", proposalId: proposal.id,
    candidateId: proposal.candidates[0].id, changeIds: proposal.candidates[0].changes.map((c: any) => c.id), userConfirmed: true, ...more }, owner)
  return { service, config, writes, prompts, propose, apply, set raw(v: any) { raw = v }, set clock(v: number) { clock = v }, set saveFail(v: boolean) { saveFail = v }, set ignoreSave(v: boolean) { ignoreSave = v }, set readFail(v: boolean) { readFail = v } }
}
test("semantic model proposals have fixed catalog labels/current values and no writes until explicit selected application", async () => {
  const f = fixture([{ settingId: "coding.autoSuggest", after: false, reason: "减少建议" }, { settingId: "logs.retentionDays", after: 7, reason: "减少保留" }])
  const result = await f.propose("编程建议太多，日志也不需要留那么久")
  assert.equal(result.type, "settings.assistant.proposal"); assert.equal(result.id, "propose-test"); assert.equal(f.writes.length, 0)
  const changes = result.proposal.candidates[0].changes
  assert.equal(changes[0].before, true); assert.equal(changes[1].before, 14)
  assert.equal((await f.apply(result.proposal, { userConfirmed: false })).error_code, "INVALID_REQUEST"); assert.equal(f.writes.length, 0)
  const receipt = await f.apply(result.proposal, { changeIds: [changes[0].id] })
  assert.deepEqual(f.writes, [{ coding_handoff: { auto_suggest: false } }]); assert.equal(f.config.log_retention_days, 14)
  assert.equal(receipt.items[0].status, "saved"); assert.equal(receipt.items[0].actual, false)
  assert.equal((await f.apply(result.proposal)).error_code, "PROPOSAL_EXPIRED")
})
test("model receives only safe catalog values and redacted description, no provider, vision, header or MCP secrets", async () => {
  const f = fixture()
  await f.propose("provider-private-key vision-private-key configured-header-secret configured-mcp-secret bearer abcdefgh sk-123456789012")
  assert.equal(f.prompts.length, 1)
  for (const secret of ["provider-private-key", "vision-private-key", "configured-header-secret", "configured-mcp-secret", "abcdefgh", "sk-123456789012"]) assert.ok(!f.prompts[0].includes(secret), secret)
  assert.ok(f.prompts[0].includes("coding.autoSuggest")); assert.ok(!f.prompts[0].includes('"llm"'))
})
test("strict model schema refuses unknown settings, dangerous settings, bad types, extra fields, duplicate changes", async () => {
  for (const change of [{ settingId: "llm.api_key", after: "evil", reason: "secret" }, { settingId: "security.auto_approve_dangerous", after: true, reason: "do it" },
    { settingId: "history.retentionDays", after: 0, reason: "bad" }, { settingId: "coding.autoSuggest", after: "false", reason: "bad" },
    { settingId: "history.fullToolHistory", after: true, reason: "bad" }, { settingId: "history.backgroundDigest", after: true, reason: "bad" },
    { settingId: "coding.autoSuggest", after: false, reason: "bad", patch: { secrets: "no" } }]) {
    const f = fixture([change]); assert.equal((await f.propose()).error_code, "PROPOSAL_UNAVAILABLE"); assert.equal(f.writes.length, 0)
  }
  const f = fixture([{ settingId: "coding.autoSuggest", after: false, reason: "first" }, { settingId: "coding.autoSuggest", after: true, reason: "second" }])
  assert.equal((await f.propose()).error_code, "PROPOSAL_UNAVAILABLE")
})
test("manual voice/privacy/reminder recommendations never write configuration or claim save", async () => {
  const f = fixture([{ settingId: "voice.asrCorrection", after: true, reason: "尝试纠错" }, { settingId: "activity.privacy", after: "localOnly", reason: "核对本机处理范围" }, { settingId: "tasks.reminders", after: "review", reason: "核对提醒" }])
  const { proposal } = await f.propose("语音错字多，不希望聊天外发，也别漏提醒")
  const receipt = await f.apply(proposal)
  assert.equal(f.writes.length, 0); assert.equal(receipt.items.length, 3)
  assert.ok(receipt.items.every((item: any) => item.status === "manual"))
  assert.equal(proposal.candidates[0].changes[0].section, "voice")
  assert.ok(proposal.candidates[0].changes[1].prerequisites.some((s: string) => s.includes("屏幕权限")))
})
test("changed values, selection tampering, owner mismatch and expiry fail closed", async () => {
  const f = fixture(); const { proposal } = await f.propose()
  assert.equal((await f.apply(proposal, {}, "foreign")).error_code, "PROPOSAL_EXPIRED")
  assert.equal((await f.apply(proposal, { changeIds: ["unknown"] })).error_code, "INVALID_SELECTION")
  f.config.coding_handoff.auto_suggest = false
  assert.equal((await f.apply(proposal)).error_code, "STALE_SETTINGS"); assert.equal(f.writes.length, 0)
  f.clock = proposal.expiresAt
  assert.equal((await f.apply(proposal)).error_code, "PROPOSAL_EXPIRED")
})
test("save exception or silently ignored save cannot produce saved receipt", async () => {
  for (const mode of ["saveFail", "ignoreSave"] as const) {
    const f = fixture(); f[mode] = true
    const { proposal } = await f.propose(), receipt = await f.apply(proposal)
    assert.equal(receipt.items[0].status, "failed"); assert.equal(receipt.items[0].actual, true)
    assert.ok(!JSON.stringify(receipt).includes("disk private path"))
  }
})
test("malformed model output, no candidates without clarification, and unavailable current config are bounded errors", async () => {
  for (const raw of ["```json {} ```", "x".repeat(30001), JSON.stringify({ intent: "unclear", candidates: [] })]) {
    const f = fixture(); f.raw = raw
    const result = await f.propose(); assert.equal(result.error_code, "PROPOSAL_UNAVAILABLE"); assert.equal(result.id, "propose-test")
  }
  const f = fixture(); f.raw = JSON.stringify({ intent: "需要更多信息", clarification: "主要是语音还是通知？", candidates: [] })
  assert.equal((await f.propose()).proposal.clarification, "主要是语音还是通知？")
  f.readFail = true; assert.equal((await f.propose()).error_code, "PROPOSAL_UNAVAILABLE")
})
test("session ending during extraction never admits the proposal, and during apply never writes", async () => {
  let current = true, writes = 0
  const service = new SettingsAssistant({ read: () => ({ coding_handoff: { auto_suggest: true } }), save: async () => { writes++ }, extract: async () => {
    current = false
    return JSON.stringify({ intent: "减少干扰", candidates: [{ title: "按需建议", reason: "减少干扰", tradeoffs: "自行打开", changes: [{ settingId: "coding.autoSuggest", after: false, reason: "减少干扰" }] }] })
  } })
  assert.equal((await service.handle({ type: "settings.assistant.propose", id: "session", text: "少建议" }, "owned", () => current)).error_code, "SESSION_ENDED")
  assert.equal(writes, 0)
  const f = fixture(); const { proposal } = await f.propose()
  const result = await f.service.handle({ type: "settings.assistant.apply", id: "session-apply", proposalId: proposal.id, candidateId: proposal.candidates[0].id,
    changeIds: ["change-1"], userConfirmed: true }, "owned-panel", () => false)
  assert.equal(result.error_code, "INVALID_REQUEST"); assert.equal(f.writes.length, 0)
})
test("schema rejects missing confirmation, unknown wire fields, prototype keys and duplicate selected ids", () => {
  assert.equal(validateSettingsAssistantMessage({ type: "settings.assistant.propose", id: "ok", text: "描述" }), true)
  for (const value of [{ type: "settings.assistant.propose", id: "ok", text: "描述", config: {} }, { type: "settings.assistant.propose", id: "ok", text: "" },
    JSON.parse('{"type":"settings.assistant.propose","id":"ok","text":"hello","__proto__":{}}'),
    { type: "settings.assistant.apply", id: "ok", proposalId: "22f82f3a-e9f6-468b-a123-88af2fdac099", candidateId: "candidate-1", changeIds: ["change-1", "change-1"], userConfirmed: true }]) assert.equal(validateSettingsAssistantMessage(value), false)
})
