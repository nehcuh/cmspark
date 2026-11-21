import assert from "node:assert/strict"
import { handleMeetingMessage, type MeetingHandlerContext, type MeetingHandlerDeps } from "../src/meeting/meeting-handlers"

export async function prepareFixtureMinutes(message: Record<string, unknown>, context: MeetingHandlerContext, deps: MeetingHandlerDeps) {
  const prepared = await handleMeetingMessage({ ...message, type: "meeting.prepare_minutes" }, context, deps)
  assert.equal(prepared.type, "meeting.minutes_prepared", JSON.stringify(prepared))
  return { ...message, type: "meeting.generate_minutes", consent_token: prepared.consent_token }
}

export async function generateFixtureMinutes(message: Record<string, unknown>, context: MeetingHandlerContext, deps: MeetingHandlerDeps) {
  return handleMeetingMessage(await prepareFixtureMinutes(message, context, deps), context, deps)
}
