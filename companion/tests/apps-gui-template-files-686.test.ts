import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { prepareGuiTemplateFiles, guiTemplateFilePathSupported, assertGuiTemplateProfileConfig,
  GUI_TEMPLATE_EXE_BYTES, GUI_TEMPLATE_EXE_SHA256, type GuiTemplateFileDeps } from "../src/apps/gui-template-files"
import type { AppEntry } from "../src/apps/types"

const input = "C:\\文档\\季度 (1) [修订].txt"
test("local-file parser accepts ordinary Unicode/spaces without expansion", () => {
  for (const value of [input, "C:\\" + "a".repeat(252) + ".txt", "D:\\a.txt", "C:\\组合e\u0301\\零.TXT"]) assert.equal(guiTemplateFilePathSupported(value), true, value)
})
for (const value of ["a.txt", "C:a.txt", "\\\\server\\share\\a.txt", "\\\\?\\C:\\a.txt", "C:/a.txt", "C:\\a.txt:ads", "C:\\..\\a.txt", "C:\\a.\\b.txt", "C:\\a \\b.txt", "C:\\a\\\\b.txt", "C:\\CON.txt", "C:\\Con .txt", "C:\\LPT1\\a.txt", "C:\\COM¹.txt", "C:\\%X%.txt", "C:\\a!b.txt", "C:\\@a.txt", 'C:\\a"b.txt', "C:\\a'b.txt", "C:\\a&b.txt", "C:\\a+b.txt", "C:\\a\nb.txt", "C:\\a\u202eb.txt", "C:\\a.xml", "C:\\" + "a".repeat(253) + ".txt"]) {
  test(`unsupported parser alias ${JSON.stringify(value)}`, () => assert.equal(guiTemplateFilePathSupported(value), false))
}
const config = (value = "", name = "sessionExt") => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><NotepadPlus><GUIConfigs><GUIConfig name="${name}">${value}</GUIConfig></GUIConfigs></NotepadPlus>`)
test("exact profile permits unrelated settings/defaults and UTF8 BOM", () => {
  assertGuiTemplateProfileConfig(config())
  assertGuiTemplateProfileConfig(Buffer.concat([Buffer.from([239,187,191]), config("session")]))
  assertGuiTemplateProfileConfig(Buffer.from('<NotepadPlus><GUIConfigs><GUIConfig name="style"><nested/></GUIConfig></GUIConfigs></NotepadPlus>'))
  assertGuiTemplateProfileConfig(Buffer.from('<NotepadPlus/>'))
})
for (const [label, body] of [
  ["session txt", config("txt")], ["workspace dot uppercase", config(".TXT", "workspaceExt")],
  ["DTD", Buffer.from('<!DOCTYPE NotepadPlus [<!ENTITY a "txt">]><NotepadPlus/>')],
  ["duplicate", Buffer.from('<NotepadPlus><GUIConfigs><GUIConfig name="sessionExt"/><GUIConfig name="sessionExt"/></GUIConfigs></NotepadPlus>')],
  ["wrong parent", Buffer.from('<NotepadPlus><other><GUIConfig name="sessionExt">txt</GUIConfig></other></NotepadPlus>')],
  ["nested relevant", config("<x>txt</x>")], ["mixed first value", config('txt<!--split-->other')],
  ["wrong root", Buffer.from('<Other/>')], ["namespace", Buffer.from('<NotepadPlus xmlns="x"/>')],
  ["bad UTF8", Buffer.from([0xff,0xff])], ["other encoding", Buffer.from('<?xml version="1.0" encoding="UTF-16"?><NotepadPlus/>')],
  ["over budget", Buffer.alloc(65537, 32)], ["malformed", Buffer.from('<NotepadPlus><')],
] as const) test(`uncertain profile denied: ${label}`, () => assert.throws(() => assertGuiTemplateProfileConfig(body)))

/** Owned inert Windows-name->POSIX inode seam; never execute PS or an application. */
function owned() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-template-files-"))
  const exe = "C:\\Portable\\notepad++.exe", file = input
  const map = (value: string) => path.join(root, ...value.slice(3).split("\\").filter(Boolean))
  const marker = "C:\\Portable\\doLocalConf.xml", cfg = "C:\\Portable\\config.xml"
  fs.mkdirSync(map("C:\\Portable"), { recursive: true }); fs.mkdirSync(path.dirname(map(file)), { recursive: true })
  const fd = fs.openSync(map(exe), "wx"); fs.ftruncateSync(fd, GUI_TEMPLATE_EXE_BYTES); fs.closeSync(fd)
  fs.writeFileSync(map(file), "target body must not be read"); fs.writeFileSync(map(marker), ""); fs.writeFileSync(map(cfg), config())
  let targetReads = 0, ps = 0, hashes = 0, checkpoints = 0
  const io = {
    ...fs,
    lstatSync: (value: fs.PathLike, options?: any) => fs.lstatSync(map(String(value)), options),
    realpathSync: (value: fs.PathLike) => { fs.realpathSync(map(String(value))); return String(value) },
    openSync: (value: fs.PathLike, flags: fs.OpenMode) => { if (String(value) === file) targetReads++; return fs.openSync(map(String(value)), flags) },
  } as unknown as NonNullable<GuiTemplateFileDeps["fs"]>
  const deps: GuiTemplateFileDeps = {
    platform: "win32", fs: io,
    runner: async (_script, args) => { ps++; assert.deepEqual(args, ["-ExePath", exe, "-FilePath", file]); return JSON.stringify({ ok: true, programFiles: ["C:\\Program Files", "C:\\Program Files (x86)"] }) },
    hashExe: async value => { hashes++; assert.equal(value, exe); return GUI_TEMPLATE_EXE_SHA256 },
  }
  const entry = { token: "win.app.notepad", kind: "gui", exe: { path: exe, sha256: GUI_TEMPLATE_EXE_SHA256 } } as AppEntry
  return { deps, entry, file, exe, marker, cfg, map, io, checkpoint: () => { checkpoints++ },
    counts: () => ({ ps, hashes, targetReads, checkpoints }), close: () => fs.rmSync(root, { recursive: true, force: true }) }
}
test("preflight freezes canonical identities and never reads the target body", async () => {
  const a = owned()
  try {
    const s = await prepareGuiTemplateFiles(a.entry, a.file, a.checkpoint, a.deps)
    assert.equal(s.canonicalFile, a.file); assert.equal(s.canonicalExe, a.exe); assert.equal(Object.isFrozen(s), true)
    assert.match(s.bindingIdentity, /^[0-9a-f]{64}$/); s.recheck()
    assert.equal(a.counts().ps, 2); assert.equal(a.counts().hashes, 1); assert.equal(a.counts().targetReads, 0)
  } finally { a.close() }
})
for (const mode of ["file replacement", "config replacement", "config bytes", "cloud creation", "marker removal", "exe replacement"]) test(`final synchronous fence: ${mode}`, async () => {
  const a = owned()
  try {
    const s = await prepareGuiTemplateFiles(a.entry, a.file, a.checkpoint, a.deps)
    if (mode === "file replacement") { fs.unlinkSync(a.map(a.file)); fs.writeFileSync(a.map(a.file), "replacement") }
    if (mode === "config replacement") { fs.renameSync(a.map(a.cfg), a.map(a.cfg) + ".old"); fs.writeFileSync(a.map(a.cfg), config()) }
    if (mode === "config bytes") fs.writeFileSync(a.map(a.cfg), config("txt"))
    if (mode === "cloud creation") fs.mkdirSync(a.map("C:\\Portable\\cloud"))
    if (mode === "marker removal") fs.unlinkSync(a.map(a.marker))
    if (mode === "exe replacement") { fs.unlinkSync(a.map(a.exe)); fs.writeFileSync(a.map(a.exe), "wrong") }
    assert.throws(s.recheck); assert.equal(a.counts().targetReads, 0)
  } finally { a.close() }
})
for (const mode of ["cloud choice", "missing config", "bad config", "oversize target", "wrong exe hash", "wrong exe size", "mapped network", "reparse chain", "Program Files", "ambiguous PS reply"]) test(`metadata negative: ${mode}`, async () => {
  const a = owned()
  try {
    if (mode === "cloud choice") { fs.mkdirSync(a.map("C:\\Portable\\cloud")); fs.writeFileSync(a.map("C:\\Portable\\cloud\\choice"), "not read") }
    if (mode === "missing config") fs.unlinkSync(a.map(a.cfg))
    if (mode === "bad config") fs.writeFileSync(a.map(a.cfg), config(".txt"))
    if (mode === "oversize target") fs.truncateSync(a.map(a.file), 1048577)
    if (mode === "wrong exe hash") a.deps.hashExe = async () => "0".repeat(64)
    if (mode === "wrong exe size") fs.truncateSync(a.map(a.exe), 1)
    if (mode === "mapped network" || mode === "reparse chain") a.deps.runner = async () => { throw new Error("fixed locality denial") }
    if (mode === "Program Files") a.deps.runner = async () => JSON.stringify({ ok: true, programFiles: ["C:\\Portable"] })
    if (mode === "ambiguous PS reply") a.deps.runner = async () => JSON.stringify({ ok: true, programFiles: [] })
    await assert.rejects(prepareGuiTemplateFiles(a.entry, a.file, a.checkpoint, a.deps))
    assert.equal(a.counts().targetReads, 0)
    if (mode === "mapped network" || mode === "reparse chain") assert.equal(a.counts().hashes, 0)
  } finally { a.close() }
})
test("request checkpoint is called on rejected await and prevents late hash admission", async () => {
  const a = owned()
  try {
    let stale = false
    a.deps.hashExe = async () => { stale = true; return GUI_TEMPLATE_EXE_SHA256 }
    await assert.rejects(prepareGuiTemplateFiles(a.entry, a.file, () => { if (stale) throw new Error("stale") }, a.deps), /stale/)
    let returned = false
    a.deps.runner = async () => { returned = true; throw new Error("probe error") }
    await assert.rejects(prepareGuiTemplateFiles(a.entry, a.file, () => { if (returned) throw new Error("stale failure") }, a.deps), /stale failure/)
  } finally { a.close() }
})

test("ordinary add-flow registered shape without optional owner hash still verifies pinned actual bytes", async () => {
 const a = owned()
 try { delete a.entry.exe!.sha256; const snapshot = await prepareGuiTemplateFiles(a.entry, a.file, a.checkpoint, a.deps); snapshot.recheck(); assert.equal(a.counts().hashes,1) } finally { a.close() }
})

test("file identity keeps distinct 64-bit Windows inode values beyond Number precision", async () => {
 const a = owned()
 try {
  let changed = false
  const original = a.io.lstatSync.bind(a.io)
  a.deps.fs = { ...a.io, lstatSync: ((value: fs.PathLike, options?: { bigint?: boolean }) => {
   const stat = original(value, options as any)
   if (String(value) !== a.file) return stat
   const ino = 9007199254740992n + (changed ? 1n : 0n)
   return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { ino: options?.bigint ? ino : Number(ino) })
  }) as typeof fs.lstatSync }
  const snapshot = await prepareGuiTemplateFiles(a.entry, a.file, a.checkpoint, a.deps)
  changed = true
  assert.throws(snapshot.recheck)
 } finally { a.close() }
})
