import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const yaml = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
const step = yaml.split('      - name: Assert linux zip has ORT napi + qwen worker + systray2 binary\n')[1]
  ?.split('      - name: Assert Windows Setup.exe exists\n')[0];
assert.ok(step, 'exact Linux release step exists');
const run = step.split('        run: |\n')[1].split('\n').map(line => {
  assert.ok(line === '' || line.startsWith('          '), 'run indentation stays exact');
  return line.slice(10);
}).join('\n').replaceAll('${{ matrix.platform }}', 'linux-x64');
const expected = [
  'onnxruntime-node/bin/napi-v3/linux/x64/onnxruntime_binding.node',
  'onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime.so.1',
  'qwen-vl-worker.py',
  'systray2/traybin/tray_linux_release',
];
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
const grep = spawnSync('bash', ['-c', 'command -v grep'], { encoding: 'utf8' });
assert.equal(grep.status, 0);
const realGrep = grep.stdout.trim();
const producer = `
const fs = require('node:fs');
const rows = JSON.parse(process.env.LIST_ROWS);
fs.appendFileSync(process.env.PRODUCER_RECEIPT, 'START\\n');
try {
  for (const row of rows) fs.writeSync(1, row + '\\n');
  if (process.env.LARGE_TAIL === '1') {
    const chunk = 'inert-unrelated-entry'.repeat(4096) + '\\n';
    for (let i = 0; i < 128; i++) fs.writeSync(1, chunk);
  }
  if (process.env.LATE_TARGET) fs.writeSync(1, process.env.LATE_TARGET + '\\n');
  fs.appendFileSync(process.env.PRODUCER_RECEIPT, 'COMPLETE\\n');
  process.exitCode = Number(process.env.PRODUCER_STATUS || 0);
} catch (e) {
  if (e.code !== 'EPIPE') throw e;
  fs.appendFileSync(process.env.PRODUCER_RECEIPT, 'EPIPE\\n');
  process.exitCode = 74;
}
`;

function execute({ rows = expected, tail = false, late = '', status = 0, grepError = false, readError = false, negativeOnly = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-release-zip-test-'));
  const result = {};
  try {
    const bin = path.join(dir, 'bin');
    const scratch = path.join(dir, 'scratch');
    fs.mkdirSync(bin); fs.mkdirSync(scratch); fs.mkdirSync(path.join(dir, 'dist-package'));
    fs.writeFileSync(path.join(dir, 'dist-package/cmspark-test-linux-x64.zip'), 'inert fixture; not opened');
    fs.writeFileSync(path.join(dir, 'producer.cjs'), producer);
    fs.writeFileSync(path.join(bin, 'unzip'), `#!/usr/bin/env bash\nexec ${quote(process.execPath.replaceAll('\\', '/'))} ${quote(path.join(dir, 'producer.cjs').replaceAll('\\', '/'))}\n`, { mode: 0o700 });
    if (grepError) fs.writeFileSync(path.join(bin, 'grep'), `#!/usr/bin/env bash\nif [[ "$*" == *libonnxruntime_providers_* ]]; then exit 2; fi\nexec ${quote(realGrep)} "$@"\n`, { mode: 0o700 });
    if (readError) fs.writeFileSync(path.join(bin, 'grep'), `#!/usr/bin/env bash\nif [[ "$*" == *libonnxruntime_providers_* ]]; then rm -- "\${@: -1}"; fi\nexec ${quote(realGrep)} "$@"\n`, { mode: 0o700 });
    let script = run;
    if (negativeOnly) {
      // Exact producer/helper and negative conditional from YAML, with its required capture.
      const begin = run.indexOf('list_zip() {');
      const firstPositive = run.indexOf("grep -E 'onnxruntime-node/bin/napi-");
      const oldFirstPositive = run.indexOf('list_zip "${ZIP}" | grep -E');
      const positiveStart = oldFirstPositive >= 0 ? oldFirstPositive : firstPositive;
      const conditionalStart = run.indexOf('if ', positiveStart);
      const conditionalEnd = run.indexOf("grep -E 'qwen-vl-worker", conditionalStart);
      const oldEnd = run.indexOf('list_zip "${ZIP}" | grep -E \'qwen-vl-worker', conditionalStart);
      const end = oldEnd >= 0 ? oldEnd : conditionalEnd;
      assert.ok(begin >= 0 && positiveStart >= 0 && conditionalStart > positiveStart && end > conditionalStart);
      script = 'set -euo pipefail\nZIP=inert.zip\n' + run.slice(begin, positiveStart) + run.slice(conditionalStart, end) + '\necho NEGATIVE_CHECK_COMPLETE\n';
    }
    fs.writeFileSync(path.join(dir, 'actual-run.sh'), script);
    const env = {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: dir, TMPDIR: scratch,
      LIST_ROWS: JSON.stringify(rows), LARGE_TAIL: tail ? '1' : '0', LATE_TARGET: late,
      PRODUCER_STATUS: String(status), PRODUCER_RECEIPT: path.join(dir, 'producer.receipt'),
    };
    const child = spawnSync('bash', [path.join(dir, 'actual-run.sh')], { cwd: dir, env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    // Save child bytes and exit before asserting anything; failed roots are retained.
    fs.writeFileSync(path.join(dir, 'stdout'), child.stdout ?? '');
    fs.writeFileSync(path.join(dir, 'stderr'), child.stderr ?? '');
    fs.writeFileSync(path.join(dir, 'exit.json'), JSON.stringify({ status: child.status, signal: child.signal, error: child.error?.code ?? null }));
    result.child = child;
    result.receipt = fs.existsSync(env.PRODUCER_RECEIPT) ? fs.readFileSync(env.PRODUCER_RECEIPT, 'utf8') : '';
    result.scratch = fs.readdirSync(scratch);
    result.dir = dir;
    return result;
  } catch (error) {
    error.message += `; owned evidence retained at ${dir}`;
    throw error;
  }
}
function check(options, verify) {
  const r = execute(options);
  try { assert.ifError(r.child.error); assert.equal(r.child.signal, null); verify(r); }
  catch (error) { error.message += `; owned evidence retained at ${r.dir}`; throw error; }
  fs.rmSync(r.dir, { recursive: true });
}
const target = (arch, provider) => `onnxruntime-node/bin/napi-v3/linux/${arch}/libonnxruntime_providers_${provider}.so`;

test('real Linux YAML clean ZIP listing succeeds once and removes owned listing', () => {
  check({}, r => { assert.equal(r.child.status, 0); assert.match(r.child.stdout, /linux-x64 zip content assert OK/); assert.equal(r.receipt, 'START\nCOMPLETE\n'); assert.deepEqual(r.scratch, []); });
});
for (const [arch, provider] of [['x64', 'cuda'], ['arm64', 'tensorrt']]) {
  test(`real YAML rejects early ${arch}/${provider} despite a large trailing list`, () => {
    check({ rows: [...expected, target(arch, provider)], tail: true }, r => { assert.equal(r.child.status, 1); assert.match(r.child.stderr, /optional CUDA\/TensorRT/); assert.equal(r.receipt, 'START\nCOMPLETE\n'); assert.deepEqual(r.scratch, []); });
  });
}
test('real YAML rejects target after a large listing', () => {
  check({ tail: true, late: target('x64', 'tensorrt') }, r => { assert.equal(r.child.status, 1); assert.match(r.child.stderr, /optional CUDA\/TensorRT/); assert.equal(r.receipt, 'START\nCOMPLETE\n'); });
});
test('real YAML rejects list producer failure even after all required content', () => {
  check({ status: 23 }, r => { assert.equal(r.child.status, 1); assert.match(r.child.stderr, /could not list Linux package ZIP/); assert.doesNotMatch(r.child.stdout, /content assert OK/); assert.deepEqual(r.scratch, []); });
});
test('actual negative-check slice rejects list failure rather than calling it no match', () => {
  check({ status: 23, negativeOnly: true }, r => { assert.equal(r.child.status, 1); assert.match(r.child.stderr, /could not list Linux package ZIP/); assert.doesNotMatch(r.child.stdout, /NEGATIVE_CHECK_COMPLETE/); });
});
test('real YAML distinguishes grep error from no match', () => {
  check({ grepError: true }, r => { assert.equal(r.child.status, 1); assert.match(r.child.stderr, /could not inspect Linux package ZIP listing/); assert.doesNotMatch(r.child.stdout, /content assert OK/); });
});
test('actual grep read failure refuses instead of accepting no match', () => {
  check({ readError: true }, r => { assert.equal(r.child.status, 1); assert.match(r.child.stderr, /could not inspect Linux package ZIP listing/); assert.doesNotMatch(r.child.stdout, /content assert OK/); });
});
for (const missing of expected) {
  test(`original positive asset assertion still rejects missing ${missing}`, () => {
    check({ rows: expected.filter(row => row !== missing) }, r => { assert.equal(r.child.status, 1); assert.doesNotMatch(r.child.stdout, /content assert OK/); assert.deepEqual(r.scratch, []); });
  });
}
