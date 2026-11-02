import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

test('825 direct config-writing vision tests refuse before touching an explicit sentinel config', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark825-isolation-'))
  const sentinel = JSON.stringify({ vision: { base_url: 'http://127.0.0.1:1/owned', model_name: 'owned-sentinel' } })
  fs.writeFileSync(path.join(directory, 'config.json'), sentinel, { mode: 0o600 })
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, CMSPARK_DATA_DIR: directory }
    delete env.CMSPARK_TEST_RUN_DIR
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', path.resolve('.test-dist/tests/vision-activity-822.test.js')], { env, encoding: 'utf8', timeout: 15_000, windowsHide: true })
    assert.equal(child.error, undefined)
    assert.notEqual(child.status, 0)
    assert.match(child.stdout + child.stderr, /requires the isolated test runner/)
    assert.equal(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'), sentinel)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
