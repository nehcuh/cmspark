import "./_outbound-grants-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  listOutboundGrants,
  resetOutboundGrantsForTests,
  grantAllowsPageExport,
} from "../src/outbound-mcp/outbound-grants"
import { hasOutboundDisclosure, clearAllOutboundDisclosureSessions } from "../src/outbound-mcp/disclosure-session"
import { handleOutboundGrantCli, outboundMcpLaunchSpec } from "../src/outbound-mcp/grant-cli"

function companionSrc(rel: string): string {
  return fs.readFileSync(path.join(__dirname, "..", "..", "src", rel), "utf8")
}

async function runGrantCli(argv: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  let stdout = ""
  let stderr = ""
  const code = await handleOutboundGrantCli(argv, {
    stdout: { write: (chunk: string) => { stdout += chunk } },
    stderr: { write: (chunk: string) => { stderr += chunk } },
  })
  return { stdout, stderr, code }
}

test.beforeEach(() => {
  resetOutboundGrantsForTests()
  clearAllOutboundDisclosureSessions()
})

test("printUsage lists outbound-grant", () => {
  const src = companionSrc("index.ts")
  assert.match(src, /outbound-grant/)
  assert.match(src, /租手钥匙/)
  assert.doesNotMatch(src, /Handoff/)
})

test("handleOutboundGrantCli issue prints cmg_ once and env snippet", async () => {
  const { stdout, stderr, code } = await runGrantCli([
    "issue", "--caller-id", "codex", "--label", "Codex",
  ])
  assert.equal(code, 0)
  const tokens = stdout.match(/cmg_[0-9a-f]{64}/g) || []
  assert.equal(tokens.length, 1, "raw cmg_ token must appear exactly once on stdout")
  assert.match(stdout, /CMSPARK_OUTBOUND_GRANT/)
  assert.match(stdout, /CMSPARK_OUTBOUND_CALLER_ID/)
  assert.match(stdout, /CMSPARK_OUTBOUND_PORT=23401/)
  assert.match(stdout, /这把钥匙只出现一次。它不是扩展配对码。/)
  assert.match(stdout, /未允许页文\/截图外泄。编程助手读取页面或截图会被拒绝/)
  assert.match(stdout, /mcp-outbound/)
  assert.doesNotMatch(stderr, /cmg_/)
  const listed = listOutboundGrants()
  assert.equal(listed.filter((g) => g.caller_id === "codex").length, 1)
  assert.equal(grantAllowsPageExport("codex"), false)
})

test("handleOutboundGrantCli --allow-page-export sets grant flag not disclosure Map", async () => {
  const { stdout, code } = await runGrantCli(["issue", "--caller-id", "c", "--allow-page-export"])
  assert.equal(code, 0)
  assert.equal(grantAllowsPageExport("c"), true)
  assert.equal(hasOutboundDisclosure("c"), false)
  assert.match(stdout, /已允许 c 把页文\/截图发给其云模型/)
  assert.match(stdout, /首次外泄仍须在确认台批准/)
})

test("handleOutboundGrantCli --allow-page-export=false does not persist true", async () => {
  const { stdout, code } = await runGrantCli([
    "issue", "--caller-id", "c", "--allow-page-export=false",
  ])
  assert.equal(code, 0)
  assert.equal(grantAllowsPageExport("c"), false)
  assert.equal(hasOutboundDisclosure("c"), false)
  assert.match(stdout, /未允许页文\/截图外泄/)
})

test("unknown subcommand exits 1", async () => {
  const { code, stderr, stdout } = await runGrantCli(["explode"])
  assert.equal(code, 1)
  assert.match(stderr, /explode|未知|unknown/i)
  assert.doesNotMatch(stdout, /cmg_/)
})

test("grant-cli.ts must not import acceptOutboundDisclosure or open a server", () => {
  const src = companionSrc("outbound-mcp/grant-cli.ts")
  assert.doesNotMatch(src, /acceptOutboundDisclosure/)
  assert.doesNotMatch(src, /listen\(/)
  assert.doesNotMatch(src, /createServer\(/)
  assert.doesNotMatch(src, /fetch\(/)
  assert.doesNotMatch(src, /http\.request/)
  assert.doesNotMatch(src, /net\.createServer/)
})

test("handleOutboundGrantCli revoke by id", async () => {
  const issued = await runGrantCli(["issue", "--caller-id", "to-revoke", "--label", "RevokeMe"])
  assert.equal(issued.code, 0)
  const rec = listOutboundGrants().find((g) => g.caller_id === "to-revoke")
  assert.ok(rec)
  const { stdout, stderr, code } = await runGrantCli(["revoke", "--grant-id", rec!.id])
  assert.equal(code, 0)
  assert.doesNotMatch(stdout, /cmg_/)
  assert.doesNotMatch(stderr, /cmg_/)
  const after = listOutboundGrants().find((g) => g.id === rec!.id)
  assert.ok(after?.revoked_at)
  assert.equal(grantAllowsPageExport("to-revoke"), false)
})

test("handleOutboundGrantCli list does not reprint cmg_", async () => {
  await runGrantCli(["issue", "--caller-id", "listed-caller", "--label", "Listed"])
  const { stdout, stderr, code } = await runGrantCli(["list"])
  assert.equal(code, 0)
  assert.doesNotMatch(stdout, /cmg_/)
  assert.doesNotMatch(stderr, /cmg_/)
  assert.match(stdout, /listed-caller/)
  assert.match(stdout, /Listed/)
  assert.match(stdout, /gr_/)
})

test("outboundMcpLaunchSpec is platform-honest", () => {
  const darwin = outboundMcpLaunchSpec("darwin")
  assert.equal(darwin.command, "/Applications/CMspark.app/Contents/Resources/cmspark-agent")
  assert.deepEqual(darwin.args, ["mcp-outbound"])

  const win = outboundMcpLaunchSpec("win32")
  assert.match(win.command, /CMspark\\node\.exe$/)
  assert.match(
    win.args[0] || "",
    /CMspark\\cmspark-agent\.js|CMspark\/cmspark-agent\.js/,
    "win32 args[0] must be the full cmspark-agent.js path, not a bare filename",
  )
  assert.notEqual(win.args[0], "cmspark-agent.js")
  assert.ok(win.args.includes("mcp-outbound"))

  const linux = outboundMcpLaunchSpec("linux")
  assert.doesNotMatch(linux.command, /\/Applications\/CMspark/)
  assert.ok(linux.args.includes("mcp-outbound"))
})
