import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createConfirmationObservation772 } from './fixtures/native-confirmation-observer-772'
import { createNativeObservation788 } from './fixtures/native-observation-788'

// Both real source-parent and normal .test-dist/tests filenames are supported.
const sourceRoot = path.resolve(__dirname, '../..')
const root = fs.existsSync(path.join(sourceRoot, 'scripts/windows-census-reporter.mjs')) ? sourceRoot : path.resolve(__dirname, '../../..')
const { createConfirmationContracts772 } = require(path.join(root, 'scripts/tests/fixtures/confirmation-contracts-772.mjs'))
const { extractActualLocalObservation772, nativeConfirmationFrame772 } = require(path.join(root, 'scripts/tests/fixtures/native-confirmation-census-772.mjs'))
const supplied = (globalThis as any)[Symbol.for('cmspark.owned.confirmation772.normal-emits')]
// The bounded CPU operator supplies only the authenticated normal-emission AST
// projection. Ordinary CI reads the actual tsc-emitted sibling without importing
// or executing that complete native module. The observer above is always real.
if (supplied !== undefined) assert.equal(supplied.normalEmitBound, true)
const actualLocal = supplied?.actualLocal ?? extractActualLocalObservation772(require('typescript'), fs.readFileSync(path.join(__dirname, 'desktop-native-thread-metadata-476.test.js'), 'utf8'), createNativeObservation788)
const controls = createConfirmationContracts772({ createConfirmationObservation772, nativeFrame: nativeConfirmationFrame772, actualLocal })
assert.equal(controls.length, 6)
const names = [
  '772 real confirmation producer preserves per-request first observations and independent clock order',
  '772 real confirmation producer bounds observations and contains malformed inputs and sink failure',
  '772 confirmation parser rejects negative mutants of real producer output and noncanonical bytes',
  '772 public confirmation boundary refuses proxies accessors symbols holes and inherited serialization',
  '772 existing Local marker uses actual normal-emitted helpers and original payload constructor',
  '772 Local public parser rejects malformed counter enum and accessor mutants without leaking source strings',
]
for (let index = 0; index < names.length; index++) assert.equal(controls[index].name, names[index])
// Literal registration sites remain in the emitted canonical test source. The
// helper contains assertion bodies, not an off-file Node registration framework.
test('772 real confirmation producer preserves per-request first observations and independent clock order', controls[0].run)
test('772 real confirmation producer bounds observations and contains malformed inputs and sink failure', controls[1].run)
test('772 confirmation parser rejects negative mutants of real producer output and noncanonical bytes', controls[2].run)
test('772 public confirmation boundary refuses proxies accessors symbols holes and inherited serialization', controls[3].run)
test('772 existing Local marker uses actual normal-emitted helpers and original payload constructor', controls[4].run)
test('772 Local public parser rejects malformed counter enum and accessor mutants without leaking source strings', controls[5].run)
