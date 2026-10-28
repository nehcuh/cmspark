import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

type Params = { command: string; args: string[]; cwd?: string; stderr: string; env: Record<string, string> }

// CPU platform seam: execute the complete production factory/resolver/identity.
// Only process identity, filesystem responses and the inert transport constructor
// are supplied. No transport.start(), SDK connection or Windows OS runs here.
export function transportPathFixture(platform: "win32" | "linux", cwd?: string, entryExists = true) {
  const paths = platform === "win32" ? path.win32 : path.posix
  const appRoot = platform === "win32" ? "C:\\owned\\app" : "/owned/app"
  const execPath = platform === "win32" ? "C:\\owned\\node.exe" : "/owned/node"
  const originalCwd = cwd ?? (platform === "win32" ? "C:\\owned\\original-cwd" : "/owned/original-cwd")
  const entry = paths.join(appRoot, "node_modules", "@modelcontextprotocol", "server-filesystem", "dist", "index.js")
  const sourceRoot = path.resolve(__dirname, "../../src")
  const constructed: Params[] = []
  const mkdirCalls: string[] = []
  const inertFs = {
    existsSync: (value: string) => value === originalCwd || (entryExists && value === entry),
    statSync: (value: string) => ({ isDirectory: () => value === originalCwd }),
    mkdirSync: (value: string) => { mkdirCalls.push(value) },
  }
  function load(file: string, dependencies: Record<string, unknown>): Record<string, any> {
    const filename = path.join(sourceRoot, file)
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      reportDiagnostics: true,
    })
    assert.equal(output.diagnostics?.filter(row => row.category === ts.DiagnosticCategory.Error).length ?? 0, 0)
    const module = { exports: {} }
    new vm.Script(output.outputText, { filename }).runInNewContext({
      module, exports: module.exports,
      require: (name: string) => {
        assert.ok(Object.hasOwn(dependencies, name), `unexpected production dependency: ${name}`)
        return dependencies[name]
      },
      process: { platform, execPath, env: { CMSPARK_DATA_DIR: paths.join(appRoot, "owned-data") } },
    })
    return module.exports
  }
  const inertOs = { homedir: () => paths.join(appRoot, "owned-home") }
  const processPath = load("process-path.ts", { fs: inertFs, os: inertOs, path: paths })
  const identity = load("mcp/filesystem-identity.ts", { "node:path": paths })
  const resolver = load("mcp/filesystem-launch.ts", {
    "node:path": paths, "node:fs": inertFs,
    "../paths": { getAppRoot: () => appRoot }, "./filesystem-identity": identity,
  })
  class InertOwnedStdioTransport {
    readonly stderr = undefined
    readonly _serverParams: Params
    constructor(params: Params) {
      // Copy only the array across the VM realm; every argument remains exact.
      this._serverParams = { ...params, args: Array.from(params.args ?? []) }
      constructed.push(this._serverParams)
    }
    start(): never { throw new Error("CPU contract must not start MCP") }
  }
  const forbidden = () => { throw new Error("unexpected CPU contract effect") }
  const factory = load("mcp/transport.ts", {
    "./stdio-transport.js": { OwnedStdioTransport: InertOwnedStdioTransport },
    "@modelcontextprotocol/sdk/client/streamableHttp.js": { StreamableHTTPClientTransport: forbidden },
    "node:path": paths, "node:os": inertOs, "node:fs": inertFs,
    "../logger.js": { logger: { warn: forbidden } },
    "../user-env.js": { getUserEnvVars: forbidden, isUnsafeLoaderEnvKey: () => false },
    "../process-path.js": processPath,
    "./filesystem-launch.js": resolver,
  })
  return { createTransport: factory.createTransport as (config: any) => InertOwnedStdioTransport,
    originalCwd, entry, execPath, constructed, mkdirCalls }
}

function assertLaunch(params: Params, command: string, args: string[], cwd: string) {
  assert.equal(params.command, command)
  assert.deepEqual(params.args, args)
  assert.equal(params.cwd, cwd)
  assert.equal(params.stderr, "pipe")
}

const roots = ["/tmp", "C:\\owned\\workspace", "relative\\literal", "--tag=not-a-path\\literal"]
function config(cwd: string) {
  return { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", ...roots],
    cwd, enabled: true, trust_level: "first-use", env: { PATH: "owned-path-only" } }
}

test("createTransport path contract: Windows normalizes the real bundled entry and only path-like args", () => {
  const f = transportPathFixture("win32")
  const params = f.createTransport(config(f.originalCwd))._serverParams
  assertLaunch(params, f.execPath,
    ["C:/owned/app/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js", "/tmp", "C:/owned/workspace", "relative\\literal", "--tag=not-a-path\\literal"], f.originalCwd)
  assert.equal(f.constructed.length, 1)
  assert.equal(params.env.PATH, "owned-path-only")
  assert.deepEqual(f.mkdirCalls, ["C:\\owned\\app\\owned-data\\npm-prefix"])
})

test("createTransport path contract: non-Windows preserves all original argument spellings", () => {
  const f = transportPathFixture("linux")
  assertLaunch(f.createTransport(config(f.originalCwd))._serverParams, f.execPath, [f.entry, ...roots], f.originalCwd)
  assert.equal(f.constructed.length, 1)
})

test("createTransport path contract: absent bundled entry does not satisfy the strict bundled launch", () => {
  const f = transportPathFixture("win32", undefined, false)
  const params = f.createTransport(config(f.originalCwd))._serverParams
  assert.equal(params.command, "npx")
  assert.throws(() => assertLaunch(params, f.execPath, [f.entry.replace(/\\/g, "/"), ...roots], f.originalCwd))
})

test("createTransport path contract: wrong entry command args cwd or stderr still fail", () => {
  const f = transportPathFixture("win32")
  const params = f.createTransport(config(f.originalCwd))._serverParams
  const expected = [f.entry.replace(/\\/g, "/"), "/tmp", "C:/owned/workspace", "relative\\literal", "--tag=not-a-path\\literal"]
  assertLaunch(params, f.execPath, expected, f.originalCwd)
  for (const mutant of [
    { ...params, args: ["C:/owned/wrong/index.js", ...params.args.slice(1)] },
    { ...params, command: "npx" },
    { ...params, args: [params.args[0], "/wrong-root", ...params.args.slice(2)] },
    { ...params, args: [...params.args, "extra"] },
    { ...params, cwd: "C:\\owned\\wrong-cwd" },
    { ...params, stderr: "inherit" },
  ]) assert.throws(() => assertLaunch(mutant, f.execPath, expected, f.originalCwd))
})
