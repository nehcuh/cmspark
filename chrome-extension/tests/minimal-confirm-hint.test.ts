// L5 (post-merge-198-201 adversary): MinimalConfirm hint must not claim
// 「仅这一次，不加白名单」 for relevant_apps (host_use app trust) confirms —
// Cockpit offers thread-scoped app trust for those.

import test from "node:test"
import assert from "node:assert/strict"
import { minimalConfirmHint } from "../src/sidepanel/components/MinimalConfirm"
import type { SecurityConfirmationRequest } from "../src/sidepanel/types"

function req(extra: Partial<SecurityConfirmationRequest>): SecurityConfirmationRequest {
  return { confirmation_id: "c1", tool_name: "host_read", ...extra } as SecurityConfirmationRequest
}

test("nonce confirm points at 确认台 code entry", () => {
  assert.match(minimalConfirmHint(req({ nonce_challenge: "AB12CD" })), /确认码/)
})

test("domain confirm mentions whitelist preview", () => {
  assert.match(minimalConfirmHint(req({ relevant_domains: ["example.com"] })), /白名单/)
})

test("relevant_apps confirm does NOT claim one-off no-whitelist (L5)", () => {
  const hint = minimalConfirmHint(req({ relevant_apps: ["com.apple.finder"] }))
  assert.ok(!hint.includes("仅这一次"), `got: ${hint}`)
  assert.match(hint, /信任/)
})

test("trust hint only for tools Cockpit actually offers trust on", () => {
  // host_app thread-trust / host_computer session-trust → trust hint.
  for (const tool_name of ["host_read", "host_app", "host_computer"]) {
    const hint = minimalConfirmHint(req({ tool_name, relevant_apps: ["com.apple.finder"] }))
    assert.match(hint, /信任选项/, tool_name)
    assert.ok(!hint.includes("仅这一次"), `${tool_name}: ${hint}`)
  }
  // host_write NEVER offers trust (writes require biometric per call) even
  // though relevant_apps is set → default one-off hint.
  const write = minimalConfirmHint(req({ tool_name: "host_write", relevant_apps: ["com.apple.finder"] }))
  assert.match(write, /仅这一次，不加白名单/)
  assert.ok(!write.includes("信任"), `got: ${write}`)
})

test("plain file-open confirm keeps the one-off copy", () => {
  assert.match(minimalConfirmHint(req({ relevant_domains: [] })), /仅这一次，不加白名单/)
})

test("#371 expert team confirm points at 确认台 for editable slices", () => {
  const hint = minimalConfirmHint(
    req({
      tool_name: "spawn_expert_team",
      expert_team: {
        will_promote_orchestrator: true,
        will_open_board: true,
        cap_note: "≤4",
        members: [
          {
            pack_id: "expert-sre",
            name: "SRE",
            role_label: "SRE",
            effective_tools: ["list_tabs"],
            brief: "watch SLO",
          },
        ],
      },
    }),
  )
  assert.match(hint, /确认台/)
  assert.match(hint, /切片/)
})
