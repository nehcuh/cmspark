import "./_outbound-grants-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { enterpriseInstance, registerEnterpriseInstance } from "../src/outbound-mcp/enterprise-policy"
import { handleOutboundGrantCli } from "../src/outbound-mcp/grant-cli"

function isolated() {
  const directory = fs.mkdtempSync(join(tmpdir(), "cmspark-register-625-")), previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = directory
  return { directory, path: join(directory, "enterprise-instance.json"), close() {
    if (previous === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = previous
    fs.rmSync(directory, { recursive: true, force: true })
  } }
}
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000
  while (!check()) { assert.ok(Date.now() < deadline, "owned registration fixture did not settle"); await new Promise(resolve => setTimeout(resolve, 5)) }
}
test("concurrent actual registration cannot replace the winning identity or invalidate its issued grant", async t => {
  const h = isolated(), modulePath = resolve(__dirname, "../src/outbound-mcp/enterprise-policy.js")
  const grantsPath = resolve(__dirname, "../src/outbound-mcp/outbound-grants.js")
  // Pause at the real check-before-write seam. On the fixed implementation the
  // first child already owns the lock and the second must fail before this seam.
  const script = `
    const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
    const [modulePath, grantsPath, directory, role] = process.argv.slice(1);
    const wait = file => { const deadline = Date.now() + 5000; while (!fs.existsSync(file)) { if (Date.now() >= deadline) throw Error('FIXTURE_DEADLINE'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); } };
    const original = fs.existsSync; let paused = false;
    fs.existsSync = file => { const exists = original(file); if (!paused && file === path.join(directory, 'enterprise-instance.json') && !exists) { paused = true; fs.writeFileSync(path.join(directory, role + '.ready'), 'ready'); wait(path.join(directory, role + '.release')); } return exists; };
    const policy = require(modulePath), grants = require(grantsPath);
    try {
      const instance = policy.registerEnterpriseInstance('profile-' + role, 'subject-' + role);
      if (role === 'first') {
        const key = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
        const grant = grants.issueOutboundGrant({caller_id:'fixture',label:'fixture',enterprise_policy:{...instance,revision:'r1',expires_at:new Date(Date.now()+60000).toISOString(),authority_public_key:key,tools:['get_page_text'],navigation:[{origin:'https://business.test',path:'/app'}],evidence:[{origin:'https://business.test',path:'/app'}],login:[{origin:'https://sso.test',path:'/login'}],ready:[{selector:'#ready'}],login_markers:[{selector:'#login'}],actions:[]}});
        const issuedPath = path.join(directory, 'first.issued'), pendingIssuedPath = issuedPath + '.tmp';
        fs.writeFileSync(pendingIssuedPath, JSON.stringify({valid:grants.verifyOutboundGrantToken(grant.token).ok}), { flag: 'wx', mode: 0o600 });
        fs.renameSync(pendingIssuedPath, issuedPath);
        wait(path.join(directory, 'verify.release'));
        process.stdout.write(JSON.stringify({registered:true,grant_live:grants.verifyOutboundGrantToken(grant.token).ok}));
      } else process.stdout.write(JSON.stringify({registered:true}));
    } catch(e) { process.stdout.write(JSON.stringify({registered:false,error:e.message})); }
  `
  const children: ChildProcess[] = []
  const completions: Promise<any>[] = []
  const run = (role: string) => {
    const child = spawn(process.execPath, ["-e", script, modulePath, grantsPath, h.directory, role], { env: { ...process.env, CMSPARK_DATA_DIR: h.directory }, stdio: ["ignore", "pipe", "pipe"] })
    children.push(child); let output = "", error = "", settled = false
    child.stdout!.on("data", chunk => { output += chunk }); child.stderr!.on("data", chunk => { error += chunk })
    const done = new Promise<any>((resolve, reject) => { child.once("error", reject); child.once("close", code => { settled = true; try { assert.equal(code, 0, error); resolve(JSON.parse(output)) } catch(e) { reject(e) } }) })
    // Attach a handler immediately, including when fixture setup fails.
    void done.catch(() => {})
    completions.push(done)
    return { done, settled: () => settled }
  }
  try {
    const first = run("first"); await until(() => fs.existsSync(join(h.directory, "first.ready")) || first.settled())
    assert.equal(first.settled(), false)
    const second = run("second"); await until(() => fs.existsSync(join(h.directory, "second.ready")) || second.settled())
    fs.writeFileSync(join(h.directory, "first.release"), "release")
    await until(() => fs.existsSync(join(h.directory, "first.issued")) || first.settled())
    assert.equal(JSON.parse(fs.readFileSync(join(h.directory, "first.issued"), "utf8")).valid, true)
    fs.writeFileSync(join(h.directory, "second.release"), "release")
    const loser = await second.done
    fs.writeFileSync(join(h.directory, "verify.release"), "release")
    const winner = await first.done
    t.diagnostic(JSON.stringify({ first: winner, second: loser }))
    assert.deepEqual(loser, { registered: false, error: "INSTANCE_BUSY" })
    assert.deepEqual(winner, { registered: true, grant_live: true })
    assert.equal(enterpriseInstance().profile_id, "profile-first")
    assert.equal(fs.existsSync(h.path + ".lock"), false)
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill()
    await Promise.allSettled(completions)
    h.close()
  }
})
test("same legacy-shaped identifiers remain idempotent and conflicting registration preserves bytes", () => {
  const h = isolated()
  try {
    const instance = registerEnterpriseInstance("legacy-profile", "subject-a"), bytes = fs.readFileSync(h.path)
    assert.deepEqual(registerEnterpriseInstance("legacy-profile", "subject-a"), instance)
    assert.throws(() => registerEnterpriseInstance("other-profile", "subject-a"), /INSTANCE_ALREADY_REGISTERED/)
    assert.deepEqual(fs.readFileSync(h.path), bytes); assert.equal(fs.existsSync(h.path + ".lock"), false)
  } finally { h.close() }
})
test("busy registration does not steal an existing lock or modify authority", async () => {
  const h = isolated()
  try {
    const lock = h.path + ".lock"; fs.writeFileSync(lock, "owned-marker")
    assert.throws(() => registerEnterpriseInstance("profile", "subject"), /INSTANCE_BUSY/)
    let stdout = "", stderr = ""
    assert.equal(await handleOutboundGrantCli(["register-instance", "--profile-id", "profile", "--subject", "subject"], { stdout: { write: text => { stdout += text } }, stderr: { write: text => { stderr += text } } }), 1)
    assert.equal(stdout, ""); assert.equal(stderr.trim(), "INSTANCE_BUSY")
    assert.equal(fs.readFileSync(lock, "utf8"), "owned-marker"); assert.equal(fs.existsSync(h.path), false)
  } finally { h.close() }
})
test("failed atomic registration releases its owned lock and can retry without a partial authority", async () => {
  const h = isolated(), native = require("node:fs") as typeof fs, rename = native.renameSync
  try {
    native.renameSync = (oldPath, newPath) => { if (newPath === h.path) throw new Error("PRIVATE_NATIVE_PATH"); rename(oldPath, newPath) }
    assert.throws(() => registerEnterpriseInstance("profile", "subject"), /INSTANCE_UNWRITABLE/)
    let stdout = "", stderr = ""
    assert.equal(await handleOutboundGrantCli(["register-instance", "--profile-id", "profile", "--subject", "subject"], { stdout: { write: text => { stdout += text } }, stderr: { write: text => { stderr += text } } }), 1)
    assert.equal(stdout, ""); assert.equal(stderr.trim(), "INSTANCE_UNWRITABLE")
    assert.equal(fs.existsSync(h.path + ".lock"), false); assert.equal(fs.existsSync(h.path), false)
    native.renameSync = rename
    assert.equal(registerEnterpriseInstance("profile", "subject").profile_id, "profile")
  } finally { native.renameSync = rename; h.close() }
})
test("registration cleanup preserves a successor lock after explicit offline fault injection", () => {
  const h = isolated(), native = require("node:fs") as typeof fs, rename = native.renameSync
  let successor: number | undefined
  try {
    native.renameSync = (oldPath, newPath) => {
      if (newPath === h.path) { fs.unlinkSync(h.path + ".lock"); successor = fs.openSync(h.path + ".lock", "wx", 0o600) }
      rename(oldPath, newPath)
    }
    registerEnterpriseInstance("profile", "subject")
    assert.equal(fs.existsSync(h.path + ".lock"), true)
    assert.throws(() => registerEnterpriseInstance("profile", "subject"), /INSTANCE_BUSY/)
  } finally { native.renameSync = rename; if (successor !== undefined) fs.closeSync(successor); h.close() }
})
test("invalid stored instance remains fail-closed and is never overwritten", () => {
  const h = isolated()
  try {
    fs.writeFileSync(h.path, JSON.stringify({ version: 1, instance_id: "old", profile_id: "profile" }))
    const bytes = fs.readFileSync(h.path)
    assert.throws(() => registerEnterpriseInstance("profile", "subject"), /INSTANCE_UNREGISTERED/)
    assert.deepEqual(fs.readFileSync(h.path), bytes); assert.equal(fs.existsSync(h.path + ".lock"), false)
  } finally { h.close() }
})
