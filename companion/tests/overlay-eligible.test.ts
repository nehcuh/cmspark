import test from "node:test"
import assert from "node:assert/strict"
import { isOverlayEligiblePack } from "../src/packs/overlay-eligible"
import type { PackManifest } from "../src/packs/types"

function base(over: Partial<PackManifest> = {}): PackManifest {
  return {
    schema_version: 1,
    id: "meeting-minutes",
    name: "会议记录",
    version: "0.4.0",
    channel: "community",
    min_capability: "L0",
    requires_modules: [],
    skills: [],
    knowledge: [],
    mcp_servers: [],
    tools: { mode: "unchanged", allow: [], deny: [] },
    system_prompt_append: "",
    ...over,
  }
}

test("meeting-minutes is overlay eligible", () => {
  assert.equal(isOverlayEligiblePack(base()), true)
})

test("trust block is not overlay eligible", () => {
  assert.equal(isOverlayEligiblePack(base({ trust: { origin: "user" } as any })), false)
})

test("osascript_eval and spawn_worker are not overlay eligible", () => {
  assert.equal(
    isOverlayEligiblePack(base({ tools: { mode: "allowlist", allow: ["osascript_eval"], deny: [] } })),
    false,
  )
  assert.equal(
    isOverlayEligiblePack(base({ tools: { mode: "allowlist", allow: ["spawn_worker"], deny: [] } })),
    false,
  )
})

test("L1 / navigate / coding-handoff / mcp_servers denied", () => {
  assert.equal(isOverlayEligiblePack(base({ min_capability: "L1" })), false)
  assert.equal(
    isOverlayEligiblePack(base({ tools: { mode: "allowlist", allow: ["navigate"], deny: [] } })),
    false,
  )
  assert.equal(isOverlayEligiblePack(base({ id: "coding-handoff" })), false)
  assert.equal(isOverlayEligiblePack(base({ mcp_servers: ["x"] })), false)
  assert.equal(isOverlayEligiblePack(base({ board_mode: true })), false)
})
