// #513 fleet suggestion card — builders, per-thread store map, wiring locks.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { agentReducer, initialState, type AgentState } from "../src/sidepanel/store/agentStore"
import {
  buildFleetAcceptText,
  buildFleetDismissMessage,
} from "../src/sidepanel/components/LoopStatusRow"

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

function stateWithThreads(): AgentState {
  return {
    ...initialState,
    activeThreadId: "thread-a",
    threads: [
      {
        id: "thread-a",
        alias: "A",
        created_at: "2026-05-26T00:00:00.000Z",
        updated_at: "2026-05-26T00:00:00.000Z",
        config_override: null,
        tool_whitelist: null,
        pinned_tabs: [],
        active_skill_ids: [],
        active_knowledge_ids: [],
        skill_selection_mode: "auto",
        knowledge_selection_mode: "auto",
        mcp_selection_mode: "auto",
        active_mcp_server_ids: [],
      },
      {
        id: "thread-b",
        alias: "B",
        created_at: "2026-05-26T00:00:00.000Z",
        updated_at: "2026-05-26T00:00:00.000Z",
        config_override: null,
        tool_whitelist: null,
        pinned_tabs: [],
        active_skill_ids: [],
        active_knowledge_ids: [],
        skill_selection_mode: "auto",
        knowledge_selection_mode: "auto",
        mcp_selection_mode: "auto",
        active_mcp_server_ids: [],
      },
    ] as unknown as AgentState["threads"],
  }
}

test("buildFleetDismissMessage shape", () => {
  assert.deepEqual(buildFleetDismissMessage("t1"), {
    type: "fleet.suggest.dismiss",
    thread_id: "t1",
    user_gesture: true,
  })
})

test("buildFleetAcceptText carries the spawn instruction and every subtask", () => {
  const text = buildFleetAcceptText(["查 A 站", "查 B 站", "查 C 站"])
  assert.match(text, /同意多路并行/)
  assert.match(text, /spawn_worker/, "explicit spawn instruction — the model must be told")
  assert.match(text, /确认中心批准/, "L2 expectation stated")
  for (const s of ["查 A 站", "查 B 站", "查 C 站"]) assert.ok(text.includes(s))
  assert.match(text, /汇总/, "final synthesis requested")
  // and it is NOT an arm: no task_loop autonomy injected by the card
  assert.ok(!text.includes("task_loop"))
})

test("SET_FLEET_SUGGEST is per-thread: B's frame does not touch A's card", () => {
  let s = stateWithThreads()
  s = agentReducer(s, {
    type: "SET_FLEET_SUGGEST",
    threadId: "thread-a",
    reason: "ra",
    subtasks: ["a1", "a2"],
  })
  s = agentReducer(s, {
    type: "SET_FLEET_SUGGEST",
    threadId: "thread-b",
    reason: "rb",
    subtasks: ["b1", "b2"],
  })
  assert.equal(s.fleetSuggestByThreadId["thread-a"].reason, "ra", "A's card intact")
  assert.equal(s.fleetSuggestByThreadId["thread-b"].reason, "rb")
  // malformed frames (fewer than 2 subtasks) are dropped, not stored half-way
  const before = { ...s.fleetSuggestByThreadId }
  s = agentReducer(s, { type: "SET_FLEET_SUGGEST", threadId: "thread-a", reason: "x", subtasks: ["only"] })
  assert.deepEqual(s.fleetSuggestByThreadId, before)
})

test("CLEAR_FLEET_SUGGEST removes only the target thread's card", () => {
  let s = stateWithThreads()
  s = agentReducer(s, { type: "SET_FLEET_SUGGEST", threadId: "thread-a", reason: "r", subtasks: ["a", "b"] })
  s = agentReducer(s, { type: "SET_FLEET_SUGGEST", threadId: "thread-b", reason: "r", subtasks: ["a", "b"] })
  s = agentReducer(s, { type: "CLEAR_FLEET_SUGGEST", threadId: "thread-a" })
  assert.equal(s.fleetSuggestByThreadId["thread-a"], undefined)
  assert.ok(s.fleetSuggestByThreadId["thread-b"], "B's card survives")
})

test("REMOVE_THREAD prunes that thread's fleet card", () => {
  let s = stateWithThreads()
  s = agentReducer(s, { type: "SET_FLEET_SUGGEST", threadId: "thread-b", reason: "r", subtasks: ["a", "b"] })
  s = agentReducer(s, { type: "REMOVE_THREAD", threadId: "thread-b" })
  assert.equal(s.fleetSuggestByThreadId["thread-b"], undefined)
})

test("wiring: frame handler, SW relay, card render, accept dual-send", () => {
  const ws = read("src/sidepanel/hooks/useWebSocket.ts")
  assert.match(ws, /case "fleet\.suggest":/, "inbound frame handled")
  assert.match(ws, /SET_FLEET_SUGGEST/, "dispatches to the per-thread map")
  assert.match(ws, /case "fleet\.suggest\.dismissed":/, "companion ack syncs local clear")

  const sw = read("src/background/index.ts")
  assert.match(sw, /case "fleet\.suggest\.dismiss":/, "SW relays the dismiss frame (default deny would eat it)")

  const chat = read("src/sidepanel/components/ChatView.tsx")
  assert.match(chat, /<FleetSuggestCard/, "card rendered")
  // independent block after the loop card — coexistence, not if/else mutual exclusion
  const iLoop = chat.indexOf("<LoopSuggestCard")
  const iFleet = chat.indexOf("<FleetSuggestCard")
  assert.ok(iLoop > 0 && iFleet > iLoop, "fleet card renders after the loop card block")
  assert.match(chat, /CLEAR_FLEET_SUGGEST/, "accept/dismiss clears synchronously")

  const row = read("src/sidepanel/components/LoopStatusRow.tsx")
  assert.match(row, /type: "chat\.send",/, "accept rides the existing chat.send pipeline")
  assert.match(row, /buildFleetDismissMessage\(threadId\)/, "both actions silence companion-side")
  // NOT arm: the accept path must not send task_loop.arm
  const cardSrc = row.slice(row.indexOf("export function FleetSuggestCard"), row.indexOf("/**", row.indexOf("export function FleetSuggestCard")))
  assert.ok(!cardSrc.includes("task_loop.arm"), "accept must not inject loop autonomy")
})
