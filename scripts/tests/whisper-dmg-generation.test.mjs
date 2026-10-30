// Run the real DMG whisper preflight block against owned staged fixtures.
// Native signing, mounting, Finder and the application are never executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seal, publish, stage } from '../whisper-generation.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(repo, 'scripts/create-dmg.sh'), 'utf8');
const start = source.indexOf('# Standalone DMG creation may be pointed at old staging.');
const end = source.indexOf('\nif [ ! -d "${ICONSET}" ]', start);
assert.ok(start >= 0 && end > start, 'actual DMG preflight block exists');
const block = source.slice(start, end);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-dmg-gen-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dist = path.join(root, 'companion/dist'), store = path.join(dist, '.whisper-generations');
  const gen = path.join(store, 'one'), current = path.join(dist, 'whisper-current-darwin-arm64');
  const staging = path.join(root, 'staging'), scripts = path.join(root, 'scripts'), commands = path.join(root, 'commands');
  for (const dir of [path.join(gen, 'bin'), path.join(gen, 'lib'), path.join(staging, 'bin'), path.join(staging, 'lib'), scripts, commands]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(gen, 'bin/cmspark-whisper-darwin-arm64'), 'bin');
  fs.writeFileSync(path.join(gen, 'lib/libwhisper.1.dylib'), 'whisper');
  fs.writeFileSync(path.join(gen, 'lib/libggml.1.dylib'), 'ggml');
  for (const name of ['whisper-generation.mjs', 'verify-macos-whisper-closure.mjs']) fs.copyFileSync(path.join(repo, 'scripts', name), path.join(scripts, name));
  fs.writeFileSync(path.join(dist, 'cmspark-agent.js'), 'same-bundle'); fs.writeFileSync(path.join(staging, 'cmspark-agent.js'), 'same-bundle');
  fs.writeFileSync(path.join(commands, 'otool'), '#!/bin/bash\nprintf "%s:\\n\\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\\n" "$2"\n', { mode: 0o700 });
  fs.writeFileSync(path.join(commands, 'node'), '#!/bin/bash\nif [[ "$1" == scripts/run-esbuild-bundle.mjs ]]; then printf "%s\\n" "$TEST_PIN"; exit "${PROOF_RC:-0}"; fi\nexec "$NODE_BINARY" "$@"\n', { mode: 0o700 });
  const runner = path.join(root, 'runner'); fs.writeFileSync(runner, 'set -euo pipefail\n' + block);
  const pin = crypto.createHash('sha256').update('bin').digest('hex');
  const run = (expected = pin, proofRc = 0) => spawnSync('/bin/bash', [runner], { cwd: root, env: {
    ...process.env, PATH: commands + ':' + path.dirname(process.execPath) + ':/usr/bin:/bin', NODE_BINARY: process.execPath,
    ROOT_DIR: root, STAGING: staging, TEST_PIN: expected, PROOF_RC: String(proofRc),
  }, encoding: 'utf8' });
  const ready = () => { seal(gen, 'darwin-arm64'); publish(gen, store, current, 'darwin-arm64'); stage(store, current, 'darwin-arm64', staging, pin); };
  return { root, gen, current, staging, pin, run, ready };
}

test('DMG preflight accepts a matching sealed staged generation', t => { const f = fixture(t); f.ready(); const r = f.run(); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Verified 1 staged whisper Mach-O objects/); });
test('DMG preflight refuses a modified staged library', t => { const f = fixture(t); f.ready(); fs.writeFileSync(path.join(f.staging, 'lib/libggml.1.dylib'), 'changed'); const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /WHISPER_GENERATION_STAGED_MISMATCH/); });
test('DMG preflight refuses a different bundle', t => { const f = fixture(t); f.ready(); fs.writeFileSync(path.join(f.staging, 'cmspark-agent.js'), 'stale'); const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /staged agent differs/); });
test('DMG preflight refuses a missing current pointer', t => { const f = fixture(t); f.ready(); fs.unlinkSync(f.current); const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /WHISPER_GENERATION_FAILED/); });
test('DMG preflight refuses a missing staged binary when a generation exists', t => { const f = fixture(t); f.ready(); fs.unlinkSync(path.join(f.staging, 'bin/cmspark-whisper-darwin-arm64')); const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /WHISPER_GENERATION_FAILED/); });
test('DMG preflight permits an intentionally absent optional helper', t => { const f = fixture(t); const r = f.run(); assert.equal(r.status, 0, r.stderr); });
test('DMG preflight stops when the bundle proof fails', t => { const f = fixture(t); f.ready(); const r = f.run(f.pin, 23); assert.notEqual(r.status, 0); assert.match(r.stderr, /cannot verify the bundled whisper pin/); });
const signedStart = source.indexOf('if [ -n "${_WHISPER_PIN}" ]; then', source.indexOf('# Deep signing must not change the pair'));
const signedEnd = source.indexOf('\n\n# --- Step 4: Create DMG ---', signedStart);
const volumeStart = source.indexOf('if [ -n "${_WHISPER_PIN}" ]; then', source.indexOf('# Fail-closed: the copied bundle'));
const volumeEnd = source.indexOf('\n\n# Set Finder window layout', volumeStart);
assert.ok(signedStart >= 0 && signedEnd > signedStart && volumeStart >= 0 && volumeEnd > volumeStart);
function runPost(f, kind, resources) {
  const runner = path.join(f.root, 'post-' + kind);
  fs.writeFileSync(runner, 'set -euo pipefail\n' + source.slice(kind === 'signed' ? signedStart : volumeStart, kind === 'signed' ? signedEnd : volumeEnd));
  const commands = path.join(f.root, 'commands');
  fs.writeFileSync(path.join(commands, 'hdiutil'), '#!/bin/bash\nprintf detach > "$DETACH_LOG"\n', { mode: 0o700 });
  return spawnSync('/bin/bash', [runner], { cwd: f.root, env: {
    ...process.env, PATH: commands + ':' + path.dirname(process.execPath) + ':/usr/bin:/bin', NODE_BINARY: process.execPath,
    ROOT_DIR: f.root, RESOURCES: resources, VOLUME: path.join(f.root, 'volume'), DEVICE: 'owned-device', DETACH_LOG: path.join(f.root, 'detach-log'),
    _WHISPER_PIN: f.pin, _WHISPER_STORE: path.join(f.root, 'companion/dist/.whisper-generations'), _WHISPER_CURRENT: f.current,
  }, encoding: 'utf8' });
}
test('actual post-sign guard rejects a changed library in the copied resources', t => {
  const f = fixture(t); f.ready(); const resources = path.join(f.root, 'resources'); fs.cpSync(f.staging, resources, { recursive: true });
  fs.writeFileSync(path.join(resources, 'lib/libwhisper.1.dylib'), 'changed'); const r = runPost(f, 'signed', resources);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /WHISPER_GENERATION_STAGED_MISMATCH/);
});
test('actual DMG-volume guard rejects a changed copied library and detaches the owned fixture', t => {
  const f = fixture(t); f.ready(); const resources = path.join(f.root, 'volume/CMspark.app/Contents/Resources'); fs.mkdirSync(path.dirname(resources), { recursive: true }); fs.cpSync(f.staging, resources, { recursive: true });
  fs.writeFileSync(path.join(resources, 'lib/libggml.1.dylib'), 'changed'); const r = runPost(f, 'volume', resources);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /DMG whisper copy differs/); assert.equal(fs.readFileSync(path.join(f.root, 'detach-log'), 'utf8'), 'detach');
});
for (const kind of ['signed', 'volume']) test(`actual ${kind} guard accepts an unchanged copied generation`, t => {
  const f = fixture(t); f.ready();
  const resources = kind === 'signed' ? path.join(f.root, 'resources') : path.join(f.root, 'volume/CMspark.app/Contents/Resources');
  fs.mkdirSync(path.dirname(resources), { recursive: true }); fs.cpSync(f.staging, resources, { recursive: true });
  const r = runPost(f, kind, resources); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Verified 1 staged whisper Mach-O objects/);
  assert.equal(fs.existsSync(path.join(f.root, 'detach-log')), false);
});
