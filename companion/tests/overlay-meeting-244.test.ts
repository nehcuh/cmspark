/**
 * #244 浮窗会议台 — 三条「禁止假装」+ ACL 恰好两个上涨方法 + 隐私 lockstep.
 */
import "./meeting-test-data-dir"
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "path"

import { SUMMONER_MEETING_WORKFLOW_JS } from "../src/summoner/meeting-workflow"
import { assertSummonerAllowed } from "../src/ws/summoner-acl"
import { SUMMONER_WEB_DISPATCH_ALLOW, SUMMONER_WEB_EVENT_ALLOW } from "../src/summoner-web"
import { MEETING_PRIVACY_ACK_V1_CLAUSES } from "../src/summoner/client"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"

const ROOT = path.resolve(__dirname, "..", "..")

function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

function extFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "..", "chrome-extension", ...parts),
    path.join(ROOT, "chrome-extension", ...parts),
    path.join(__dirname, "..", "..", "..", "chrome-extension", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

const overlayHtml = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")

test("#244 禁止假装-1: 隐私「我已了解」后出现会议台，不是只改按钮文案", () => {
  assert.match(overlayHtml, /id="meetingDesk"/)
  assert.match(overlayHtml, /id="meetingPrivacyAck"/)
  const ack = overlayHtml.slice(
    overlayHtml.indexOf('$("meetingPrivacyAck").onclick'),
    overlayHtml.indexOf('$("meetingRec").onclick'),
  )
  assert.match(ack, /showMeetingDesk\(true\)/)
  assert.match(ack, /startMeetingCapture\(\)/)
  assert.doesNotMatch(ack, /textContent\s*=\s*["']结束会议["']/)
  assert.doesNotMatch(ack, /textContent\s*=\s*["']会议中["']/)
  // Desk covers Capture row (z-index), not a sibling strip under the composer.
  const deskCss = overlayHtml.slice(
    overlayHtml.indexOf(".meeting-desk{"),
    overlayHtml.indexOf(".meeting-desk[hidden]"),
  )
  assert.match(deskCss, /position:absolute/)
  assert.match(deskCss, /inset:0/)
  assert.match(deskCss, /z-index:7/)
  assert.match(overlayHtml, /\.capture-row\{[^}]*z-index:1/)
  assert.match(overlayHtml, />返回对话</)
  assert.match(overlayHtml, />生成会议纪要</)
  assert.match(overlayHtml, />开始录制</)
  assert.match(overlayHtml, /结束录制/)
})

test("#244 禁止假装-2: native final transcript has its own visible commit and persistence", () => {
  const commit = SUMMONER_MEETING_WORKFLOW_JS.slice(SUMMONER_MEETING_WORKFLOW_JS.indexOf("function commitMeetingSegment"), SUMMONER_MEETING_WORKFLOW_JS.indexOf("function meetingSttEvent"))
  assert.match(commit, /appendMeetingLive\(text/)
  assert.match(commit, /\/api\/meeting\/append/)
  assert.doesNotMatch(commit, /\$\("text"\)\.value/)
  assert.match(overlayHtml, /box\.scrollTop=box\.scrollHeight/)
})

test("#244 禁止假装-3: failed minutes do not claim generated", async () => {
  const failed = await handleMeetingMessage(
    { type: "meeting.generate_minutes", v: 1, text: "有转写但无 LLM。" },
    { origin: "cmspark-tray://local", surface: "summoner" },
    { getLlmConfig: () => null },
  )
  assert.equal(failed.type, "meeting.error")
  assert.equal(failed.code, "llm_not_configured")
  assert.equal(JSON.stringify(failed).includes("已生成"), false)
  assert.match(SUMMONER_MEETING_WORKFLOW_JS, /if\(!md\)throw new Error\("纪要生成失败/)
  assert.match(SUMMONER_MEETING_WORKFLOW_JS, /catch\(e\)\{meetingProblem\(e\);\$\("meetingHint"\)\.textContent="纪要生成失败"/)
})

test("#244 MeetingPanel 五条隐私原文不动（overlay lockstep）", () => {
  assert.equal(MEETING_PRIVACY_ACK_V1_CLAUSES.length, 5)
  const panel = fs.readFileSync(
    extFile("src", "sidepanel", "components", "MeetingPanel.tsx"),
    "utf8",
  )
  const start = panel.indexOf("<li>会创建本地会话产物")
  assert.ok(start >= 0, "MeetingPanel privacy <li> list missing")
  const block = panel.slice(start, panel.indexOf("</ul>", start))
  assert.match(overlayHtml, /MEETING_PRIVACY_ACK_V1_CLAUSES\.map/)
  for (const clause of MEETING_PRIVACY_ACK_V1_CLAUSES) {
    assert.ok(block.includes(clause), `MeetingPanel missing clause: ${clause}`)
  }
})

test("#244 overlay ACL #492 仅增两个参考动词；auto_diarize 被拒（#244 NEVER）", async () => {
  const meeting = [...SUMMONER_WEB_DISPATCH_ALLOW].filter((t) => t.startsWith("meeting.")).sort()
  assert.deepEqual(meeting, [
    "meeting.append_transcript",
    "meeting.create",
    "meeting.end",
    "meeting.generate_minutes",
    "meeting.get",
    "meeting.import_reference",
    "meeting.list",
    "meeting.set_reference",
    "meeting.start",
  ])
  assert.equal(assertSummonerAllowed("summoner", "meeting.append_transcript").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.generate_minutes").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.auto_diarize").ok, false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.auto_diarize"), false)
  assert.equal(assertSummonerAllowed("summoner", "meeting.import_text").ok, false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.import_text"), false)
  assert.equal(assertSummonerAllowed("summoner", "ui.open_sidepanel").ok, false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("ui.open_sidepanel"), false)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("meeting.minutes_result"), true)
  assert.doesNotMatch(overlayHtml, />允许<|>拒绝</)
  assert.doesNotMatch(overlayHtml, /Allow\/Deny/)
  assert.doesNotMatch(overlayHtml, /id="meetingDiarize"/)
  assert.doesNotMatch(overlayHtml, /\/api\/meeting\/diarize/)
  assert.match(overlayHtml, /说话人标注请在侧栏会议面板使用/)
  const denied = await handleMeetingMessage(
    { type: "meeting.auto_diarize", v: 1, privacy_ack_v1: true, id: "mtg_nope", mode: "text_gap" },
    { origin: "cmspark-tray://local", surface: "summoner" },
  )
  assert.equal(denied.code, "origin_denied")
})

test("#244 #230 freeze: overlay HTML dispatch meeting set is a snapshot (not a trivially-green regex)", () => {
  const meeting = [...SUMMONER_WEB_DISPATCH_ALLOW].filter((t) => t.startsWith("meeting.")).sort()
  assert.deepEqual(meeting, [
    "meeting.append_transcript",
    "meeting.create",
    "meeting.end",
    "meeting.generate_minutes",
    "meeting.get",
    "meeting.import_reference",
    "meeting.list",
    "meeting.set_reference",
    "meeting.start",
  ])
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("mcp.toggle_server"), false)
})
