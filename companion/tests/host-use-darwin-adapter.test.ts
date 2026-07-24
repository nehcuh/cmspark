// Unit tests for companion/src/host-use/darwin/adapter.ts
//
// Mocks the cmspark-host Swift binary via the injectable DarwinRunner (M11 —
// no real AppleScript / TCC invocation). Tests validate the adapter contract:
//   - validateTargetId enforces darwin format (Kimi Round 2 + Pi-sub)
//   - listReadTargets re-encodes (M2 base64url) + validates every returned id
//     (defense in depth against forged ids injected into list output)
//   - readOne re-validates + vault-checks on consume side; Notes/Finder throw
//     NotImplementedForApp before spawning (M1, adapter level)
//   - hostRead branches on application (M1, index level — no silent Mail
//     fallback for Notes/Finder)
//   - producer→validator round-trip with nasty names (M2 regression)
//   - stderr surfacing from the binary (M11)
//   - writeOne throws NotImplemented for update/delete; create/move prefix
//     checks (Phase 1 W6)

import test from "node:test"
import assert from "node:assert/strict"
import {
  DarwinHostAdapter,
  encodeRawTargetId,
  decodeTargetIdToRaw,
  type DarwinRunner,
} from "../src/host-use/darwin/adapter.js"
import { hostRead } from "../src/host-use/darwin/index.js"
import { NotImplementedForApp, DarwinPathNotAbsolute } from "../src/host-use/types.js"

// Mock binary path — tests construct adapter directly with a fake bin path.
// We don't actually spawn anything in these tests (writeOne/non-mail kind/
// validateTargetId paths don't reach execFile).
const FAKE_BIN = "/nonexistent/cmspark-host-test"

test("validateTargetId: accepts well-formed mail TargetId", () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  const id = a.validateTargetId("macos:com.apple.mail:iCloud:msg-1")
  assert.equal(id as string, "macos:com.apple.mail:iCloud:msg-1")
})

test("validateTargetId: rejects missing macos: prefix (LLM forgery)", () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  assert.throws(
    () => a.validateTargetId("com.apple.mail:iCloud:msg-1"),
    /malformed darwin TargetId/,
  )
})

test("validateTargetId: rejects unknown app segment", () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  assert.throws(
    () => a.validateTargetId("macos:com.example.mail:iCloud:msg-1"),
    /malformed darwin TargetId/,
  )
})

test("validateTargetId: rejects unknown kind suffix", () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  assert.throws(
    () => a.validateTargetId("macos:com.apple.mail:iCloud:contact-1"),
    /malformed darwin TargetId/,
  )
})

test("validateTargetId: rejects empty account segment (collision risk)", () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  assert.throws(
    () => a.validateTargetId("macos:com.apple.mail::msg-1"),
    /malformed darwin TargetId/,
  )
})

test("validateTargetId: rejects non-string input", () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  assert.throws(() => a.validateTargetId("" as string), /empty or non-string/)
  assert.throws(() => a.validateTargetId(null as any), /empty or non-string/)
})

test("writeOne: create rejects non-Notes TargetId (Phase 1 W6 only supports Notes)", async () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  const mailId = a.validateTargetId("macos:com.apple.mail:iCloud:msg-1")
  await assert.rejects(
    () => a.writeOne(mailId, { kind: "create", body: "x" }),
    /Phase 1 W6 only supports Notes/,
  )
})

test("writeOne: move rejects non-Finder TargetId (Phase 1 W6 only supports Finder)", async () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  const mailId = a.validateTargetId("macos:com.apple.mail:iCloud:msg-1")
  await assert.rejects(
    () => a.writeOne(mailId, { kind: "move", destination: "/tmp", source_path: "/tmp/x" }),
    /Phase 1 W6 only supports Finder/,
  )
})

test("writeOne: update throws NotImplemented (Phase 1 W7+)", async () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  const id = a.validateTargetId("macos:com.apple.Notes:default:note-1")
  await assert.rejects(
    () => a.writeOne(id, { kind: "update", body: "x" }),
    /not implemented in Phase 1 W6/,
  )
})

test("writeOne: delete throws NotImplemented (requires biometric)", async () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  const id = a.validateTargetId("macos:com.apple.Notes:default:note-1")
  await assert.rejects(
    () => a.writeOne(id, { kind: "delete" } as any),
    /requires biometric confirmation/,
  )
})

test("listReadTargets: throws NotImplemented for unsupported kinds", async () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  // Phase 1 W7: mail-inbox / note / file are all valid kinds now.
  // Future kinds (e.g., "calendar-event") would be rejected here.
  // Use a fake kind that's not in the TargetKind union via cast.
  await assert.rejects(
    () => a.listReadTargets("calendar-event" as any),
    /kind "calendar-event" not supported/,
  )
})

test("readOne: rejects unvalidated TargetId (forged id bypass attempt)", async () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  // Cast raw string directly to bypass validateTargetId — simulates a
  // companion bug or LLM-forged id reaching readOne. Consume-side
  // re-validation delegates to the unified validator (M11).
  const forged = "linux:atspi://evil/path" as any
  await assert.rejects(
    () => a.readOne(forged),
    /malformed darwin TargetId/,
  )
})

test("readOne: rejects TargetId for vault app (e.g. com.apple.mail blocked via app segment manipulation)", async () => {
  // This test verifies the defense-in-depth vault check inside readOne.
  // Construct a TargetId that passes regex (it allows Notes for Phase 1 W6
  // forward-compat) but has a vault-app bundle. The vault check inside readOne
  // must catch it before spawning the binary.
  //
  // Note: in practice the regex currently restricts to (mail|Notes|finder)
  // and Mail is NOT on the vault blacklist. This test uses a forged "Notes"
  // id that the regex permits but the vault check would catch if Notes were
  // ever blacklisted. Marking as TODO for Phase 1 W6 when Notes ships.
  // For now, we test that readOne calls isVaultApp and rejects known vault
  // apps. The bypass test below forges com.apple.keychainaccess which the
  // regex's app segment doesn't accept — so the regex catches it first.
  const a = new DarwinHostAdapter(FAKE_BIN)
  // Forgery attempt: regex won't match because keychainaccess isn't in
  // the (mail|Notes|finder) app segment whitelist.
  await assert.rejects(
    () => a.readOne("macos:com.apple.keychainaccess:icloud:msg-1" as any),
    /malformed darwin TargetId/,
  )
})

// --- M11 spawn-level tests (injected DarwinRunner — zero real spawns) --------

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url")

function makeAdapter(runner: DarwinRunner): DarwinHostAdapter {
  return new DarwinHostAdapter({ binPath: FAKE_BIN, runner })
}

test("listReadTargets: stderr from the binary surfaces in the error message", async () => {
  const runner: DarwinRunner = async () => {
    throw Object.assign(new Error("exit 5"), {
      code: 5,
      stderr: "TCC denied or sandbox blocked (oserr=-1743)",
    })
  }
  const a = makeAdapter(runner)
  await assert.rejects(
    () => a.listReadTargets("mail-inbox"),
    /list-mail: TCC denied or sandbox blocked/,
  )
})

test("readOne: stderr from read-message surfaces in the error message", async () => {
  const runner: DarwinRunner = async () => {
    throw Object.assign(new Error("exit 4"), { code: 4, stderr: "AppleScript error: no such message" })
  }
  const a = makeAdapter(runner)
  const id = a.validateTargetId(encodeRawTargetId("macos:com.apple.mail:iCloud:msg-12345"))
  await assert.rejects(() => a.readOne(id), /read-message: AppleScript error: no such message/)
})

test("listReadTargets: forged vault-app id injected into list output is rejected (defense in depth)", async () => {
  const runner: DarwinRunner = async () =>
    JSON.stringify(["macos:com.apple.mail:iCloud:msg-1", "macos:com.apple.keychainaccess:x:msg-1"])
  const a = makeAdapter(runner)
  await assert.rejects(() => a.listReadTargets("mail-inbox"), /encodeRawTargetId/)
})

test("listReadTargets: wrong-platform forged id injected into list output is rejected", async () => {
  const runner: DarwinRunner = async () =>
    JSON.stringify(["win:outlook:store:msg-ABCDEF12", "linux:atspi://evil/path"])
  const a = makeAdapter(runner)
  await assert.rejects(() => a.listReadTargets("mail-inbox"), /encodeRawTargetId/)
})

test("listReadTargets: producer-shaped id with wrong kind marker is rejected at the encode boundary", async () => {
  const runner: DarwinRunner = async () => JSON.stringify(["macos:com.apple.mail:iCloud:contact-1"])
  const a = makeAdapter(runner)
  await assert.rejects(() => a.listReadTargets("mail-inbox"), /missing :<kind>- marker/)
})

test("M2 round-trip: nasty file names survive list→validate→decode losslessly", async () => {
  // Exactly what list-files.applescript emits (URL-encoded file names).
  const raws = [
    "macos:com.apple.finder:Documents:file-John%27s%20report.pdf",
    "macos:com.apple.finder:Documents:file-100%25.txt",
    "macos:com.apple.finder:Documents:file-a%3Ab%2Fc.txt",
    "macos:com.apple.finder:Documents:file-%E4%B8%AD%E6%96%87%E6%8A%A5%E5%91%8A.pdf",
  ]
  const runner: DarwinRunner = async () => JSON.stringify(raws)
  const a = makeAdapter(runner)
  const ids = await a.listReadTargets("file")
  assert.equal(ids.length, raws.length)
  for (let i = 0; i < raws.length; i++) {
    // Every validated id fits the strict base64url charset (the M2 fix).
    assert.match(
      ids[i] as string,
      /^macos:com\.apple\.finder:[A-Za-z0-9_\-]+:file-[A-Za-z0-9_\-]+$/,
      `validated id must match strict charset: ${ids[i]}`,
    )
    // …and decodes back to the EXACT raw string the producer emitted.
    assert.equal(decodeTargetIdToRaw(ids[i] as string), raws[i])
  }
})

test("M2 round-trip: notes id with CoreData stable-id + hostile account name", () => {
  const raw = "macos:com.apple.Notes:John's Work 账户:note-x-coredata://9F3E2A/Note/p42"
  const encoded = encodeRawTargetId(raw)
  assert.match(encoded, /^macos:com\.apple\.Notes:[A-Za-z0-9_\-]+:note-[A-Za-z0-9_\-]+$/)
  const a = new DarwinHostAdapter(FAKE_BIN)
  const validated = a.validateTargetId(encoded)
  assert.equal(decodeTargetIdToRaw(validated as string), raw)
})

test("M2 round-trip: list→validate→readOne hands the ORIGINAL raw id to the binary", async () => {
  const rawMail = "macos:com.apple.mail:John's Gmail 工作:msg-458293"
  const calls: string[][] = []
  const runner: DarwinRunner = async (_bin, args) => {
    calls.push(args)
    if (args[0] === "list-mail") return JSON.stringify([rawMail])
    return JSON.stringify({
      sender: "Alice",
      subject: "Hi",
      date_received: "2026-07-18",
      body_preview: "hello",
    })
  }
  const a = makeAdapter(runner)
  const [id] = await a.listReadTargets("mail-inbox")
  assert.match(id as string, /^macos:com\.apple\.mail:[A-Za-z0-9_\-]+:msg-[A-Za-z0-9_\-]+$/)
  const out = await a.readOne(id)
  assert.equal(out.sender, "Alice")
  const readArgs = calls.find((c) => c[0] === "read-message")
  assert.ok(readArgs, "read-message must be spawned")
  // The Swift binary's parseTargetId expects the raw form (account in clear).
  assert.deepEqual(readArgs, ["read-message", "--target", rawMail])
})

test("listReadTargets: --limit is NOT sent to the binary; limit applied TS-side (M8)", async () => {
  const calls: string[][] = []
  const raws = Array.from({ length: 5 }, (_, i) => `macos:com.apple.mail:iCloud:msg-${i + 1}`)
  const runner: DarwinRunner = async (_bin, args) => {
    calls.push(args)
    return JSON.stringify(raws)
  }
  const a = makeAdapter(runner)
  const ids = await a.listReadTargets("mail-inbox", { limit: 2 })
  assert.deepEqual(calls[0], ["list-mail"]) // no --limit argv (script caps top-100 fixed)
  assert.equal(ids.length, 2)
})

test("readOne: Notes/Finder ids throw NotImplementedForApp BEFORE spawning (M1, adapter level)", async () => {
  let spawned = false
  const runner: DarwinRunner = async () => { spawned = true; return "{}" }
  const a = makeAdapter(runner)
  const noteId = a.validateTargetId(
    encodeRawTargetId("macos:com.apple.Notes:default:note-x-coredata://A/Note/p1"),
  )
  await assert.rejects(
    () => a.readOne(noteId),
    (err: any) => {
      assert.ok(err instanceof NotImplementedForApp)
      assert.equal(err.appToken, "com.apple.Notes")
      return true
    },
  )
  const fileId = a.validateTargetId(
    encodeRawTargetId("macos:com.apple.finder:Documents:file-a.txt"),
  )
  await assert.rejects(
    () => a.readOne(fileId),
    (err: any) => err instanceof NotImplementedForApp && err.appToken === "com.apple.finder",
  )
  assert.equal(spawned, false)
})

test("writeOne create: LLM values travel as separate argv elements (no interpolation)", async () => {
  const calls: string[][] = []
  const runner: DarwinRunner = async (_bin, args) => {
    calls.push(args)
    return JSON.stringify({
      target_id: "macos:com.apple.Notes:default:note-x-coredata://ABC/Note/p7",
      undoable: true,
    })
  }
  const a = makeAdapter(runner)
  const id = a.validateTargetId(encodeRawTargetId("macos:com.apple.Notes:default:note-placeholder"))
  const evil = "Title\"; evil \"\nsecond line"
  const out = await a.writeOne(id, { kind: "create", body: evil })
  assert.equal(out.undoable, true)
  assert.deepEqual(calls[0], ["create-note", "--name", 'Title"; evil "', "--body", evil])
  // M2: the raw target_id returned by the producer is re-encoded + validated.
  assert.equal(
    out.target_id as string,
    `macos:com.apple.Notes:${b64("default")}:note-${b64("x-coredata://ABC/Note/p7")}`,
  )
})

// --- M6 Finder move path validation --------------------------------------------

test("writeOne move: relative source_path / destination rejected with DarwinPathNotAbsolute BEFORE spawning (M6)", async () => {
  let spawned = false
  const runner: DarwinRunner = async () => { spawned = true; return "{}" }
  const a = makeAdapter(runner)
  const id = a.validateTargetId(encodeRawTargetId("macos:com.apple.finder:Documents:file-a.txt"))
  await assert.rejects(
    () => a.writeOne(id, { kind: "move", destination: "/Users/x/Desktop", source_path: "reports/a.txt" }),
    (err: any) => {
      assert.ok(err instanceof DarwinPathNotAbsolute)
      assert.match(err.message, /source_path=reports\/a\.txt/)
      return true
    },
  )
  await assert.rejects(
    () => a.writeOne(id, { kind: "move", destination: "Desktop", source_path: "/Users/x/Documents/a.txt" }),
    (err: any) => {
      assert.ok(err instanceof DarwinPathNotAbsolute)
      assert.match(err.message, /destination=Desktop/)
      return true
    },
  )
  // Empty / missing source is rejected by the same absolute-path check.
  await assert.rejects(
    () => a.writeOne(id, { kind: "move", destination: "/Users/x/Desktop", source_path: "" }),
    (err: any) => err instanceof DarwinPathNotAbsolute,
  )
  assert.equal(spawned, false)
})

test("writeOne move: absolute paths pass through as argv verbatim (M6 happy path)", async () => {
  const calls: string[][] = []
  const runner: DarwinRunner = async (_bin, args) => {
    calls.push(args)
    return JSON.stringify({ target_id: "macos:com.apple.finder:moved:file-ok", undoable: true })
  }
  const a = makeAdapter(runner)
  const id = a.validateTargetId(encodeRawTargetId("macos:com.apple.finder:Documents:file-a.txt"))
  // A path with a single quote is now legitimate: TS passes it through as an
  // argv element; the Swift side escapes it for the double-quoted AppleScript
  // context (M7 — previously rejected outright).
  const out = await a.writeOne(id, {
    kind: "move",
    destination: "/Users/x/Desktop",
    source_path: "/Users/x/Documents/John's report.pdf",
  })
  assert.equal(out.undoable, true)
  assert.deepEqual(calls[0], [
    "move-file",
    "--source", "/Users/x/Documents/John's report.pdf",
    "--destination", "/Users/x/Desktop",
  ])
  // M2: the decorative raw target_id returned by move-file is re-encoded too.
  assert.equal(out.target_id as string, `macos:com.apple.finder:${b64("moved")}:file-${b64("ok")}`)
})

// --- M1 index-level branching (hostRead) --------------------------------------
test("hostRead: com.apple.Notes / com.apple.finder throw NotImplementedForApp (M1 — no silent Mail fallback)", async () => {
  for (const app of ["com.apple.Notes", "com.apple.finder"]) {
    await assert.rejects(
      () => hostRead({ application: app }),
      (err: any) => {
        assert.ok(err instanceof NotImplementedForApp, `expected NotImplementedForApp for ${app}`)
        assert.equal(err.appToken, app)
        assert.match(err.message, /not implemented yet/)
        return true
      },
    )
  }
})

test("hostRead: vault + non-whitelisted apps still rejected before branching", async () => {
  await assert.rejects(() => hostRead({ application: "com.apple.keychainaccess" }), /vault blacklist/)
  await assert.rejects(() => hostRead({ application: "com.apple.Photos" }), /not in read whitelist/)
})

test("hostRead: default/mail path proceeds to the binary (fails honestly when binary missing)", async () => {
  // S-P0-1: CMSPARK_HOST_BIN override now requires explicit opt-in.
  process.env.CMSPARK_HOST_BIN = FAKE_BIN
  process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE = "1"
  try {
    await assert.rejects(
      () => hostRead({ application: "com.apple.mail" }),
      (err: any) => !(err instanceof NotImplementedForApp),
    )
    await assert.rejects(
      () => hostRead({}), // default application = com.apple.mail
      (err: any) => !(err instanceof NotImplementedForApp),
    )
  } finally {
    delete process.env.CMSPARK_HOST_BIN
    delete process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE
  }
})

test("S-P0-1: CMSPARK_HOST_BIN without opt-in flag throws (A1 — deny path)", async () => {
  // A1 (Grok round 2): CMSPARK_HOST_BIN set + CMSPARK_ALLOW_HOST_BIN_OVERRIDE unset
  // must throw — silent ignore is the original footgun. Production binaries rarely
  // set NODE_ENV, so the old NODE_ENV gate was effectively always-off in prod.
  process.env.CMSPARK_HOST_BIN = FAKE_BIN
  delete process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE
  try {
    await assert.rejects(
      () => hostRead({ application: "com.apple.mail" }),
      /CMSPARK_HOST_BIN override ignored/,
    )
  } finally {
    delete process.env.CMSPARK_HOST_BIN
  }
})
