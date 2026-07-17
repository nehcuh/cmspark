// Unit tests for companion/src/host-use/win/adapter.ts
//
// Zero spawns, zero real fs: PsRunner and FsOps are injected fakes. Covers:
//   - validateTargetId accept/reject matrix (wrong-platform, unknown app/kind,
//     empty account, non-string, msg non-hex, file ids decoding to ../x or
//     C:\x — plan §B runtime rules 1-4)
//   - listReadTargets re-validation (forged id injection from a compromised
//     script is rejected)
//   - readOne forged id / stderr surfacing / CLASSNOTREG → WinAppNotAvailable
//   - writeOne prefix checks, allowlist escape → WinPathOutsideAllowlist
//     (including adversary amendment A2 Documents2 / Documents-evil cases),
//     update/delete throws

import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import { WinHostAdapter, isWithinRoot, type FsOps, type FsStatLike } from "../src/host-use/win/adapter.js"
import { WinAppNotAvailable, WinPathOutsideAllowlist } from "../src/host-use/types.js"
import type { PsRunner } from "../src/host-use/win/powershell.js"

const USERPROFILE = process.platform === "win32" ? "C:\\Users\\test" : "/home/test"
const DOCS = path.join(USERPROFILE, "Documents")
const DESKTOP = path.join(USERPROFILE, "Desktop")
const DOWNLOADS = path.join(USERPROFILE, "Downloads")

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url")
}

// --- Fake FsOps over an in-memory file table --------------------------------

interface FakeEntry { dir?: boolean; mtime?: number }

function fakeFs(files: Record<string, FakeEntry>, realpathMap?: Record<string, string>): {
  fsOps: FsOps
  renamed: Array<{ src: string; dest: string }>
} {
  const renamed: Array<{ src: string; dest: string }> = []
  const stat = (p: string): FsStatLike => {
    const e = files[p]
    if (!e) {
      const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException
      err.code = "ENOENT"
      throw err
    }
    return {
      isFile: () => !e.dir,
      isDirectory: () => !!e.dir,
      mtime: new Date(e.mtime ?? 0),
      size: 1,
    }
  }
  const fsOps: FsOps = {
    readdirSync(dir) {
      const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep
      const names = new Set<string>()
      for (const p of Object.keys(files)) {
        if (p.startsWith(prefix)) {
          const rest = p.slice(prefix.length)
          if (!rest.includes(path.sep)) names.add(rest)
        }
      }
      if (names.size === 0 && !files[dir]?.dir) {
        const err = new Error(`ENOENT: ${dir}`) as NodeJS.ErrnoException
        err.code = "ENOENT"
        throw err
      }
      return [...names]
    },
    statSync: stat,
    realpathSync(p) {
      return realpathMap?.[p] ?? p
    },
    renameSync(src, dest) {
      renamed.push({ src, dest })
    },
    existsSync(p) {
      return p in files
    },
  }
  return { fsOps, renamed }
}

const noopRunner: PsRunner = async () => { throw new Error("runner not expected") }

function makeAdapter(opts?: { runner?: PsRunner; fsOps?: FsOps }): WinHostAdapter {
  return new WinHostAdapter({
    runner: opts?.runner ?? noopRunner,
    fsOps: opts?.fsOps ?? fakeFs({}).fsOps,
    userProfile: USERPROFILE,
  })
}

// --- validateTargetId matrix -------------------------------------------------

test("validateTargetId: accepts well-formed outlook msg id", () => {
  const a = makeAdapter()
  const id = a.validateTargetId("win:outlook:user_example_com:msg-1A2B3C4D5E6F")
  assert.equal(id as string, "win:outlook:user_example_com:msg-1A2B3C4D5E6F")
})

test("validateTargetId: accepts well-formed onenote + fs ids", () => {
  const a = makeAdapter()
  assert.equal(
    a.validateTargetId("win:onenote:unfiled:note-abcdef0123456789") as string,
    "win:onenote:unfiled:note-abcdef0123456789",
  )
  const fid = `win:fs:documents:file-${b64("reports\\q3.xlsx")}`
  assert.equal(a.validateTargetId(fid) as string, fid)
})

test("validateTargetId: rejects wrong-platform ids (macos:/linux:)", () => {
  const a = makeAdapter()
  assert.throws(
    () => a.validateTargetId("macos:com.apple.mail:iCloud:msg-1"),
    /wrong-platform TargetId/,
  )
  assert.throws(
    () => a.validateTargetId("linux:evolution:default:msg-1"),
    /wrong-platform TargetId/,
  )
})

test("validateTargetId: rejects unknown app / kind / empty account", () => {
  const a = makeAdapter()
  assert.throws(() => a.validateTargetId("win:word:acct:msg-1A2B3C4D"), /malformed win TargetId/)
  assert.throws(() => a.validateTargetId("win:outlook:acct:contact-1A2B3C4D"), /malformed win TargetId/)
  assert.throws(() => a.validateTargetId("win:outlook::msg-1A2B3C4D"), /malformed win TargetId/)
})

test("validateTargetId: rejects non-string / empty input", () => {
  const a = makeAdapter()
  assert.throws(() => a.validateTargetId("" as string), /empty or non-string/)
  assert.throws(() => a.validateTargetId(null as any), /empty or non-string/)
  assert.throws(() => a.validateTargetId(42 as any), /empty or non-string/)
})

test("validateTargetId: msg id must be hex >= 8 chars", () => {
  const a = makeAdapter()
  assert.throws(() => a.validateTargetId("win:outlook:acct:msg-XYZ12345"), /EntryID hex/)
  assert.throws(() => a.validateTargetId("win:outlook:acct:msg-AB12"), /EntryID hex/)
})

test("validateTargetId: fs root must be documents/desktop/downloads", () => {
  const a = makeAdapter()
  assert.throws(
    () => a.validateTargetId(`win:fs:windows:file-${b64("a.txt")}`),
    /fs root "windows" not in/,
  )
})

test("validateTargetId: file id decoding to ../x or C:\\x is rejected", () => {
  const a = makeAdapter()
  assert.throws(
    () => a.validateTargetId(`win:fs:documents:file-${b64("..\\..\\Windows\\win.ini")}`),
    /\.\./,
  )
  assert.throws(
    () => a.validateTargetId(`win:fs:documents:file-${b64("C:\\Windows\\System32\\x.dll")}`),
    /drive letter/,
  )
  assert.throws(
    () => a.validateTargetId(`win:fs:documents:file-${b64("\\\\server\\share\\x")}`),
    /absolute\/UNC/,
  )
  assert.throws(
    () => a.validateTargetId(`win:fs:documents:file-${b64("/etc/passwd")}`),
    /absolute\/UNC/,
  )
})

// --- listReadTargets ----------------------------------------------------------

test("listReadTargets mail-inbox: parses ids and re-validates each", async () => {
  const runner: PsRunner = async (script, args) => {
    assert.ok(script.endsWith("outlook-list.ps1"))
    assert.deepEqual(args, ["-Limit", "5"])
    return JSON.stringify({ ids: ["win:outlook:store:msg-ABCDEF12", "win:outlook:store:msg-12345678"] })
  }
  const a = makeAdapter({ runner })
  const ids = await a.listReadTargets("mail-inbox", { limit: 5 })
  assert.equal(ids.length, 2)
  assert.equal(ids[0] as string, "win:outlook:store:msg-ABCDEF12")
})

test("listReadTargets mail-inbox: forged id injection is rejected (wrong-platform)", async () => {
  const runner: PsRunner = async () =>
    JSON.stringify({ ids: ["win:outlook:store:msg-ABCDEF12", "macos:com.apple.mail:x:msg-1"] })
  const a = makeAdapter({ runner })
  await assert.rejects(() => a.listReadTargets("mail-inbox"), /wrong-platform TargetId/)
})

test("listReadTargets mail-inbox: forged id injection is rejected (non-hex msg)", async () => {
  const runner: PsRunner = async () => JSON.stringify({ ids: ["win:outlook:store:msg-NOTHEX!!"] })
  const a = makeAdapter({ runner })
  await assert.rejects(() => a.listReadTargets("mail-inbox"), /malformed win TargetId|EntryID hex/)
})

test("listReadTargets mail-inbox: CLASSNOTREG stderr maps to WinAppNotAvailable", async () => {
  const runner: PsRunner = async () => {
    throw Object.assign(new Error("exit 2"), {
      code: 2,
      stderr: "CLASSNOTREG:win.outlook.classic|Classic Outlook is not installed (New Outlook has no COM interface).",
    })
  }
  const a = makeAdapter({ runner })
  await assert.rejects(
    () => a.listReadTargets("mail-inbox"),
    (err: any) => {
      assert.ok(err instanceof WinAppNotAvailable)
      assert.equal(err.appToken, "win.outlook.classic")
      assert.match(err.message, /not available/)
      return true
    },
  )
})

test("listReadTargets file: lists files from allowlisted roots (files only, mtime desc)", async () => {
  const { fsOps } = fakeFs({
    [DOCS]: { dir: true },
    [path.join(DOCS, "a.txt")]: { mtime: 1000 },
    [path.join(DOCS, "b.txt")]: { mtime: 3000 },
    [path.join(DOCS, "subdir")]: { dir: true },
    [DESKTOP]: { dir: true },
    [path.join(DESKTOP, "c.txt")]: { mtime: 2000 },
    // no Downloads dir — must not abort the listing
  })
  const a = makeAdapter({ fsOps })
  const ids = await a.listReadTargets("file")
  assert.deepEqual(
    ids.map((x) => x as string),
    [
      `win:fs:documents:file-${b64("b.txt")}`,
      `win:fs:desktop:file-${b64("c.txt")}`,
      `win:fs:documents:file-${b64("a.txt")}`,
    ],
  )
})

test("listReadTargets note: throws not-implemented (create-only, darwin parity)", async () => {
  const a = makeAdapter()
  await assert.rejects(() => a.listReadTargets("note"), /create-only/)
})

// --- readOne ------------------------------------------------------------------

test("readOne: re-validates forged ids on consume side", async () => {
  const a = makeAdapter()
  await assert.rejects(
    () => a.readOne("macos:com.apple.mail:iCloud:msg-1" as any),
    /wrong-platform TargetId/,
  )
})

test("readOne msg: returns strict 4-tuple from script output", async () => {
  const runner: PsRunner = async (script, args) => {
    assert.ok(script.endsWith("outlook-read.ps1"))
    assert.equal(args[0], "-TargetId")
    return JSON.stringify({
      sender: "Alice",
      subject: "Hi",
      date_received: "2026-07-17T01:00:00.0000000",
      body_preview: "hello",
    })
  }
  const a = makeAdapter({ runner })
  const id = a.validateTargetId("win:outlook:store:msg-ABCDEF123456")
  const out = await a.readOne(id)
  assert.deepEqual(out, {
    sender: "Alice",
    subject: "Hi",
    date_received: "2026-07-17T01:00:00.0000000",
    body_preview: "hello",
  })
})

test("readOne msg: raw stderr surfaces in the error message", async () => {
  const runner: PsRunner = async () => {
    throw Object.assign(new Error("exit 1"), { code: 1, stderr: "outlook-read: no message for EntryID" })
  }
  const a = makeAdapter({ runner })
  const id = a.validateTargetId("win:outlook:store:msg-ABCDEF123456")
  await assert.rejects(() => a.readOne(id), /outlook-read: no message for EntryID/)
})

test("readOne file: metadata only (file_path + mtime), no content", async () => {
  const target = path.join(DOCS, "a.txt")
  const { fsOps } = fakeFs({ [DOCS]: { dir: true }, [target]: { mtime: 1700000000000 } })
  const a = makeAdapter({ fsOps })
  const id = a.validateTargetId(`win:fs:documents:file-${b64("a.txt")}`)
  const out = await a.readOne(id)
  assert.equal(out.file_path, target)
  assert.equal(out.file_mtime, new Date(1700000000000).toISOString())
  assert.equal(out.body_preview, undefined)
})

// --- writeOne -----------------------------------------------------------------

test("writeOne create: requires win:onenote: TargetId", async () => {
  const a = makeAdapter()
  const fsId = a.validateTargetId(`win:fs:documents:file-${b64("a.txt")}`)
  await assert.rejects(
    () => a.writeOne(fsId, { kind: "create", body: "x" }),
    /only supports OneNote/,
  )
})

test("writeOne create: LLM values travel as separate argv elements (no interpolation)", async () => {
  const calls: Array<{ script: string; args: string[] }> = []
  const runner: PsRunner = async (script, args) => {
    calls.push({ script, args })
    return JSON.stringify({ target_id: "win:onenote:unfiled:note-ABC123", undoable: true })
  }
  const a = makeAdapter({ runner })
  const id = a.validateTargetId("win:onenote:default:note-default")
  const evil = "Title\"; evil command; \"\nsecond line"
  const out = await a.writeOne(id, { kind: "create", body: evil })
  assert.equal(out.undoable, true)
  assert.equal(out.target_id as string, "win:onenote:unfiled:note-ABC123")
  assert.equal(calls.length, 1)
  assert.ok(calls[0].script.endsWith("onenote-create.ps1"))
  // Name = first line (≤80 chars); both values are discrete argv elements.
  assert.deepEqual(calls[0].args, ["-Name", 'Title"; evil command; "', "-Body", evil])
})

test("writeOne move: requires win:fs: TargetId", async () => {
  const a = makeAdapter()
  const noteId = a.validateTargetId("win:onenote:unfiled:note-ABC123")
  await assert.rejects(
    () => a.writeOne(noteId, { kind: "move", destination: DESKTOP, source_path: path.join(DOCS, "a.txt") }),
    /only supports fs targets/,
  )
})

test("writeOne move: happy path inside allowlisted roots", async () => {
  const src = path.join(DOCS, "a.txt")
  const { fsOps, renamed } = fakeFs({
    [DOCS]: { dir: true },
    [src]: { mtime: 1 },
    [DESKTOP]: { dir: true },
  })
  const a = makeAdapter({ fsOps })
  const id = a.validateTargetId(`win:fs:documents:file-${b64("a.txt")}`)
  const out = await a.writeOne(id, { kind: "move", destination: DESKTOP, source_path: src })
  assert.equal(out.undoable, true)
  assert.deepEqual(renamed, [{ src, dest: path.join(DESKTOP, "a.txt") }])
})

test("writeOne move: source outside roots → WinPathOutsideAllowlist", async () => {
  const outside = process.platform === "win32" ? "C:\\Windows\\Temp\\a.txt" : "/etc/a.txt"
  const a = makeAdapter()
  const id = a.validateTargetId(`win:fs:documents:file-${b64("a.txt")}`)
  await assert.rejects(
    () => a.writeOne(id, { kind: "move", destination: DESKTOP, source_path: outside }),
    (err: any) => err instanceof WinPathOutsideAllowlist,
  )
})

test("writeOne move: Documents2 / Documents-evil sibling-prefix escape rejected (amendment A2)", async () => {
  const evilRoots = [path.join(USERPROFILE, "Documents2"), path.join(USERPROFILE, "Documents-evil")]
  for (const evilRoot of evilRoots) {
    const src = path.join(evilRoot, "a.txt")
    const { fsOps } = fakeFs({ [evilRoot]: { dir: true }, [src]: { mtime: 1 }, [DESKTOP]: { dir: true } })
    const a = makeAdapter({ fsOps })
    const id = a.validateTargetId(`win:fs:documents:file-${b64("a.txt")}`)
    await assert.rejects(
      () => a.writeOne(id, { kind: "move", destination: DESKTOP, source_path: src }),
      (err: any) => {
        assert.ok(err instanceof WinPathOutsideAllowlist, `expected WinPathOutsideAllowlist for ${src}`)
        return true
      },
    )
    // …and as DESTINATION
    const goodSrc = path.join(DOCS, "a.txt")
    const { fsOps: fsOps2 } = fakeFs({ [DOCS]: { dir: true }, [goodSrc]: { mtime: 1 }, [evilRoot]: { dir: true } })
    const a2 = makeAdapter({ fsOps: fsOps2 })
    await assert.rejects(
      () => a2.writeOne(id, { kind: "move", destination: evilRoot, source_path: goodSrc }),
      (err: any) => err instanceof WinPathOutsideAllowlist,
    )
  }
})

test("writeOne move: realpath(parent) escape rejected (junctioned parent, amendment A2)", async () => {
  const src = path.join(DOCS, "junction", "a.txt")
  const outside = process.platform === "win32" ? "C:\\Windows\\Temp" : "/tmp"
  const { fsOps } = fakeFs(
    { [path.join(DOCS, "junction")]: { dir: true }, [src]: { mtime: 1 }, [DESKTOP]: { dir: true } },
    { [path.join(DOCS, "junction")]: outside },
  )
  const a = makeAdapter({ fsOps })
  const id = a.validateTargetId(`win:fs:documents:file-${b64("a.txt")}`)
  await assert.rejects(
    () => a.writeOne(id, { kind: "move", destination: DESKTOP, source_path: src }),
    (err: any) => err instanceof WinPathOutsideAllowlist,
  )
})

test("writeOne update/delete: throw honest not-implemented errors (darwin parity)", async () => {
  const a = makeAdapter()
  const id = a.validateTargetId("win:onenote:default:note-default")
  await assert.rejects(() => a.writeOne(id, { kind: "update", body: "x" }), /not implemented in Phase 1/)
  await assert.rejects(() => a.writeOne(id, { kind: "delete" }), /requires biometric confirmation/)
})

// --- isWithinRoot boundary (amendment A2 exact form) --------------------------

test("isWithinRoot: exact match or root+sep only — no sibling prefixes", () => {
  assert.equal(isWithinRoot(DOCS, DOCS), true)
  assert.equal(isWithinRoot(path.join(DOCS, "a.txt"), DOCS), true)
  assert.equal(isWithinRoot(path.join(USERPROFILE, "Documents2"), DOCS), false)
  assert.equal(isWithinRoot(path.join(USERPROFILE, "Documents-evil"), DOCS), false)
  assert.equal(isWithinRoot(DOWNLOADS, DOCS), false)
  // Case-insensitive (NTFS).
  assert.equal(isWithinRoot(DOCS.toUpperCase(), DOCS.toLowerCase()), true)
})
