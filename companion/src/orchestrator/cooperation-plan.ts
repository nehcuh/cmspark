import { createHash, randomUUID } from "crypto"
import { z } from "zod"
import type { ThreadManager } from "../threads/thread-manager"
import type { CooperationResult } from "./cooperation-result"
import { dependencyReadiness } from "./cooperation-dependencies"
import { computeWorkerWhitelist, workerParentCapabilityWhitelist, workerWhitelistAllows } from "./spawn"
import { getMcpManager } from "../mcp/manager"
import { workerCapUsage } from "./worker-occupancy"
import { ORCHESTRATOR_CAPS } from "./constants"
import catalog from "../bridge/tool-definitions-catalog.json"
const KNOWN_TOOLS = new Set(catalog.map(t => t.function.name))

const PROCESS_ID = randomUUID()
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)
const text = z.string().trim().min(1).max(2000)
export const planInput = z.object({ tasks: z.array(z.object({
  id, goal: text, depends_on: z.array(id).max(32).default([]),
  required_tools: z.array(z.string().min(1).max(128)).max(32).default([]),
  input_refs: z.array(z.string().min(1).max(512)).max(16).default([]),
  criteria: z.array(z.object({ id, description: text })).min(1).max(8),
})).min(1).max(32) })
export const reviewInput = z.object({ plan_id: id, task_id: id, source_version: z.string().min(1).max(512),
  criteria: z.array(z.object({ id, passed: z.boolean(), reason: text,
    refs: z.array(z.string().min(1).max(600)).max(16), })).min(1).max(8),
  conflicts: z.array(text).max(8),
})
type Decision = z.infer<typeof reviewInput>["criteria"][number] & { source_version: string; attempt: number }
type Attempt = { number: number; worker_id: string; process_id: string; started_at: string; result?: CooperationResult; launch_error?: string }
type McpBinding = { server_name: string; tool_name: string; identity: string }
export type PlannedTask = z.infer<typeof planInput>["tasks"][number] & {
  attempts: Attempt[]; decisions: Decision[]; conflicts: string[]
  mcp_bindings?: Record<string, McpBinding>
}
export type CooperationPlan = { id: string; run_id: string | null; tasks: PlannedTask[]; created_at: string }
type Active = (id: string) => boolean

function owner(tm: ThreadManager, ownerId: string) {
  const parent = tm.get(ownerId)
  if (!parent || parent.agent_role === "worker" || parent.parent_thread_id) throw new Error("cooperation requires the owning parent thread")
  return parent
}

function fingerprint(value: unknown): string {
  // Persist only a deterministic digest: server config can contain credentials.
  const json = JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry)
  return createHash("sha256").update(json).digest("hex")
}

function currentMcpBinding(tm: ThreadManager, ownerId: string, name: string): McpBinding {
  const parent = owner(tm, ownerId), manager = getMcpManager()
  const route = manager.resolveToolName(name)
  if (!name.startsWith("mcp__") || !route) throw new Error(`unknown or unavailable required MCP capability: ${name}`)
  const live = manager.listServers().find(server => server.name === route.serverName)
  const configured = manager.getServerConfig(route.serverName)
  if (!live || live.connection.status !== "connected" || !live.enabled || !configured?.enabled ||
    fingerprint(live.config) !== fingerprint(configured)) throw new Error(`required MCP server unavailable or changing: ${route.serverName}`)
  if (parent.mcp_selection_mode === "manual" && !parent.active_mcp_server_ids?.includes(route.serverName)) {
    throw new Error(`required MCP server is outside parent selection: ${route.serverName}`)
  }
  const whitelist = workerParentCapabilityWhitelist(parent)
  if (whitelist !== null && !workerWhitelistAllows(whitelist, name)) throw new Error(`parent lacks required MCP capability: ${name}`)
  return { server_name: route.serverName, tool_name: route.toolName,
    identity: fingerprint({ config: configured, inputSchema: manager.getToolInputSchema(name) }) }
}

function assertRequiredCapabilities(tm: ThreadManager, ownerId: string, task: PlannedTask, tools: string[]): void {
  for (const name of task.required_tools) {
    if (!workerWhitelistAllows(tools, name)) throw new Error("worker lacks required capabilities")
    if (!KNOWN_TOOLS.has(name)) assertBoundMcpCapability(tm, ownerId, task, name)
  }
}

function assertBoundMcpCapability(tm: ThreadManager, ownerId: string, task: PlannedTask, name: string, currentName = name): void {
  const binding = task.mcp_bindings?.[name], current = currentMcpBinding(tm, ownerId, currentName)
  if (!binding || binding.server_name !== current.server_name || binding.tool_name !== current.tool_name || binding.identity !== current.identity) {
    throw new Error(`required MCP capability changed since planning: ${name}`)
  }
}

/** Reuse before/after confirmation; bind both the requested alias and the underlying capability. */
export function plannedWorkerMcpError(tm: ThreadManager, workerId: string, name: string): string | null {
  const worker = tm.get(workerId), parentId = worker?.parent_thread_id
  if (!worker || !parentId || !name.startsWith("mcp__")) return null
  const parent = tm.get(parentId), plan = parent?.cooperation_plan
  const task = plan?.tasks.find(task => task.attempts.some(attempt => attempt.worker_id === workerId))
  if (!task) return null
  const route = getMcpManager().resolveToolName(name)
  const boundNames = task.required_tools.filter(requiredName => {
    const binding = task.mcp_bindings?.[requiredName]
    return requiredName === name || (binding && route &&
      binding.server_name === route.serverName && binding.tool_name === route.toolName)
  })
  if (boundNames.length === 0) return null
  try {
    if (latest(task)?.worker_id !== workerId || plan?.run_id !== worker.orchestrator_run_id || plan?.run_id !== parent?.orchestrator_run_id) {
      throw new Error("MCP worker belongs to a stale cooperation attempt")
    }
    if (!tm.isToolAllowed(workerId, name)) throw new Error("worker lacks required MCP capability")
    for (const boundName of boundNames) assertBoundMcpCapability(tm, parentId, task, boundName, name)
    return null
  } catch (error) { return String(error) }
}
function currentPlan(tm: ThreadManager, ownerId: string, planId?: string) {
  const parent = owner(tm, ownerId), plan = parent.cooperation_plan
  if (!plan || (planId && plan.id !== planId)) throw new Error("cooperation plan not found or superseded")
  if (plan.run_id !== null && plan.run_id !== parent.orchestrator_run_id) throw new Error("cooperation plan belongs to a stale run")
  return plan
}
function write(tm: ThreadManager, ownerId: string, plan: CooperationPlan) {
  if (!tm.update(ownerId, { cooperation_plan: plan })) throw new Error("cooperation checkpoint could not be saved")
}
function assertMutable(tm: ThreadManager, ownerId: string) {
  if (owner(tm, ownerId).execution_policy === "plan_readonly") throw new Error("cooperation mutation forbidden in plan_readonly")
}
function latest(task: PlannedTask) { return task.attempts.at(-1) }

/** Observation only: planned creation attempts never increase a worker's recovery budget. */
export function clampPlannedRecovery(tm: ThreadManager, ownerId: string, result: CooperationResult): CooperationResult {
  const parent = tm.get(ownerId), plan = parent?.cooperation_plan
  if (result.executor !== "browser" || result.owner_thread_id !== ownerId || !plan ||
      plan.run_id !== (parent?.orchestrator_run_id ?? null) || result.run_id !== plan.run_id) return result
  const task = plan.tasks.find(t => t.attempts.some(a => a.worker_id === result.source.thread_id))
  if (!task) return result
  const budget = Math.min(result.recovery.budget_remaining, Math.max(0, 3 - task.attempts.length))
  const exhaustedRetry = budget === 0 && result.recovery.action === "retry_after_confirmation"
  if (budget === result.recovery.budget_remaining && !exhaustedRetry) return result
  return { ...result, recovery: { ...result.recovery, budget_remaining: budget,
    ...(exhaustedRetry ? { action: "revise_plan" as const, requires_confirmation: false } : {}) } }
}
function sourceIsCurrent(tm: ThreadManager, result: CooperationResult) {
  const worker = tm.get(result.source.thread_id)
  if (!worker) return true
  if (worker.last_run_execution_id && worker.last_run_execution_id !== worker.last_run_settled_execution_id) return false
  const prefix = `${worker.last_run_ended_at ?? "not_started"}:${worker.last_run_terminal ?? "normal"}:${!!worker.paused}:`
  const lastAssistant = tm.getMessages(worker.id).filter(m => m.role === "assistant").at(-1)
  return result.source.version.startsWith(prefix) && result.source.message_id === lastAssistant?.id &&
    result.source.execution_id === worker.last_run_execution_id
}
function validDecision(tm: ThreadManager, task: PlannedTask, decision: Decision, isActive: Active) {
  if (!decision.passed) return false
  const attempt = task.attempts.find(a => a.number === decision.attempt), result = attempt?.result
  if (!attempt || !result || result.source.version !== decision.source_version) return false
  const worker = tm.get(attempt.worker_id)
  // A removed source retains its bounded checkpoint, but cannot promise raw history.
  if (!worker) return true
  if (worker.parent_thread_id !== result.owner_thread_id || worker.orchestrator_run_id !== result.run_id ||
      (tm.get(result.owner_thread_id)?.orchestrator_run_id ?? null) !== result.run_id) return false
  return !isActive(worker.id) && !worker.paused && sourceIsCurrent(tm, result)
}
function accepted(tm: ThreadManager, task: PlannedTask, isActive: Active) {
  return task.conflicts.length === 0 && missing(tm, task, isActive).length === 0
}
function missing(tm: ThreadManager, task: PlannedTask, isActive: Active) {
  return task.criteria.filter(c => !task.decisions.some(d => d.id === c.id && validDecision(tm, task, d, isActive)))
}
function runtimeStatus(tm: ThreadManager, task: PlannedTask, isActive: Active) {
  const attempt = latest(task)
  if (!attempt) return "pending"
  const worker = tm.get(attempt.worker_id)
  if (worker?.paused) return "paused"
  if (isActive(attempt.worker_id)) return "running"
  if (worker?.last_run_execution_id && worker.last_run_execution_id !== worker.last_run_settled_execution_id) return "interrupted"
  if (worker?.last_run_terminal === "aborted") return "cancelled"
  if (worker?.last_run_terminal === "security_halt") return "blocked"
  if (attempt.launch_error) return "failed"
  if (attempt.result && !sourceIsCurrent(tm, attempt.result)) return "needs_collection"
  if (attempt.result && !["ready", "running"].includes(attempt.result.status)) return attempt.result.status
  if (worker?.last_run_ended_at) return "needs_collection"
  return attempt.process_id === PROCESS_ID ? "queued" : "interrupted"
}

/** Immutable within a run: neither a model nor a retry can reset the attempt budget. */
export function createCooperationPlan(tm: ThreadManager, ownerId: string, input: unknown) {
  assertMutable(tm, ownerId)
  const parent = owner(tm, ownerId), parsed = planInput.parse(input)
  if (parent.cooperation_plan) throw new Error("a cooperation plan already exists; resume it instead of resetting its budget")
  if (new Set(parsed.tasks.map(t => t.id)).size !== parsed.tasks.length) throw new Error("duplicate task id")
  for (const task of parsed.tasks) {
    for (const name of task.required_tools) {
      if (!KNOWN_TOOLS.has(name)) currentMcpBinding(tm, ownerId, name)
    }
    if (new Set(task.criteria.map(c => c.id)).size !== task.criteria.length) throw new Error("duplicate criterion id")
    const check = dependencyReadiness(task.id, parsed.tasks.map(t => ({ id: t.id, status: "open", depends_on_intent_ids: t.depends_on })))
    if (check.reason === "missing" || check.reason === "cycle") throw new Error(`invalid dependencies: ${check.reason}`)
  }
  const plan: CooperationPlan = { id: randomUUID(), run_id: parent.orchestrator_run_id ?? null,
    created_at: new Date().toISOString(), tasks: parsed.tasks.map(t => ({ ...t, attempts: [], decisions: [], conflicts: [],
      mcp_bindings: Object.fromEntries(t.required_tools.filter(name => !KNOWN_TOOLS.has(name)).map(name => [name, currentMcpBinding(tm, ownerId, name)])),
    })) }
  write(tm, ownerId, plan)
  return plan
}

export function plannedSpawnCheck(tm: ThreadManager, ownerId: string, params: Record<string, any>, isActive: Active, effectiveTools?: string[]) {
  assertMutable(tm, ownerId)
  const plan = currentPlan(tm, ownerId, params.plan_id), parent = owner(tm, ownerId)
  if (!params.plan_id || !params.plan_task_id) throw new Error("plan_id and plan_task_id required together")
  const task = plan.tasks.find(t => t.id === params.plan_task_id)
  if (!task) throw new Error("planned task not found")
  if (params.plan_task_attempt !== task.attempts.length + 1) throw new Error("planned attempt changed; request a fresh confirmation")
  if (parent.paused || (["aborted", "security_halt"].includes(parent.last_run_terminal ?? "") && !isActive(ownerId))) throw new Error("parent stopped; resume through the existing user control")
  if (String(params.goal ?? "").trim() !== task.goal) throw new Error("spawn goal must match the immutable plan goal")
  if (accepted(tm, task, isActive)) throw new Error("task already accepted; reuse its checkpoint")
  if (task.depends_on.some(dep => !plan.tasks.some(t => t.id === dep && accepted(tm, t, isActive)))) throw new Error("dependencies await acceptance")
  if (task.attempts.length >= 3) throw new Error("task attempt budget exhausted")
  const state = runtimeStatus(tm, task, isActive)
  if (["running", "queued", "needs_collection", "paused", "cancelled", "blocked"].includes(state)) throw new Error(`task cannot be replaced: ${state}`)
  if (state === "completed" && task.decisions.length === 0) throw new Error("review the completed result before replacement")
  const tools = effectiveTools ?? computeWorkerWhitelist({ parentWhitelist: workerParentCapabilityWhitelist(parent),
    roleAllow: Array.isArray(params.tool_allow) ? params.tool_allow : null, roleDeny: params.tool_deny })
  assertRequiredCapabilities(tm, ownerId, task, tools)
  return { plan, task, missing: missing(tm, task, isActive) }
}

/** Synchronous compare/check/write before kick; concurrent spawns cannot both bind. */
export function bindPlannedWorker(tm: ThreadManager, ownerId: string, params: Record<string, any>, workerId: string, isActive: Active) {
  const worker = tm.get(workerId)
  if (!worker || worker.parent_thread_id !== ownerId) throw new Error("planned worker owner mismatch")
  const { plan, task } = plannedSpawnCheck(tm, ownerId, params, isActive, worker.tool_whitelist ?? [])
  if (worker.mcp_selection_mode === "manual" && Object.values(task.mcp_bindings ?? {}).some(binding => !worker.active_mcp_server_ids?.includes(binding.server_name))) {
    throw new Error("worker selection excludes required MCP server")
  }
  const attempt: Attempt = { number: task.attempts.length + 1, worker_id: workerId, process_id: PROCESS_ID, started_at: new Date().toISOString() }
  write(tm, ownerId, { ...plan, run_id: worker.orchestrator_run_id ?? null,
    tasks: plan.tasks.map(t => t.id === task.id ? { ...t, attempts: [...t.attempts, attempt] } : t) })
  return { attempt: attempt.number, missing: missing(tm, task, isActive), input_refs: task.input_refs }
}

export function plannedLaunchFailed(tm: ThreadManager, ownerId: string, workerId: string, error: unknown) {
  const plan = owner(tm, ownerId).cooperation_plan
  if (!plan) return
  write(tm, ownerId, { ...plan, tasks: plan.tasks.map(t => latest(t)?.worker_id !== workerId ? t : {
    ...t, attempts: t.attempts.map(a => a.worker_id === workerId ? { ...a, launch_error: String(error).slice(0, 500) } : a),
  }) })
}

/** Used before Board merge, not merely after recording the merged result. */
export function isCurrentPlannedWorker(tm: ThreadManager, workerId: string): boolean {
  const worker = tm.get(workerId), parent = worker?.parent_thread_id ? tm.get(worker.parent_thread_id) : undefined
  const plan = parent?.cooperation_plan
  const task = plan?.tasks.find(t => t.attempts.some(a => a.worker_id === workerId))
  return !task || (latest(task)?.worker_id === workerId && plan?.run_id === worker?.orchestrator_run_id && plan?.run_id === parent?.orchestrator_run_id)
}

export function checkpointCooperationResult(tm: ThreadManager, ownerId: string, result: CooperationResult) {
  if (result.executor !== "browser" || !isCurrentPlannedWorker(tm, result.source.thread_id)) return
  const plan = owner(tm, ownerId).cooperation_plan
  const task = plan?.tasks.find(t => latest(t)?.worker_id === result.source.thread_id)
  if (!plan || !task) return
  result = clampPlannedRecovery(tm, ownerId, result)
  const old = latest(task)!
  const sameReport = old.result?.source.version === result.source.version && old.result.status === result.status
  const previous = old.result?.recovery, incoming = result.recovery
  if (sameReport && previous?.action === incoming.action && previous.automatic === incoming.automatic &&
      previous.requires_confirmation === incoming.requires_confirmation && previous.budget_remaining === incoming.budget_remaining) return
  write(tm, ownerId, { ...plan, tasks: plan.tasks.map(t => t.id !== task.id ? t : { ...t,
    // A changed report invalidates judgments about that attempt, not accepted siblings.
    decisions: sameReport ? t.decisions : t.decisions.filter(d => d.attempt !== old.number),
    attempts: t.attempts.map(a => a.number === old.number ? { ...a, result } : a),
  }) })
}

export function reviewCooperationTask(tm: ThreadManager, ownerId: string, input: unknown, isActive: Active) {
  assertMutable(tm, ownerId)
  const parsed = reviewInput.parse(input), plan = currentPlan(tm, ownerId, parsed.plan_id)
  const task = plan.tasks.find(t => t.id === parsed.task_id), attempt = task && latest(task), result = attempt?.result
  if (!task || !attempt || !result || result.source.version !== parsed.source_version) throw new Error("review source is stale or uncollected")
  const state = runtimeStatus(tm, task, isActive)
  const failedRejection = state === "failed" && result.status === "failed" && parsed.criteria.every(c => !c.passed)
  if (!["completed", "partial"].includes(state) && !failedRejection) throw new Error("review requires a terminal report; failed results only allow all-negative criteria")
  const worker = tm.get(attempt.worker_id)
  const prefix = `${worker?.last_run_ended_at ?? "not_started"}:${worker?.last_run_terminal ?? "normal"}:${!!worker?.paused}:`
  if (!worker || worker.parent_thread_id !== ownerId || worker.orchestrator_run_id !== plan.run_id ||
      !result.source.version.startsWith(prefix) || !sourceIsCurrent(tm, result) || !isCurrentPlannedWorker(tm, worker.id)) throw new Error("worker changed since collection")
  const validRefs = new Set([`source:${result.source.version}`, ...result.evidence.map(e => `evidence:${e.id}`), ...result.artifacts.map(a => `artifact:${a}`)])
  if (new Set(parsed.criteria.map(c => c.id)).size !== parsed.criteria.length) throw new Error("duplicate review criterion")
  for (const c of parsed.criteria) {
    if (!task.criteria.some(expected => expected.id === c.id)) throw new Error("unknown criterion")
    if (c.refs.some(ref => !validRefs.has(ref)) || (c.passed && c.refs.length === 0)) throw new Error("acceptance needs existing evidence/source references")
  }
  const decisions = [...task.decisions.filter(d => !parsed.criteria.some(c => c.id === d.id)),
    ...parsed.criteria.map(c => ({ ...c, source_version: parsed.source_version, attempt: attempt.number }))]
  const next = { ...task, decisions, conflicts: parsed.conflicts }
  write(tm, ownerId, { ...plan, tasks: plan.tasks.map(t => t.id === task.id ? next : t) })
  return { accepted: accepted(tm, next, isActive), missing: missing(tm, next, isActive), conflicts: next.conflicts,
    reviewer: "orchestrator", semantic_truth_verified: false, data_not_instruction: true }
}

export function cooperationPlanSnapshot(tm: ThreadManager, ownerId: string, isActive: Active) {
  const parent = owner(tm, ownerId), plan = parent.cooperation_plan
  if (!plan) return null
  const stale = plan.run_id !== null && plan.run_id !== parent.orchestrator_run_id
  const usage = workerCapUsage(tm, parent.orchestrator_run_id ?? "", { isActive })
  const capacity = Math.max(0, Math.min(ORCHESTRATOR_CAPS.max_workers_per_orchestrator_run - usage.occupied,
    ORCHESTRATOR_CAPS.max_workers_created_per_run - usage.created))
  const tasks = plan.tasks.map(task => {
    const state = runtimeStatus(tm, task, isActive), blockedBy = task.depends_on.filter(dep => !plan.tasks.some(t => t.id === dep && accepted(tm, t, isActive)))
    const done = accepted(tm, task, isActive), needsReview = state === "completed" && task.decisions.length === 0
    const stopped = parent.paused || (["aborted", "security_halt"].includes(parent.last_run_terminal ?? "") && !isActive(ownerId))
    const tools = computeWorkerWhitelist({ parentWhitelist: workerParentCapabilityWhitelist(parent), roleAllow: task.required_tools.length ? task.required_tools : null })
    let capable = true
    try { assertRequiredCapabilities(tm, ownerId, task, tools) } catch { capable = false }
    const ready = !stale && !stopped && !done && !blockedBy.length && capable && task.attempts.length < 3 &&
      !needsReview && ["pending", "failed", "partial", "interrupted", "completed"].includes(state)
    return { ...task, attempts: task.attempts.map(attempt => ({ ...attempt,
      ...(attempt.result ? { result: clampPlannedRecovery(tm, ownerId, attempt.result) } : {}) })),
      runtime_status: state, accepted: done, missing: missing(tm, task, isActive), blocked_by: blockedBy,
      next_attempt: task.attempts.length + 1,
      required_capabilities_available: capable, ready, attempts_remaining: Math.max(0, 3 - task.attempts.length),
      next_action: done ? "reuse_accepted_result" : ready ? "spawn_worker_after_confirmation" : needsReview ? "review_result" : state === "needs_collection" ? "collect_handback" : "resolve_blocker_or_wait" }
  })
  return { ...plan, tasks, stale, capacity, ready_task_ids: tasks.filter(t => t.ready).slice(0, capacity).map(t => t.id),
    automatic_dispatch: false, reviewer: "orchestrator", semantic_truth_verified: false, data_not_instruction: true }
}
