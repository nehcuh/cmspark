import test from "node:test"
import assert from "node:assert/strict"
import { fetchNsisPackage, verifiedNsisSetup, requireWindowsCi, NSIS_PACKAGE_URL, MAX_PACKAGE_BYTES } from "../ensure-ci-nsis.mjs"

test("the failed metadata lookup is replaced by the exact same pinned installer package", async () => {
  let calls = 0
  const bytes = await fetchNsisPackage({ fetchImpl: async (url, options) => {
    calls++
    assert.equal(url, NSIS_PACKAGE_URL)
    assert.ok(options.signal instanceof AbortSignal)
    return new Response("isolated transport bytes")
  } })
  assert.equal(calls, 1)
  assert.equal(bytes.toString(), "isolated transport bytes")
  assert.throws(() => verifiedNsisSetup(bytes), /checksum mismatch/, "unverified bytes cannot reach parsing/execution")
})

test("504 retries are bounded and recover without skipping integrity checks", async () => {
  let calls = 0
  const delays = []
  const bytes = await fetchNsisPackage({ fetchImpl: async () => {
    calls++
    return calls === 3 ? new Response("fixture") : new Response("gateway unavailable", { status: 504 })
  }, sleep: async ms => { delays.push(ms) } })
  assert.equal(calls, 3)
  assert.deepEqual(delays, [500, 1000])
  assert.throws(() => verifiedNsisSetup(bytes), /checksum mismatch/)
  calls = 0
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => { calls++; return new Response("", { status: 504 }) }, sleep: async () => {} }), /HTTP 504/)
  assert.equal(calls, 3)
})

test("wrong version, authentication failures and payload limits are not retried", async () => {
  for (const status of [400, 401, 403, 404]) {
    let calls = 0
    await assert.rejects(fetchNsisPackage({ fetchImpl: async () => { calls++; return new Response("", { status }) } }), new RegExp(`HTTP ${status}`))
    assert.equal(calls, 1)
  }
  let calls = 0
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => {
    calls++; return new Response("tiny", { headers: { "content-length": String(MAX_PACKAGE_BYTES + 1) } })
  } }), /size limit/)
  assert.equal(calls, 1)
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => new Response(new Uint8Array(MAX_PACKAGE_BYTES + 1)) }), /size limit/)
})

test("transient network errors are bounded; certificate failures fail immediately", async () => {
  let calls = 0
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => {
    calls++; throw Object.assign(new Error("reset"), { cause: { code: "ECONNRESET" } })
  }, sleep: async () => {} }), /transport failed/)
  assert.equal(calls, 3)
  calls = 0
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => {
    calls++; throw Object.assign(new Error("certificate"), { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } })
  } }), /transport failed/)
  assert.equal(calls, 1)
})

test("empty or oversized packages fail closed, and local platforms cannot invoke installer", () => {
  assert.throws(() => verifiedNsisSetup(Buffer.alloc(0)), /checksum mismatch/)
  assert.throws(() => verifiedNsisSetup(Buffer.alloc(MAX_PACKAGE_BYTES + 1)), /size limit/)
  assert.throws(() => requireWindowsCi("darwin", { GITHUB_ACTIONS: "true" }), /restricted/)
  assert.throws(() => requireWindowsCi("win32", {}), /restricted/)
  requireWindowsCi("win32", { GITHUB_ACTIONS: "true" })
})

// #650: fixed owned fixture observations; never replace the production stop script.
import fs from "node:fs"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
const workflowYaml = createRequire(new URL("../../companion/package.json", import.meta.url))("js-yaml")
const stopSmoke = fs.readFileSync(new URL("./win-installer-stop-smoke.ps1", import.meta.url), "utf8").replaceAll("\r\n", "\n")

test("NSIS observation brackets the complete original macro without changing its inputs or wait", () => {
  const section = stopSmoke.match(/Section\n([\s\S]*?)SectionEnd/)[1]
  assert.equal(section, '  ReadEnvStr $INSTDIR "CMSPARK_SMOKE_INSTALL_ROOT"\n  FileOpen $9 "$EXEDIR\\stop-phase.txt" w\n  FileWrite $9 "entered"\n  FileClose $9\n  !insertmacro StopInstalledAgentUnshared\n  FileOpen $9 "$EXEDIR\\stop-phase.txt" w\n  FileWrite $9 "returned"\n  FileClose $9\n')
  assert.match(stopSmoke, /\$harness\.Replace\('__MACRO__', \$macro\)/)
  assert.match(stopSmoke, /\/DCMSPARK_STOP_SCRIPT=/)
  assert.match(stopSmoke, /\$stop\.WaitForExit\(30000\)/)
  assert.match(stopSmoke, /Stop-Process -Id \$stop\.Id -Force/)
  assert.match(stopSmoke, /installed fixture was not stopped/)
  assert.match(stopSmoke, /sibling installation was incorrectly stopped/)
  assert.match(stopSmoke, /system Node agent was not stopped/)
  assert.match(stopSmoke, /unrelated system Node process was stopped/)
})

test("receipt reader is bounded, finite and permanently checked in the owned Windows smoke", () => {
  assert.match(stopSmoke, /function Get-OwnedStopReceiptState/)
  assert.match(stopSmoke, /ReparsePoint/)
  assert.match(stopSmoke, /New-Object byte\[\] 17/)
  assert.match(stopSmoke, /while \(\$count -lt 17\)/)
  assert.match(stopSmoke, /if \(\$count -gt 16\) \{ return 'invalid' \}/)
  assert.doesNotMatch(stopSmoke, /ReadAll(?:Text|Bytes)|Get-Content[^\n]*stop-phase/)
  assert.match(stopSmoke, /function Test-OwnedStopReceiptParser/)
  assert.match(stopSmoke, /Test-OwnedStopReceiptParser \$root/)
  assert.equal((stopSmoke.match(/NSIS_STOP_SMOKE_STATE=/g) ?? []).length, 2)
})

const registryReady = "Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value 'ready=true' -Encoding utf8\n"
const censusCondition = "${{ !cancelled() && matrix.os == 'windows-latest' && steps.windows-census-compile.outcome == 'success' && steps.windows-registry-prerequisites.outputs.ready == 'true' }}"
const digest = text => createHash("sha256").update(text).digest("hex")
// #650: keep the legacy full lifecycle pin after removing only reviewed short-root additions.
const reviewedShortSetup = "  $shortFixture = Join-Path $fixture 'canonical short alias owned'\n  New-Item -ItemType Directory -Path $shortFixture -ErrorAction Stop | Out-Null\n  Add-Type @'\nusing System;\nusing System.Text;\nusing System.Runtime.InteropServices;\npublic static class Cmspark650OwnedPaths {\n  [DllImport(\"kernel32.dll\", CharSet=CharSet.Unicode, SetLastError=true)]\n  public static extern uint GetShortPathName(string source, StringBuilder dest, uint size);\n  [DllImport(\"kernel32.dll\", CharSet=CharSet.Unicode, SetLastError=true)]\n  public static extern uint GetLongPathName(string source, StringBuilder dest, uint size);\n}\n'@\n  $longBuffer = [System.Text.StringBuilder]::new(32768)\n  $shortBuffer = [System.Text.StringBuilder]::new(32768)\n  $longLength = [Cmspark650OwnedPaths]::GetLongPathName($shortFixture, $longBuffer, 32768)\n  if ($longLength -eq 0 -or $longLength -ge 32768) { throw 'CENSUS_OWNED_SHORT_ROOT_INVALID' }\n  $shortLength = [Cmspark650OwnedPaths]::GetShortPathName($longBuffer.ToString(), $shortBuffer, 32768)\n  if ($shortLength -eq 0 -or $shortLength -ge 32768 -or $shortBuffer.ToString() -notmatch '~[0-9]' -or $shortBuffer.ToString() -eq $longBuffer.ToString()) { throw 'CENSUS_OWNED_SHORT_ROOT_INVALID' }\n  $env:CMSPARK_TEST_LONG_ROOT = $longBuffer.ToString()\n  $env:CMSPARK_TEST_SHORT_ROOT = $shortBuffer.ToString()\n"
const reviewedShortCleanup = ["    if (Test-Path Env:CMSPARK_TEST_LONG_ROOT) { Remove-Item Env:CMSPARK_TEST_LONG_ROOT -ErrorAction Stop }\n","    if (Test-Path Env:CMSPARK_TEST_SHORT_ROOT) { Remove-Item Env:CMSPARK_TEST_SHORT_ROOT -ErrorAction Stop }\n"]
const legacyControlCommand = "node --test scripts/tests/windows-census.test.mjs scripts/tests/windows-census-evidence.test.mjs scripts/tests/windows-census-cli.test.mjs"
const reviewedControlCommand = "node --test scripts/tests/windows-census.test.mjs scripts/tests/windows-census-evidence.test.mjs scripts/tests/windows-census-cli.test.mjs scripts/tests/windows-census-short-path.test.mjs"
// #650: only the complete reviewed diagnostic insertions may normalize away.
const reviewedSetupDiagnosticPrelude = "# CMSPARK_650_SETUP_DIAGNOSTIC_BEGIN\nfunction Write-Cmspark650SetupDiagnostic {\n  param([string]$Stage, [string]$Phase, [System.Management.Automation.ErrorRecord]$Record)\n  $safeStage = 'UNKNOWN'\n  if ($Stage -cin @('primary', 'cleanup')) { $safeStage = $Stage }\n  $safePhase = 'UNKNOWN'\n  if ($Phase -cin @('service', 'directory_create', 'share_owner', 'share_create', 'controls', 'short_join', 'short_directory', 'short_type', 'long_buffer', 'short_buffer', 'long_call', 'long_check', 'short_call', 'short_check', 'roots_long', 'roots_short', 'roots_unc', 'launcher', 'cleanup_identity', 'cleanup_lookup', 'cleanup_verify', 'cleanup_share', 'cleanup_directory', 'cleanup_unc_env', 'cleanup_long_env', 'cleanup_short_env')) { $safePhase = $Phase }\n  $reason = 'OTHER'\n  switch -CaseSensitive ([string]$Record.FullyQualifiedErrorId) {\n    'CENSUS_OWNED_SMB_SETUP_FAILED' { $reason = 'SMB_SETUP'; break }\n    'CENSUS_OWNED_SMB_IDENTITY_INVALID' { $reason = 'SMB_IDENTITY'; break }\n    'CENSUS_OWNED_SHORT_ROOT_INVALID' { $reason = 'SHORT_ROOT'; break }\n  }\n  $line = 0; $column = 0\n  if ($null -ne $Record.InvocationInfo) {\n    $candidateLine = $Record.InvocationInfo.ScriptLineNumber\n    $candidateColumn = $Record.InvocationInfo.OffsetInLine\n    if ($candidateLine -ge 1 -and $candidateLine -le 4096) { $line = [int]$candidateLine }\n    if ($candidateColumn -ge 1 -and $candidateColumn -le 4096) { $column = [int]$candidateColumn }\n  }\n  $receipt = [ordered]@{ version = 1; stage = $safeStage; phase = $safePhase; reason = $reason; line = $line; column = $column }\n  [Console]::Out.WriteLine([string]::Format([System.Globalization.CultureInfo]::InvariantCulture, 'CENSUS_650_SETUP {{\"version\":1,\"stage\":\"{0}\",\"phase\":\"{1}\",\"reason\":\"{2}\",\"line\":{3},\"column\":{4}}}', [object[]]@($receipt.stage, $receipt.phase, $receipt.reason, $receipt.line, $receipt.column)))\n}\n# CMSPARK_650_SETUP_DIAGNOSTIC_END\n"
const reviewedSetupDiagnosticPairs = [
  [
    "  $phase = 'service'\n  Start-Service LanmanServer -ErrorAction Stop\n",
    "  Start-Service LanmanServer -ErrorAction Stop\n"
  ],
  [
    "  $phase = 'directory_create'\n  $created = (& node scripts/windows-census-owned-smb.mjs create $share | ConvertFrom-Json -ErrorAction Stop)\n",
    "  $created = (& node scripts/windows-census-owned-smb.mjs create $share | ConvertFrom-Json -ErrorAction Stop)\n"
  ],
  [
    "  $phase = 'share_owner'\n  $owner = [Security.Principal.WindowsIdentity]::GetCurrent()\n",
    "  $owner = [Security.Principal.WindowsIdentity]::GetCurrent()\n"
  ],
  [
    "  $phase = 'share_create'\n  try { New-SmbShare -Name $share -Path $fixture -FullAccess $owner.Name -ErrorAction Stop | Out-Null } finally { $owner.Dispose() }\n",
    "  try { New-SmbShare -Name $share -Path $fixture -FullAccess $owner.Name -ErrorAction Stop | Out-Null } finally { $owner.Dispose() }\n"
  ],
  [
    "  $phase = 'controls'\n  node --test scripts/tests/windows-census.test.mjs scripts/tests/windows-census-evidence.test.mjs scripts/tests/windows-census-cli.test.mjs scripts/tests/windows-census-short-path.test.mjs\n",
    "  node --test scripts/tests/windows-census.test.mjs scripts/tests/windows-census-evidence.test.mjs scripts/tests/windows-census-cli.test.mjs scripts/tests/windows-census-short-path.test.mjs\n"
  ],
  [
    "  $phase = 'short_join'\n  $shortFixture = Join-Path $fixture 'canonical short alias owned'\n",
    "  $shortFixture = Join-Path $fixture 'canonical short alias owned'\n"
  ],
  [
    "  $phase = 'short_directory'\n  New-Item -ItemType Directory -Path $shortFixture -ErrorAction Stop | Out-Null\n",
    "  New-Item -ItemType Directory -Path $shortFixture -ErrorAction Stop | Out-Null\n"
  ],
  [
    "  $phase = 'short_type'\n  Add-Type @'\n",
    "  Add-Type @'\n"
  ],
  [
    "  $phase = 'long_buffer'\n  $longBuffer = [System.Text.StringBuilder]::new(32768)\n",
    "  $longBuffer = [System.Text.StringBuilder]::new(32768)\n"
  ],
  [
    "  $phase = 'short_buffer'\n  $shortBuffer = [System.Text.StringBuilder]::new(32768)\n",
    "  $shortBuffer = [System.Text.StringBuilder]::new(32768)\n"
  ],
  [
    "  $phase = 'long_call'\n  $longLength = [Cmspark650OwnedPaths]::GetLongPathName($shortFixture, $longBuffer, 32768)\n",
    "  $longLength = [Cmspark650OwnedPaths]::GetLongPathName($shortFixture, $longBuffer, 32768)\n"
  ],
  [
    "  $phase = 'long_check'\n  if ($longLength -eq 0 -or $longLength -ge 32768) { throw 'CENSUS_OWNED_SHORT_ROOT_INVALID' }\n",
    "  if ($longLength -eq 0 -or $longLength -ge 32768) { throw 'CENSUS_OWNED_SHORT_ROOT_INVALID' }\n"
  ],
  [
    "  $phase = 'short_call'\n  $shortLength = [Cmspark650OwnedPaths]::GetShortPathName($longBuffer.ToString(), $shortBuffer, 32768)\n",
    "  $shortLength = [Cmspark650OwnedPaths]::GetShortPathName($longBuffer.ToString(), $shortBuffer, 32768)\n"
  ],
  [
    "  $phase = 'short_check'\n  if ($shortLength -eq 0 -or $shortLength -ge 32768 -or $shortBuffer.ToString() -notmatch '~[0-9]' -or $shortBuffer.ToString() -eq $longBuffer.ToString()) { throw 'CENSUS_OWNED_SHORT_ROOT_INVALID' }\n",
    "  if ($shortLength -eq 0 -or $shortLength -ge 32768 -or $shortBuffer.ToString() -notmatch '~[0-9]' -or $shortBuffer.ToString() -eq $longBuffer.ToString()) { throw 'CENSUS_OWNED_SHORT_ROOT_INVALID' }\n"
  ],
  [
    "  $phase = 'roots_long'\n  $env:CMSPARK_TEST_LONG_ROOT = $longBuffer.ToString()\n",
    "  $env:CMSPARK_TEST_LONG_ROOT = $longBuffer.ToString()\n"
  ],
  [
    "  $phase = 'roots_short'\n  $env:CMSPARK_TEST_SHORT_ROOT = $shortBuffer.ToString()\n",
    "  $env:CMSPARK_TEST_SHORT_ROOT = $shortBuffer.ToString()\n"
  ],
  [
    "  $phase = 'roots_unc'\n  $env:CMSPARK_TEST_UNC_SHARE = '\\\\127.0.0.1\\' + $share\n",
    "  $env:CMSPARK_TEST_UNC_SHARE = '\\\\127.0.0.1\\' + $share\n"
  ],
  [
    "  $phase = 'launcher'\n  node scripts/windows-census.mjs\n",
    "  node scripts/windows-census.mjs\n"
  ],
  [
    "    $phase = 'cleanup_identity'\n    if ($directoryCreated) {\n",
    "    if ($directoryCreated) {\n"
  ],
  [
    "      $phase = 'cleanup_lookup'\n      $current = @(Get-SmbShare -Name $share -ErrorAction Stop)\n",
    "      $current = @(Get-SmbShare -Name $share -ErrorAction Stop)\n"
  ],
  [
    "      $phase = 'cleanup_verify'\n      & node scripts/windows-census-owned-smb.mjs verify $share $current[0].Name $current[0].Path $created.dev $created.ino\n",
    "      & node scripts/windows-census-owned-smb.mjs verify $share $current[0].Name $current[0].Path $created.dev $created.ino\n"
  ],
  [
    "      $phase = 'cleanup_share'\n      Remove-SmbShare -Name $share -Force -ErrorAction Stop\n",
    "      Remove-SmbShare -Name $share -Force -ErrorAction Stop\n"
  ],
  [
    "      $phase = 'cleanup_directory'\n      Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction Stop\n",
    "      Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction Stop\n"
  ],
  [
    "    $phase = 'cleanup_unc_env'\n    if (Test-Path Env:CMSPARK_TEST_UNC_SHARE) { Remove-Item Env:CMSPARK_TEST_UNC_SHARE -ErrorAction Stop }\n",
    "    if (Test-Path Env:CMSPARK_TEST_UNC_SHARE) { Remove-Item Env:CMSPARK_TEST_UNC_SHARE -ErrorAction Stop }\n"
  ],
  [
    "    $phase = 'cleanup_long_env'\n    if (Test-Path Env:CMSPARK_TEST_LONG_ROOT) { Remove-Item Env:CMSPARK_TEST_LONG_ROOT -ErrorAction Stop }\n",
    "    if (Test-Path Env:CMSPARK_TEST_LONG_ROOT) { Remove-Item Env:CMSPARK_TEST_LONG_ROOT -ErrorAction Stop }\n"
  ],
  [
    "    $phase = 'cleanup_short_env'\n    if (Test-Path Env:CMSPARK_TEST_SHORT_ROOT) { Remove-Item Env:CMSPARK_TEST_SHORT_ROOT -ErrorAction Stop }\n",
    "    if (Test-Path Env:CMSPARK_TEST_SHORT_ROOT) { Remove-Item Env:CMSPARK_TEST_SHORT_ROOT -ErrorAction Stop }\n"
  ],
  [
    "} catch {\n  Write-Cmspark650SetupDiagnostic -Stage 'primary' -Phase $phase -Record $_\n  throw 'CENSUS_OWNED_SMB_STEP_FAILED'\n} finally {\n",
    "} catch { throw 'CENSUS_OWNED_SMB_STEP_FAILED' } finally {\n"
  ],
  [
    "  } catch {\n    Write-Cmspark650SetupDiagnostic -Stage 'cleanup' -Phase $phase -Record $_\n    throw 'CENSUS_OWNED_SMB_CLEANUP_FAILED'\n  } finally {\n",
    "  } catch { throw 'CENSUS_OWNED_SMB_CLEANUP_FAILED' } finally {\n"
  ]
]
const diagnosticControlCommand = reviewedControlCommand + " scripts/tests/windows-census-setup-diagnostics.test.mjs"
function censusWithoutReviewedSetupDiagnostics(run) {
  assert.equal(run.split(reviewedSetupDiagnosticPrelude).length, 2, "one exact finite diagnostic formatter")
  run = run.replace(reviewedSetupDiagnosticPrelude, "")
  assert.equal(run.split(diagnosticControlCommand).length, 2, "original eighty-five controls plus diagnostic family exactly once")
  run = run.replace(diagnosticControlCommand, reviewedControlCommand)
  for (const [reviewed, original] of reviewedSetupDiagnosticPairs) {
    assert.equal(run.split(reviewed).length, 2, "each exact phase/receipt insertion occurs once at its original command")
    run = run.replace(reviewed, original)
  }
  return run
}
function legacyCensusWithoutReviewedShortRoots(run) {
  for (const addition of [reviewedShortSetup, ...reviewedShortCleanup]) {
    assert.equal(run.split(addition).length, 2, 'each reviewed short-root addition is present exactly once')
    run = run.replace(addition, '')
  }
  assert.equal(run.split(reviewedControlCommand).length, 2, 'the reviewed short-path controls run exactly once')
  return run.replace(reviewedControlCommand, legacyControlCommand)
}
function originalCensusCommands(run) {
  const match = run.match(/^  # CMSPARK_650_ORIGINAL_COMMANDS_BEGIN\n([\s\S]*?)^  # CMSPARK_650_ORIGINAL_COMMANDS_END$/m)
  assert.ok(match, 'one bounded original command block')
  const locator = "  $env:CMSPARK_TEST_UNC_SHARE = '\\\\127.0.0.1\\' + $share\n"
  assert.equal(match[1].split(locator).length, 2, 'only the census receives the new owned locator')
  return match[1].replace(locator, '').replace(/^  /gm, '')
}
function assertCensusSchedule(raw) {
  const steps = workflowYaml.load(raw).jobs['smoke-os'].steps
  const names = steps.map(s => s.name)
  const i = names.indexOf('Native Windows read-only Registry discovery (#644)')
  assert.deepEqual(names.slice(i - 1, i + 4), ['Compile shared companion test inputs (#650)', 'Native Windows read-only Registry discovery (#644)', 'Complete Windows Companion census (#650)', 'Windows census finite public receipts (#650)', 'Office compatibility and relocated runtime (#611)'])
  assert.equal(names[i - 2], 'Pinned NSIS dependency transport and integrity (#633)')
  const [compile, registry, census, artifact, office] = steps.slice(i - 1, i + 4)
  assert.deepEqual(compile, { name: names[i - 1], id: 'windows-census-compile', shell: 'bash', run: 'cd companion\nnpx tsc -p tsconfig.test.json\n' })
  assert.equal(registry.id, 'windows-registry-prerequisites')
  assert.equal(registry.if, "matrix.os == 'windows-latest'")
  assert.equal(registry['continue-on-error'], undefined)
  assert.equal(registry.run.split(registryReady).length, 2, 'one finite output, not per-view readiness')
  assert(registry.run.includes('}\n' + registryReady + 'cd companion\n'), 'readiness follows the complete original view loop')
  assert.equal(digest(registry.run.replace(registryReady, '')), 'a2bb4df47a70ee0e4dc6d70a73097332f92b1a6e76d4194e215fba5a2b199c9a', 'original Registry body and failure exit remain exact')
  assert.equal(census.if, censusCondition)
  assert.equal(census['continue-on-error'], undefined)
  const originalRun = censusWithoutReviewedSetupDiagnostics(census.run)
  assert.equal(digest(originalRun), 'd6652f9fed162dee00a77a7053b5f6ff42730c7ba139b1eb4df0985680999405', 'reviewed owned SMB and short-root lifecycle stays exact')
  const legacyRun = legacyCensusWithoutReviewedShortRoots(originalRun)
  assert.equal(digest(legacyRun), '75ea0a66638629f8f3d5a162122e94ce626dec9ede490596afbf80cdb303ac4b', 'the full original lifecycle stays exact outside reviewed insertions')
  assert.equal(digest(originalCensusCommands(legacyRun)), 'b6aba13f90e3e4567e0b80f21c8585a223383200e26237514d53caafd80836a6', 'the original control/census commands and exits remain exact')
  assert.equal(digest(JSON.stringify(artifact)), 'bf504e85964e900151325fca797443741ab84ad49d746b0257af2a269fc64697', 'sealed artifact condition and paths stay exact')
  assert.equal(digest(office.run), '8fb06555123eebe638397b5bc81d5074db606f3aa9192d499b5914095b130402', 'Office loses only its extracted compiler line')
  for (const step of [compile, office]) {
    assert.equal(step.if, undefined); assert.equal(step['continue-on-error'], undefined)
  }
  assert.equal(steps.filter(s => s.name === compile.name).length, 1)
}
test("full census follows verified prerequisites before targeted Office and preserves every native gate", () => {
  assertCensusSchedule(fs.readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n"))
})
test("scheduling contract rejects missing compilation, premature readiness and waived native failures", () => {
  const raw = fs.readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n")
  assertCensusSchedule(raw)
  for (const [from, to] of [
    ['id: windows-census-compile', 'id: missing-compile'],
    ["steps.windows-registry-prerequisites.outputs.ready == 'true'", "steps.windows-registry-prerequisites.outputs.ready == 'false'"],
    ['          ' + registryReady + '          cd companion', '          cd companion'],
    ['          foreach ($view in $views) {', '          ' + registryReady + '          foreach ($view in $views) {'],
    ['.test-dist/tests/integration/registry-apps-644.test.js', '.test-dist/tests/integration/omitted-registry.test.js'],
    ['node scripts/windows-census.mjs', 'echo census-not-executed'],
    ["        id: windows-registry-prerequisites\n", "        id: windows-registry-prerequisites\n        continue-on-error: true\n"],
  ]) {
    assert(raw.includes(from), 'mutant must target the actual source')
    assert.throws(() => assertCensusSchedule(raw.replace(from, to)))
  }
  const premature = raw.replace('          ' + registryReady, '').replace('          foreach ($view in $views) {', '          ' + registryReady + '          foreach ($view in $views) {')
  assert.throws(() => assertCensusSchedule(premature), 'a single readiness output inside/before the view loop is insufficient')
  const late = workflowYaml.load(raw), steps = late.jobs['smoke-os'].steps
  const office = steps.splice(steps.findIndex(s => s.name === 'Office compatibility and relocated runtime (#611)'), 1)[0]
  steps.splice(steps.findIndex(s => s.id === 'windows-census-compile'), 0, office)
  assert.throws(() => assertCensusSchedule(workflowYaml.dump(late)), 'targeted Office cannot precede forensic census again')
})

test('owned UNC workflow checks current binding before either delete and keeps the later603 lifecycle', () => {
  const steps = workflowYaml.load(fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')).jobs['smoke-os'].steps
  const run = censusWithoutReviewedSetupDiagnostics(steps.find(s => s.id === 'windows-census').run)
  assertCensusSchedule(fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
  const create = run.indexOf('node scripts/windows-census-owned-smb.mjs create $share')
  const directoryFlag = run.indexOf('$directoryCreated = $true')
  const shareCreate = run.indexOf('New-SmbShare -Name $share -Path $fixture -FullAccess $owner.Name -ErrorAction Stop')
  const shareFlag = run.indexOf('$shareCreated = $true')
  const lookup = run.indexOf('Get-SmbShare -Name $share -ErrorAction Stop')
  const verify = run.indexOf('node scripts/windows-census-owned-smb.mjs verify $share $current[0].Name $current[0].Path $created.dev $created.ino')
  const removeShare = run.indexOf('Remove-SmbShare -Name $share -Force -ErrorAction Stop')
  const removeDirectory = run.indexOf('Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction Stop')
  assert.ok(create >= 0 && create < directoryFlag && directoryFlag < shareCreate && shareCreate < shareFlag)
  assert.ok(lookup > shareFlag && lookup < verify && verify < removeShare && removeShare < removeDirectory)
  assert.match(run.slice(verify, removeShare), /if \(\$LASTEXITCODE -ne 0\) \{ throw 'CENSUS_OWNED_SMB_IDENTITY_INVALID' \}/)
  assert.match(run, /if \(-not \$shareCreated\) \{ throw 'CENSUS_OWNED_SMB_IDENTITY_INVALID' \}/)
  assert.match(run, /if \(\$current.Count -ne 1\) \{ throw 'CENSUS_OWNED_SMB_IDENTITY_INVALID' \}/)
  assert.match(run, /catch \{ throw 'CENSUS_OWNED_SMB_CLEANUP_FAILED' \}/)
  assert.doesNotMatch(run, /SilentlyContinue|continue-on-error|GITHUB_ENV|Everyone|Authenticated Users/)
  const later = steps.find(s => s.name === 'Windows ACP pipes and filesystem roots / native UNC (#603)')
  assert.match(later.run, /cmspark603_/)
  assert.match(later.run, /CMSPARK_TEST_UNC_SHARE/)
  assert.ok(steps.indexOf(later) > steps.findIndex(s => s.id === 'windows-census'))
})

test('owned UNC lifecycle guards reject missing verify, waived cleanup, foreign removal and skipped canonical call', () => {
  const raw = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
  for (const [from, to] of [
    ['Get-SmbShare -Name $share -ErrorAction Stop', 'Get-SmbShare -Name foreign -ErrorAction Stop'],
    ['node scripts/windows-census-owned-smb.mjs verify', 'echo verify-not-called'],
    ["throw 'CENSUS_OWNED_SMB_CLEANUP_FAILED'", "Write-Output 'cleanup-waived'"],
    ['Remove-SmbShare -Name $share -Force -ErrorAction Stop', 'Remove-SmbShare -Name foreign -Force -ErrorAction Stop'],
    ['node scripts/windows-census.mjs', 'echo census-not-called'],
  ]) {
    assert.ok(raw.includes(from))
    assert.throws(() => assertCensusSchedule(raw.replace(from, to)))
  }
})

test('reviewed short-root additions normalize to the complete original pinned lifecycle', () => {
  const raw = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
  const run = censusWithoutReviewedSetupDiagnostics(workflowYaml.load(raw).jobs['smoke-os'].steps.find(s => s.id === 'windows-census').run)
  assert.equal(digest(legacyCensusWithoutReviewedShortRoots(run)), '75ea0a66638629f8f3d5a162122e94ce626dec9ede490596afbf80cdb303ac4b')
  for (const addition of [reviewedShortSetup, ...reviewedShortCleanup]) {
    assert.throws(() => legacyCensusWithoutReviewedShortRoots(run.replace(addition, '')), 'missing additions cannot silently normalize')
    assert.throws(() => legacyCensusWithoutReviewedShortRoots(run + addition), 'duplicate additions cannot silently normalize')
  }
  assert.throws(() => legacyCensusWithoutReviewedShortRoots(run.replace(reviewedControlCommand, legacyControlCommand)))
  for (const [from, to] of [
    ['32768', '32769'],
    ["'canonical short alias owned'", "'foreign short alias'"],
    ['GetShortPathName($longBuffer.ToString()', 'GetShortPathName($fixture'],
    ['Remove-Item Env:CMSPARK_TEST_SHORT_ROOT -ErrorAction Stop', "Write-Output 'cleanup-waived'"],
    ['scripts/tests/windows-census-short-path.test.mjs', 'scripts/tests/omitted-short-path.test.mjs'],
  ]) {
    assert.ok(raw.includes(from), 'mutants target actual reviewed workflow')
    assert.throws(() => assertCensusSchedule(raw.replace(from, to)), 'reviewed additions cannot bypass lifecycle pin')
  }
})

// Exact inverse must reject changed or missing diagnostics as well as every old native gate.
test('setup diagnostics normalize only their exact reviewed delta and retain the d6652 full-body pin', () => {
  const raw = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
  assertCensusSchedule(raw)
  for (const [from,to] of [
    ["$phase = 'short_call'", "$phase = 'long_call'"],
    ["-Stage 'primary' -Phase $phase -Record $_", "-Stage 'cleanup' -Phase $phase -Record $_"],
    ["$reason = 'OTHER'", "$reason = [string]$Record.FullyQualifiedErrorId"],
    ["$candidateLine -le 4096", "$candidateLine -le 4097"],
    ["scripts/tests/windows-census-setup-diagnostics.test.mjs", "scripts/tests/omitted-setup-diagnostics.test.mjs"],
  ]) { assert.ok(raw.includes(from)); assert.throws(() => assertCensusSchedule(raw.replace(from,to))) }
})
