// Focused composition fixture: real Office stager, real filesystem stager and
// real Node module resolution. The engine files and package bodies are inert
// owned inputs, not an authenticated Office build or native execution.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { stageOfficeRuntime } from '../../stage-office-runtime.mjs'

// Real stager + real owned filesystem; no mocked path or filesystem answers.
// Failed fixture roots are retained, including the original source mutation.
export function destinationAdmissionControl(stageFilesystemRuntime) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-destination-admission-')))
  const source = path.join(root, 'source'), alias = path.join(root, 'source-alias')
  const entry = path.join(source, 'node_modules/@modelcontextprotocol/server-filesystem')
  const snapshot = () => {
    const rows = []
    const visit = directory => {
      for (const name of fs.readdirSync(directory).sort()) {
        const file = path.join(directory, name), st = fs.lstatSync(file)
        assert.equal(st.isSymbolicLink(), false, 'controlled source has no links')
        rows.push({ path: path.relative(source, file), mode: st.mode, mtimeMs: st.mtimeMs,
          sha256: st.isFile() ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null })
        if (st.isDirectory()) visit(file)
      }
    }
    visit(source)
    return rows
  }
  try {
    fs.mkdirSync(path.join(entry, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(entry, 'package.json'), JSON.stringify({ name: '@modelcontextprotocol/server-filesystem', version: '1.0.0' }))
    fs.writeFileSync(path.join(entry, 'dist/index.js'), '// inert entry, not executed\n')
    fs.symlinkSync(source, alias, 'junction')
    const before = snapshot()
    for (const destination of [path.join(alias, 'newdir'), path.join(alias, 'deep/leaf'), alias, path.join(source, 'direct'), root]) {
      assert.throws(() => stageFilesystemRuntime({ source, destination }), /overlap/)
      assert.deepEqual(snapshot(), before, 'overlap refusal must not write source')
    }
    assert.equal(fs.existsSync(path.join(source, 'newdir')), false)
    assert.equal(fs.existsSync(path.join(source, 'deep')), false)
    const normal = path.join(root, 'normal/missing/staged')
    const positive = stageFilesystemRuntime({ source, destination: normal })
    assert.equal(fs.readFileSync(path.join(normal, positive.entry), 'utf8'), '// inert entry, not executed\n')
    assert.deepEqual(snapshot(), before)
    const outside = path.join(root, 'outside'), outsideAlias = path.join(root, 'outside-alias')
    fs.mkdirSync(outside); fs.symlinkSync(outside, outsideAlias, 'junction')
    const allowed = path.join(outsideAlias, 'new/staged')
    const aliased = stageFilesystemRuntime({ source, destination: allowed })
    assert.equal(fs.readFileSync(path.join(outside, 'new/staged', aliased.entry), 'utf8'), '// inert entry, not executed\n')
    assert.deepEqual(snapshot(), before)
    fs.rmSync(root, { recursive: true })
    return { overlapRefusals: 5, missingDestinationSuccesses: 2, sourceUnchanged: true }
  } catch (error) {
    error.message += `; owned evidence retained at ${root}`
    throw error
  }
}

export function existingPayloadControl(stageFilesystemRuntime) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-staging-composition-'))
  const source = path.join(root, 'source'), destination = path.join(root, 'staged')
  const ENTRY = '@deepseek-ai/libreoffice-kit', ENGINE = '@deepseek-ai/libreoffice-kit-wasm'
  const FS_ENTRY = '@modelcontextprotocol/server-filesystem'
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'package.json'), '{}'); fs.writeFileSync(path.join(source, 'package-lock.json'), '{"packages":{}}')
  function pkg(name, metadata, files) {
    const directory = path.join(source, 'node_modules', name); fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: '0.1.5', ...metadata }))
    for (const [relative, body] of Object.entries(files)) { const file = path.join(directory, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body) }
    return directory
  }
  try {
    pkg(ENTRY, { main: 'lib/index.js', dependencies: { 'fast-deep-equal': '3.1.3' }, optionalDependencies: { [ENGINE]: '0.1.5' } }, {
      'lib/index.js': 'module.exports = () => require("fast-deep-equal")\n',
      'lib/worker.js': '// not executed\n', 'lib/font-snapshot-worker.js': '// not executed\n', LICENSE: 'owned fixture', NOTICE: 'owned fixture',
    })
    const engineFiles = { 'loader.js': '// not executed', 'engine.wasm': 'inert not WASM', 'engine.data': 'inert', 'metadata.json': '{}', 'sources/recipe.json': '{}', 'licenses/MPL.txt': 'owned fixture' }
    // Same public fixture schema used by the existing Office stager unit test.
    // Self-hashes only validate this inert test fixture; never a product trust root.
    const manifest = { schemaVersion: 1, version: '0.1.5', platform: 'wasm', status: 'built', engine: { kind: 'wasm', loader: 'loader.js', wasm: 'engine.wasm', data: 'engine.data', metadata: 'metadata.json' }, files: Object.fromEntries(Object.entries(engineFiles).map(([name, body]) => [name, createHash('sha256').update(body).digest('hex')])) }
    pkg(ENGINE, { os: ['linux'] }, { ...engineFiles, 'prebuilds.json': JSON.stringify(manifest) })
    const shared = pkg('fast-deep-equal', { version: '3.1.3', main: 'index.js' }, { 'index.js': 'module.exports = require("./node_modules/owned-private")\n', LICENSE: 'owned fixture' })
    pkg(FS_ENTRY, { dependencies: { 'fast-deep-equal': '3.1.3' } }, { 'dist/index.js': '// not executed\n' })
    const office = stageOfficeRuntime({ source, destination, platform: 'linux-x64' })
    assert.equal(office.packages.some(p => p.name === 'fast-deep-equal'), true)
    const outputShared = path.join(destination, 'node_modules/fast-deep-equal')
    // A separate prior staging owner's explicit nested input. This is not a
    // claim that today's locked fast-deep-equal package needs this child.
    const nested = path.join(outputShared, 'node_modules/owned-private')
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(nested, 'package.json'), '{"name":"owned-private","version":"1.0.0","main":"index.js"}')
    fs.writeFileSync(path.join(nested, 'index.js'), 'module.exports = "owned-prior-component-result"\n')
    const originalNested = fs.readFileSync(path.join(nested, 'index.js'))
    const require = createRequire(path.join(destination, 'package.json'))
    const readConsumer = () => {
      for (const file of Object.keys(require.cache)) if (file.startsWith(destination + path.sep)) delete require.cache[file]
      try { return require(ENTRY)() } catch (error) { return error.code }
    }
    assert.equal(readConsumer(), 'owned-prior-component-result')
    stageFilesystemRuntime({ source, destination })
    // Shared by the immutable R1 counter and current R2 test. R1 really deletes
    // the child's bytes; cache clearing makes the real consumer see the loss.
    assert.equal(readConsumer(), 'owned-prior-component-result', 'an earlier component nested dependency must survive staging')
    assert.deepEqual(fs.readFileSync(path.join(nested, 'index.js')), originalNested)

    const outputIndex = path.join(outputShared, 'index.js'), inputIndex = path.join(shared, 'index.js')
    const indexBytes = fs.readFileSync(inputIndex), indexMode = fs.statSync(inputIndex).mode & 0o777
    const assertConflict = mutate => {
      const undo = mutate()
      try {
        assert.throws(() => stageFilesystemRuntime({ source, destination }), /payload conflicts with source/)
        assert.deepEqual(fs.readFileSync(path.join(nested, 'index.js')), originalNested)
      } finally { undo() }
    }
    assertConflict(() => { fs.writeFileSync(outputIndex, 'different'); return () => fs.writeFileSync(outputIndex, indexBytes) })
    assertConflict(() => { const extra = path.join(outputShared, 'foreign.txt'); fs.writeFileSync(extra, 'owned extra'); return () => fs.unlinkSync(extra) })
    assertConflict(() => { const file = path.join(outputShared, 'LICENSE'); const bytes = fs.readFileSync(file), mode = fs.statSync(file).mode & 0o777; fs.unlinkSync(file); return () => { fs.writeFileSync(file, bytes); fs.chmodSync(file, mode) } })
    assertConflict(() => { fs.chmodSync(outputIndex, indexMode ^ 0o100); return () => fs.chmodSync(outputIndex, indexMode) })
    return { preserved: true, payloadConflictControls: 4 }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}
