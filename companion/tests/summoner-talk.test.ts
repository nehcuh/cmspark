/**
 * Summoner v2 — empty overlay TALKS (last/new thread). `#` prefix searches titles.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  isSummonerSearchQuery,
  summonerSearchNeedle,
  resolveSubmitThread,
  submitSummonerTalk,
} from "../src/summoner/client"

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

function traySwiftSrc(): string {
  return (
    fs.readFileSync(srcFile("tray", "Tray.swift"), "utf8") +
    "\n" +
    fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  )
}

const THREADS = [
  { id: "old", title: "Old notes", updated_at: "2026-08-01T00:00:00Z" },
  { id: "mid", title: "Browser tab", updated_at: "2026-08-10T00:00:00Z" },
  { id: "new", title: "Latest", updated_at: "2026-08-20T12:00:00Z", created_at: "2026-08-19T00:00:00Z" },
]

test("isSummonerSearchQuery is true iff trimmed text starts with #", () => {
  assert.equal(isSummonerSearchQuery("#"), true)
  assert.equal(isSummonerSearchQuery("#invoice"), true)
  assert.equal(isSummonerSearchQuery("  #foo"), true)
  assert.equal(isSummonerSearchQuery("# foo"), true)
  assert.equal(isSummonerSearchQuery("invoice"), false)
  assert.equal(isSummonerSearchQuery("foo #bar"), false)
  assert.equal(isSummonerSearchQuery(""), false)
  assert.equal(isSummonerSearchQuery("   "), false)
})

test("summonerSearchNeedle is the text after #", () => {
  assert.equal(summonerSearchNeedle("#invoice"), "invoice")
  assert.equal(summonerSearchNeedle("  #foo  "), "foo")
  assert.equal(summonerSearchNeedle("#"), "")
  assert.equal(summonerSearchNeedle("# title"), "title")
  assert.equal(summonerSearchNeedle("not-search"), "")
})

test("resolveSubmitThread uses requestedId when present", () => {
  assert.equal(resolveSubmitThread({ requestedId: "mid", threads: THREADS }), "mid")
  assert.equal(resolveSubmitThread({ requestedId: "  mid  ", threads: THREADS }), "mid")
  // unknown id is still the requested one — create happens only when empty
  assert.equal(resolveSubmitThread({ requestedId: "ghost", threads: THREADS }), "ghost")
})

test("resolveSubmitThread empty requestedId picks newest thread or null", () => {
  assert.equal(resolveSubmitThread({ requestedId: "", threads: THREADS }), "new")
  assert.equal(resolveSubmitThread({ requestedId: "   ", threads: THREADS }), "new")
  assert.equal(resolveSubmitThread({ requestedId: "", threads: [] }), null)
})

test("submitSummonerTalk empty id uses newest thread, claims overlay, sends chat", async () => {
  const calls: string[] = []
  const r = await submitSummonerTalk("", "hello overlay", {
    listThreads: async () => THREADS,
    createThread: async () => {
      calls.push("create")
      return { id: "created" }
    },
    claimLease: async (id) => {
      calls.push(`claim:${id}`)
    },
    sendChatCreate: ({ thread_id, message }) => {
      calls.push(`chat:${thread_id}:${message}`)
      return true
    },
  })
  assert.equal(r.ok, true)
  assert.equal(r.threadId, "new")
  assert.deepEqual(calls, ["claim:new", "chat:new:hello overlay"])
})

test("submitSummonerTalk creates a thread when none exist", async () => {
  const r = await submitSummonerTalk("", "first", {
    listThreads: async () => [],
    createThread: async () => ({ id: "fresh" }),
    claimLease: async () => {},
    sendChatCreate: () => true,
  })
  assert.equal(r.ok, true)
  assert.equal(r.threadId, "fresh")
})

test("submitSummonerTalk hydrates after resolve when hydrate is provided", async () => {
  let hydrated: { thread_id: string; messages: unknown[] } | undefined
  await submitSummonerTalk("mid", "go", {
    listThreads: async () => THREADS,
    createThread: async () => ({ id: "nope" }),
    claimLease: async () => {},
    sendChatCreate: () => true,
    selectMessages: async (id) => {
      assert.equal(id, "mid")
      return [{ role: "user", content: "prior" }]
    },
    hydrate: (payload) => {
      hydrated = payload
    },
  })
  assert.equal(hydrated?.thread_id, "mid")
  assert.deepEqual(hydrated?.messages, [{ role: "user", content: "prior" }])
})

test("submitSummonerTalk busy path steers without claiming lease", async () => {
  const calls: string[] = []
  const r = await submitSummonerTalk(
    "new",
    "dont click that",
    {
      listThreads: async () => THREADS,
      createThread: async () => ({ id: "x" }),
      claimLease: async () => {
        calls.push("claim")
        return true
      },
      sendChatCreate: () => {
        calls.push("create")
        return true
      },
      sendSteer: ({ message }) => {
        calls.push(`steer:${message}`)
        return true
      },
      isRunActive: () => true,
    },
    { enqueue: false },
  )
  assert.equal(r.ok, true)
  assert.deepEqual(calls, ["steer:dont click that"])
})

test("submitSummonerTalk busy enqueue does not chat.create", async () => {
  const calls: string[] = []
  await submitSummonerTalk(
    "new",
    "next turn",
    {
      listThreads: async () => THREADS,
      createThread: async () => ({ id: "x" }),
      claimLease: async () => {
        calls.push("claim")
      },
      sendChatCreate: () => {
        calls.push("create")
        return true
      },
      sendEnqueue: ({ message }) => {
        calls.push(`enq:${message}`)
        return true
      },
      isRunActive: () => true,
    },
    { enqueue: true },
  )
  assert.deepEqual(calls, ["enq:next turn"])
})

test("submitSummonerTalk skips chat.create when claimLease returns false", async () => {
  let sent = false
  const r = await submitSummonerTalk("", "hello", {
    listThreads: async () => THREADS,
    createThread: async () => ({ id: "x" }),
    claimLease: async () => false,
    sendChatCreate: () => {
      sent = true
      return true
    },
  })
  assert.equal(r.ok, false)
  assert.equal(r.threadId, null)
  assert.equal(sent, false)
})

test("submitSummonerTalk refuses blank text and does not create", async () => {
  let created = false
  const r = await submitSummonerTalk("", "   ", {
    listThreads: async () => [],
    createThread: async () => {
      created = true
      return { id: "x" }
    },
    claimLease: async () => {},
    sendChatCreate: () => true,
  })
  assert.equal(r.ok, false)
  assert.equal(r.threadId, null)
  assert.equal(created, false)
})

test("SummonerController v2 empty state talks, not title-search", () => {
  const src = traySwiftSrc()
  // spec §2: placeholder changed to command palette prompt
  assert.match(src, /搜命令、历史、知识，或直接说任务/)
  assert.doesNotMatch(src, /说点什么，或按住说话/)
  // spec §5c: hint changed from title-search HUD to command palette
  assert.match(src, /回车发送 · Shift\+Enter 排队 · .* 收起/)
  assert.match(src, /继续 · /)
  assert.doesNotMatch(src, /输入线程标题/)
  // Send stays visible in talk (including detached)
  const apply = src.slice(src.indexOf("private func applyPhase()"), src.indexOf("private func relayout()"))
  assert.doesNotMatch(apply, /sendButton\?\.isHidden = !chatting \|\| detached/)
  // Search only on # prefix
  assert.match(src, /isSummonerSearchQuery|hasPrefix\("#"\)|startsWith\("#"\)/)
  // submitComposer allows empty threadId
  const submit = src.slice(src.indexOf("private func submitComposer("), src.indexOf("@objc func sendClicked()"))
  assert.doesNotMatch(submit, /!threadId\.isEmpty/)
  assert.match(submit, /summoner\.submit/)
})

test("SummonerController placeholder does not advertise hidden press-to-talk", () => {
  const src = traySwiftSrc()
  const line = src.split("\n").find((l) => l.includes("summonerTalkPlaceholder"))
  assert.ok(line, "summonerTalkPlaceholder missing")
  assert.doesNotMatch(line!, /按住说话/)
  // spec §2: placeholder changed to command palette prompt
  assert.match(line!, /搜命令、历史、知识，或直接说任务/)
})

test("SummonerController applyHydrate does not reopen a closed overlay", () => {
  const src = traySwiftSrc()
  const start = src.indexOf("  func applyHydrate(_ json: [String: Any]) {")
  // SummonerController's applyHydrate is the second (HUD has one first)
  const summoner = src.indexOf("  func applyHydrate(_ json: [String: Any]) {", start + 10)
  assert.ok(summoner > start, "SummonerController applyHydrate missing")
  const body = src.slice(summoner, summoner + 900)
  assert.match(body, /guard isOpen else \{ return \}/)
  assert.doesNotMatch(body, /open\(threadId/)
})

test("hidden mic tooltip does not advertise press-to-talk", () => {
  const src = traySwiftSrc()
  assert.doesNotMatch(src, /mic\.toolTip = ".*按住说话/)
})

test("SummonerController HUD hides send; Return submits", () => {
  const src = traySwiftSrc()
  const apply = src.slice(src.indexOf("private func applyPhase()"), src.indexOf("private func relayout()"))
  assert.match(apply, /sendButton\?\.isHidden = true/)
  assert.match(apply, /footRow\?\.isHidden = true/)
})

test("menu-bar-agent empty submit resolves last/new thread then claims overlay lease", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.search(/export (async )?function handleSummonerSubmit/)
  assert.ok(start >= 0, "handleSummonerSubmit missing")
  const next = src.indexOf("\nexport ", start + 10)
  const body = src.slice(start, next > start ? next : start + 1800)
  assert.match(body, /listThreads/)
  assert.match(body, /createThread/)
  assert.match(body, /composer\.lease|claimLease|claimOverlay/)
  assert.match(body, /sendChatCreate/)
  assert.match(body, /hydrate/)
  assert.match(src, /summonerBrowserAttached/)
  assert.match(src, /pickAuthenticatedClientWs/)
})

test("SummonerController has press-hold mic that emits summoner.mic", () => {
  const src = traySwiftSrc()
  assert.match(src, /🎙/)
  assert.match(src, /summoner\.mic\.start/)
  assert.match(src, /summoner\.mic\.(wav|end)/)
  assert.match(src, /summoner\.dictate/)
  assert.match(src, /applyDictate|composer\?\.string = text/)
})

test("menu-bar-agent maps summoner.mic to voice.stt and dictate on result", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /summoner\.mic/)
  assert.match(src, /sendMicWavToStt/)
  assert.match(src, /resolveSummonerSttModelId/)
  assert.match(src, /privacy_ack_v2/)
  assert.match(src, /mapVoiceSttToSummonerCmd/)
  assert.match(src, /summoner\.dictate/)
})

test("menu-bar-agent new_thread creates a thread and hydrates empty overlay", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /summoner\.new_thread/)
  assert.match(src, /handleSummonerNewThread/)
  assert.match(src, /createThread/)
})

test("menu-bar-agent ready applies resume idle policy", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /shouldStartNewSummonerThread/)
  assert.match(src, /summoner\.settings\.set/)
  assert.match(src, /handleSummonerReady/)
  assert.match(src, /mcp\.list/)
  assert.match(src, /encodeSummonerMcp/)
})

test("CompanionClient.createThread sends thread.create", () => {
  const src = fs.readFileSync(srcFile("tray", "companion-client.ts"), "utf8")
  assert.match(src, /async createThread\(/)
  const start = src.indexOf("async createThread(")
  const method = src.slice(start, start + 500)
  assert.match(method, /thread\.create/)
  assert.match(method, /sendRequest/)
})

test("CompanionClient.sendAppRequest is a public request/response seam for STT start", () => {
  const src = fs.readFileSync(srcFile("tray", "companion-client.ts"), "utf8")
  assert.match(src, /sendAppRequest\(/)
  assert.match(src, /return this\.sendRequest\(/)
})
