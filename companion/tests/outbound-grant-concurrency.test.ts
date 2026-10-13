import "./_outbound-grants-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { getConfigDir } from "../src/config"
import { issueOutboundGrant, revokeOutboundGrant, revokeAllOutboundGrants, verifyOutboundGrantToken, listOutboundGrants, resetOutboundGrantsForTests } from "../src/outbound-mcp/outbound-grants"
import { registerEnterpriseInstance } from "../src/outbound-mcp/enterprise-policy"
import { generateKeyPairSync } from "node:crypto"

const instance = registerEnterpriseInstance("concurrency-test-profile", "user-a")
const authority_public_key = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString()
const storePath = join(getConfigDir(), "outbound-grants.json")
const modulePath = require.resolve("../src/outbound-mcp/outbound-grants")
const policy = () => ({ ...instance, revision: "r1", expires_at: new Date(Date.now() + 60_000).toISOString(), authority_public_key,
  tools: ["navigate"], navigation: [{ origin: "https://business.test", path: "/app" }], evidence: [], login: [], ready: [{ selector: "#ready" }], login_markers: [{ selector: "#login" }], actions: [] })
function waitMessage(child: ChildProcess, phase: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("isolated scheduler timeout")) }, 5000)
    const message = (value: any) => { if (value.phase === phase) { cleanup(); resolve(value) } }
    const exit = () => { cleanup(); reject(new Error("isolated child ended before expected phase")) }
    const cleanup = () => { clearTimeout(timer); child.off("message", message); child.off("exit", exit) }
    child.on("message", message); child.on("exit", exit)
  })
}
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 1000)
    child.once("exit", () => { clearTimeout(timer); resolve() }); child.kill()
  })
}
function childProcess(mode: "auth" | "issue", token = ""): ChildProcess {
  // Scheduling shims choose a real separate-process interleaving. Production
  // verification, transaction, issuance and revocation are not replaced.
  return spawn(process.execPath, ["-e", `
    const fs=require('node:fs'),store=require(process.env.TEST_MODULE);
    let paused=false;
    const pause=()=>{process.send({phase:'paused'});const b=Buffer.alloc(1);fs.readSync(0,b,0,1,null)};
    if(process.env.TEST_MODE==='auth'){
      const read=fs.readFileSync;
      fs.readFileSync=function(file,...args){const value=read.call(fs,file,...args);if(String(file)===process.env.TEST_STORE&&!paused){paused=true;pause()}return value};
      const result=store.verifyOutboundGrantToken(process.env.TEST_TOKEN);
      process.send({phase:'done',ok:result.ok});
    }else{
      const rename=fs.renameSync;
      fs.renameSync=function(from,to){if(String(to)===process.env.TEST_STORE&&!paused){paused=true;pause()}return rename.call(fs,from,to)};
      const result=store.issueOutboundGrant({caller_id:'admin',label:'concurrent issuer'});
      process.send({phase:'done',id:result.id});
    }
    process.disconnect();
  `], { stdio: ["pipe", "ignore", "ignore", "ipc"], env: { ...process.env, TEST_MODULE: modulePath, TEST_STORE: storePath, TEST_MODE: mode, TEST_TOKEN: token } })
}
test.beforeEach(() => resetOutboundGrantsForTests())
test("separate legacy/enterprise authentication cannot undo revoke, revoke-all or newer policy", async () => {
  for (const enterpriseAuth of [false, true]) for (const mutation of ["revoke", "all", "policy"]) {
    resetOutboundGrantsForTests()
    const enterprise = issueOutboundGrant({ caller_id: "itcra", label: "enterprise", enterprise_policy: policy() })
    const legacy = issueOutboundGrant({ caller_id: "legacy", label: "legacy" })
    const child = childProcess("auth", enterpriseAuth ? enterprise.token : legacy.token)
    try {
      await waitMessage(child, "paused")
      if (mutation === "revoke") assert.equal(revokeOutboundGrant(enterprise.id), true)
      else if (mutation === "all") assert.equal(revokeAllOutboundGrants(), 2)
      else {
        const file = JSON.parse(readFileSync(storePath, "utf8"))
        file.grants.find((g: any) => g.id === enterprise.id).enterprise_policy.revision = "r2"
        writeFileSync(storePath, JSON.stringify(file)) // isolated administrator fault injection
      }
      const committed = readFileSync(storePath, "utf8"), done = waitMessage(child, "done")
      child.stdin!.write("g"); await done
      assert.equal(readFileSync(storePath, "utf8"), committed)
      if (mutation !== "policy") assert.equal(verifyOutboundGrantToken(enterprise.token).ok, false)
      else assert.equal(listOutboundGrants().find(g => g.id === enterprise.id)!.enterprise_policy!.revision, "r2")
    } finally { await stopChild(child) }
  }
})
test("actual issuer holds cross-process transaction; contending writers fail explicitly then revoke persists", async () => {
  const existing = issueOutboundGrant({ caller_id: "legacy", label: "existing" }), child = childProcess("issue")
  try {
    await waitMessage(child, "paused")
    const committed = readFileSync(storePath, "utf8")
    assert.equal(existsSync(storePath + ".lock"), true)
    assert.throws(() => issueOutboundGrant({ caller_id: "other", label: "contender" }), /GRANT_STORE_BUSY/)
    assert.throws(() => revokeOutboundGrant(existing.id), /GRANT_STORE_BUSY/)
    assert.throws(() => revokeAllOutboundGrants(), /GRANT_STORE_BUSY/)
    assert.equal(verifyOutboundGrantToken(existing.token).ok, true) // usage is independent of writer
    assert.equal(readFileSync(storePath, "utf8"), committed)
    assert.ok(listOutboundGrants().find(g => g.id === existing.id)!.last_used_at)
    const done = waitMessage(child, "done"); child.stdin!.write("g")
    const issued = await done
    assert.equal(existsSync(storePath + ".lock"), false)
    assert.equal(revokeOutboundGrant(existing.id), true)
    assert.equal(verifyOutboundGrantToken(existing.token).ok, false)
    assert.equal(listOutboundGrants().some(g => g.id === issued.id), true)
  } finally { await stopChild(child) }
})
