import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Execute the whole production Bash producer. Only external commands are inert boundaries;
// these text fixtures are not Mach-O/signature/provenance or actual macOS evidence.
const source = fs.readFileSync(new URL('../build-cmspark-whisper.sh', import.meta.url));
const pinBefore = 'owned source pin sentinel; no production digest is updated\n';
const utilities = ['dirname', 'cp', 'chmod', 'mkdir', 'rm', 'find', 'ln', 'basename', 'wc', 'tr'];
function fixture(t, fault = '', missing = '', platform = 'Darwin') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark (compatibility version backup) builder 783-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'commands'), companion = path.join(root, 'companion');
  fs.mkdirSync(bin); fs.mkdirSync(path.join(companion, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(companion, 'src/voice'), { recursive: true });
  const script = path.join(companion, 'scripts/build-cmspark-whisper.sh');
  fs.writeFileSync(script, source);
  const pin = path.join(companion, 'src/voice/whisper-binary-pins.ts'); fs.writeFileSync(pin, pinBefore);
  const input = path.join(root, 'input'), lib = path.join(input, 'lib');
  fs.mkdirSync(lib, { recursive: true });
  const primary = path.join(input, 'whisper-cli'); fs.writeFileSync(primary, 'inert primary text\n');
  for (const name of ['libwhisper.1.2.dylib', 'libggml.0.1.dylib']) fs.writeFileSync(path.join(lib, name), 'inert library text\n');
  for (const name of utilities) {
    const target = ['/bin', '/usr/bin'].map(p => path.join(p, name)).find(p => fs.existsSync(p));
    assert.ok(target, `required ownedFS/Bash utility ${name}`);
    fs.symlinkSync(target, path.join(bin, name));
  }
  const writeCommand = (name, body) => {
    if (name !== missing) fs.writeFileSync(path.join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o700 });
  };
  const awk = ['/usr/bin/awk', '/bin/awk'].find(p => fs.existsSync(p)); assert.ok(awk);
  const parseCount = path.join(root, 'parse-count'); fs.writeFileSync(parseCount, '0');
  writeCommand('awk', `if [[ "$1" == *'compatibility version'* ]]; then
  IFS= read -r count < "$PARSE_COUNT" || true
  count=$((count+1)); printf '%s\\n' "$count" > "$PARSE_COUNT"
  role=lib; [[ "$count" == 1 ]] && role=primary
  printf 'parse:%s\\n' "$role" >> "$TRACE"
  [[ "$FAULT" != "parse-$role" ]] || exit 43
fi
exec "$AWK_BINARY" "$@"`);
  writeCommand('uname', `case "$1" in -s) printf '%s\\n' "$PLATFORM";; -m) printf '%s\\n' arm64;; *) exit 97;; esac`);
  writeCommand('brew', `[[ "$1" == --prefix && ( "$2" == whisper-cpp || "$2" == ggml ) ]] || exit 97\nprintf '%s\\n' "$INPUT"`);
  writeCommand('otool', `[[ "$1" == -L ]] || exit 97\nrole=lib; [[ "$2" == "$PRIMARY_OUT" ]] && role=primary\nprintf 'inspect:%s\\n' "$role" >> "$TRACE"\n[[ "$FAULT" != "inspect-$role" ]] || exit 41\nprintf '%s:\\n' "$2"\n[[ "$FAULT" != empty-dependencies ]] || exit 0\nif [[ "$FAULT" == "malformed-$role" ]]; then printf 'not an otool dependency\\n'; exit 0; fi\nif [[ "$FAULT" == "missing-newline-$role" ]]; then printf '\\t%s (compatibility version 1.0.0, current version 1.0.0)' "$INPUT/lib/libwhisper.1.2.dylib"; exit 0; fi\nprintf '\\t%s (compatibility version 1.0.0, current version 1.0.0)\\n' "$INPUT/lib/libwhisper.1.2.dylib"\nif [[ "$FAULT" == "trailing-empty-$role" ]]; then printf '\\n'; fi`);
  writeCommand('install_name_tool', `case "$1" in -id) action=id;; -change) action=change;; *) exit 97;; esac\nprintf 'relocate:%s\\n' "$action" >> "$TRACE"\nif [[ "$action" == change && "$2" != "$INPUT/lib/libwhisper.1.2.dylib" ]]; then exit 99; fi\n[[ "$FAULT" != "relocate-$action" ]] || exit 41`);
  writeCommand('codesign', `[[ "$1" == --force && "$2" == --sign && "$3" == - && "$#" == 4 ]] || exit 97\nrole=lib; [[ "$4" == "$PRIMARY_OUT" ]] && role=primary\nprintf 'sign:%s\\n' "$role" >> "$TRACE"\n[[ "$FAULT" != "sign-$role" ]] || exit 41`);
  writeCommand('shasum', `printf 'hash\\n' >> "$TRACE"\nprintf '%064d  inert-output\\n' 0`);
  writeCommand('stat', `printf '1\\n'`);
  // If a failure incorrectly falls through --write-pins this sentinel makes the call visible;
  // no real Node compiler/runtime is reachable from the Bash child's isolated PATH.
  writeCommand('node', `printf 'write-pins\\n' >> "$TRACE"\nexit 79`);
  const trace = path.join(root, 'trace'); fs.writeFileSync(trace, '');
  const primaryOut = path.join(companion, 'dist/bin/cmspark-whisper-darwin-arm64');
  const env = { PATH: bin, TMPDIR: root, LANG: 'C', LC_ALL: 'C',
    CMSPARK_WHISPER_SRC: primary, INPUT: input, PRIMARY_OUT: primaryOut, TRACE: trace, FAULT: fault, PLATFORM: platform, AWK_BINARY: awk, PARSE_COUNT: parseCount };
  const run = args => {
    const r = spawnSync('/bin/bash', [script, ...args], { cwd: root, env, encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024 });
    assert.equal(r.error, undefined, 'owned Bash child completed naturally'); assert.equal(r.signal, null);
    return { ...r, trace: fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean) };
  };
  return { root, run, pin, primaryOut };
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
for (const fault of ['inspect-primary', 'relocate-change', 'relocate-id', 'inspect-lib', 'sign-lib', 'sign-primary', 'parse-primary', 'parse-lib']) {
  test(`783 required ${fault} failure stops the actual builder before hash success or pin update`, t => {
    const f = fixture(t, fault), r = f.run(['--write-pins']);
    assert.equal(r.status, fault.startsWith('parse-') ? 43 : 41, r.stderr); assert.doesNotMatch(r.stdout, /SUCCESS:/);
    assert.equal(r.trace.includes('hash'), false); assert.equal(r.trace.includes('write-pins'), false);
    assert.equal(fs.readFileSync(f.pin, 'utf8'), pinBefore);
  });
}
for (const fault of ['malformed-primary', 'malformed-lib', 'missing-newline-primary', 'missing-newline-lib', 'trailing-empty-primary', 'trailing-empty-lib']) {
  test(`783 ${fault} output refuses before signing the primary or updating a pin`, t => {
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
