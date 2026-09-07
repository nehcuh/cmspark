/** #457 source/data rehearsal only, never installs or launches the real app.
 * Run after nvm use 22: node scripts/rehearse-enterprise-roundtrip.mjs
 * Compiles current source and the pinned pre-upgrade 0.6.6 source in temp dirs,
 * then runs new -> old -> new in separate processes against synthetic data.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const baseline = "63b449d9ff77c2c37af54579fbff3b628df286c1"
assert.ok(Number(process.versions.node.split(".")[0]) >= 22, "Use nvm use 22 first")
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-roundtrip-"))
const baselineTree = path.join(workspace, "baseline")
const currentDist = path.join(workspace, "current-dist")
const currentTree = path.join(workspace, "current")
const data = path.join(workspace, "data")
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options })
try {
  fs.mkdirSync(baselineTree)
  const resolvedBaseline = run("git", ["rev-parse", baseline]).trim()
  const archive = run("git", ["archive", resolvedBaseline, "companion"], { encoding: "buffer" })
  const archivePath = path.join(workspace, "baseline.tar")
  fs.writeFileSync(archivePath, archive)
  run("tar", ["-xf", archivePath, "-C", baselineTree])
  const oldCompanion = path.join(baselineTree, "companion")
  assert.equal(JSON.parse(fs.readFileSync(path.join(oldCompanion, "package.json"), "utf8")).version, "0.6.6")
  fs.symlinkSync(path.join(root, "companion/node_modules"), path.join(oldCompanion, "node_modules"), process.platform === "win32" ? "junction" : "dir")
  // Freeze current inputs too; compilation never races subsequent repo edits.
  fs.mkdirSync(currentTree)
  fs.cpSync(path.join(root, "companion/src"), path.join(currentTree, "src"), { recursive: true })
  for (const file of ["tsconfig.json", "package.json"]) fs.copyFileSync(path.join(root, "companion", file), path.join(currentTree, file))
  const fixture = path.join(currentTree, "page-read-v1.json")
  fs.copyFileSync(path.join(root, "companion/tests/fixtures/page-read-v1.json"), fixture)
  const fixtureSha256 = createHash("sha256").update(fs.readFileSync(fixture)).digest("hex")
  const procedureSha256 = createHash("sha256").update(fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex")
  fs.symlinkSync(path.join(root, "companion/node_modules"), path.join(currentTree, "node_modules"), process.platform === "win32" ? "junction" : "dir")
  const sourceHash = createHash("sha256")
  const hashTree = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) hashTree(file)
      else if (entry.isFile()) sourceHash.update(path.relative(currentTree, file).split(path.sep).join("/") + "\0").update(fs.readFileSync(file)).update("\0")
    }
  }
  hashTree(path.join(currentTree, "src"))
  for (const file of ["tsconfig.json", "package.json"]) sourceHash.update(file + "\0").update(fs.readFileSync(path.join(currentTree, file))).update("\0")
  const candidateSourceSha256 = sourceHash.digest("hex")
  const tsc = path.join(root, "companion/node_modules/typescript/bin/tsc")
  run(process.execPath, [tsc, "-p", path.join(currentTree, "tsconfig.json"), "--outDir", currentDist])
  run(process.execPath, [tsc, "-p", path.join(oldCompanion, "tsconfig.json")])
  fs.symlinkSync(path.join(root, "companion/node_modules"), path.join(workspace, "node_modules"), process.platform === "win32" ? "junction" : "dir")
  const phaseFile = path.join(workspace, "phase.cjs")
  fs.writeFileSync(phaseFile, String.raw`
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const [phase, dist, data, fixturePath] = process.argv.slice(2)
assert.equal(process.env.CMSPARK_DATA_DIR, data)
assert.ok(path.basename(path.dirname(data)).startsWith('cmspark-roundtrip-'))
const load = rel => require(path.join(dist, rel))
const metaFile = path.join(data, 'rehearsal-private.json')
const evidenceDir = path.join(data, 'business-evidence-v1')
const scope = { kind: 'chat', threadId: 'synthetic-roundtrip' }
const createInput = { kind: 'change_material.v1', title: 'Synthetic', target: { environment: 'prod', business_system_id: 'SYS-1' }, request_id: 'create' }
;(async () => {
  await load('config.js').initDataDir()
  const grants = load('outbound-mcp/outbound-grants.js')
  if (phase === 'create') {
    const service = new (load('business-evidence/service.js').BusinessEvidenceService)(data, scope)
    const reply = service.create(createInput)
    const captured = service.store.capture('synthetic-read', 'get_page_text', JSON.parse(fs.readFileSync(fixturePath, 'utf8')))
    assert.equal(captured.capture_status, 'captured')
    const observation = service.store.read().observations[0]
    const excerpt = 'REL-1'; const offset = observation.content.indexOf(excerpt)
    assert.ok(offset >= 0, 'recorded fixture contains the selected release ID')
    const start = Array.from(observation.content.slice(0, offset)).length
    const update = { draft_id: reply.draft_id, expected_revision: 1, request_id: 'update', fields: { 'release.id': { value: excerpt, citations: [{ observation_id: observation.id, excerpt, start, end: start + Array.from(excerpt).length }] } } }
    const updated = service.update(update)
    const ordinary = grants.issueOutboundGrant({ caller_id: 'ordinary', label: 'synthetic' })
    const context = grants.issueOutboundGrant({ caller_id: 'context', label: 'synthetic', profile: 'outbound_context_v1', allow_context_export: true, context_origins: ['https://devops.example.test'], context_knowledge_ids: ['roundtrip-knowledge'] })
    const knowledge = '---\nname: roundtrip-knowledge\ntype: site_knowledge\nsite: devops.example.test\n---\nSynthetic selected knowledge\n'
    fs.writeFileSync(path.join(data, 'skills/roundtrip-knowledge.md'), knowledge, { mode: 0o600 })
    const files = fs.readdirSync(evidenceDir); assert.equal(files.length, 1)
    const file = files[0]
    const bytes = fs.readFileSync(path.join(evidenceDir, file), 'utf8')
    const future = JSON.parse(bytes); future.schema_version = 999
    const futureBytes = JSON.stringify(future)
    // Actual producer bytes with only the future-version discriminator changed.
    const futureScope = { kind: 'chat', threadId: 'synthetic-future' }
    const futureFile = load('business-evidence/content.js').evidenceScopeHash(futureScope) + '.json'
    fs.writeFileSync(path.join(evidenceDir, futureFile), futureBytes, { mode: 0o600 })
    fs.writeFileSync(metaFile, JSON.stringify({ reply, update, updated, ordinary, context, knowledge, file, bytes, futureFile, futureBytes }), { mode: 0o600 })
  } else {
    const m = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
    assert.equal(fs.readFileSync(path.join(evidenceDir, m.file), 'utf8'), m.bytes)
    assert.equal(fs.readFileSync(path.join(evidenceDir, m.futureFile), 'utf8'), m.futureBytes)
    assert.equal(fs.readFileSync(path.join(data, 'skills/roundtrip-knowledge.md'), 'utf8'), m.knowledge)
    assert.equal(grants.verifyOutboundGrantToken(m.ordinary.token, 'ordinary').ok, true)
    if (phase === 'old') {
      assert.equal(fs.existsSync(path.join(dist, 'business-evidence')), false, 'baseline has no draft/evidence module; only old initialization leaves this new directory alone')
      assert.equal(grants.verifyOutboundGrantToken(m.context.token, 'context').ok, false)
      // Exercise the old grant writer, not just its parser.
      const grantFile = path.join(data, 'outbound-grants.json')
      const beforeBytes = fs.readFileSync(grantFile, 'utf8')
      const beforeContext = JSON.parse(beforeBytes).grants.find(row => row.id === m.context.id)
      assert.ok(beforeContext, 'context record exists before exercising old writer')
      m.old_writer = grants.issueOutboundGrant({ caller_id: 'old-writer', label: 'synthetic-old' })
      const afterBytes = fs.readFileSync(grantFile, 'utf8')
      assert.notEqual(afterBytes, beforeBytes, 'old writer really persisted a change')
      const rows = JSON.parse(afterBytes).grants
      assert.ok(rows.some(row => row.id === m.old_writer.id))
      assert.deepEqual(rows.find(row => row.id === m.context.id), beforeContext, 'raw context fields survive old writer, without new-reader defaults')
      assert.equal(grants.verifyOutboundGrantToken(m.old_writer.token, 'old-writer').ok, true)
      fs.writeFileSync(metaFile, JSON.stringify(m), { mode: 0o600 })
    } else {
      assert.equal(grants.verifyOutboundGrantToken(m.old_writer.token, 'old-writer').ok, true, 'current code reads the actual old-writer record')
      assert.equal(grants.verifyOutboundGrantToken(m.context.token, 'context').ok, true)
      const context = grants.lookupContextGrant(m.context.id)
      assert.equal(context.allow_context_export, true)
      assert.deepEqual(context.context_knowledge_ids, ['roundtrip-knowledge'])
      assert.deepEqual(context.context_origins, ['https://devops.example.test'])
      const service = new (load('business-evidence/service.js').BusinessEvidenceService)(data, scope)
      assert.deepEqual(service.create(createInput), m.reply)
      assert.deepEqual(service.update(m.update), m.updated)
      const view = service.read({ draft_id: m.reply.draft_id })
      assert.equal(view.draft.revision, 2)
      assert.equal(view.draft.fields['release.id'].citations[0].observation_id, service.store.read().observations[0].id)
      assert.equal(view.ready, false, 'synthetic unconfigured draft must never become ready')
      const future = new (load('business-evidence/store.js').EvidenceStore)(data, { kind: 'chat', threadId: 'synthetic-future' })
      assert.throws(() => future.read(), /EVIDENCE_SCHEMA_UNSUPPORTED/)
      assert.equal(fs.readFileSync(path.join(evidenceDir, m.futureFile), 'utf8'), m.futureBytes)
    }
  }
  process.stdout.write('phase-complete:' + phase + '\n')
})().catch(error => { console.error(error); process.exitCode = 1 })
`)
  // Minimal environment: no model credentials or production data directory.
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TMPDIR: workspace, TEMP: workspace, TMP: workspace, CMSPARK_DATA_DIR: data }
  const verifiedPhases = []
  for (const [phase, dist] of [["create", currentDist], ["old", path.join(oldCompanion, "dist")], ["verify", currentDist]]) {
    const output = run(process.execPath, [phaseFile, phase, dist, data, fixture], { env, cwd: workspace })
    assert.ok(output.trimEnd().endsWith(`phase-complete:${phase}`), `phase ${phase} completed all assertions`)
    verifiedPhases.push(phase)
  }
  console.log(JSON.stringify({ result: "PASS", kind: "synthetic-source-data-roundtrip", baseline: resolvedBaseline,
    candidate_head: run("git", ["rev-parse", "HEAD"]).trim(), candidate_uses_working_tree: true, candidate_companion_source_sha256: candidateSourceSha256,
    source_hash_covers: ["companion/src", "companion/tsconfig.json", "companion/package.json"], verified_phases: verifiedPhases,
    fixture_sha256: fixtureSha256, procedure_sha256: procedureSha256, node: process.version, platform: process.platform,
    dependencies: "Both source snapshots use current companion/node_modules; historical lockfile/dependency fidelity is not rehearsed",
    isolation: "Temporary cwd and application data root with minimal environment; not an OS filesystem sandbox, os.homedir is not intercepted",
    verified: ["new producer citations and draft revisions survive old initialization", "idempotent replay in restarted current code", "raw new permission fields survive a proven old grant write and new code verifies old-written token", "old version denies new context profile", "selected knowledge bytes preserved", "unknown evidence schema left untouched by old initialization and refused by current code"],
    not_verified: ["real enterprise scenarios", "installed app or installer", "browser/Companion mixed versions", "other operating systems", "production model", "historical dependency versions", "old evidence reader (does not exist in baseline)", "OS filesystem sandbox"],
  }, null, 2))
} finally { fs.rmSync(workspace, { recursive: true, force: true }) }
