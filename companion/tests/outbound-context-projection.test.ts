import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { projectOutboundContext } from "../src/outbound-mcp/context-projection"
import { ContextSessionRegistry } from "../src/outbound-mcp/context-session"
import { OUTBOUND_CONTEXT_PROFILE, type LiveContextGrant } from "../src/outbound-mcp/context-permission"
import { siteTargetFromBrowser } from "../src/site-context/target"
import { buildSiteContext } from "../src/site-context/service"

test("real knowledge producer exports the granted projection only, rechecks grant/target and rejects deleted or changed documents", async () => {
  const root = mkdtempSync(join(tmpdir(), "cmspark-outbound-context-"))
  const previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = root
  try {
    const { initDataDir } = await import("../src/config")
    await initDataDir()
    const { SkillEngine } = await import("../src/skills/skill-engine")
    const dir = join(root, "skills"); mkdirSync(dir, { recursive: true })
    const write = (id: string, body: string) => writeFileSync(join(dir, `${id}.md`), `---\nname: ${id}\ntype: site_knowledge\nsite: portal.test\ndescription: ${id}\n---\n${body}\n`)
    write("selected", "Selected context body")
    write("private", "UNSELECTED_PRIVATE_BODY")
    const engine = new SkillEngine()
    const grant: LiveContextGrant = { id: "g1", caller_id: "caller", profile: OUTBOUND_CONTEXT_PROFILE, revoked_at: null, expires_at: null,
      allow_context_export: true, context_origins: ["https://portal.test"], context_knowledge_ids: ["selected", "missing"] }
    const lookupGrant = (id: string) => id === grant.id ? grant : undefined
    const sessions = new ContextSessionRegistry(lookupGrant)
    const session = sessions.issue(grant.id, grant.caller_id)
    const identity = { grantId: grant.id, callerId: grant.caller_id, sessionHandle: session.handle }
    const target = siteTargetFromBrowser(7, "https://portal.test/page?token=private#secret", Date.now())!
    const deps = { engine, lookupGrant, sessions, resolveTarget: async () => target }
    const result = await projectOutboundContext({ tabId: 7, query: "context" }, identity, deps)
    const chat = await buildSiteContext(engine, { scopeId: "chat", target, query: "context", selection: { kind: "explicit", skillIds: [], knowledgeIds: ["selected"] } })
    assert.deepEqual(result.knowledge, chat.snapshot.knowledge)
    assert.deepEqual(result.omitted, [{ id: "missing", reason: "NOT_FOUND" }])
    assert.doesNotMatch(JSON.stringify(result), /UNSELECTED_PRIVATE_BODY|Safety Guard|token=private|#secret/)
    assert.equal((result as any).prompt, undefined)
    assert.equal((result as any).observations, undefined)
    for (const mutation of ["revoke", "navigate", "delete", "edit", "unselect"]) {
      grant.revoked_at = null; grant.context_knowledge_ids = ["selected"]
      write("selected", "Selected context body")
      let reads = 0
      const changing = { ...deps, resolveTarget: async () => {
        reads++
        if (reads === 2) {
          if (mutation === "revoke") grant.revoked_at = new Date().toISOString()
          if (mutation === "navigate") return siteTargetFromBrowser(7, "https://portal.test/page?new-version", Date.now())!
          if (mutation === "delete") rmSync(join(dir, "selected.md"))
          if (mutation === "edit") write("selected", "Changed current context")
          if (mutation === "unselect") grant.context_knowledge_ids = []
        }
        return target
      } }
      if (mutation === "revoke" || mutation === "navigate") await assert.rejects(projectOutboundContext({ tabId: 7 }, identity, changing), new RegExp(mutation === "revoke" ? "GRANT_DENIED" : "TARGET_CHANGED"))
      else {
        const limited = await projectOutboundContext({ tabId: 7 }, identity, changing)
        assert.equal(limited.knowledge.length, 0)
        assert.equal(limited.omitted[0].reason, mutation === "delete" ? "NOT_FOUND" : mutation === "edit" ? "REDACTED" : "GRANT_DENIED")
      }
    }
  } finally {
    if (previous === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = previous
    rmSync(root, { recursive: true, force: true })
  }
})
