import test from "node:test"
import assert from "node:assert/strict"
import { validateCockpitSteps748 } from "./windows-ci-feedback-750-contract.mjs"
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

function assertStopSmokeContract(source) {
  const section = source.match(/Section\n([\s\S]*?)SectionEnd/)[1]
  assert.equal(section, '  ReadEnvStr $INSTDIR "CMSPARK_SMOKE_INSTALL_ROOT"\n  FileOpen $9 "$EXEDIR\\stop-phase.txt" w\n  FileWrite $9 "entered"\n  FileClose $9\n__OBSERVATION_ENTER__\n  !insertmacro StopInstalledAgentUnshared\n  FileOpen $9 "$EXEDIR\\stop-phase.txt" w\n  FileWrite $9 "returned"\n  FileClose $9\n__OBSERVATION_AFTER__\n')
  const transport = "$harness.Replace('__OBSERVATION_PREAMBLE__', $observation.nsisPreamble).Replace('__OBSERVATION_ENTER__', $observation.nsisEnter).Replace('__OBSERVATION_AFTER__', $observation.nsisAfterMacro)"
  assert.equal(source.split(transport).length, 2, 'the three fixed observation fields reach the harness exactly once')
  assert.ok(source.includes("    if ($restoredMacro -cne $macro) { throw 'NSIS observed macro differs from production' }"), 'the complete restored production macro is still checked')
  assert.match(source, /\/DCMSPARK_STOP_SCRIPT=/)
  assert.match(source, /\$stop\.WaitForExit\(30000\)/)
  assert.match(source, /Stop-Process -Id \$stop\.Id -Force/)
  assert.match(source, /installed fixture was not stopped/)
  assert.match(source, /sibling installation was incorrectly stopped/)
  assert.match(source, /system Node agent was not stopped/)
  assert.match(source, /unrelated system Node process was stopped/)
}
test("NSIS observation brackets the complete original macro without changing its inputs or wait", () => {
  assertStopSmokeContract(stopSmoke)
})
test('observed NSIS harness refuses missing phases, changed transport, macro guard and original timeout', () => {
  for (const [from, to] of [
    ['__OBSERVATION_ENTER__\n', ''],
    ['__OBSERVATION_AFTER__\n', ''],
    ['__OBSERVATION_ENTER__\n', '__OBSERVATION_ENTER__\n__OBSERVATION_ENTER__\n'],
    [".Replace('__OBSERVATION_PREAMBLE__', $observation.nsisPreamble)", ".Replace('__OBSERVATION_PREAMBLE__', $macro)"],
    [".Replace('__OBSERVATION_AFTER__', $observation.nsisAfterMacro)", ''],
    ['$restoredMacro -cne $macro', '$restoredMacro -ceq $macro'],
    ['$stop.WaitForExit(30000)', '$stop.WaitForExit(30001)'],
  ]) {
    assert.ok(stopSmoke.includes(from))
    assert.throws(() => assertStopSmokeContract(stopSmoke.replace(from, to)))
  }
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
const censusCondition = "${{ !cancelled() && matrix.os == 'windows-latest' && matrix.lane == 'census' && steps.windows-census-compile.outcome == 'success' && steps.windows-registry-prerequisites.outputs.ready == 'true' }}"
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
const reviewedShortProvisionPairs = [
  [
    "  $shortCreated = (& node scripts/windows-census-owned-smb.mjs create-short $share $created.dev $created.ino | ConvertFrom-Json -ErrorAction Stop)\n  if ($LASTEXITCODE -ne 0 -or $shortCreated.path -cne $shortFixture) { throw 'CENSUS_OWNED_SHORT_ROOT_INVALID' }\n",
    "  New-Item -ItemType Directory -Path $shortFixture -ErrorAction Stop | Out-Null\n"
  ],
  [
    "  [StructLayout(LayoutKind.Sequential)]\n  public struct OwnedInfo {\n    public uint Attributes;\n    public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;\n    public uint VolumeSerialNumber, SizeHigh, SizeLow, Links, FileIndexHigh, FileIndexLow;\n  }\n  [DllImport(\"kernel32.dll\", EntryPoint=\"CreateFileW\", CharSet=CharSet.Unicode, SetLastError=true, ExactSpelling=true)]\n  private static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFile(string source, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);\n  [DllImport(\"kernel32.dll\", SetLastError=true, ExactSpelling=true)]\n  [return: MarshalAs(UnmanagedType.Bool)]\n  private static extern bool GetFileInformationByHandle(Microsoft.Win32.SafeHandles.SafeFileHandle handle, out OwnedInfo info);\n  [DllImport(\"kernel32.dll\", EntryPoint=\"SetFileShortNameW\", CharSet=CharSet.Unicode, SetLastError=true, ExactSpelling=true)]\n  [return: MarshalAs(UnmanagedType.Bool)]\n  private static extern bool SetFileShortName(Microsoft.Win32.SafeHandles.SafeFileHandle handle, string name);\n  public static int PrepareShortName(string source, string dev, string ino) {\n    Microsoft.Win32.SafeHandles.SafeFileHandle handle = CreateFile(source, 0x10080, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);\n    try {\n      if (handle.IsInvalid) return AliasResult(1, Marshal.GetLastWin32Error());\n      OwnedInfo info = new OwnedInfo();\n      if (!GetFileInformationByHandle(handle, out info)) return AliasResult(2, Marshal.GetLastWin32Error());\n      ulong fileId = ((ulong)info.FileIndexHigh << 32) | info.FileIndexLow;\n      if ((info.Attributes & 0x10) == 0 || (info.Attributes & 0x400) != 0 || fileId == 0 || info.VolumeSerialNumber.ToString(System.Globalization.CultureInfo.InvariantCulture) != dev || fileId.ToString(System.Globalization.CultureInfo.InvariantCulture) != ino) return AliasResult(3, 0);\n      if (!SetFileShortName(handle, \"CNSUS~1\")) return AliasResult(4, Marshal.GetLastWin32Error());\n      return AliasResult(0, 0);\n    } finally { handle.Dispose(); }\n  }\n  private static int AliasResult(int stage, int error) {\n    if (error < 0 || error > 65535) error = 0;\n    Console.WriteLine(\"CENSUS_650_SHORT {{\\\"stage\\\":{0},\\\"error\\\":{1}}}\", stage, error);\n    return stage;\n  }\n",
    ""
  ],
  [
    "  $shortSetStatus = [Cmspark650OwnedPaths]::PrepareShortName($shortFixture, $shortCreated.dev, $shortCreated.ino)\n  if ($shortSetStatus -ne 0) { throw 'CENSUS_OWNED_SHORT_ROOT_INVALID' }\n",
    ""
  ],
  [
    "  if ([System.IO.Path]::GetFileName($shortBuffer.ToString()) -ine 'CNSUS~1') { throw 'CENSUS_OWNED_SHORT_ROOT_INVALID' }\n",
    ""
  ],
  [
    "scripts/tests/windows-census-setup-diagnostics.test.mjs scripts/tests/windows-census-short-provision.test.mjs\n",
    "scripts/tests/windows-census-setup-diagnostics.test.mjs\n"
  ]
]
function censusWithoutReviewedShortProvision(run) {
  for (const [current, previous] of reviewedShortProvisionPairs) {
    assert.equal(run.split(current).length, 2, "one exact owned alias prerequisite delta");
    run = run.replace(current, previous)
  }
  return run
}
function censusWithoutReviewedSetupDiagnostics(run) {
  run = censusWithoutReviewedShortProvision(run)
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
// Validate this exact pre-census prerequisite block before applying old pins.
// The scalar PS regression remains first; fixed build-only acceptance follows.
function censusStepsWithReviewedFirstEvidence723(raw) {
  const steps = workflowYaml.load(raw).jobs['smoke-os'].steps
  // This checks exact source-derived objects, native-only final pair, all lane
  // outcomes and the sole appended lifecycle test before making a legacy view.
  return validateCockpitSteps748(steps)
}
function censusStepsWithReviewedNodeSelection723(raw) {
  return censusStepsWithReviewedFirstEvidence723(raw)
}
test('finite first failure upload cannot widen paths, run on PASS or weaken the native step', () => {
  const raw = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  censusStepsWithReviewedFirstEvidence723(raw)
  for (const mutate of [
    steps => { steps.find(step => step.name === 'Publish finite cockpit first failure (#723)').with.path = '${{ runner.temp }}/**' },
    steps => { steps.find(step => step.name === 'Publish finite cockpit first failure (#723)').if = "always() && matrix.os == 'windows-latest'" },
    steps => { steps.find(step => step.name === 'Windows cockpit native bridge first identity STOP gate (#723)')['continue-on-error'] = true },
    steps => { const step = steps.find(step => step.name === 'Publish finite cockpit first failure (#723)'); steps.push({ ...step }) },
    steps => { delete steps.find(step => step.name === 'Windows cockpit native bridge first identity STOP gate (#723)').id },
  ]) {
    const doc = workflowYaml.load(raw); mutate(doc.jobs['smoke-os'].steps)
    assert.throws(() => censusStepsWithReviewedFirstEvidence723(workflowYaml.dump(doc)))
  }
})
// Validate the complete reviewed macOS-only addition before removing it from
// the original cross-platform schedule pin. Every original Windows gate remains.
function censusStepsWithReviewedTail725(raw) {
  const steps = censusStepsWithReviewedNodeSelection723(raw)
  const name = 'Actual owned PTY tail transport (#725; macOS)'
  const tail = steps.filter(step => step.name === name)
  assert.equal(tail.length, 1, 'one exact directed macOS native tail step')
  assert.deepEqual(tail[0], {
    name, if: "matrix.os == 'macos-latest'", shell: 'bash',
    run: 'cd companion\nnode scripts/run-tests.mjs .test-dist/tests/integration/terminal-tail-native-725.test.js\n',
  }, 'native command, platform and failure semantics remain exact')
  const compile = steps.findIndex(step => step.name === 'Compile shared companion test inputs (#650)')
  assert.ok(compile >= 0)
  assert.equal(steps.indexOf(tail[0]), compile + 1, 'actual native tail follows the shared compile')
  return steps.filter(step => step !== tail[0])
}
function assertCensusSchedule(raw) {
  const steps = censusStepsWithReviewedTail725(raw)
  const names = steps.map(s => s.name)
  const i = names.indexOf('Native Windows read-only Registry discovery (#644)')
  assert.deepEqual(names.slice(i - 1, i + 4), ['Compile shared companion test inputs (#650)', 'Native Windows read-only Registry discovery (#644)', 'Complete Windows Companion census (#650)', 'Windows census finite public receipts (#650)', 'Office compatibility and relocated runtime (#611)'])
  const early = steps.findIndex(s => s.name === 'Pinned NSIS dependency transport and integrity (#633)')
  assert.equal(early, steps.findIndex(s => s.name === 'Install + build companion') + 1)
  assert.ok(early < steps.findIndex(s => s.name === 'Build fixed no-autofocus UIA DLL (#572)'))
  assert.deepEqual(steps[early], { name: 'Pinned NSIS dependency transport and integrity (#633)', run: 'node --test scripts/tests/nsis-ci-setup.test.mjs scripts/tests/windows-ci-feedback-750.test.mjs' })
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
  assert.equal(artifact.if, "always() && matrix.os == 'windows-latest' && matrix.lane == 'census' && steps.windows-census.outputs.public_dir != ''")
  const artifactBeforeLanes = { ...artifact, if: artifact.if.replace(" && matrix.lane == 'census'", '') }
  assert.equal(digest(JSON.stringify(artifactBeforeLanes)), 'bf504e85964e900151325fca797443741ab84ad49d746b0257af2a269fc64697', 'original sealed artifact condition and paths stay exact outside the explicit lane selector')
  const passiveOfficeCommand = 'node --test scripts/tests/office-lock-passive.test.mjs\n'
  assert.equal(office.run.split(passiveOfficeCommand).length, 2, 'the delivered passive Office controls run exactly once')
  assert.ok(office.run.includes('node --test scripts/tests/office-runtime-stage.test.mjs\n' + passiveOfficeCommand), 'passive controls follow the original Office controls')
  assert.equal(digest(office.run.replace(passiveOfficeCommand, '')), '8fb06555123eebe638397b5bc81d5074db606f3aa9192d499b5914095b130402', 'Office retains its original body outside the exact delivered passive command')
  assert.equal(compile.if, undefined)
  assert.equal(office.if, "matrix.lane != 'census'")
  for (const step of [compile, office]) assert.equal(step['continue-on-error'], undefined)
  assert.equal(steps.filter(s => s.name === compile.name).length, 1)
}
test("full census follows verified prerequisites before targeted Office and preserves every native gate", () => {
  assertCensusSchedule(fs.readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n"))
})
test('delivered passive Office controls cannot be omitted, duplicated, moved or waived', () => {
  const raw = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
  const command = 'node --test scripts/tests/office-lock-passive.test.mjs\n'
  assertCensusSchedule(raw)
  for (const change of [
    run => run.replace(command, ''),
    run => run.replace(command, command + command),
    run => run.replace(command, command.trimEnd() + ' || true\n'),
    run => run.replace(command, '') + command,
    run => run.replace('office-runtime-stage.test.mjs', 'omitted-office-controls.test.mjs'),
    run => run.replace('node scripts/smoke-office-runtime.mjs', 'echo smoke-not-executed'),
    run => run + 'echo unreviewed-command\n',
  ]) {
    const document = workflowYaml.load(raw)
    const office = document.jobs['smoke-os'].steps.find(s => s.name === 'Office compatibility and relocated runtime (#611)')
    const changed = change(office.run)
    assert.notEqual(changed, office.run, 'mutants change the actual command body')
    office.run = changed
    assert.throws(() => assertCensusSchedule(workflowYaml.dump(document)))
  }
  const document = workflowYaml.load(raw)
  document.jobs['smoke-os'].steps.find(s => s.name === 'Office compatibility and relocated runtime (#611)')['continue-on-error'] = true
  assert.throws(() => assertCensusSchedule(workflowYaml.dump(document)))
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


test('owned alias provisioning inverse rejects omission/mutation/duplication without weakening original lifecycle pins', () => {
  const raw = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
  const run = workflowYaml.load(raw).jobs['smoke-os'].steps.find(s => s.id === 'windows-census').run
  for (const [current] of reviewedShortProvisionPairs) {
    assert.throws(() => censusWithoutReviewedShortProvision(run.replace(current, '')))
    assert.throws(() => censusWithoutReviewedShortProvision(run + current))
  }
  for (const [from,to] of [['0x10080','0x10081'],['0x02200000','0x02000000'],['CNSUS~1','OTHER~1'],['$shortCreated.ino','$created.ino'],['fileId == 0','fileId != 0']]) {
    assert.ok(run.includes(from)); assert.throws(() => censusWithoutReviewedShortProvision(run.replace(from,to)))
  }
})


test('reviewed macOS tail addition is exact once before preserving every Windows schedule pin', () => {
  const raw = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
  assertCensusSchedule(raw)
  const name = 'Actual owned PTY tail transport (#725; macOS)'
  for (const mutate of [
    (steps, index) => steps.splice(index, 1),
    (steps, index) => steps.splice(index, 0, { ...steps[index] }),
    (steps, index) => { steps[index].if = "matrix.os == 'windows-latest'" },
    (steps, index) => { steps[index]['continue-on-error'] = true },
    (steps, index) => { steps[index].run += 'echo unreviewed-command\n' },
    (steps, index) => { steps[index].run = steps[index].run.replace('terminal-tail-native-725', 'omitted-native') },
    (steps, index) => { steps[index]['timeout-minutes'] = 99 },
    (steps, index) => { const tail = steps.splice(index, 1)[0]; steps.splice(index - 1, 0, tail) },
  ]) {
    const doc = workflowYaml.load(raw), steps = doc.jobs['smoke-os'].steps
    mutate(steps, steps.findIndex(step => step.name === name))
    assert.throws(() => assertCensusSchedule(workflowYaml.dump(doc)))
  }
})

test('reviewed early PowerShell scalar regression preserves every original schedule pin under LF and CRLF', () => {
  const raw = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
  const name = 'Windows cockpit Node scalar selection (#723)'
  for (const source of [raw, raw.replaceAll('\n', '\r\n')]) {
    assertCensusSchedule(source)
    for (const mutate of [
      (steps, index) => steps.splice(index, 1),
      (steps, index) => steps.splice(index, 0, { ...steps[index] }),
      (steps, index) => { steps[index].if = "matrix.os == 'macos-latest'" },
      (steps, index) => { steps[index]['continue-on-error'] = true },
      (steps, index) => { steps[index].shell = 'bash' },
      (steps, index) => { steps[index].run = steps[index].run.replace('cockpit-bridge-node-selection.test.ps1', 'omitted.ps1') },
      (steps, index) => { steps[index].run = steps[index].run.replace('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n', '') },
      (steps, index) => { steps[index].run += 'echo unreviewed-command\n' },
      (steps, index) => { steps[index]['timeout-minutes'] = 99 },
      (steps, index) => { const step = steps.splice(index, 1)[0]; steps.splice(index - 1, 0, step) },
      (steps, index) => { const step = steps.splice(index, 1)[0]; steps.splice(index + 1, 0, step) },
    ]) {
      const doc = workflowYaml.load(source), steps = doc.jobs['smoke-os'].steps
      mutate(steps, steps.findIndex(step => step.name === name))
      assert.throws(() => assertCensusSchedule(workflowYaml.dump(doc)))
    }
  }
})
