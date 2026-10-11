// #603: official filesystem roots replace (rather than union) CLI allow-dirs.
import "./_security-gates-setup"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { initDataDir, getConfig, saveConfig, replaceMcpServers, clearConfigCache } from "../../src/config"
import { getMcpManager } from "../../src/mcp/manager"
import { bindMcpDispatchRuntime, executeMcpTool } from "../../src/mcp/dispatch"
import { pathToFileUri } from "../../src/mcp/allow-dir-expand"
import { SecurityConfirmationManager } from "../../src/security-confirmation"

for (const mode of ["omitted", "empty", "authoritative", "arg-present", "uri-cli", "cwd-fallback", "null-roots", "mixed-roots"] as const) {
  test(`official filesystem approved expansion preserves effective allowlist: ${mode}`, { timeout: 20000 }, async () => {
    await initDataDir()
    // Match the official server's async/native realpath. On Windows the sync
    // implementation can retain TEMP's RUNNER~1 alias, while roots use the
    // long name; the upstream allowlist compares those strings literally.
    const root = await fs.promises.realpath(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-roots-owned-")))
    const [a, b, c] = ["original space #百分", "approved", "unapproved"].map(name => path.join(root, name))
    for (const dir of [a, b, c]) { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, "file.txt"), path.basename(dir)) }
    const initialCwd = process.cwd()
    const manager = getMcpManager(), confirmations = new SecurityConfirmationManager()
    let prompts = 0
    const ws = { readyState: WebSocket.OPEN, send(raw: string) {
      const frame = JSON.parse(raw)
      if (frame.type === "security.confirmation.request") {
        prompts++; queueMicrotask(() => confirmations.respondFrom(frame.confirmation_id, true, ws))
      }
    } } as WebSocket
    const read = (dir: string) => manager.callTool({ serverName: "filesystem", toolName: "read_text_file" }, { path: path.join(dir, "file.txt") })
    const outside = (result: Awaited<ReturnType<typeof read>>) => result.isError === true && result.content.some((item: any) =>
      item.type === "text" && /Access denied - path outside allowed directories/.test(item.text))
    const waitExcluded = async () => {
      const until = Date.now() + 4000
      for (;;) {
        const result = await read(c)
        if (outside(result)) return
        assert.ok(Date.now() < until, `unapproved CLI directory not excluded by roots: ${JSON.stringify(result)}`)
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    try {
      const authoritative = mode === "authoritative" || mode === "arg-present" || mode === "mixed-roots"
      if (mode === "cwd-fallback") process.chdir(root)
      saveConfig({ security: { ...getConfig().security, allow_all_schemes: false, auto_approve_dangerous: false, auto_approve_enterprise_tools: false }, mcp: { enabled: true, servers: {} } })
      replaceMcpServers({ filesystem: { transport: "stdio", command: process.execPath,
        args: [require.resolve("@modelcontextprotocol/server-filesystem/dist/index.js"), mode === "cwd-fallback" ? `./${path.basename(a)}` : a,
          ...(mode === "uri-cli" ? [pathToFileUri(c)] : []),
          ...(authoritative ? [c] : []), ...(mode === "arg-present" ? [b] : [])],
        ...(mode === "cwd-fallback" ? { cwd: path.join(root, "missing-cwd") } : {}),
        enabled: true, trust_level: "trusted", security_capabilities: ["read-only"],
        ...(mode === "empty" ? { roots: [] } : mode === "null-roots" ? { roots: [null] as any } :
          authoritative ? { roots: [{ uri: pathToFileUri(a) }, ...(mode === "mixed-roots" ? [null] as any : [])] } : {}),
      } })
      clearConfigCache()
      await manager.applyConfig(getConfig().mcp)
      await manager.waitForServerReady("filesystem")
      // Official oninitialized roots refresh is asynchronous. Wait for its
      // observable allowlist rather than testing the startup CLI window.
      if (authoritative) await waitExcluded()
      const initialRead = await read(a)
      if (initialRead.isError !== false) {
        let allowed: unknown
        try { allowed = await manager.callTool({ serverName: "filesystem", toolName: "list_allowed_directories" }, {}) }
        catch (error) { allowed = String(error) }
        assert.equal(initialRead.isError, false, JSON.stringify({ initialRead, a, uri: pathToFileUri(a), allowed }))
      }
      assert.equal((await read(b)).isError, true)
      const excluded = await read(c)
      assert.ok(outside(excluded), JSON.stringify(excluded))
      bindMcpDispatchRuntime({ getThreadManager: () => null, securityConfirmations: confirmations, broadcastToClients() {} })
      const result = await executeMcpTool("mcp__filesystem__read_text_file", { path: path.join(b, "file.txt") }, "owned", ws, Date.now())
      assert.equal(result.success, true, result.error)
      assert.equal(prompts, 1)
      clearConfigCache()
      const roots = getConfig().mcp!.servers.filesystem.roots
      if (authoritative) {
        assert.ok(roots?.some(r => r.uri === pathToFileUri(a)))
        assert.ok(roots?.some(r => r.uri === pathToFileUri(b)))
        assert.ok(!roots?.some(r => r.uri === pathToFileUri(c)))
      } else {
        assert.deepEqual(roots, mode === "empty" ? [] : mode === "null-roots" ? [null] : undefined, "args-only mode must keep the server's original interpretation")
      }
      // Restart from persisted config, proving both directories survive reconnect.
      await manager.applyConfig({ enabled: false, servers: {} })
      await manager.applyConfig(getConfig().mcp)
      await manager.waitForServerReady("filesystem")
      assert.equal((await read(a)).isError, false)
      assert.equal((await read(b)).isError, false)
      // In authoritative mode C is a CLI arg; wait out the startup window.
      await waitExcluded()
      assert.equal(confirmations.pendingCount(), 0)
    } finally {
      confirmations.rejectAll(); bindMcpDispatchRuntime(null)
      await manager.applyConfig({ enabled: false, servers: {} })
      process.chdir(initialCwd)
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}
