// Temporary, post-failure snapshot only. Never exports captured log text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const CAP = 262144;
const unknown = () => ({status: 'UNKNOWN', operations: [], gaps: []});
const enums = ['WAIT_IDLE', 'WAIT_EXISTENCE', 'SNAPSHOT', 'QUERY', 'CLICK', 'KEY', 'HIT_TEST', 'OTHER'];
export function projectTrace(text) {
  const operations = [], gaps = [];
  let previous;
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
    const time = Number(match[1]), bucket = Math.min(240, Math.floor(time * 4));
    if (previous && time < previous.time) return unknown();
    if (previous) gaps.push({delta: time - previous.time, row: [previous.operation, operation, previous.bucket, bucket]});
    previous = {time, bucket, operation};
    operations.push([operation, bucket]);
  }
  return operations.length ? {status: 'OBSERVED', operations: operations.slice(-4), gaps: gaps.sort((a, b) => b.delta - a.delta).slice(0, 2).map(g => g.row)} : unknown();
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
const emptyProjection = () => ({schema: 1, snapshotOnly: true, parentClose: 'UNKNOWN', intervals: 'TRACE_ADJACENCY', stdout: unknown(), stderr: unknown()});
export function collectScene(scene) {
  const result = emptyProjection(), parent = path.dirname(scene);
  if (!/^native-workspace-476-[A-Za-z0-9]{6}$/.test(path.basename(parent)) || !/^cmspark-workspace-ui-705-[a-f0-9]{64}$/.test(path.basename(scene))) return result;
  result.stdout = snapshot(parent, scene, 'xcode.stdout');
  result.stderr = snapshot(parent, scene, 'xcode.stderr');
  return result;
}
export function collect(base = os.tmpdir()) {
  const result = emptyProjection();
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
    return collectScene(scenes[0].scene);
  } catch { return {...result, stdout: unknown(), stderr: unknown()}; }
  return result;
}
export function validProjection(value) {
  const keys = (o, names) => o !== null && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join(',') === [...names].sort().join(',');
  const bucket = n => Number.isInteger(n) && n >= 0 && n <= 240;
  const stream = s => keys(s, ['status', 'operations', 'gaps']) && ['UNKNOWN', 'OBSERVED'].includes(s.status)
    && Array.isArray(s.operations) && s.operations.length <= 4 && s.operations.every(r => Array.isArray(r) && r.length === 2 && enums.includes(r[0]) && bucket(r[1]))
    && Array.isArray(s.gaps) && s.gaps.length <= 2 && s.gaps.every(r => Array.isArray(r) && r.length === 4 && enums.includes(r[0]) && enums.includes(r[1]) && bucket(r[2]) && bucket(r[3]) && r[3] >= r[2])
    && (s.status === 'OBSERVED' ? s.operations.length > 0 : s.operations.length === 0 && s.gaps.length === 0);
  return keys(value, ['schema', 'snapshotOnly', 'parentClose', 'intervals', 'stdout', 'stderr']) && value.schema === 1 && value.snapshotOnly === true && value.parentClose === 'UNKNOWN' && value.intervals === 'TRACE_ADJACENCY' && stream(value.stdout) && stream(value.stderr);
}
function outputPath() { return path.join(process.env.RUNNER_TEMP, 'macos-native-trace.json'); }
function writeProjection(value) {
  if (!validProjection(value)) throw Error('DIAGNOSTIC_REFUSED');
  const output = JSON.stringify(value);
  if (Buffer.byteLength(output) > 1024) throw Error('DIAGNOSTIC_BOUND');
  fs.writeFileSync(outputPath(), output, {flag: 'wx', mode: 0o600});
}
export function saveSceneTrace(scene) {
  const base = fs.realpathSync(os.tmpdir());
  if (path.dirname(path.dirname(scene)) !== base || !/^cmspark-workspace-ui-705-[a-f0-9]{64}$/.test(path.basename(scene))) return;
  writeProjection(collectScene(scene));
}
// Preserve a valid hook snapshot when a later gate fails. Never upload arbitrary
// pre-existing content at the fixed output name.
export function preserveExisting(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd, {bigint: true});
    if (!before.isFile() || before.uid !== BigInt(process.getuid()) || before.nlink !== 1n || (before.mode & 0o7777n) !== 0o600n || before.size > 1024n) throw Error();
    const bytes = Buffer.alloc(1025), length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (BigInt(length) !== before.size || length > 1024 || !same(before, fs.fstatSync(fd, {bigint: true})) || !same(before, fs.lstatSync(file, {bigint: true}))) throw Error();
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, length)), value = JSON.parse(text);
    if (!validProjection(value) || text !== JSON.stringify(value) || !same(before, fs.fstatSync(fd, {bigint: true})) || !same(before, fs.lstatSync(file, {bigint: true}))) throw Error();
    return true;
  } catch (error) {
    if (fd === undefined && error?.code === 'ENOENT') return false;
    throw Error('DIAGNOSTIC_REFUSED');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { if (!preserveExisting(outputPath())) writeProjection(collect()); }
  catch { process.stderr.write('DIAGNOSTIC_REFUSED\n'); process.exitCode = 1; }
}
