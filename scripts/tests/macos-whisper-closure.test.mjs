import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../verify-macos-whisper-closure.mjs', import.meta.url))
const shim = `#!/bin/sh
name=\${2##*/}
[ "$CASE" != otool_failure ] || exit 7
[ "$CASE" != malformed ] || { printf '%s:\\ninvalid\\n' "$2"; exit 0; }
[ "$CASE" != bad_header ] || { printf 'other:\\n\\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\\n'; exit 0; }
[ "$CASE" != no_newline ] || { printf '%s:\\n\\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)' "$2"; exit 0; }
printf '%s:\\n' "$2"
if [ "$name" = cmspark-whisper-darwin-arm64 ]; then
  case "$CASE" in
    absolute) dep=/opt/homebrew/other.dylib ;;
    missing) dep=@loader_path/../lib/missing.dylib ;;
    rpath) dep=@rpath/libvalid.dylib ;;
    escape) dep=@loader_path/../lib/escape.dylib ;;
    system_traversal) dep=/usr/lib/../../tmp/untrusted.dylib ;;
    *) dep=@loader_path/../lib/libvalid.dylib ;;
  esac
else
  if [ "$CASE" = transitive ]; then dep=/opt/homebrew/libomp.dylib; else dep=/usr/lib/libSystem.B.dylib; fi
fi
printf '\\t%s (compatibility version 1.0.0, current version 1.0.0)\\n' "$dep"
`

test('staged graph follows transitive dependencies and rejects unknown or escaping paths', () => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-whisper-closure-'))
  try {
    const stage = path.join(owned, 'stage')
    const bin = path.join(stage, 'bin')
    const lib = path.join(stage, 'lib')
    const tools = path.join(owned, 'tools')
    fs.mkdirSync(bin, { recursive: true })
    fs.mkdirSync(lib)
    fs.mkdirSync(tools)
    fs.writeFileSync(path.join(bin, 'cmspark-whisper-darwin-arm64'), 'fixture')
    fs.writeFileSync(path.join(lib, 'libvalid.dylib'), 'fixture')
    fs.writeFileSync(path.join(owned, 'external.dylib'), 'external')
    fs.symlinkSync(path.join(owned, 'external.dylib'), path.join(lib, 'escape.dylib'))
    fs.writeFileSync(path.join(tools, 'otool'), shim, { mode: 0o755 })
    const run = scenario => spawnSync(process.execPath, [script, stage, 'cmspark-whisper-darwin-arm64'], {
      encoding: 'utf8', env: { ...process.env, CASE: scenario, PATH: `${tools}:/usr/bin:/bin` },
    })
    const ok = run('valid')
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /Verified 2 staged whisper Mach-O objects/)
    for (const scenario of ['absolute', 'missing', 'rpath', 'escape', 'system_traversal', 'transitive', 'otool_failure', 'malformed', 'bad_header', 'no_newline']) {
      const result = run(scenario)
      assert.notEqual(result.status, 0, `${scenario} must fail closed`)
      assert.match(result.stderr, /WHISPER_CLOSURE_/)
    }
    fs.unlinkSync(path.join(bin, 'cmspark-whisper-darwin-arm64'))
    fs.symlinkSync(path.join(owned, 'external.dylib'), path.join(bin, 'cmspark-whisper-darwin-arm64'))
    assert.notEqual(run('valid').status, 0, 'primary symlink outside bin must fail')
  } finally {
    fs.rmSync(owned, { recursive: true, force: true })
  }
})
