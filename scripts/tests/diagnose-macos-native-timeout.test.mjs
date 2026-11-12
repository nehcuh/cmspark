// Synthetic grammar controls, not captured XCTest evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {collect, projectTrace} from '../diagnose-macos-native-timeout.mjs';
test('projection exports only closed tokens and source clock buckets', () => {
  const value = projectTrace('secret\n    t =    1.25s Click "PRIVATE-NAME"\n    t =    2.00s Wait for SECRET to idle\n    t =    3.00s Find PRIVATE-PATH\n    t =    4.00s Waiting 5.0s for SECRET to exist\n    t =    5.00s Requesting snapshot of SECRET\n    t =    6.00s Click unterminated-secret');
  assert.deepEqual(value, {status: 'OBSERVED', operations: [['WAIT_IDLE', 8], ['QUERY', 12], ['WAIT_EXISTENCE', 16], ['SNAPSHOT', 20]]});
  assert(!JSON.stringify(value).includes('SECRET'));
  assert.deepEqual(projectTrace('unrecognized\n'), {status: 'UNKNOWN', operations: []});
});
test('only one private scene with bounded regular logs is admitted', t => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trace-control-')));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const parent = path.join(base, 'native-workspace-476-ABC123'), scene = path.join(parent, 'cmspark-workspace-ui-705-' + 'a'.repeat(64));
  fs.mkdirSync(parent, {mode: 0o700}); fs.mkdirSync(scene, {mode: 0o700});
  const file = path.join(scene, 'xcode.stdout');
  fs.writeFileSync(file, '    t =    1.00s Click PRIVATE\n', {mode: 0o600});
  assert.equal(collect(base).stdout.status, 'OBSERVED');
  fs.chmodSync(file, 0o644); assert.equal(collect(base).stdout.status, 'UNKNOWN'); fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, Buffer.alloc(262145)); assert.equal(collect(base).stdout.status, 'UNKNOWN');
  fs.writeFileSync(file, Buffer.from([0xff, 0x0a])); assert.equal(collect(base).stdout.status, 'UNKNOWN');
  fs.unlinkSync(file); fs.symlinkSync('/etc/passwd', file); assert.equal(collect(base).stdout.status, 'UNKNOWN'); fs.unlinkSync(file);
  fs.writeFileSync(file, '    t =    1.00s Click PRIVATE\n', {mode: 0o600});
  fs.mkdirSync(path.join(parent, 'cmspark-workspace-ui-705-' + 'b'.repeat(64)), {mode: 0o700});
  assert.equal(collect(base).stdout.status, 'UNKNOWN');
  assert(Buffer.byteLength(JSON.stringify(collect(base))) <= 1024);
});
