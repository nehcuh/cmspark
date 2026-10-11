import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { McpClient } from "../src/mcp/client"
import * as short from "../src/mcp/filesystem-short-path"

const cfg = { transport: "stdio" as const, command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"], enabled: true, trust_level: "trusted" as const }
const alias = "C:\\Users\\RUNNER~1", long = "C:\\Users\\runneradmin"
function ownedFs(): short.ShortPathFs {
  return { lstat: async () => ({ isSymbolicLink: () => false }), realpath: async p => {
    if (p === alias) return long
    if (p.endsWith("FILE~1.TXT")) return path.win32.join(path.win32.dirname(p), "file long.txt")
    throw Object.assign(new Error("missing owned alias"), { code: "ENOENT" })
  } }
}

test("existing ancestor and filename aliases expand, while new leaf names are retained", async () => {
  assert.equal(await short.expandWindowsShortPath(`${alias}\\work #百分%\\FILE~1.TXT`, undefined, ownedFs()), `${long}\\work #百分%\\file long.txt`)
  assert.equal(await short.expandWindowsShortPath(`${alias}\\work\\new\\draft~1.txt`, undefined, ownedFs()), `${long}\\work\\new\\draft~1.txt`)
})

for (const input of ["relative\\RUNNER~1\\file", "C:RUNNER~1\\file", "file:///C:/Users/RUNNER~1/file", "\\\\?\\C:\\RUNNER~1\\file", "\\\\.\\C:\\RUNNER~1\\file", `${alias}\\FILE~1.TXT:stream`, "C:\\work\\normal.txt"]) {
  test(`unsupported/non-alias path keeps original semantics: ${input}`, async () => {
    const deps = { lstat: async () => { throw new Error("must not probe") }, realpath: async () => { throw new Error("must not probe") } }
    assert.equal(await short.expandWindowsShortPath(input, undefined, deps), input)
  })
}

test("UNC alias spelling expands without changing the host/share", async () => {
  const input = "\\\\nas\\team\\PROJEC~1\\file.txt"
  const deps = { lstat: async () => ({ isSymbolicLink: () => false }), realpath: async () => "\\\\nas\\team\\project space" }
  assert.equal(await short.expandWindowsShortPath(input, undefined, deps), "\\\\nas\\team\\project space\\file.txt")
})

for (const mode of ["symlink", "changed-parent", "late-link", "permission"] as const) test(`alias conversion preserves lexical denial: ${mode}`, async () => {
  let reads = 0
  const deps = { lstat: async () => ({ isSymbolicLink: () => mode === "symlink" || (mode === "late-link" && ++reads === 2) }),
    realpath: async () => {
      if (mode === "permission") throw Object.assign(new Error("denied"), { code: "EACCES" })
      return mode === "changed-parent" ? "C:\\approved\\runneradmin" : long
    } }
  assert.equal(await short.expandWindowsShortPath(`${alias}\\file.txt`, undefined, deps), `${alias}\\file.txt`)
})

test("only official path fields change; caller args, content, patterns and edits stay intact", async () => {
  const payload = `${alias}\\FILE~1.TXT`
  const args = Object.freeze({ path: payload, content: payload, pattern: payload, edits: [{ oldText: payload, newText: payload }], extra: payload })
  const mapped = await short.normalizeFilesystemToolArgs("write_file", args, undefined, ownedFs())
  assert.equal(mapped.path, `${long}\\file long.txt`)
  for (const key of ["content", "pattern", "edits", "extra"]) assert.equal(mapped[key], (args as any)[key])
  assert.equal(args.path, payload)
  const paths = Object.freeze([payload, `${alias}\\new.txt`, 4])
  const multiple = await short.normalizeFilesystemToolArgs("read_multiple_files", { paths }, undefined, ownedFs())
  assert.deepEqual(multiple.paths, [`${long}\\file long.txt`, `${long}\\new.txt`, 4])
  assert.equal(paths[0], payload)
  const moved = await short.normalizeFilesystemToolArgs("move_file", { source: payload, destination: `${alias}\\new.txt` }, undefined, ownedFs())
  assert.deepEqual(moved, { source: `${long}\\file long.txt`, destination: `${long}\\new.txt` })
  assert.equal(await short.normalizeFilesystemToolArgs("remote_tool", args, undefined, ownedFs()), args)
})

test("launch identity excludes HTTP, SSH and custom filesystem display names", () => {
  assert.equal(short.isLocalOfficialFilesystem(cfg), true)
  assert.equal(short.isLocalOfficialFilesystem({ ...cfg, command: "node.exe", args: ["C:\\node_modules\\@modelcontextprotocol\\server-filesystem\\dist\\index.js"] }), true)
  for (const c of [
    { transport: "http" as const, url: "http://example.test/mcp", enabled: true, trust_level: "trusted" as const },
    { ...cfg, command: "ssh" }, { ...cfg, command: "node", args: ["custom-server-filesystem.js"] },
    { ...cfg, command: "node", args: ["custom.js", "C:\\node_modules\\@modelcontextprotocol\\server-filesystem\\dist\\index.js"] },
    { ...cfg, args: ["--package", "@modelcontextprotocol/server-filesystem", "--call", "custom"] },
  ]) assert.equal(short.isLocalOfficialFilesystem(c), false)
})

function fakeConnected(t: test.TestContext, config: any = cfg) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!
  Object.defineProperty(process, "platform", { value: "win32" })
  t.after(() => Object.defineProperty(process, "platform", platform))
  const client = new McpClient("owned", config)
  const wire: any[] = []
  const sdk = { callTool: async (value: any) => { wire.push(value); return { content: [{ type: "text", text: "owned result" }], isError: false } }, close: async () => {} }
  Object.assign(client as any, { client: sdk, _capabilities: { tools: true }, _connection: { status: "connected" } })
  return { client, wire }
}

test("public McpClient applies compatibility before SDK dispatch without changing original args", async t => {
  const { client, wire } = fakeConnected(t)
  t.mock.method(short, "normalizeFilesystemToolArgs", (tool: string, args: Record<string, any>, signal?: AbortSignal) => shortNormalize(tool, args, signal))
  const args = { path: `${alias}\\FILE~1.TXT`, head: 3 }
  await client.callTool("read_text_file", args)
  assert.equal(wire[0].arguments.path, `${long}\\file long.txt`)
  assert.equal(wire[0].arguments.head, 3)
  assert.equal(args.path, `${alias}\\FILE~1.TXT`)
})
const shortNormalize = (tool: string, args: any, signal?: AbortSignal) => normalize(tool, args, signal, ownedFs())
const normalize = short.normalizeFilesystemToolArgs

test("abort during native lookup stops further alias probes", async () => {
  const controller = new AbortController()
  let release!: (value: { isSymbolicLink(): boolean }) => void
  let realpaths = 0
  const pending = short.expandWindowsShortPath(`${alias}\\file.txt`, controller.signal, {
    lstat: () => new Promise(resolve => { release = resolve }),
    realpath: async () => { realpaths++; return long },
  })
  controller.abort()
  release({ isSymbolicLink: () => false })
  await assert.rejects(pending, /abort/i)
  assert.equal(realpaths, 0)
})

for (const reason of ["external", "timeout", "close"] as const) test(`pending alias IO cannot dispatch after ${reason}`, async t => {
  const { client, wire } = fakeConnected(t, { ...cfg, call_timeout_ms: 20 })
  let finish!: (args: any) => void
  t.mock.method(short, "normalizeFilesystemToolArgs", () => new Promise(resolve => { finish = resolve }))
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const controller = new AbortController()
  const pending = client.callTool("read_text_file", { path: `${alias}\\file.txt` }, controller.signal)
  const rejected = assert.rejects(pending, reason === "timeout" ? /MCP timeout/ : reason === "external" ? /MCP call aborted/ : /not connected|changed/)
  if (reason === "external") controller.abort()
  if (reason === "timeout") t.mock.timers.tick(21)
  if (reason === "close") { await client.close(); finish({ path: `${long}\\file.txt` }) }
  await rejected
  if (reason !== "close") finish({ path: `${long}\\file.txt` })
  await Promise.resolve()
  assert.equal(wire.length, 0)
})

test("non-local clients send original arguments without any local lookup", async t => {
  const { client, wire } = fakeConnected(t, { transport: "http", url: "https://example.test/mcp", enabled: true, trust_level: "trusted" })
  t.mock.method(short, "normalizeFilesystemToolArgs", () => { throw new Error("no local lookup") })
  const args = { path: `${alias}\\file.txt` }
  await client.callTool("read_text_file", args)
  assert.equal(wire[0].arguments, args)
})
