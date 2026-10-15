import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { capture, childEnvironment } from '../windows-census.mjs'

const root = fs.realpathSync(path.resolve(import.meta.dirname, '../..'))
const owned = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-census-cli-')))
fs.chmodSync(owned, 0o700)
const raw = path.join(owned, 'raw'); fs.mkdirSync(raw, { mode: 0o700 })
// Even on hosted Windows this negative must not start a real census or read a key.
const env = { ...childEnvironment(process.env, owned, raw), GITHUB_ACTIONS: 'false' }
test.after(() => console.log('CENSUS_CLI_CONTROL_RETAINED ' + owned))
for (const name of ['windows-census', 'recover-windows-census']) {
  test(`${name} actual symlink CLI entry/no-args is a refusal, never silent exit0`, async () => {
    const source = path.join(root, 'scripts', name + '.mjs'), alias = path.join(owned, name + '-alias.mjs')
    fs.symlinkSync(source, alias, 'file')
    const direct = await capture(process.execPath, [source], { cwd: owned, env, raw, name: name + '-direct' })
    assert.equal(direct.code, 1)
    const aliased = await capture(process.execPath, [alias], { cwd: owned, env, raw, name: name + '-alias' })
    fs.writeFileSync(path.join(owned, name + '-proof.json'), JSON.stringify({ direct, aliased }, null, 2))
    assert.equal(aliased.code, 1)
    assert.equal(fs.readFileSync(path.join(raw, name + '-alias.stdout'), 'utf8'), '')
    assert.match(fs.readFileSync(path.join(raw, name + '-alias.stderr'), 'utf8'), /^CENSUS_[A-Z_]+\r?\n$/)
  })
}
test('both CLI modules remain inert when imported, including a missing non-file argv1', async () => {
  const entry = 'await import(' + JSON.stringify(pathToFileURL(path.join(root, 'scripts/windows-census.mjs')).href) + ');await import(' + JSON.stringify(pathToFileURL(path.join(root, 'scripts/recover-windows-census.mjs')).href) + ');console.log("OWNED_IMPORT_ONLY");'
  const r = await capture(process.execPath, ['--input-type=module', '-e', entry, 'OWNED_NONEXISTENT_ARGV'], { cwd: owned, env, raw, name: 'import-only' })
  assert.equal(r.code, 0)
  assert.equal(fs.readFileSync(path.join(raw, 'import-only.stdout'), 'utf8').trim(), 'OWNED_IMPORT_ONLY')
  assert.equal(fs.readFileSync(path.join(raw, 'import-only.stderr'), 'utf8'), '')
})
