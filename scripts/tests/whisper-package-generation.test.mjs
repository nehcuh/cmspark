// Exercise the real package.sh macOS whisper block with owned files and inert
// otool/build seams. This is not a signed package or native runtime test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seal, publish } from '../whisper-generation.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(repo, 'scripts/package.sh'), 'utf8');
const start = source.indexOf('    if [ -n "${_WHISPER_BIN}" ]; then', source.indexOf('# Path B: optional cmspark-whisper'));
const end = source.indexOf('    ;;\n  windows-*)', start);
assert.ok(start >= 0 && end > start, 'actual macOS package block exists');
const block = source.slice(start, end);

function fixture(t, withOmp = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-package-gen-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dist = path.join(root, 'companion/dist');
  const store = path.join(dist, '.whisper-generations');
  const gen = path.join(store, 'one');
  const current = path.join(dist, 'whisper-current-darwin-arm64');
  const out = path.join(root, 'out');
  const scripts = path.join(root, 'scripts');
  const commands = path.join(root, 'commands');
  for (const dir of [path.join(gen, 'bin'), path.join(gen, 'lib'), out, scripts, commands]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(gen, 'bin/cmspark-whisper-darwin-arm64'), 'bin');
  const libs = ['libwhisper.1.dylib', 'libggml.1.dylib', ...(withOmp ? ['libomp.dylib'] : [])];
  for (const name of libs) fs.writeFileSync(path.join(gen, 'lib', name), name);
  for (const name of ['whisper-generation.mjs', 'verify-macos-whisper-closure.mjs']) fs.copyFileSync(path.join(repo, 'scripts', name), path.join(scripts, name));
  fs.writeFileSync(path.join(commands, 'otool'), '#!/bin/bash\nprintf "%s:\\n\\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\\n" "$2"\n', { mode: 0o700 });
  fs.writeFileSync(path.join(commands, 'node'), '#!/bin/bash\nif [[ "$1" == scripts/run-esbuild-bundle.mjs ]]; then printf "%s\\n" "$TEST_PIN"; exit "${PROOF_RC:-0}"; fi\nexec "$NODE_BINARY" "$@"\n', { mode: 0o700 });
  const runner = path.join(root, 'runner');
  fs.writeFileSync(runner, 'set -euo pipefail\n' + block);
  const pin = crypto.createHash('sha256').update('bin').digest('hex');
  const run = (expected = pin, proofRc = 0, injected = {}) => spawnSync('/bin/bash', [runner], { cwd: root, env: {
    ...process.env, PATH: commands + ':' + path.dirname(process.execPath) + ':/usr/bin:/bin', NODE_BINARY: process.execPath,
    ...injected, ROOT_DIR: root, STAGING: out, PLATFORM: 'macos-arm64', _WHISPER_BIN: 'cmspark-whisper-darwin-arm64', TEST_PIN: expected, PROOF_RC: String(proofRc),
  }, encoding: 'utf8' });
  return { root, dist, store, gen, current, out, pin, run };
}
function ready(f) { seal(f.gen, 'darwin-arm64'); publish(f.gen, f.store, f.current, 'darwin-arm64'); }

test('real package block stages a sealed generation and retains the closure gate', t => {
  const f = fixture(t); ready(f); const r = f.run();
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Verified 1 staged whisper Mach-O objects/);
  assert.equal(fs.readFileSync(path.join(f.out, 'bin/cmspark-whisper-darwin-arm64'), 'utf8'), 'bin');
});
test('real package block rejects a different verified pin', t => {
  const f = fixture(t); ready(f); const r = f.run('0'.repeat(64));
  assert.notEqual(r.status, 0); assert.match(r.stderr, /WHISPER_GENERATION_PIN_MISMATCH/);
  assert.equal(fs.existsSync(path.join(f.out, 'bin/cmspark-whisper-darwin-arm64')), false);
});
test('real package block rejects a changed sealed library', t => {
  const f = fixture(t); ready(f); fs.writeFileSync(path.join(f.gen, 'lib/libggml.1.dylib'), 'changed');
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /WHISPER_GENERATION_MANIFEST_MISMATCH/);
});
test('legacy flat binary without a sealed generation is refused', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.dist, 'bin')); fs.writeFileSync(path.join(f.dist, 'bin/cmspark-whisper-darwin-arm64'), 'old');
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /legacy unsealed/);
});
test('no whisper artifact retains the optional disabled warning', t => {
  const f = fixture(t); const r = f.run(); assert.equal(r.status, 0, r.stderr); assert.match(r.stderr, /local STT disabled/);
});
test('failure to verify the bundle pin prevents staging', t => {
  const f = fixture(t); ready(f); const r = f.run(f.pin, 23);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /cannot verify the bundled whisper pin/);
  assert.equal(fs.existsSync(path.join(f.out, 'bin/cmspark-whisper-darwin-arm64')), false);
});
for (const name of ['libwhisper.1.dylib', 'libggml.1.dylib', 'libomp.dylib']) {
  test(`pre-existing ${name} is not overwritten`, t => {
    const f = fixture(t); ready(f); fs.mkdirSync(path.join(f.out, 'lib'), { recursive: true });
    const target = path.join(f.out, 'lib', name); fs.writeFileSync(target, 'keep'); const r = f.run();
    assert.notEqual(r.status, 0); assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
  });
}
test('a generation without OpenMP stages when its static graph needs no OpenMP', t => {
  const f = fixture(t, false); ready(f); const r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(f.out, 'lib/libomp.dylib')), false);
});

for (const name of ['libwhisper.1.dylib', 'libggml.1.dylib', 'libomp.dylib']) {
  test(`real package block rejects ${name} write failure`, t => {
    const f = fixture(t); ready(f);
    const target = path.join(fs.realpathSync(f.out), 'lib', name);
    const flag = path.join(f.root, 'fault-hit');
    const hook = path.join(f.root, 'inject.cjs');
    fs.writeFileSync(hook, `const fs = require('node:fs'); const write = fs.writeFileSync; fs.writeFileSync = function(p, ...args) { if (p === process.env.FAULT_TARGET) { write(process.env.FAULT_FLAG, 'hit'); const e = new Error('owned write failure'); e.code = 'EIO'; throw e; } return write.call(this, p, ...args); };`);
    const r = f.run(f.pin, 0, { NODE_OPTIONS: '--require=' + hook, FAULT_TARGET: target, FAULT_FLAG: flag });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /WHISPER_GENERATION_FAILED/);
    assert.equal(fs.readFileSync(flag, 'utf8'), 'hit');
    assert.equal(fs.existsSync(target), false);
  });
}
