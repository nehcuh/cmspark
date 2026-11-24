import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

test("reports weighted reads on known rows and separates routes, kinds and legacy logs", t => {
  const dir = mkdtempSync(path.join(tmpdir(), "cmspark-cache-report-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const endpoint = { base_host: "gateway.test", protocol: "anthropic", model: "model-a" }
  const chat = { ...endpoint, kind: "chat", round: 1 }
  function writeLog(name: string, rows: Record<string, unknown>[]) {
    writeFileSync(path.join(dir, name), rows.map(data => JSON.stringify({ event: "llm.usage", data })).join("\r\n"))
  }
  writeLog("companion-2026-11-24.1.log", [
    { ...chat, prompt_tokens: 1000, cached_input_tokens: 900 },
    { ...chat, prompt_tokens: 10, cached_input_tokens: 0 },
    { ...chat, prompt_tokens: 10000 },
    { ...chat, round: 3, prompt_tokens: 22, cached_input_tokens: 0 },
    { kind: "title", model: "model-a", prompt_tokens: 20 },
  ])
  writeLog("companion-2026-11-24.log", [
    { ...chat, protocol: "openai", prompt_tokens: 3, cached_input_tokens: 2 },
    { ...chat, base_host: "other.test", prompt_tokens: 5, cached_input_tokens: 1 },
    { ...chat, model: "model-b", prompt_tokens: 7, cached_input_tokens: 2 },
    { ...endpoint, kind: "fleet_assess", prompt_tokens: 0, cached_input_tokens: 0 },
  ])
  writeLog("unrelated.log", [{ ...chat, prompt_tokens: 1000, cached_input_tokens: 900 }])
  const script = path.join(__dirname, "../../../scripts/prompt-cache-report.mjs")
  const output = execFileSync(process.execPath, [script, dir, path.join(dir, "companion-2026-11-24.log")], { encoding: "utf8" })
  const rows: Array<Record<string, unknown>> = JSON.parse(output)
  assert.equal(rows.length, 7)
  const first = rows.find(row => row.base_host === endpoint.base_host && row.protocol === endpoint.protocol
    && row.model === endpoint.model && row.group === "chat.round_1")
  assert.deepEqual(first, {
    ...endpoint, group: "chat.round_1", reported_requests: 2, unknown_requests: 1, hit_requests: 1,
    cached_input_tokens: 900, measured_input_tokens: 1010, token_hit_rate_percent: 89.11,
  })
  assert.equal(rows.find(row => row.group === "chat.round_2_plus")?.token_hit_rate_percent, 0)
  assert.deepEqual(rows.find(row => row.group === "title"), {
    base_host: "unknown", protocol: "unknown", model: "model-a", group: "title",
    reported_requests: 0, unknown_requests: 1, hit_requests: 0,
    cached_input_tokens: 0, measured_input_tokens: 0, token_hit_rate_percent: null,
  })
  assert.equal(rows.find(row => row.group === "fleet_assess")?.token_hit_rate_percent, null)
})
