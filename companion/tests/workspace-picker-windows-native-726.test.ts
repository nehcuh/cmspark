/** Remote-only #726: real original picker and synthetic ACP, never human approval. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import cp from "node:child_process"
import { promisify } from "node:util"
import { withSurface650 } from "./fixtures/native-surface-650"

const testsRoot = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../tests" : ".")
function admission() {
  assert.equal(process.platform, "win32"); assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.env.RUNNER_OS, "Windows")
  const root = process.env.CMSPARK_TEST_RUN_DIR, data = process.env.CMSPARK_DATA_DIR
  assert.ok(root && data && path.isAbsolute(root) && path.isAbsolute(data), "canonical preload required")
  const named = fs.lstatSync(data, { bigint: true }), real = fs.realpathSync(data)
  assert.ok(named.isDirectory() && !named.isSymbolicLink())
  const resolved = fs.statSync(real, { bigint: true }); assert.equal(named.dev, resolved.dev); assert.equal(named.ino, resolved.ino)
  const relative = path.relative(fs.realpathSync(root), real)
  assert.ok(relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
  return real
}

test("726 hosted Windows native hint OK binds actual selected root and starts synthetic ACP there; cancel binds nothing", { skip: process.platform !== "win32" }, async t => {
  const data = admission()
  await withSurface650(t, async (owned, lease) => {
    lease.retain()
    const controllerModule = require(path.join(testsRoot, "helpers/picker-controller-726.cjs"))
    const adapterModule = require(path.join(testsRoot, "helpers/picker-native-adapter-726.cjs"))
    const scratch = fs.mkdtempSync(path.join(data, "picker726-")), scratchStat = fs.lstatSync(scratch, { bigint: true })
    const root = path.join(scratch, "实际工作区-726"); fs.mkdirSync(root)
    const expected = fs.realpathSync.native(root), configFile = path.join(data, "config.json")
    let before: Buffer | null = null
    if (fs.existsSync(configFile)) { const s = fs.lstatSync(configFile); assert.ok(s.isFile() && !s.isSymbolicLink() && s.nlink === 1); before = fs.readFileSync(configFile) }
    const tempBefore = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }
    process.env.TEMP = scratch; process.env.TMP = scratch; process.env.TMPDIR = scratch
    const children = new Map<cp.ChildProcess, Promise<void>>()
    function track(child: cp.ChildProcess) {
      if (!children.has(child)) children.set(child, new Promise(resolve => child.once("close", () => resolve())))
      return child
    }
    const originalExec = cp.execFile, originalSpawn = cp.spawn
    const originalPromisified: any = promisify(originalExec)
    let next: { mode: "ok" | "cancel"; controller?: any; child?: cp.ChildProcess } | undefined
    const controllers: any[] = []
    let expectedCommand: string | undefined
    // Forward unchanged args/options to the original real execFile, retaining
    // its documented Promise.child before awaiting completion. No fake picker.
    const wrapped: any = (...args: any[]) => Reflect.apply(originalExec, cp, args)
    Object.defineProperty(wrapped, promisify.custom, { value: (...args: any[]) => {
      if (next) {
        assert.ok(Array.isArray(args[1]) && args[1].length === 6)
        assert.equal(args[1].slice(0, 5).join("|"), "-NoProfile|-STA|-WindowStyle|Hidden|-File")
        const script = args[1][5], relative = path.relative(scratch, script)
        assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative))
        const st = fs.lstatSync(script); assert.ok(st.isFile() && !st.isSymbolicLink() && st.nlink === 1)
        assert.equal(fs.readFileSync(script, "utf8"), "\uFEFF" + expectedCommand)
        assert.equal(args[2].timeout, 120000); assert.equal(args[2].windowsHide, false)
      }
      const result = originalPromisified(...args)
      if (result.child) track(result.child)
      result.catch(() => {}) // observed even if synchronous test admission refuses
      if (next) {
        const action = next; next = undefined
        if (result.child) action.child = track(result.child)
        assert.ok(result.child && result.child.pid, "actual original picker child required")
        const native = adapterModule.nativePickerAdapter726({ child: action.child, script: path.join(testsRoot, "helpers/picker-native-726.ps1"), powershell: args[0], signal: owned.signal, registerChild: track })
        action.controller = controllerModule.controlPicker726({ child: action.child, native, mode: action.mode, signal: owned.signal })
        action.controller.done.catch(() => {}); controllers.push(action.controller)
      }
      return result
    } })
    cp.execFile = wrapped
    cp.spawn = ((...args: any[]) => track(Reflect.apply(originalSpawn, cp, args))) as typeof cp.spawn
    let config: typeof import("../src/config") | undefined, manager: ReturnType<typeof import("../src/acp/manager").getAcpManager> | undefined
    let installed: { bytes: Buffer; dev: bigint; ino: bigint } | undefined
    let pending: Promise<any> | undefined, clean = false
    try {
      lease.checkpoint()
      config = await import("../src/config"); assert.equal(fs.realpathSync(config.getConfigDir()), data); config.clearConfigCache()
      const stage = path.join(scratch, "stage"), cwd = path.join(scratch, "cwd.json")
      config.saveConfig({ capability_profile: "enterprise", modules: { workspace: { available: true, enabled: true, policy: "confirm_per_command" } }, acp: { enabled: true, servers: { fixture726: {
        enabled: true, command: process.execPath, args: [path.join(testsRoot, "helpers/picker-acp-peer-726.cjs")], protocol: "acp",
        env: { FIXTURE_MODE: "normal", FIXTURE_PID_FILE: path.join(scratch, "peer-pid"), FIXTURE_STAGE_FILE: stage, FIXTURE_PERMISSION_FILE: path.join(scratch, "permission"), FIXTURE_CWD_FILE: cwd },
        policy: { profile: "review_readonly", session_timeout_ms: 45000 },
      } } }, coding_handoff: { open_local_terminal: false } } as any)
      const installedStat = fs.lstatSync(configFile, { bigint: true }); assert.ok(installedStat.isFile() && !installedStat.isSymbolicLink() && installedStat.nlink === 1n)
      installed = { bytes: fs.readFileSync(configFile), dev: installedStat.dev, ino: installedStat.ino }; config.clearConfigCache()
      // Configured synthetic peer is real; unrelated PATH agent enumeration
      // is an explicit metadata-only DI seam, never a provider invocation.
      const discovery = await import("../src/acp/discover")
      owned.mock.method(discovery, "discoverCodingAgents", () => [])
      const { ThreadManager } = await import("../src/threads/thread-manager")
      const { handleMessage } = await import("../src/message-router")
      const picker = await import("../src/obsidian/folder-picker")
      // wrapper is retained by the real picker import, other execFile callers
      // always forward and never acquire a synthetic picker result.
      assert.ok(picker.resolveWindowsPowerShell())
      const acp = await import("../src/acp/manager"); manager = acp.getAcpManager()
      const { SecurityConfirmationManager } = await import("../src/security-confirmation")
      const confirmations = new SecurityConfirmationManager(), origin = Object.freeze({ fixture: "726" })
      const threads = new ThreadManager(), a = threads.create("Synthetic picker owner"), b = threads.create("Synthetic cancel owner")
      const services: any = { threadManager: threads, skillEngine: null, historyStore: null }
      let current = true, approvals = 0
      const session: any = { originWs: origin, isCurrentSession: () => current, sendToExtension() {}, executeTool: async () => { throw Error("UNEXPECTED_TOOL") },
        requestConfirmation(details: any) { return confirmations.request(message => {
          if (message.type !== "security.confirmation.request") return
          assert.equal(confirmations.respondFrom(message.confirmation_id, true, {} as any).outcome, "origin_mismatch")
          const approve = message.tool_name !== "acp_permission"
          if (approve) approvals++
          assert.equal(confirmations.respondFrom(message.confirmation_id, approve, origin as any, message.nonce_challenge).outcome, "resolved")
        }, details, { originWs: origin as any, signal: owned.signal }) },
      }
      const invokePicker = async (thread: typeof a, mode: "ok" | "cancel") => {
        lease.checkpoint(); const action: NonNullable<typeof next> = { mode }; next = action
        expectedCommand = picker.buildWindowsFolderPickScript(picker.WORKSPACE_FOLDER_PROMPT, expected)
        pending = handleMessage({ type: "workspace.pick", thread_id: thread.id, initial_path: expected, request_id: "native726:" + mode }, services, session)
        const result = await pending; pending = undefined
        assert.ok(action.child && action.controller, "original native child and real controller must exist")
        assert.equal((await action.controller.done).ownedModalAction, true)
        await children.get(action.child); await action.controller.dispose(); lease.checkpoint()
        return result
      }
      const picked = await invokePicker(a, "ok")
      assert.equal(picked.type, "workspace.pick_result"); assert.equal(picked.bound, true); assert.equal(picked.error, undefined)
      assert.equal(fs.realpathSync(picked.path), expected); assert.equal(threads.get(a.id)!.workspace_root, expected)
      // Causal initial selection evidence: no directory-control input was sent;
      // exact owned original OK returned expected. Not a visible-address read.
      assert.equal(threads.get(b.id)!.workspace_root, undefined)
      const cancelled = await invokePicker(b, "cancel")
      assert.equal(cancelled.cancelled, true); assert.equal(cancelled.bound, undefined); assert.equal(threads.get(b.id)!.workspace_root, undefined)
      let terminalResolve!: (value: any) => void
      const terminal = new Promise<any>(resolve => { terminalResolve = resolve })
      manager.setTerminalSink(info => terminalResolve(info))
      pending = handleMessage({ type: "acp.ui_start", thread_id: a.id, workspace_root: path.join(scratch, "stale-client-root"), agent_id: "fixture726", goal: "synthetic transport acceptance", cloud_disclosure_accepted: true }, services, session)
      const started = await pending; pending = undefined
      assert.equal(started.type, "acp.ui_start.accepted"); assert.equal(started.thread_id, a.id); assert.equal(approvals, 1)
      assert.equal(manager.getSession(started.session_id)!.workspace_root, expected)
      const finished = await terminal; assert.equal(finished.kind, "closed"); assert.equal(finished.session.workspace_root, expected)
      assert.equal(JSON.parse(fs.readFileSync(cwd, "utf8")).cwd, expected, "actual synthetic child cwd must equal canonical picker binding")
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(scratch, "permission"), "utf8")), { outcome: { outcome: "cancelled" }, approved: false })
      current = false
      const stale = await handleMessage({ type: "workspace.pick", thread_id: a.id, initial_path: expected, request_id: "native726:stale" }, services, session)
      assert.ok(stale.error); assert.equal(next, undefined)
      clean = true
    } finally {
      try {
      next = undefined; await manager?.shutdown()
      for (const child of children.keys()) if (child.exitCode === null && child.signalCode === null) child.kill()
      if (pending) await pending.catch(() => {})
      await Promise.all(children.values()) // terminate dispatch is never settlement
      for (const controller of controllers) await controller.dispose()
      lease.checkpoint()
      if (installed) {
        const s = fs.lstatSync(configFile, { bigint: true }); assert.ok(s.isFile() && !s.isSymbolicLink() && s.nlink === 1n)
        assert.equal(s.dev, installed.dev); assert.equal(s.ino, installed.ino); assert.ok(fs.readFileSync(configFile).equals(installed.bytes))
        if (before) fs.writeFileSync(configFile, before); else fs.unlinkSync(configFile)
      }
      config?.clearConfigCache()
      const now = fs.lstatSync(scratch, { bigint: true }); assert.ok(now.isDirectory() && !now.isSymbolicLink()); assert.equal(now.dev, scratchStat.dev); assert.equal(now.ino, scratchStat.ino)
      fs.rmSync(scratch, { recursive: true, force: true }); lease.settled()
      } finally {
        cp.execFile = originalExec; cp.spawn = originalSpawn; owned.mock.restoreAll()
        for (const key of ["TEMP", "TMP", "TMPDIR"] as const) {
          if (tempBefore[key] === undefined) delete process.env[key]; else process.env[key] = tempBefore[key]
        }
      }
    }
    assert.equal(clean, true)
  })
})
