import test from "node:test"
import assert from "node:assert/strict"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { resolveTaskRelationship } from "../src/sidepanel/utils/task-relationship"
import { TaskRelationshipNav } from "../src/sidepanel/components/TaskRelationshipNav"
import { agentReducer, initialState, type AgentState } from "../src/sidepanel/store/agentStore"
import type { Thread, FleetWorkerView } from "../src/sidepanel/types"

const parent: Thread = { id: "parent", alias: "Office 文档兼容性", created_at: "2026-10-13", updated_at: "2026-10-13", config_override: initialState.config, tool_whitelist: null, pinned_tabs: [], active_skill_ids: [] }
const worker: FleetWorkerView = { id: "child", alias: "入口诊断", agent_role: "worker", worker_role_label: "格式入口", parent_thread_id: parent.id, orchestrator_run_id: "run", paused: false, status: "idle", tab_locks: [] }

test("Fleet-first child selection resolves the exact worker and real parent without list hydration", () => {
  let state = { ...initialState, threads: [parent] }
  state = agentReducer(state, { type: "SET_FLEET", fleet: { workers: [worker], locks: [], worker_count: 1, lock_count: 0, open_intent_count: 0, worst_status: "idle", orchestrator_runs: [] } })
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: worker.id })
  assert.deepEqual(resolveTaskRelationship(state.activeThreadId, state.threads, state.fleet!.workers), { kind: "child", title: "格式入口", parentTitle: parent.alias, parentId: parent.id, availability: "available" })
})

test("full Thread wins over conflicting Fleet and neither titles nor same-run rows imply ownership", () => {
  const normal = { ...parent, id: worker.id, alias: "普通对话", agent_role: "normal" as const }
  assert.deepEqual(resolveTaskRelationship(worker.id, [parent, normal], [worker]), { kind: "normal", title: normal.alias })
  assert.deepEqual(resolveTaskRelationship("another-child", [parent], [worker]), { kind: "normal", title: "新对话" })
  assert.deepEqual(resolveTaskRelationship(worker.id, [parent], [{ ...worker, parent_thread_id: null }]), { kind: "child", title: "格式入口", availability: "missing" })
  assert.deepEqual(resolveTaskRelationship(worker.id, [], [worker, { ...worker, id: parent.id, alias: parent.alias, agent_role: "orchestrator", parent_thread_id: null }]), { kind: "child", title: "格式入口", availability: "missing" })
})

test("parent title refresh, missing/trash and invalid explicit relationships remain honest", () => {
  const updated = resolveTaskRelationship(worker.id, [{ ...parent, alias: "更新后的主任务" }], [worker])
  assert.equal(updated.kind === "child" && updated.parentTitle, "更新后的主任务")
  for (const [rows, child, availability] of [
    [[], worker, "missing"],
    [[{ ...parent, trashed_at: "2026-10-13" }], worker, "trashed"],
    [[parent], { ...worker, parent_thread_id: worker.id }, "invalid"],
    [[{ ...parent, parent_thread_id: worker.id }], worker, "invalid"],
  ] as const) {
    const relation = resolveTaskRelationship(worker.id, rows, [child])
    assert.equal(relation.kind, "child")
    if (relation.kind !== "child") throw new Error("child identity lost")
    assert.equal(relation.availability, availability)
    assert.equal(relation.parentId, undefined)
    const html = renderToStaticMarkup(createElement(TaskRelationshipNav, { relationship: relation, onNavigate: () => { throw new Error("unavailable navigation") } }))
    assert.match(html, />子任务 · 格式入口<\/span>/)
    assert.match(html, /disabled=""/)
  }
})

test("restored multi-level data returns the direct parent and detects longer cycles", () => {
  const middle = { ...parent, id: "middle", alias: "上级子任务", agent_role: "worker" as const, parent_thread_id: parent.id }
  const child = { ...worker, parent_thread_id: middle.id }
  const relation = resolveTaskRelationship(child.id, [parent, middle], [child])
  assert.equal(relation.kind === "child" && relation.parentId, middle.id)
  const cyclic = resolveTaskRelationship(child.id, [{ ...parent, parent_thread_id: child.id }, middle], [child])
  assert.equal(cyclic.kind === "child" && cyclic.availability, "invalid")
})

test("actual presentation exposes visible parent/child and accessible direct-parent action", () => {
  const relation = resolveTaskRelationship(worker.id, [parent], [worker])
  const html = renderToStaticMarkup(createElement(TaskRelationshipNav, { relationship: relation, onNavigate: () => {} }))
  assert.match(html, />主任务 · Office 文档兼容性<\/span>/)
  assert.match(html, />子任务 · 格式入口<\/span>/)
  assert.match(html, /aria-label="返回主任务 Office 文档兼容性"/)
  // Click/Enter/Space and disabled refusal use real DOM role/name queries in
  // companion/scripts/test-task-navigation-ui.py, not JSX child positions.
})

test("return selection preserves both message caches, work state and composer requests", () => {
  const childThread: Thread = { ...parent, ...worker, agent_role: "worker" }
  const mainMessage = { id: "m1", thread_id: parent.id, role: "user" as const, content: "整体任务", created_at: "2026-10-13" }
  const childMessage = { ...mainMessage, id: "m2", thread_id: worker.id, content: "子任务进展" }
  let state: AgentState = { ...initialState, threads: [parent, childThread], activeThreadId: parent.id, messages: [mainMessage], threadBusyById: { [parent.id]: true, [worker.id]: true }, composerRestore: { text: "待发送草稿", token: 1 } }
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: worker.id })
  state = agentReducer(state, { type: "SET_MESSAGES", messages: [childMessage] })
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: parent.id })
  assert.deepEqual(state.messages, [mainMessage])
  assert.deepEqual(state.messagesByThreadId[worker.id], [childMessage])
  assert.deepEqual(state.threadBusyById, { [parent.id]: true, [worker.id]: true })
  assert.equal(state.composerRestore?.text, "待发送草稿")
  assert.equal(state.composerUploadClearSeq, initialState.composerUploadClearSeq)
})
