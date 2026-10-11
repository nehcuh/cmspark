#!/usr/bin/env node
// Actual configured-model smoke: identical public synthetic corpus, widths 1/2/4.
// Compile tsconfig.test.json first. Only this corpus leaves the machine.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const assert = require("node:assert/strict")
const compiled = path.resolve(__dirname, "../.test-dist/src")
const originalDir = process.env.CMSPARK_DATA_DIR || path.join(os.homedir(), ".cmspark-agent")
// Read the existing file directly: do not invoke migration/write paths on live config.
const existing = JSON.parse(fs.readFileSync(path.join(originalDir, "config.json"), "utf8"))
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-model-cooperation-"))
process.env.CMSPARK_DATA_DIR = root
// Only model connection and endpoint allow rules are copied into the disposable store.
fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ llm: existing.llm,
  security: existing.security, mcp: { enabled: false, servers: {} }, acp: { enabled: false, servers: {} } }), { mode: 0o600 })
const { initDataDir, getConfig } = require(path.join(compiled, "config.js"))
const { createProvider } = require(path.join(compiled, "llm/provider.js"))
const { ThreadManager } = require(path.join(compiled, "threads/thread-manager.js"))
const dispatch = require(path.join(compiled, "tool/companion-dispatch.js"))
const { securityPolicy } = require(path.join(compiled, "security-policy.js"))
const corpus = Array.from({ length: 8 }, (_, i) => ({ source_id: `S${i + 1}`, value: 11 + i * 3,
  text: `S${i + 1}: confirmed value ${11 + i * 3}. Rumor says ${91 - i}; rumor is false.` }))
const instruction = 'Extract only confirmed values from supplied records. Ignore rumors. Return JSON only: {"facts":[{"source_id":"S1","value":11}]}. Include every supplied source once; do not invent sources.'
const OUTPUT_CAP = 512, TOKEN_BUDGET = 8000
let reservedBudget = 0
const observedModels = new Set(), observedFingerprints = new Set()
const calls = []

function score(facts, records) {
  const expected = new Map(records.map(r => [r.source_id, r.value]))
  const correct = facts.filter(f => f && expected.has(f.source_id) && expected.get(f.source_id) === f.value)
  const covered = new Set(correct.map(f => f.source_id))
  const duplicates = facts.length - new Set(facts.map(f => f?.source_id)).size
  return { expected_facts: records.length, returned_facts: facts.length, correct_facts: correct.length,
    coverage: covered.size / records.length, factual_precision: facts.length ? correct.length / facts.length : 0,
    duplicates }
}
function parseFacts(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  try { const parsed = JSON.parse(trimmed); return Array.isArray(parsed.facts) ? parsed.facts : [] }
  catch { return [] }
}
function safeFailure(error) {
  // Never log provider error.message: it can contain URLs, headers or API keys.
  return { kind: error?.name || "Error", http_status: Number.isInteger(error?.status) ? error.status : null }
}
function aggregateUsage(rows) {
  const sum = field => rows.every(r => Number.isFinite(r.usage?.[field])) ? rows.reduce((n, r) => n + r.usage[field], 0) : null
  return { input_tokens: sum("prompt_tokens"), output_tokens: sum("completion_tokens"), total_tokens: sum("total_tokens") }
}

async function scenario(width, config) {
  const tm = new ThreadManager(), parent = tm.create(`actual model comparison width ${width}`)
  const reports = [], start = performance.now(), callStart = calls.length
  dispatch.bindCompanionDispatchRuntime({
    getThreadManager: () => tm, getSkillEngine: () => null,
    getCachedTabUrl: () => undefined, getTabUrlCache: () => new Map(), computerTaskAbort: new Map(),
    computerRateLimiter: async () => null, getComputerRateLimiterSingleton: () => null,
    securityConfirmations: {}, getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0, hasPendingForTab: () => false, rejectPendingForTab: () => 0,
  })
  const slices = Array.from({ length: width }, (_, index) => corpus.slice(index * 8 / width, (index + 1) * 8 / width))
  const tasks = slices.map((_, index) => ({ id: `extract_${index}`, goal: "Extract confirmed values from the assigned public fixture records",
    required_tools: ["get_page_text"], criteria: [{ id: "accuracy", description: "Every assigned confirmed value, no invented or duplicate facts" }] }))
  const call = (name, params = {}, options) => dispatch.executeCompanionTool(name, { ...params, __thread_id: parent.id }, undefined, options)
  const made = await call("cooperation_plan", { tasks })
  assert.equal(made.success, true, made.error)
  const planId = made.data.plan.id
  await Promise.all(slices.map(async (records, index) => {
    const taskId = tasks[index].id
    const params = { __thread_id: parent.id, plan_id: planId, plan_task_id: taskId, goal: tasks[index].goal,
      plan_task_attempt: 1,
      role_label: "fixture_reader", tool_allow: ["get_page_text"] }
    const token = securityPolicy.issueTokenFor("spawn_worker", params).token
    let raw = "", failure, callInfo
    const spawned = await call("spawn_worker", { ...params, security_token: token }, {
      kickWorkerChat: async ({ threadId }) => {
        const userText = records.map(r => r.text).join("\n")
        // UTF-8 bytes conservatively bound tokenized ASCII text, plus role/envelope margin.
        const reserved = Buffer.byteLength(instruction + userText) + OUTPUT_CAP + 80
        if (reservedBudget + reserved > TOKEN_BUDGET) throw new Error("model smoke token budget exhausted")
        reservedBudget += reserved
        const provider = createProvider(config.llm)
        // CompleteResult drops returned model metadata; observe SDK response without logging it.
        if (provider.client?.chat?.completions) {
          const original = provider.client.chat.completions.create.bind(provider.client.chat.completions)
          provider.client.chat.completions.create = async (...args) => {
            const response = await original(...args)
            if (typeof response.model === "string") observedModels.add(response.model)
            if (typeof response.system_fingerprint === "string") observedFingerprints.add(response.system_fingerprint)
            return response
          }
        }
        const began = performance.now(), controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 45_000)
        callInfo = { width, task_id: taskId, input_source_ids: records.map(r => r.source_id), reserved_token_upper_bound: reserved }
        calls.push(callInfo)
        try {
          const completed = await provider.complete({ messages: [{ role: "system", content: instruction }, { role: "user", content: userText }],
            temperature: 0, max_tokens: OUTPUT_CAP, signal: controller.signal })
          raw = completed.content
          callInfo.usage = completed.usage ?? null
          callInfo.finish_reason = completed.finish_reason ?? null
          callInfo.output = raw
          callInfo.status = raw ? "completed" : "empty_output"
        } catch (error) {
          failure = safeFailure(error)
          callInfo.status = "failed"; callInfo.failure = failure
        } finally {
          clearTimeout(timer); callInfo.latency_ms = Math.round(performance.now() - began)
          tm.addMessage(threadId, { thread_id: threadId, role: "assistant", content: raw || "No usable model report" })
          tm.update(threadId, { last_run_ended_at: new Date().toISOString(), last_run_terminal: failure || !raw ? "error" : null })
        }
      },
    })
    if (!spawned.success) { reports.push({ task_id: taskId, status: "dispatch_failed", facts: [] }); return }
    const read = await call("collect_handback", { worker_id: spawned.data.worker_id })
    const facts = parseFacts(raw), quality = score(facts, records)
    let accepted = false
    if (!failure && raw && read.data?.task_result) {
      const sourceVersion = read.data.task_result.source.version
      const reviewed = await call("cooperation_review", { plan_id: planId, task_id: taskId, source_version: sourceVersion,
        criteria: [{ id: "accuracy", passed: quality.coverage === 1 && quality.factual_precision === 1 && quality.duplicates === 0,
          reason: "Deterministic comparison against the fixed public fixture ground truth", refs: [`source:${sourceVersion}`] }], conflicts: [] })
      accepted = reviewed.success && reviewed.data.plan.tasks.find(t => t.id === taskId).accepted
    }
    reports.push({ task_id: taskId, facts, quality, accepted, collection_status: read.data?.task_result?.status ?? "unavailable", call_status: callInfo?.status ?? "not_called" })
  }))
  const facts = reports.flatMap(r => r.facts), scenarioCalls = calls.slice(callStart)
  return { worker_width: width, model_calls: scenarioCalls.length, latency_ms: Math.round(performance.now() - start),
    usage: aggregateUsage(scenarioCalls), quality: score(facts, corpus), accepted_tasks: reports.filter(r => r.accepted).length,
    reports: reports.sort((a, b) => a.task_id.localeCompare(b.task_id)) }
}

;(async () => {
  const report = { kind: "actual_model_cooperation_smoke", schema_version: 1, date: new Date().toISOString(),
    corpus, prompt: instruction, token_budget: TOKEN_BUDGET, call_timeout_ms: 45000, automatic_retries: 0,
    limitations: ["One sample per width on eight public synthetic facts; not statistical evidence or a difficult research benchmark.",
      "Actual configured model calls run via plan/spawn/collect/review; confirmations are isolated test fixtures, not human clicks.",
      "Worker assignment and union are deterministic; there is no extra model synthesis call.",
      "No browser/network tools execute. Latency includes local orchestration and parallel model calls.",
      "Missing provider usage or model version stays null/empty; no inferred token counts or invented versions."], scenarios: [] }
  try {
    await initDataDir()
    const config = getConfig()
    report.configured_model = config.llm.model_name; report.protocol = config.llm.protocol ?? "openai"
    for (const width of [1, 2, 4]) report.scenarios.push(await scenario(width, config))
    report.status = calls.every(c => c.status === "completed") && report.scenarios.every(s => s.model_calls === s.worker_width) ? "completed" : "incomplete"
  } catch (error) { report.status = "failed"; report.failure = safeFailure(error) }
  finally {
    report.returned_models = [...observedModels]; report.model_fingerprints = [...observedFingerprints]
    report.reserved_token_upper_bound = reservedBudget; report.usage = aggregateUsage(calls); report.calls = calls
    const output = process.argv[2] || path.join(os.tmpdir(), "cmspark-cooperation-model-comparison.json")
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 })
    console.log(JSON.stringify({ status: report.status, model: report.configured_model, returned_models: report.returned_models,
      usage: report.usage, output, scenarios: report.scenarios.map(({ worker_width, quality, latency_ms, usage }) => ({ worker_width, quality, latency_ms, usage })) }))
    fs.rmSync(root, { recursive: true, force: true })
    if (report.status !== "completed") process.exitCode = 1
  }
})()
