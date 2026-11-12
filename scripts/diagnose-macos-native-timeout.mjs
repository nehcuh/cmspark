// Temporary, post-failure snapshot only. Never exports captured log text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const CAP = 262144;
const unknown = () => ({status: 'UNKNOWN', operations: []});
export function projectTrace(text) {
  const operations = [];
  for (const line of text.split('\n').slice(0, -1)) {
    const match = /^[ \t]*t = [ \t]*([0-9]{1,4}\.[0-9]{2})s[ \t]+([^\r\n]*)\r?$/.exec(line);
    if (!match) continue;
    const value = match[2];
    const operation = /^Wait for .* to idle$/.test(value) ? 'WAIT_IDLE'
      : /^Waiting .* to exist$/.test(value) ? 'WAIT_EXISTENCE'
      : /^(?:Requesting snapshot|Get accessibility hierarchy)/.test(value) ? 'SNAPSHOT'
      : /^(?:Find |Checking existence|Get number of matches)/.test(value) ? 'QUERY'
      : /^(?:Click |Tap )/.test(value) ? 'CLICK'
      : /^(?:Type |Press )/.test(value) ? 'KEY'
      : /^(?:Hit test |Performing hit test)/.test(value) ? 'HIT_TEST' : 'OTHER';
    operations.push([operation, Math.min(240, Math.floor(Number(match[1]) * 4))]);
  }
  return operations.length ? {status: 'OBSERVED', operations: operations.slice(-4)} : unknown();
}
const same = (a, b) => ['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].every(k => a[k] === b[k]);
const privateDirectory = p => {
  const s = fs.lstatSync(p, {bigint: true});
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== BigInt(process.getuid()) || (s.mode & 0o7777n) !== 0o700n) throw Error();
  return s;
};
function snapshot(parent, scene, name) {
  let fd;
  try {
    const p = privateDirectory(parent), s = privateDirectory(scene), file = path.join(scene, name);
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd, {bigint: true});
    if (!before.isFile() || before.uid !== BigInt(process.getuid()) || before.nlink !== 1n || (before.mode & 0o7777n) !== 0o600n || before.size > BigInt(CAP)) return unknown();
    const bytes = Buffer.alloc(CAP + 1), length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (length > CAP || BigInt(length) !== before.size || !same(before, fs.fstatSync(fd, {bigint: true})) || !same(before, fs.lstatSync(file, {bigint: true}))) return unknown();
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, length));
    const result = projectTrace(text);
    if (!same(before, fs.fstatSync(fd, {bigint: true})) || !same(before, fs.lstatSync(file, {bigint: true})) || !same(p, privateDirectory(parent)) || !same(s, privateDirectory(scene))) return unknown();
    return result;
  } catch { return unknown(); }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}
export function collect(base = os.tmpdir()) {
  const result = {schema: 1, snapshotOnly: true, parentClose: 'UNKNOWN', stdout: unknown(), stderr: unknown()};
  try {
    const scenes = [];
    for (const name of fs.readdirSync(base).filter(n => /^native-workspace-476-[A-Za-z0-9]{6}$/.test(n))) {
      const parent = path.join(base, name);
      privateDirectory(parent);
      for (const child of fs.readdirSync(parent).filter(n => /^cmspark-workspace-ui-705-[a-f0-9]{64}$/.test(n))) {
        const scene = path.join(parent, child); privateDirectory(scene); scenes.push({parent, scene});
      }
    }
    if (scenes.length !== 1) return result;
    const {parent, scene} = scenes[0];
    result.stdout = snapshot(parent, scene, 'xcode.stdout');
    result.stderr = snapshot(parent, scene, 'xcode.stderr');
  } catch { return {...result, stdout: unknown(), stderr: unknown()}; }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = JSON.stringify(collect());
  if (Buffer.byteLength(output) > 1024) throw Error('DIAGNOSTIC_BOUND');
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'macos-native-trace.json'), output + '\n', {flag: 'wx', mode: 0o600});
}
