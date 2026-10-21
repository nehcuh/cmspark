import test from "node:test"
import assert from "node:assert/strict"
import { validateWsMessage } from "../src/ws/validate"
import { handlePersonalWorkspaceMessage } from "../src/message-router/handlers/personal-workspace"

test("personal data families refuse missing, overlay, spoofed and disconnected authority before service access", async () => {
  const sessions = [undefined, { surface: "summoner", origin: "cmspark-tray://local", panelId: "overlay", isCurrentSession: () => true },
    { surface: "panel", origin: "https://example.invalid", panelId: "forged", isCurrentSession: () => true },
    { surface: "panel", origin: "chrome-extension://owned", panelId: "closed", isCurrentSession: () => false },
    { surface: "panel", origin: "chrome-extension://owned", isCurrentSession: () => true }]
  for (const session of sessions) for (const type of ["activity.state", "activity.configure", "todo.confirm", "settings.assistant.propose", "settings.assistant.apply"]) {
    const result = await handlePersonalWorkspaceMessage({ type, id: "owned-correlation", userConfirmed: true }, session)
    assert.equal(result.ok, false)
    assert.equal(result.error_code, "WORKSPACE_METHOD_DENIED")
    assert.equal(result.id, "owned-correlation")
    assert.equal("state" in result, false)
    assert.equal("proposal" in result, false)
  }
})

test("WS validators recognize exact personal requests and reject authority flags, unknown config and unconfirmed apply", () => {
  assert.equal(validateWsMessage({ type: "activity.state", id: "read" }).valid, true)
  assert.equal(validateWsMessage({ type: "settings.assistant.propose", id: "semantic-1", text: "语音错字很多，希望先看看解决方案" }).valid, true)
  for (const request of [
    { type: "activity.state", surface: "panel" },
    { type: "activity.configure", expected_revision: 0, patch: { enabled: "true" } },
    { type: "activity.configure", expected_revision: 0, patch: { api_key: "untrusted" } },
    { type: "todo.update", expected_revision: 0, todo_id: "../../config.json", patch: { title: "forged" } },
    { type: "settings.assistant.propose", id: "semantic-1", text: "", current: true },
    { type: "settings.assistant.apply", id: "semantic-1", proposalId: "00000000-0000-4000-8000-000000000000", candidateId: "candidate-1", changeIds: ["change-1"], userConfirmed: false },
  ]) assert.equal(validateWsMessage(request).valid, false, request.type)
})
