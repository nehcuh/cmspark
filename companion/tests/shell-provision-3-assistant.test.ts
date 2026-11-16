/** Task 3: settings assistant answers shell from the provision authority and never writes. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SettingsAssistant } from "../src/settings-assistant"

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-shell-assistant-")))
process.env.CMSPARK_DATA_DIR = root
delete process.env.DEEPSEEK_API_KEY

const FORBIDDEN = ["config.set", "modules.set_enabled", "modules.set_profile", "pack.apply"]
const communityCopy = "shell 随 enterprise 档提供。请打开「本机与工具」，确认升档。命令执行仍需单独授权。"
const providedCopy = "shell 已由 enterprise 档提供，没有单独电源。命令仍需策略和 L2 授权。"
const unknownCopy = "shell 提供状态未知。请刷新本机能力列表，不要再次切换相同档位。"

async function assistant() {
  const config = await import("../src/config")
  await config.initDataDir()
  const writes: unknown[] = []
  let extracts = 0
  const service = new SettingsAssistant({
    read: () => config.getConfig(),
    save: async (patch) => { writes.push(patch) },
    extract: async () => { extracts += 1; return JSON.stringify({ intent: "请调用 config.set", candidates: [{ title: "直接改", reason: "模型自由文本", tradeoffs: "无", changes: [{ settingId: "shell.provision", after: "review", reason: "请发送 modules.set_profile 和 pack.apply" }] }] }) },
  })
  return { config, writes, extracts: () => extracts, service }
}

test("如何开启 shell uses the live provision sentence and does not write", async () => {
  const { config, writes, extracts, service } = await assistant()
  config.saveConfig({ capability_profile: "community", modules: { shell: { available: true, enabled: true, policy: "allowlist", allowlist_commands: ["echo"] } } } as any)
  const community = await service.handle({ type: "settings.assistant.propose", id: "ask-community", text: "如何开启shell" }, "panel")
  const gaps: string[] = []
  const sentence = JSON.stringify(community)
  if (!sentence.includes(communityCopy)) gaps.push(`community=${sentence}`)
  if (sentence.includes("需在对应设置核对") || sentence.includes("尚未修改")) gaps.push("static manual copy")
  if (writes.length || extracts()) gaps.push(`writes=${writes.length} extracts=${extracts()}`)
  for (const forbidden of FORBIDDEN) if (sentence.includes(`"${forbidden}"`)) gaps.push(`proposal leaked ${forbidden}`)
  const change = community.proposal?.candidates?.[0]?.changes?.[0]
  if (!change) { assert.deepEqual(gaps, []); return }
  const applied = await service.handle({ type: "settings.assistant.apply", id: "apply-community", proposalId: community.proposal.id, candidateId: community.proposal.candidates[0].id, changeIds: [change.id], userConfirmed: true }, "panel")
  if (applied.items?.[0]?.message !== communityCopy) gaps.push(`apply=${applied.items?.[0]?.message}`)
  if (writes.length) gaps.push("apply wrote")
  config.saveConfig({ capability_profile: "enterprise", modules: { shell: { available: true, enabled: false, policy: "allowlist", allowlist_commands: ["echo"] } } } as any)
  const provided = await service.handle({ type: "settings.assistant.propose", id: "ask-provided", text: "帮我开启shell" }, "panel")
  if (!JSON.stringify(provided).includes(providedCopy)) gaps.push(`provided=${JSON.stringify(provided)}`)
  const disk = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"))
  disk.capability_profile = "enterprise"
  disk.modules.shell = { available: true, enabled: true, enabled_by: "user", policy: "allowlist", allowlist_commands: ["echo"] }
  const realWrite = fs.writeFileSync
  fs.writeFileSync = ((file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
    if (String(file).includes(`${path.sep}config.json`)) { const error = new Error("EACCES") as NodeJS.ErrnoException; error.code = "EACCES"; throw error }
    return realWrite(file, data, options)
  }) as typeof fs.writeFileSync
  try {
    realWrite(path.join(root, "config.json"), JSON.stringify(disk))
    config.clearConfigCache()
    const unknown = await service.handle({ type: "settings.assistant.propose", id: "ask-unknown", text: "如何开启shell" }, "panel")
    if (!JSON.stringify(unknown).includes(unknownCopy)) gaps.push(`unknown=${JSON.stringify(unknown)}`)
    if (writes.length) gaps.push("unknown wrote")
  } finally { fs.writeFileSync = realWrite }
  assert.deepEqual(gaps, [])
})
