#!/usr/bin/env node
// Real conversion from a relocated executable-relative sidecar. Missing assets fail.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { stageOfficeRuntime, verifyOfficeEngine, officeTarget } from './stage-office-runtime.mjs'
import { removeOfficeSmokeRuntime } from './office-smoke-cleanup.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const options = {}
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--source', '--platform', '--runtime', '--staged'].includes(process.argv[i]) || !process.argv[i + 1]) throw new Error('Invalid Office smoke arguments')
  options[process.argv[i].slice(2)] = process.argv[i + 1]
}
const source = path.resolve(options.source ?? path.join(root, 'companion'))
const platform = options.platform ?? `${({ darwin: 'macos', win32: 'windows', linux: 'linux' })[process.platform]}-${process.arch}`
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark office 611 测试 '))
try {
  let record
  if (options.staged) {
    const staged = path.resolve(options.staged)
    record = JSON.parse(fs.readFileSync(path.join(staged, 'office-runtime.json'), 'utf8'))
    const target = officeTarget(platform)
    if (record.platform !== platform || record.kitVersion !== '0.1.5' || record.engine !== target.engine) throw new Error('Staged Office target mismatch')
    for (const pkg of record.packages) {
      if (typeof pkg.path !== 'string' || !pkg.path.startsWith('node_modules/') || pkg.path.includes('..') || pkg.path.includes('\\')) throw new Error('Invalid staged Office package path')
      const output = path.join(temporary, pkg.path)
      fs.mkdirSync(path.dirname(output), {recursive:true})
      fs.cpSync(path.join(staged, pkg.path), output, {recursive:true,verbatimSymlinks:true})
    }
    const engine = record.packages.find(pkg => pkg.name === target.engine)
    if (!engine) throw new Error('Staged Office engine missing')
    verifyOfficeEngine(path.join(temporary, engine.path), target.engine, target)
  } else record = stageOfficeRuntime({ source, destination: temporary, platform })
  const runtime = path.join(temporary, process.platform === 'win32' ? 'node.exe' : 'node')
  fs.copyFileSync(path.resolve(options.runtime ?? process.execPath), runtime)
  if (process.platform !== 'win32') fs.chmodSync(runtime, 0o755)
  fs.copyFileSync(path.join(source, 'tests', 'fixtures', 'office-611', 'one-page.doc'), path.join(temporary, 'input.doc'))
  const probe = path.join(temporary, 'probe.cjs')
  fs.writeFileSync(probe, `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const directory = path.dirname(process.execPath);
const kit = createRequire(process.execPath)('@deepseek-ai/libreoffice-kit');
(async () => {
  assert.equal(kit.ENGINE_VERSION, '0.1.5');
  const converter = await kit.createConverter({timeoutMs:30000,maxInputBytes:10485760,maxOutputBytes:33554432,fontMetadataCacheDirectory:false});
  try {
    assert.equal(converter.backend, process.platform === 'linux' ? 'wasm' : 'native');
    await converter.convert({inputPath:path.join(directory,'input.doc'),outputPath:path.join(directory,'output.txt')});
    const text = fs.readFileSync(path.join(directory,'output.txt'),'utf8');
    assert.match(text, /Office preview/);
    assert.match(text, /中文文档/);
    console.log('Relocated Office sidecar: actual bilingual DOC conversion passed ('+converter.backend+')');
  } finally { await converter.dispose(); }
})().catch(error => {console.error(error);process.exitCode=1});
`)
  const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' }
  const result = spawnSync(runtime, [probe], { cwd: temporary, env, stdio: 'inherit', timeout: 90000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Relocated Office smoke failed: ${result.status ?? result.signal}`)
  console.log(`Verified ${record.engine} without source module resolution`)
} finally { removeOfficeSmokeRuntime(temporary) }
