// OwnedFS + inert transport: actual handler, source-extracted lifecycle/receiver,
// and source-extracted extension reducer. No listener, browser or daemon starts.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

const required = ["companion/src/ws/lifecycle.ts", "chrome-extension/src/sidepanel/store/agentStore.tsx"]
const candidates = [path.resolve(__dirname, "../.."), path.resolve(__dirname, "../../..")]
const roots = candidates.filter(root => required.every(file => fs.existsSync(path.join(root, file))))
assert.equal(roots.length, 1, "one source root for both direct and compiled test layouts")
const root = roots[0]
const parse = (file: string, kind = ts.ScriptKind.TS) => ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, kind)
const lifecycle = parse("companion/src/ws/lifecycle.ts")
const incoming = parse("chrome-extension/src/sidepanel/hooks/useWebSocket.ts")
const draft = parse("chrome-extension/src/sidepanel/utils/settings-draft.ts")
const normalizer = parse("chrome-extension/src/sidepanel/utils/normalize-config.ts")
const effort = parse("chrome-extension/src/sidepanel/utils/reasoning-effort.ts")
const store = parse("chrome-extension/src/sidepanel/store/agentStore.tsx", ts.ScriptKind.TSX)
const functionText = (source: ts.SourceFile, name: string) => {
  const found = source.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.equal(found.length, 1, `unique actual function ${name}`)
  return found[0].getText(source).replace(/^export\s+/, "")
}
const code = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let configListener: ts.ArrowFunction | undefined, reply: ts.IfStatement | undefined, receiver: ts.CaseClause | undefined
const findLifecycle = (node: ts.Node) => {
  if (ts.isCallExpression(node) && node.expression.getText(lifecycle) === "configEvents.on" && node.arguments[0]?.getText(lifecycle) === "CONFIG_CHANGE_EVENT" && ts.isArrowFunction(node.arguments[1])) { assert.equal(configListener, undefined); configListener = node.arguments[1] }
  if (ts.isIfStatement(node) && node.expression.getText(lifecycle) === "response && ws.readyState === WebSocket.OPEN") { assert.equal(reply, undefined); reply = node }
  ts.forEachChild(node, findLifecycle)
}
findLifecycle(lifecycle)
const findReceiver = (node: ts.Node) => {
  if (ts.isCaseClause(node) && node.expression.getText(incoming) === '"config.conflict"') { assert.equal(receiver, undefined); receiver = node }
  ts.forEachChild(node, findReceiver)
}
findReceiver(incoming)
assert.ok(configListener && reply && receiver)
const stateDeclarations = store.statements.flatMap(node => ts.isVariableStatement(node) ? node.declarationList.declarations.filter(d => d.name.getText(store) === "initialState") : [])
assert.equal(stateDeclarations.length, 1)
const initialExpression = stateDeclarations[0].initializer
assert.ok(initialExpression)
const draftFunctions = ["sameValue", "createSettingsDraft", "editSettingsDraft", "receiveSettingsSnapshot", "prepareSettingsSubmission", "resolveSettingsConflict", "acknowledgeSettingsSubmission", "compareSettingsRevisions"].map(name => functionText(draft, name)).join("\n")
const consumerCode = [draftFunctions, functionText(effort, "isReasoningEffort"), functionText(effort, "effectiveReasoningEffort"), functionText(normalizer, "isMaskedApiKey"), functionText(normalizer, "normalizeConfig"), functionText(store, "agentReducer"), `globalThis.initialState = ${initialExpression.getText(store)}; globalThis.agentReducer = agentReducer; globalThis.prepareSettingsSubmission = prepareSettingsSubmission; globalThis.normalizeConfig = normalizeConfig;`].join("\n")
const receiveCode = receiver.statements.filter(node => !ts.isBreakStatement(node)).map(node => node.getText(incoming)).join("\n")

test("#806 actual config producers and source consumers preserve draft provenance", async t => {
  const owned = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-settings-chain-806-")))
  const identity = fs.lstatSync(owned, { bigint: true }), previousDataDir = process.env.CMSPARK_DATA_DIR, previousApiKey = process.env.DEEPSEEK_API_KEY
  process.env.CMSPARK_DATA_DIR = owned
  delete process.env.DEEPSEEK_API_KEY
  try {
    const config = await import("../src/config")
    const { handleConfigFamily } = await import("../src/message-router/handlers/config")
    const { redactConfigForWire } = await import("../src/config-redact")
    let frames: any[] = [], state: any
    const context: any = { getConfigSnapshot: config.getConfigSnapshot, redactConfigForWire,
      broadcastToClients: (frame: any) => frames.push(JSON.parse(JSON.stringify(frame))),
      mcpManager: { applyConfig: async () => {} }, logger: { warn: () => {} }, WebSocket: { OPEN: 1 },
      dispatch: (action: any) => { state = context.agentReducer(state, action) } }
    vm.runInNewContext(code(consumerCode), context, { timeout: 1000 })
    vm.runInNewContext(code(`globalThis.listener = (${configListener!.getText(lifecycle)})`), context, { timeout: 1000 })
    vm.runInNewContext(code(`globalThis.consume = (msg: any) => { ${receiveCode} }`), context, { timeout: 1000 })
    vm.runInNewContext(code(`globalThis.echo = (response: any, msg: any, ws: any) => { ${reply!.getText(lifecycle)} }`), context, { timeout: 1000 })
    const listener = context.listener
    const echo = (response: any, id: string) => context.echo(response, { id }, { readyState: 1, send: (json: string) => frames.push(JSON.parse(json)) })
    const deliver = () => { const batch = frames; frames = []; for (const frame of batch) context.consume(frame) }
    const start = (key: string, first: string, later: string) => {
      state = context.agentReducer(state, { type: "EDIT_SETTINGS_DRAFT", config: { [key]: first } })
      const submission = context.prepareSettingsSubmission(state.settingsDraft, "settings-save:owned")
      state = context.agentReducer(state, { type: "BEGIN_SETTINGS_SAVE", submission })
      state = context.agentReducer(state, { type: "EDIT_SETTINGS_DRAFT", config: { [key]: later } })
      return submission
    }
    const run = async (fn: () => Promise<void>) => {
      frames = []; config.clearConfigCache()
      config.saveConfig({ llm: { ...config.getConfig().llm, api_key: "", model_name: "old" } })
      state = context.agentReducer(context.initialState, { type: "SET_CONNECTION", state: "connected" })
      context.consume(await handleConfigFamily("config.get", {}))
      state = context.agentReducer(state, { type: "BEGIN_SETTINGS_DRAFT" })
      config.configEvents.on(config.CONFIG_CHANGE_EVENT, listener)
      try { await fn() } finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, listener) }
    }
    await t.test("own broadcast and proven ACK retain later edit without false conflict", () => run(async () => {
      const p = start("model_name", "first", "later"), result = await handleConfigFamily("config.set", { id: p.id, config: p.patch, config_revision: p.revision })
      assert.equal(result.config_applied_revision, result.config_revision); echo(result, p.id); assert.equal(frames.length, 2); deliver()
      assert.equal(state.settingsDraft.value.model_name, "later"); assert.ok(state.settingsDraft.dirty.model_name); assert.equal(state.settingsDraft.conflicts.model_name, undefined); assert.equal(state.settingsSave.status, "review")
    }))
    await t.test("same-value reentrant write yields no proof and retains conflict", () => run(async () => {
      const p = start("model_name", "first", "later")
      const reenter = () => { config.configEvents.off(config.CONFIG_CHANGE_EVENT, reenter); config.saveConfig({ llm: { ...config.getConfig().llm, model_name: "first" } }) }
      config.configEvents.on(config.CONFIG_CHANGE_EVENT, reenter)
      try { const result = await handleConfigFamily("config.set", { id: p.id, config: p.patch, config_revision: p.revision }); assert.equal(result.config_applied_revision, undefined); echo(result, p.id); deliver(); assert.equal(state.settingsDraft.value.model_name, "later"); assert.equal(state.settingsDraft.conflicts.model_name, true) }
      finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, reenter) }
    }))
    await t.test("later third-party write conflicts after own ACK", () => run(async () => {
      const p = start("model_name", "first", "later"), result = await handleConfigFamily("config.set", { id: p.id, config: p.patch, config_revision: p.revision })
      echo(result, p.id); deliver(); assert.equal(state.settingsDraft.conflicts.model_name, undefined)
      config.saveConfig({ llm: { ...config.getConfig().llm, model_name: "other" } }); deliver(); assert.equal(state.settingsDraft.conflicts.model_name, true); assert.equal(state.settingsDraft.value.model_name, "later")
    }))
    await t.test("masked secret ACK only confirms original generation", () => run(async () => {
      const p = start("api_key", "owned-a", "owned-b"), result = await handleConfigFamily("config.set", { id: p.id, config: p.patch, config_revision: p.revision })
      assert.deepEqual(result.config_applied_secret_fields, ["api_key"]); assert.equal(result.config.llm.api_key, "***"); echo(result, p.id); deliver()
      assert.equal(state.settingsDraft.value.api_key, "owned-b"); assert.ok(state.settingsDraft.dirty.api_key); assert.equal(state.settingsDraft.conflicts.api_key, undefined)
    }))
    await t.test("third-party write before save causes CAS conflict", () => run(async () => {
      const p = start("model_name", "first", "later"); config.saveConfig({ llm: { ...config.getConfig().llm, model_name: "other" } })
      const result = await handleConfigFamily("config.set", { id: p.id, config: p.patch, config_revision: p.revision }); assert.equal(result.type, "config.conflict"); assert.equal(result.config_applied_revision, undefined)
      echo(result, p.id); deliver(); assert.equal(state.settingsSave.status, "conflict"); assert.equal(state.settingsDraft.value.model_name, "later"); assert.equal(state.settingsDraft.conflicts.model_name, true)
    }))
    await t.test("reentrant masked secret yields no proof and retains conflict", () => run(async () => {
      const p = start("api_key", "owned-a", "owned-b")
      const reenter = () => { config.configEvents.off(config.CONFIG_CHANGE_EVENT, reenter); config.saveConfig({ llm: { ...config.getConfig().llm, api_key: "owned-a" } }, { llmKey: true }) }
      config.configEvents.on(config.CONFIG_CHANGE_EVENT, reenter)
      try { const result = await handleConfigFamily("config.set", { id: p.id, config: p.patch, config_revision: p.revision }); assert.equal(result.config_applied_revision, undefined); assert.equal(result.config_applied_secret_fields, undefined); assert.equal(result.config.llm.api_key, "***"); echo(result, p.id); deliver(); assert.equal(state.settingsDraft.conflicts.api_key, true); assert.equal(state.settingsDraft.value.api_key, "owned-b") }
      finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, reenter) }
    }))
    await t.test("unrelated later write does not conflict with edited model", () => run(async () => {
      const p = start("model_name", "first", "later"), result = await handleConfigFamily("config.set", { id: p.id, config: p.patch, config_revision: p.revision })
      echo(result, p.id); deliver(); config.saveConfig({ trusted_domains: ["example.invalid"] }); deliver(); assert.equal(state.settingsDraft.value.model_name, "later"); assert.equal(state.settingsDraft.conflicts.model_name, undefined); assert.ok(state.settingsDraft.dirty.model_name)
    }))
  } finally {
    if (previousDataDir === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = previousDataDir
    if (previousApiKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousApiKey
    const current = fs.lstatSync(owned, { bigint: true }); assert.equal(current.isSymbolicLink(), false); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino)
    fs.rmSync(owned, { recursive: true })
  }
})
