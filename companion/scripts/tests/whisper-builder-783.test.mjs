import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Execute the whole production Bash producer. Only external commands are inert boundaries;
// these text fixtures are not Mach-O/signature/provenance or actual macOS evidence.
const source = fs.readFileSync(new URL('../build-cmspark-whisper.sh', import.meta.url));
const ompRule = fs.readFileSync(new URL('../../../scripts/whisper-omp-name.sh', import.meta.url));
const generationHelper = fs.readFileSync(new URL('../../../scripts/whisper-generation.mjs', import.meta.url));
const pinBefore = 'owned source pin sentinel; no production digest is updated\n';
const utilities = ['dirname', 'chmod', 'mkdir', 'ln', 'basename', 'wc', 'tr', 'realpath', 'mktemp'];
function fixture(t, fault = '', missing = '', platform = 'Darwin') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark (compatibility version backup) builder 783-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'commands'), companion = path.join(root, 'companion');
  fs.mkdirSync(bin); fs.mkdirSync(path.join(companion, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'scripts/whisper-omp-name.sh'), ompRule);
  fs.writeFileSync(path.join(root, 'scripts/whisper-generation.mjs'), generationHelper);
  fs.mkdirSync(path.join(companion, 'src/voice'), { recursive: true });
  const script = path.join(companion, 'scripts/build-cmspark-whisper.sh');
  fs.writeFileSync(script, source);
  const pin = path.join(companion, 'src/voice/whisper-binary-pins.ts'); fs.writeFileSync(pin, pinBefore);
  const input = path.join(root, 'input'), lib = path.join(input, 'lib');
  fs.mkdirSync(lib, { recursive: true });
  const primary = path.join(input, 'whisper-cli'); fs.writeFileSync(primary, 'inert primary text\n');
  const versioned = ['versioned-omp', 'foreign-omp', 'ambiguous-omp'].includes(fault);
  for (const name of ['libwhisper.1.2.dylib', 'libggml.0.1.dylib', ...(fault === 'missing-omp' ? [] : [versioned ? 'libomp.5.dylib' : 'libomp.dylib'])]) fs.writeFileSync(path.join(lib, name), 'inert library text\n');
  if (versioned) {
    if (fault === 'foreign-omp') fs.writeFileSync(path.join(root, 'foreign.dylib'), 'foreign');
    fs.symlinkSync(fault === 'foreign-omp' ? path.join(root, 'foreign.dylib') : 'libomp.5.dylib', path.join(lib, 'libomp.dylib'));
    if (fault === 'ambiguous-omp') fs.writeFileSync(path.join(lib, 'libomp.6.dylib'), 'other version');
  }
  if (fault === 'extra-omp') for (const name of ['libomptarget.dylib', 'libomp.5extra.dylib']) fs.writeFileSync(path.join(lib, name), 'unrelated');
  for (const name of utilities) {
    const target = ['/bin', '/usr/bin'].map(p => path.join(p, name)).find(p => fs.existsSync(p));
    assert.ok(target, `required ownedFS/Bash utility ${name}`);
    fs.symlinkSync(target, path.join(bin, name));
  }
  const writeCommand = (name, body) => {
    if (name !== missing) fs.writeFileSync(path.join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o700 });
  };
  const awk = ['/usr/bin/awk', '/bin/awk'].find(p => fs.existsSync(p)); assert.ok(awk);
  const cp = ['/bin/cp', '/usr/bin/cp'].find(p => fs.existsSync(p)); assert.ok(cp);
  const rm = ['/bin/rm', '/usr/bin/rm'].find(p => fs.existsSync(p)); assert.ok(rm);
  const find = ['/usr/bin/find', '/bin/find'].find(p => fs.existsSync(p)); assert.ok(find);
  const parseCount = path.join(root, 'parse-count'); fs.writeFileSync(parseCount, '0');
  writeCommand('awk', `if [[ "$1" == *'compatibility version'* ]]; then
  IFS= read -r count < "$PARSE_COUNT" || true
  count=$((count+1)); printf '%s\\n' "$count" > "$PARSE_COUNT"
  role=lib; [[ "$count" == 1 ]] && role=primary
  printf 'parse:%s\\n' "$role" >> "$TRACE"
  [[ "$FAULT" != "parse-$role" ]] || exit 43
fi
exec "$AWK_BINARY" "$@"`);
  writeCommand('cp', `for arg in "$@"; do
  case "$arg" in
    *libwhisper*.dylib) if [[ "$FAULT" == copy-whisper ]]; then printf 'fault:copy-whisper\\n' >> "$TRACE"; exit 44; fi ;;
    *libggml*.dylib) if [[ "$FAULT" == copy-ggml ]]; then printf 'fault:copy-ggml\\n' >> "$TRACE"; exit 44; fi ;;
    *libomp*.dylib) if [[ "$FAULT" == copy-omp ]]; then printf 'fault:copy-omp\\n' >> "$TRACE"; exit 44; fi ;;
  esac
done
exec "$CP_BINARY" "$@"`);
  writeCommand('rm', `if [[ "$FAULT" == cleanup-libs ]]; then printf 'fault:cleanup-libs\\n' >> "$TRACE"; exit 45; fi
exec "$RM_BINARY" "$@"`);
  writeCommand('find', `family=''
for arg in "$@"; do
  case "$arg" in
    'libwhisper*.dylib') family=whisper ;;
    'libggml*.dylib') family=ggml ;;
  esac
done
rc=0
"$FIND_BINARY" "$@" || rc=$?
if [[ -n "$family" ]]; then printf 'find:%s:%s\\n' "$family" "$rc" >> "$TRACE"; fi
exit "$rc"`);
  writeCommand('uname', `case "$1" in -s) printf '%s\\n' "$PLATFORM";; -m) printf '%s\\n' arm64;; *) exit 97;; esac`);
  writeCommand('brew', `[[ "$1" == --prefix && ( "$2" == whisper-cpp || "$2" == ggml || "$2" == libomp ) ]] || exit 97\nprintf '%s\\n' "$INPUT"`);
  writeCommand('otool', `[[ "$1" == -L ]] || exit 97\nrole=lib; [[ "$2" == *cmspark-whisper-darwin-arm64 ]] && role=primary\nprintf 'inspect:%s\\n' "$role" >> "$TRACE"\n[[ "$FAULT" != "inspect-$role" ]] || exit 41\nif [[ "$FAULT" == "wrong-heading-$role" ]]; then printf 'wrong-target:\\n\\t/owned/lib.dylib (compatibility version 1.0.0, current version 1.0.0)\\n'; exit 0; fi\nif [[ "$FAULT" == "architecture-$role" ]]; then printf '%s (architecture arm64):\\n\\t/owned/lib.dylib (compatibility version 1.0.0, current version 1.0.0)\\n' "$2"; exit 0; fi\nprintf '%s:\\n' "$2"\n[[ "$FAULT" != empty-dependencies ]] || exit 0\nif [[ "$FAULT" == "malformed-$role" ]]; then printf 'not an otool dependency\\n'; exit 0; fi\nif [[ "$FAULT" == "control-$role" ]]; then printf '\\t/owned/control\\rpath (compatibility version 1.0.0, current version 1.0.0)\\n'; exit 0; fi\nif [[ "$FAULT" == "internal-tab-$role" ]]; then printf '\\t/owned/control\\tpath (compatibility version 1.0.0, current version 1.0.0)\\n'; exit 0; fi\ncase "$FAULT" in\n  "prefix-cr-$role") printf '\\t\\r/owned/lib.dylib (compatibility version 1.0.0, current version 1.0.0)\\n'; exit 0 ;;\n  "prefix-vt-$role") printf '\\t\\v/owned/lib.dylib (compatibility version 1.0.0, current version 1.0.0)\\n'; exit 0 ;;\n  "prefix-ff-$role") printf '\\t\\f/owned/lib.dylib (compatibility version 1.0.0, current version 1.0.0)\\n'; exit 0 ;;\n  "prefix-tab-$role") printf '\\t\\t/owned/lib.dylib (compatibility version 1.0.0, current version 1.0.0)\\n'; exit 0 ;;\nesac\nif [[ "$FAULT" == "missing-newline-$role" ]]; then printf '\\t%s (compatibility version 1.0.0, current version 1.0.0)' "$INPUT/lib/libwhisper.1.2.dylib"; exit 0; fi\nsuffix=''; [[ "$FAULT" != weak-dependency ]] || suffix=', weak'\nprintf '\\t%s (compatibility version 1.0.0, current version 1.0.0%s)\\n' "$INPUT/lib/libwhisper.1.2.dylib" "$suffix"\nif [[ "$2" == *libggml.0.1.dylib ]]; then printf '\\t%s (compatibility version 1.0.0, current version 1.0.0)\\n' "$INPUT/lib/libomp.dylib"; fi\nif [[ "$FAULT" == "trailing-empty-$role" ]]; then printf '\\n'; fi`);
  writeCommand('install_name_tool', `case "$1" in -id) action=id;; -change) action=change;; *) exit 97;; esac\nprintf 'relocate:%s\\n' "$action" >> "$TRACE"\nif [[ "$action" == change ]]; then role=lib; [[ "$4" == *cmspark-whisper-darwin-arm64 ]] && role=primary; printf 'relocate-role:%s\\n' "$role" >> "$TRACE"; fi\nif [[ "$action" == change && "$2" != "$INPUT/lib/libwhisper.1.2.dylib" && "$2" != "$INPUT/lib/libomp.dylib" ]]; then exit 99; fi\n[[ "$FAULT" != "relocate-$action" ]] || exit 41`);
  writeCommand('codesign', `[[ "$1" == --force && "$2" == --sign && "$3" == - && "$#" == 4 ]] || exit 97\nrole=lib; [[ "$4" == *cmspark-whisper-darwin-arm64 ]] && role=primary\nprintf 'sign:%s\\n' "$role" >> "$TRACE"\n[[ "$FAULT" != "sign-$role" ]] || exit 41`);
  writeCommand('shasum', `printf 'hash\\n' >> "$TRACE"\nprintf '%064d  inert-output\\n' 0`);
  writeCommand('stat', `printf '1\\n'`);
  // The generation helper runs in Node; a separate sentinel catches an unexpected
  // --write-pins invocation without changing the source pin fixture.
  writeCommand('node', `if [[ "$1" == *whisper-generation.mjs ]]; then exec "$NODE_BINARY" "$@"; fi\nprintf 'write-pins\\n' >> "$TRACE"\nexit 79`);
  const trace = path.join(root, 'trace'); fs.writeFileSync(trace, '');
  const primaryOut = path.join(companion, 'dist/bin/cmspark-whisper-darwin-arm64');
  const env = { PATH: bin, TMPDIR: root, LANG: 'C', LC_ALL: 'C',
    CMSPARK_WHISPER_SRC: primary, INPUT: input, PRIMARY_OUT: primaryOut, TRACE: trace, FAULT: fault, PLATFORM: platform, AWK_BINARY: awk, CP_BINARY: cp, RM_BINARY: rm, FIND_BINARY: find, PARSE_COUNT: parseCount, NODE_BINARY: process.execPath };
  const run = args => {
    const r = spawnSync('/bin/bash', [script, ...args], { cwd: root, env, encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024 });
    assert.equal(r.error, undefined, 'owned Bash child completed naturally'); assert.equal(r.signal, null);
    return { ...r, trace: fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean) };
  };
  return { root, run, pin, primaryOut, env, generationLib: path.join(companion, 'dist/whisper-current-darwin-arm64/lib') };
}

test('783 actual Darwin builder orders required inspection relocation signing before its measured digest', t => {
  const f = fixture(t), r = f.run([]);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /SUCCESS:/);
  for (const event of ['inspect:primary', 'relocate:change', 'relocate:id', 'inspect:lib', 'sign:lib', 'sign:primary', 'hash']) assert.ok(r.trace.includes(event), event);
  assert.ok(r.trace.indexOf('inspect:primary') < r.trace.indexOf('relocate:change'));
  assert.ok(r.trace.indexOf('sign:lib') < r.trace.indexOf('sign:primary'));
  assert.ok(r.trace.indexOf('sign:primary') < r.trace.indexOf('hash'));
  assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
});
test('783 actual builder preserves a weak dependency in a path containing spaces', t => {
  const f = fixture(t, 'weak-dependency'), r = f.run([]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SUCCESS:/);
  assert.ok(r.trace.includes('relocate-role:primary'), 'primary dependency was relocated');
  assert.ok(r.trace.includes('relocate-role:lib'), 'library dependency was relocated');
  assert.ok(r.trace.includes('sign:primary'));
  assert.ok(r.trace.includes('hash'));
  assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
});
for (const fault of ['copy-whisper', 'copy-ggml']) {
  test(`783 ${fault} failure stops the actual builder before digest or pin update`, t => {
    const f = fixture(t, fault), r = f.run(['--write-pins']);
    assert.notEqual(r.status, 0);
    assert.ok(r.trace.includes(`fault:${fault}`), 'requested copy fault was actually reached');
    assert.ok(r.trace.some(event => new RegExp(`^find:${fault.slice(5)}:[1-9][0-9]*$`).test(event)), 'find reported the copy failure');
    assert.doesNotMatch(r.stdout, /SUCCESS:/);
    assert.equal(r.trace.includes('hash'), false); assert.equal(r.trace.includes('write-pins'), false);
    assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
  });
}
for (const fault of ['inspect-primary', 'relocate-change', 'relocate-id', 'inspect-lib', 'sign-lib', 'sign-primary', 'parse-primary', 'parse-lib']) {
  test(`783 required ${fault} failure stops the actual builder before hash success or pin update`, t => {
    const f = fixture(t, fault), r = f.run(['--write-pins']);
    assert.equal(r.status, fault.startsWith('parse-') ? 43 : 41, r.stderr); assert.doesNotMatch(r.stdout, /SUCCESS:/);
    assert.equal(r.trace.includes('hash'), false); assert.equal(r.trace.includes('write-pins'), false);
    assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
  });
}
for (const fault of ['wrong-heading-primary', 'architecture-primary', 'malformed-primary', 'malformed-lib', 'missing-newline-primary', 'missing-newline-lib', 'trailing-empty-primary', 'trailing-empty-lib', 'control-primary', 'control-lib', 'internal-tab-primary', 'internal-tab-lib']) {
  test(`783 ${fault} output refuses before signing the primary or updating a pin`, t => {
    const f = fixture(t, fault), r = f.run(['--write-pins']);
    assert.notEqual(r.status, 0); assert.doesNotMatch(r.stdout, /SUCCESS:/);
    if (fault === 'wrong-heading-primary' || fault === 'architecture-primary') {
      assert.ok(r.trace.includes('inspect:primary'), 'actual primary inspection was reached');
      assert.match(r.stderr, /invalid otool output/);
    }
    assert.equal(r.trace.includes('sign:primary'), false);
    assert.equal(r.trace.includes('hash'), false); assert.equal(r.trace.includes('write-pins'), false);
    assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
  });
}
for (const control of ['cr', 'vt', 'ff', 'tab']) for (const role of ['primary', 'lib']) {
  const fault = `prefix-${control}-${role}`;
  test(`783 ${fault} refuses ambiguous leading bytes before signing or pin update`, t => {
    const f = fixture(t, fault), r = f.run(['--write-pins']);
    assert.notEqual(r.status, 0); assert.doesNotMatch(r.stdout, /SUCCESS:/);
    assert.equal(r.trace.includes('sign:primary'), false);
    assert.equal(r.trace.includes('hash'), false); assert.equal(r.trace.includes('write-pins'), false);
    assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
  });
}
for (const tool of ['otool', 'install_name_tool', 'codesign', 'awk']) {
  test(`783 missing required ${tool} refuses the actual Darwin builder before output copy`, t => {
    const f = fixture(t, '', tool), r = f.run(['--write-pins']);
    assert.equal(r.status, 1, r.stderr); assert.match(r.stderr, new RegExp(`required macOS tool missing: ${tool}`));
    assert.equal(fs.existsSync(f.primaryOut), false); assert.deepEqual(r.trace, []);
    assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
  });
}

test('783 missing inspected dependency data refuses before signing or updating a pin', t => {
  const f = fixture(t, 'empty-dependencies'), r = f.run(['--write-pins']);
  assert.notEqual(r.status, 0); assert.doesNotMatch(r.stdout, /SUCCESS:/);
  assert.equal(r.trace.includes('relocate:change'), false);
  assert.equal(r.trace.includes('sign:primary'), false);
  assert.equal(r.trace.includes('hash'), false); assert.equal(r.trace.includes('write-pins'), false);
  assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
});

test('783 actual Darwin builder stages the required libomp runtime', t => {
  const f = fixture(t), r = f.run([]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(f.generationLib, 'libomp.dylib'), 'utf8'), 'inert library text\n');
  assert.ok(r.trace.includes('sign:lib'));
});
test('783 libomp copy failure stops before hash or pin update', t => {
  const f = fixture(t, 'copy-omp'), r = f.run(['--write-pins']);
  assert.notEqual(r.status, 0); assert.ok(r.trace.includes('fault:copy-omp'));
  assert.equal(r.trace.includes('hash'), false); assert.equal(r.trace.includes('write-pins'), false);
  assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
});
test('783 failed library cleanup stops before hash or pin update', t => {
  const f = fixture(t, 'cleanup-libs'), r = f.run(['--write-pins']);
  assert.notEqual(r.status, 0); assert.ok(r.trace.includes('fault:cleanup-libs'));
  assert.match(r.stderr, /failed to clear staged libraries/);
  assert.equal(r.trace.includes('hash'), false); assert.equal(r.trace.includes('write-pins'), false);
  assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
});
test('783 unresolved library stops before hash or pin update', t => {
  const f = fixture(t, 'missing-omp'), r = f.run(['--write-pins']);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /missing staged library dependency/);
  assert.equal(r.trace.includes('hash'), false); assert.equal(r.trace.includes('write-pins'), false);
  assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
});
test('783 versioned libomp retains a verified source alias', t => {
  const f = fixture(t, 'versioned-omp'), r = f.run([]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readlinkSync(path.join(f.generationLib, 'libomp.dylib')), 'libomp.5.dylib');
});
for (const fault of ['foreign-omp', 'ambiguous-omp']) {
  test(`783 ${fault} refuses an unverified libomp alias`, t => {
    const f = fixture(t, fault), r = f.run(['--write-pins']);
    assert.notEqual(r.status, 0); assert.equal(r.trace.includes('hash'), false);
    assert.equal(r.trace.includes('write-pins'), false); assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
  });
}
test('783 unrelated libomp-prefixed files are not staged', t => {
  const f = fixture(t, 'extra-omp'), r = f.run([]);
  assert.equal(r.status, 0, r.stderr);
  for (const name of ['libomptarget.dylib', 'libomp.5extra.dylib']) assert.equal(fs.existsSync(path.join(f.generationLib, name)), false);
});
test('783 shared libomp filename policy accepts only numeric sonames', () => {
  const rule = fileURLToPath(new URL('../../../scripts/whisper-omp-name.sh', import.meta.url));
  const script = '. "$1"; shift; for n do is_whisper_omp_name "$n" && printf "Y\\n" || printf "N\\n"; done';
  const r = spawnSync('/bin/sh', ['-c', script, 'sh', rule, 'libomp.dylib', 'libomp.22.1.8.dylib', 'libomptarget.dylib', 'libomp.5extra.dylib', 'libomp.5..1.dylib'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'Y\nY\nN\nN\nN\n');
});
test('783 Darwin builder refuses a symlinked dist before writing to its target', t => {
  const f = fixture(t), dist = path.join(f.root, 'companion/dist'), other = path.join(f.root, 'other-owned');
  fs.mkdirSync(other); fs.symlinkSync(other, dist);
  const r = f.run([]);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /generation directory is a symlink/);
  assert.deepEqual(fs.readdirSync(other), []); assert.equal(r.trace.includes('hash'), false);
});
test('783 Darwin builder refuses a symlinked generation store before writing to its target', t => {
  const f = fixture(t), dist = path.join(f.root, 'companion/dist'), other = path.join(f.root, 'other-owned');
  fs.mkdirSync(dist); fs.mkdirSync(other); fs.symlinkSync(other, path.join(dist, '.whisper-generations'));
  const r = f.run([]);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /generation directory is a symlink/);
  assert.deepEqual(fs.readdirSync(other), []); assert.equal(r.trace.includes('hash'), false);
});
test('783 failed pin write preserves the previously published generation', t => {
  const f = fixture(t), first = f.run([]), current = path.join(f.root, 'companion/dist/whisper-current-darwin-arm64');
  assert.equal(first.status, 0, first.stderr); const before = fs.readlinkSync(current);
  const second = f.run(['--write-pins']);
  assert.equal(second.status, 79); assert.equal(fs.readlinkSync(current), before);
  assert.doesNotMatch(second.stdout, /SUCCESS:/); assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
});
test('783 custom output retains its explicit path and does not publish a generation', t => {
  const f = fixture(t), output = path.join(f.root, 'custom', 'whisper'); f.env.CMSPARK_WHISPER_OUT = output;
  const r = f.run([]); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(output, 'utf8'), 'inert primary text\n');
  assert.equal(fs.readFileSync(path.join(f.root, 'companion/dist/lib/libomp.dylib'), 'utf8'), 'inert library text\n');
  assert.equal(fs.existsSync(path.join(f.root, 'companion/dist/whisper-current-darwin-arm64')), false);
});
test('783 help describes sealed macOS generations without shell comment markers', t => {
  const f = fixture(t), sed = ['/usr/bin/sed', '/bin/sed'].find(file => fs.existsSync(file));
  assert.ok(sed); fs.symlinkSync(sed, path.join(f.root, 'commands/sed'));
  const r = f.run(['--help']);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /sealed generation/);
  assert.match(r.stdout, /Node\.js 22 is required/); assert.doesNotMatch(r.stdout, /^#/m);
  assert.deepEqual(r.trace, []);
});
