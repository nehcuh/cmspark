// CPU source contracts only. These do not parse/execute PowerShell or prove native success.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const moduleFor: Record<string, string> = {
  'ForEach-Object': 'Microsoft.PowerShell.Core',
  'Where-Object': 'Microsoft.PowerShell.Core',
  'Out-Null': 'Microsoft.PowerShell.Core',
  'Add-Type': 'Microsoft.PowerShell.Utility',
  'Select-Object': 'Microsoft.PowerShell.Utility',
  'ConvertTo-Json': 'Microsoft.PowerShell.Utility',
  'ConvertFrom-Json': 'Microsoft.PowerShell.Utility',
  'New-Object': 'Microsoft.PowerShell.Utility',
  'Start-Sleep': 'Microsoft.PowerShell.Utility',
  'Write-Output': 'Microsoft.PowerShell.Utility',
  'Join-Path': 'Microsoft.PowerShell.Management',
  'Set-Item': 'Microsoft.PowerShell.Management',
}
const fixtures: Array<{ name: string; sha: string; crlfSha: string; calls: Record<string, number> }> = [
  { name: 'uia-script-encoding-650.ps1', sha: '72f046d3e1a5322218d1a903820a3c3fb27ef4a318069d12c69ced298aad269b',
    crlfSha: '4f284595888cbd667f3f220526de7e4367afeb10f2546317b11b2f50703031f0',
    calls: { 'ForEach-Object': 1, 'Where-Object': 1, 'ConvertTo-Json': 1 } },
  { name: 'apps-template-native-686.ps1', sha: '5a8eecdc2844bbb6d95ce76c6d6d4b664e9d8f1e98ca71e7368d93dfca744fd6',
    crlfSha: '55e503976b0a2743b821a661cf9de6a48d9a850e8f78e09bc67861f8fa4403ef',
    calls: { 'Add-Type': 1, 'New-Object': 1, 'ConvertTo-Json': 1, 'Start-Sleep': 1 } },
  { name: 'registry-helpers-644.ps1', sha: '514e7422a33a12f6a8b82c43814b66e7bec1238401d595b9d0922c9d6fb27cff',
    crlfSha: 'c5399eac7e21006c8821fd14340c79f20e426f88149af255c9f705a4c787c7b3',
    calls: { 'Select-Object': 2, 'Add-Type': 1, 'Out-Null': 1, 'Set-Item': 1, 'Join-Path': 5,
      'ConvertFrom-Json': 3, 'ConvertTo-Json': 3, 'Write-Output': 5, 'Where-Object': 1 } },
]
const source = (name: string) => fs.readFileSync(path.resolve(__dirname, '../../tests/fixtures', name), 'utf8')
const oldSelector = "$n.GetCommandName() -eq 'Add-Type'"
const selector = "$n.GetCommandName() -in @('Add-Type','Microsoft.PowerShell.Utility\\Add-Type')"

// A limited lexical view for these fixed files: hide comments, ordinary strings,
// and literal here-strings (including their C#). Never a substitute for the PS AST.
function commandSpans(text: string) {
  const code = text.replace(/@'[\s\S]*?^'@|@"[\s\S]*?^"@|'(?:''|[^'])*'|"(?:`[\s\S]|[^"`])*"|#[^\r\n]*/gm, match => match.replace(/[^\r\n]/g, ' '))
  return [...code.matchAll(/(?:[A-Za-z][\w.]*\\)?[A-Za-z][\w]*-[A-Za-z][\w-]*/g)]
}
const commandWords = (text: string) => commandSpans(text).map(m => m[0])
const sha = (text: string) => createHash('sha256').update(Buffer.from(text)).digest('hex')
function requireBindings(text: string, expected: Record<string, number>) {
  const words = commandWords(text)
  for (const [name, count] of Object.entries(expected)) {
    const actual = words.filter(word => word.split('\\').at(-1) === name)
    assert.deepEqual(actual, Array(count).fill(`${moduleFor[name]}\\${name}`), name)
  }
}
function inverse(text: string, name: string) {
  if (name === 'registry-helpers-644.ps1') text = text.replace(selector, oldSelector)
  return text.replace(/Microsoft\.PowerShell\.(?:Core|Utility|Management)\\/g, '')
}

for (const fixture of fixtures) {
  test(`#650 fixed builtin bindings: ${fixture.name}`, () => requireBindings(source(fixture.name), fixture.calls))
  test(`#650 complete original body/encoding inverse: ${fixture.name}`, () => {
    // These PS files have no eol=lf rule. Accept only either complete original
    // Git LF bytes or their exact CRLF checkout, including the original BOM.
    // Never rewrite/normalize the executable fixture, or accept mixed EOLs.
    const digest = sha(inverse(source(fixture.name), fixture.name))
    assert.ok(digest === fixture.sha || digest === fixture.crlfSha)
  })
}

test('#650 exact LF/CRLF checkout hashes retain body/BOM and reject mixed EOL', () => {
  for (const fixture of fixtures) {
    // In-memory source-derived test vectors only, never written/executed as PS.
    const lf = inverse(source(fixture.name), fixture.name).replace(/\r\n/g, '\n')
    assert.equal(sha(lf), fixture.sha)
    assert.equal(sha(lf.replace(/\n/g, '\r\n')), fixture.crlfSha)
    const allowed = (s: string) => [fixture.sha, fixture.crlfSha].includes(sha(s))
    assert.equal(allowed(lf.replace('\n', '\r\n')), false)
    assert.equal(allowed(lf + '\n'), false)
    assert.equal(allowed(lf.startsWith('\uFEFF') ? lf.slice(1) : '\uFEFF' + lf), false)
  }
})

test('#650 command contract rejects bare, wrong-module, duplicate and missing calls', () => {
  for (const fixture of fixtures) {
    const current = source(fixture.name)
    requireBindings(current, fixture.calls)
    for (const name of Object.keys(fixture.calls)) {
      const word = `${moduleFor[name]}\\${name}`
      const actual = commandSpans(current).find(m => m[0] === word)
      assert.ok(actual, 'mutate an actual command, never the quoted selector')
      const changed = (value: string) => current.slice(0, actual.index) + value + current.slice(actual.index + word.length)
      assert.throws(() => requireBindings(changed(name), fixture.calls), `${name} bare`)
      assert.throws(() => requireBindings(changed(`Wrong.Module\\${name}`), fixture.calls), `${name} module`)
      assert.throws(() => requireBindings(changed(''), fixture.calls), `${name} missing`)
      assert.throws(() => requireBindings(current + `\n${word}\n`, fixture.calls), `${name} duplicate`)
    }
  }
})

test('#650 lexical view excludes quoted/comments/C# but retains actual call names', () => {
  const text = "# Wrong.Module\\New-Object\n'Wrong.Module\\Add-Type'\n@'\nWrong.Module\\Select-Object\n'@\nMicrosoft.PowerShell.Utility\\New-Object X\n"
  assert.deepEqual(commandWords(text), ['Microsoft.PowerShell.Utility\\New-Object'])
})

test('#644 selector remains closed to the actual Add-Type literal, with count/type fences', () => {
  const helper = source('registry-helpers-644.ps1')
  assert.equal(helper.split(selector).length, 2)
  assert.ok(helper.includes("$n -is [Management.Automation.Language.CommandAst] -and " + selector))
  assert.ok(helper.includes("if ($add.Count -ne 1 -or $add[0].CommandElements[2] -isnot [Management.Automation.Language.StringConstantExpressionAst]) { throw 'OWNED_NATIVE_LITERAL_REQUIRED' }"))
  assert.ok(helper.includes('$code=$add[0].CommandElements[2].Value'))
  // Bind the contract to the actual production producer; do not invent an AST
  // that bypasses its current bare Add-Type, or execute its Registry/native code.
  const production = fs.readFileSync(path.resolve(__dirname, '../../src/host-use/win/scripts/apps-enumerate.ps1'), 'utf8')
  assert.deepEqual(commandWords(production).filter(w => w.split('\\').at(-1) === 'Add-Type'), ['Add-Type'])
  const acceptedNames = [...selector.matchAll(/'([^']+)'/g)].map(m => m[1])
  assert.deepEqual(acceptedNames, ['Add-Type', 'Microsoft.PowerShell.Utility\\Add-Type'])
  const selected = (words: string[]) => words.filter(w => acceptedNames.includes(w))
  assert.equal(selected(['Add-Type']).length, 1)
  assert.equal(selected(['Microsoft.PowerShell.Utility\\Add-Type']).length, 1)
  assert.equal(selected(['Other.Module\\Add-Type']).length, 0)
  assert.equal(selected(['Add-Type', 'Microsoft.PowerShell.Utility\\Add-Type']).length, 2)
})
