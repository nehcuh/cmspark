/**
 * #244 浮窗会议台 — 三条「禁止假装」+ ACL 恰好两个上涨方法 + 隐私 lockstep.
 */
import "./meeting-test-data-dir"
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "path"

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

test("#244 禁止假装-2: 转写进会议台滚动区，不进草稿框", () => {
  const result = overlayHtml.slice(
    overlayHtml.indexOf('if(t==="voice.stt.result")'),
    overlayHtml.indexOf('if(t==="meeting.diarized")'),
  )
  assert.match(result, /appendMeetingLive\(txt/)
  assert.match(result, /\/api\/meeting\/append/)
  assert.match(result, /else if\(txt && !meetingId\)/)
  assert.match(overlayHtml, /box\.scrollTop=box\.scrollHeight/)
  assert.match(overlayHtml, /function appendMeetingLive/)
  // Composer fill is only the !meetingId branch.
  const composerFill = result.slice(result.indexOf("else if(txt && !meetingId)"))
  assert.match(composerFill, /\$\("text"\)\.value/)
  assert.doesNotMatch(result.slice(0, result.indexOf("else if(txt && !meetingId)")), /\$\("text"\)\.value/)
})

test("#244 禁止假装-3: generate_minutes 失败不许写「已生成」", async () => {
  const req = overlayHtml.slice(
    overlayHtml.indexOf("function requestMeetingMinutes"),
    overlayHtml.indexOf('$("meetingStart").onclick'),
  )
  assert.match(req, /纪要生成失败/)
  const errBranch = req.slice(
    req.indexOf("if(d && (d.type==="),
    req.indexOf("var md="),
  )
  assert.doesNotMatch(errBranch, /已生成/)
  assert.doesNotMatch(errBranch, /已提交/)
  assert.match(req, /if\(!md\)/)
  const emptyMd = req.slice(req.indexOf("if(!md)"), req.indexOf("var box=$(\"meetingMinutes\")"))
  assert.match(emptyMd, /纪要生成失败/)
  assert.doesNotMatch(emptyMd, /已生成/)
  assert.doesNotMatch(emptyMd, /已提交/)

  const sse = overlayHtml.slice(
    overlayHtml.indexOf('if(t==="meeting.minutes_result")'),
    overlayHtml.indexOf('if(t==="mcp.confirm.pending")'),
  )
  assert.doesNotMatch(sse, /纪要已提交/)
  assert.match(sse, /纪要已生成/)

  const failed = await handleMeetingMessage(
    { type: "meeting.generate_minutes", v: 1, text: "有转写但无 LLM。" },
    { origin: "cmspark-tray://local", surface: "summoner" },
    { getLlmConfig: () => null },
  )
  assert.equal(failed.type, "meeting.error")
  assert.equal(failed.code, "llm_not_configured")
  assert.notEqual(failed.type, "meeting.minutes_result")
  assert.equal(JSON.stringify(failed).includes("已生成"), false)
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

test("#244 overlay ACL 上涨恰好 append_transcript + generate_minutes；import_text 仍扩展-only", () => {
  const meeting = [...SUMMONER_WEB_DISPATCH_ALLOW].filter((t) => t.startsWith("meeting.")).sort()
  assert.deepEqual(meeting, [
    "meeting.append_transcript",
    "meeting.auto_diarize",
    "meeting.create",
    "meeting.end",
    "meeting.generate_minutes",
    "meeting.get",
    "meeting.list",
    "meeting.start",
  ])
  assert.equal(assertSummonerAllowed("summoner", "meeting.append_transcript").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.generate_minutes").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.import_text").ok, false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.import_text"), false)
  assert.equal(assertSummonerAllowed("summoner", "ui.open_sidepanel").ok, false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("ui.open_sidepanel"), false)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("meeting.minutes_result"), true)
  // Overlay never Allow/Deny.
  assert.doesNotMatch(overlayHtml, />允许<|>拒绝</)
  assert.doesNotMatch(overlayHtml, /Allow\/Deny/)
})

test("#244 #230 freeze: this ticket does not touch mcp.toggle / skill.activate / RunProgress", () => {
  // Pin: those methods stay as they were; we do not add them as part of #244.
  const acl = fs.readFileSync(srcFile("ws", "summoner-acl.ts"), "utf8")
  assert.doesNotMatch(acl, /run_progress/)
  assert.doesNotMatch(overlayHtml, /F-S-10/)
  assert.doesNotMatch(overlayHtml, /grant-cli/)
})
