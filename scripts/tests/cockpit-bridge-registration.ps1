# Remote-only CPU/build/owned-registration admission. This is not the real
# Chrome/native-port positive gate and cannot enable masking.
param([Parameter(Mandatory=$true)][string]$TestRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or -not [Environment]::Is64BitOperatingSystem) { throw 'COCKPIT_BRIDGE_REMOTE_ONLY' }
if (-not $env:CMSPARK_TEST_RUN_DIR -or -not [IO.Path]::IsPathRooted($TestRoot)) { throw 'COCKPIT_BRIDGE_OWNED_ROOT_REQUIRED' }
$admissionRoot = (Get-Item -LiteralPath $env:CMSPARK_TEST_RUN_DIR).FullName.TrimEnd('\') + '\'
$providedRoot = (Get-Item -LiteralPath $TestRoot).FullName.TrimEnd('\') + '\'
if (-not $providedRoot.StartsWith($admissionRoot, [StringComparison]::OrdinalIgnoreCase) -or $providedRoot -ceq $admissionRoot -or
    ((Get-Item -LiteralPath $TestRoot).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'COCKPIT_BRIDGE_OWNED_ROOT_REQUIRED' }
$repo = (Get-Item -LiteralPath (Join-Path $PSScriptRoot '..\..')).FullName
$root = Join-Path $TestRoot ('cockpit-bridge-' + [guid]::NewGuid().ToString('N'))
$subkey = 'Software\Google\Chrome\NativeMessagingHosts\com.cmspark.cockpit'
$bases = @{}
$child = $null
$registered = $false
$foreign = $null
$counts = [ordered]@{ csharpFraming = 0; registration = 0; unregister = 0; negativeNative = 0; realChromePositive = 'NOT_RUN' }
$utf8 = [Text.UTF8Encoding]::new($false, $true)
function Check([bool]$Value) { if (-not $Value) { throw 'COCKPIT_BRIDGE_REGISTRATION_ASSERT' } }
function Refused([scriptblock]$Run, [string]$Reason) {
  $observed = $false
  try { & $Run | Out-Null } catch { if ($_.Exception.Message -cne $Reason) { throw }; $observed = $true }
  Check $observed
  $counts.registration++
}
try {
  # Admission is read-only until both exact host keys are absent. Never save,
  # delete or temporarily replace a user/foreign registration.
  foreach ($view in @('Registry32', 'Registry64')) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::$view)
    $bases[$view] = $base
    $key = $base.OpenSubKey($subkey, $false)
    if ($null -ne $key) { $key.Dispose(); throw 'COCKPIT_BRIDGE_FIXED_KEY_OCCUPIED' }
  }
  Check (-not (Test-Path -LiteralPath $root))
  New-Item -ItemType Directory -Path $root | Out-Null
  $bin = Join-Path $root 'bin'
  New-Item -ItemType Directory -Path $bin | Out-Null
  & (Join-Path $repo 'scripts\build-cockpit-native-bridge.ps1') -OutputDirectory $bin | Out-Null
  $compiler = @('Framework64', 'Framework') | ForEach-Object { Join-Path $env:SystemRoot "Microsoft.NET\$_\v4.0.30319\csc.exe" } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (-not $compiler) { throw 'COCKPIT_BRIDGE_BUILD_COMPILER' }
  $cpu = Join-Path $root 'framing.exe'
  & $compiler /nologo /target:exe /platform:x64 /warn:4 /warnaserror+ /codepage:65001 /main:CMspark.CockpitBridge.FramingTests ('/out:' + $cpu) (Join-Path $repo 'companion\src\computer\native\cockpit-bridge-host.cs') (Join-Path $repo 'scripts\tests\cockpit-bridge-framing.cs')
  Check ($LASTEXITCODE -eq 0)
  $receipt = & $cpu
  Check ($LASTEXITCODE -eq 0)
  $cpuReceipt = $receipt | ConvertFrom-Json
  Check ($cpuReceipt.kind -ceq 'controlled-csharp-framing' -and $cpuReceipt.native -ceq 'NOT_RUN' -and $cpuReceipt.passed -gt 0)
  $counts.csharpFraming = $cpuReceipt.passed
  # Keep the actual serializer output, not a manually assembled native DTO.
  [IO.File]::WriteAllText((Join-Path $root 'framing-producer.json'), $receipt + "`n", $utf8)
  $register = Join-Path $repo 'scripts\register-cockpit-native-bridge.ps1'
  Refused { & $register -InstallRoot $root } 'COCKPIT_BRIDGE_EXACT_ID_REQUIRED'
  Refused { & $register -InstallRoot $root -ExtensionId '*' } 'COCKPIT_BRIDGE_EXACT_ID_REQUIRED'
  Refused { & $register -InstallRoot $root -ExtensionId ('q' * 32) } 'COCKPIT_BRIDGE_EXACT_ID_REQUIRED'
  $id = 'a' * 32 # Explicit offline operator value, never a Chrome identity claim.
  $result = & $register -InstallRoot $root -ExtensionId $id
  Check ($result -ceq 'COCKPIT_BRIDGE_REGISTERED'); $registered = $true; $counts.registration++
  $result = & $register -InstallRoot $root -ExtensionId $id
  Check ($result -ceq 'COCKPIT_BRIDGE_ALREADY_REGISTERED'); $counts.registration++
  Refused { & $register -InstallRoot $root -ExtensionId ('b' * 32) } 'COCKPIT_BRIDGE_REGISTRATION_EXPLICIT_UNBIND_REQUIRED'
  # HKCU\Software is shared: both logical views must see this same owned
  # value, not be mistaken for two independent registrations/shadow keys.
  foreach ($view in @('Registry32', 'Registry64')) {
    $alias = $bases[$view].OpenSubKey($subkey, $false)
    try { Check ($null -ne $alias -and $alias.GetValue('') -ceq (Join-Path $root 'native-messaging\com.cmspark.cockpit.json') -and $alias.GetValueKind('') -eq [Microsoft.Win32.RegistryValueKind]::String -and $alias.ValueCount -eq 1 -and $alias.SubKeyCount -eq 0) }
    finally { if ($null -ne $alias) { $alias.Dispose() } }
  }
  $manifest = Join-Path $root 'native-messaging\com.cmspark.cockpit.json'
  $record = Join-Path $root 'native-messaging\registration.json'
  $originalManifest = [IO.File]::ReadAllBytes($manifest)
  $originalRecord = [IO.File]::ReadAllBytes($record)
  $parsed = $utf8.GetString($originalManifest) | ConvertFrom-Json
  Check (@($parsed.allowed_origins).Count -eq 1 -and $parsed.allowed_origins[0] -ceq ('chrome-extension://' + $id + '/'))
  # Changed bytes cannot become an uninstall ownership receipt.
  $changed = $utf8.GetBytes($utf8.GetString($originalManifest) + ' ')
  [IO.File]::WriteAllBytes($manifest, $changed)
  try {
    Refused { & $register -InstallRoot $root -Unregister } 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT'
    Check ([Convert]::ToBase64String([IO.File]::ReadAllBytes($manifest)) -ceq [Convert]::ToBase64String($changed))
    Check ([Convert]::ToBase64String([IO.File]::ReadAllBytes($record)) -ceq [Convert]::ToBase64String($originalRecord))
  } finally {
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($manifest)) -ceq [Convert]::ToBase64String($changed)) { [IO.File]::WriteAllBytes($manifest, $originalManifest) }
  }
  # Mutate only this fixture's just-created key. Matching text in a different
  # value kind must not retain the own REG_SZ record's cleanup authority.
  $key = $bases.Registry64.OpenSubKey($subkey, $true)
  try { $key.SetValue('', $manifest, [Microsoft.Win32.RegistryValueKind]::ExpandString) } finally { $key.Dispose() }
  try {
    Refused { & $register -InstallRoot $root -ExtensionId $id } 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT'
    $key = $bases.Registry64.OpenSubKey($subkey, $false)
    try { Check ($key.GetValueKind('') -eq [Microsoft.Win32.RegistryValueKind]::ExpandString -and $key.GetValue('') -ceq $manifest) } finally { $key.Dispose() }
  } finally {
    $key = $bases.Registry64.OpenSubKey($subkey, $true)
    try {
      if ($key.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::ExpandString -or $key.GetValue('') -cne $manifest -or $key.ValueCount -ne 1 -or $key.SubKeyCount -ne 0) { throw 'COCKPIT_BRIDGE_REGISTRY_FIXTURE_OWNERSHIP_CHANGED' }
      $key.SetValue('', $manifest, [Microsoft.Win32.RegistryValueKind]::String)
    } finally { $key.Dispose() }
  }
  # The actual fixed exe is invoked with a deliberate non-Chrome parent/stdio.
  # No fake bound/metadata is supplied. It must emit its fixed refusal and exit1.
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = Join-Path $bin 'cmspark-cockpit-bridge.exe'
  $start.Arguments = 'chrome-extension://' + $id + '/ --parent-window=1'
  $start.UseShellExecute = $false; $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
  $child = [Diagnostics.Process]::Start($start)
  $body = $utf8.GetBytes(([ordered]@{ v = 1; op = 'bind'; ownerNonce = ('a' * 32); challenge = ('b' * 64); documentId = 'non-chrome-negative'; windowId = 1 } | ConvertTo-Json -Compress))
  $length = [BitConverter]::GetBytes([uint32]$body.Length)
  $child.StandardInput.BaseStream.Write($length, 0, 4); $child.StandardInput.BaseStream.Write($body, 0, $body.Length); $child.StandardInput.BaseStream.Flush(); $child.StandardInput.Close()
  $memory = [IO.MemoryStream]::new()
  $copy = $child.StandardOutput.BaseStream.CopyToAsync($memory)
  $stderr = $child.StandardError.ReadToEndAsync()
  Check ($child.WaitForExit(15000))
  $copy.GetAwaiter().GetResult(); $errorText = $stderr.GetAwaiter().GetResult()
  Check ($child.ExitCode -eq 1 -and $errorText -ceq '')
  $bytes = $memory.ToArray(); $memory.Dispose()
  Check ($bytes.Length -ge 4 -and $bytes.Length -le 4100)
  $n = [BitConverter]::ToUInt32($bytes, 0); Check ($n -eq ($bytes.Length - 4))
  $json = $utf8.GetString($bytes, 4, $n)
  Check ($json -ceq '{"v":1,"op":"unavailable","reason":"bridge_unavailable"}')
  $counts.negativeNative++
  $result = & $register -InstallRoot $root -Unregister
  Check ($result -ceq 'COCKPIT_BRIDGE_UNREGISTERED'); $registered = $false; $counts.unregister++
  # The existing-key conflict is newly owned. Registry32 is an alias of the
  # shared HKCU key, not a second physical shadow registration.
  $foreign = Join-Path $root 'other-owned-manifest.json'
  $key = $bases.Registry32.CreateSubKey($subkey, $true)
  try { $key.SetValue('', $foreign, [Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
  Refused { & $register -InstallRoot $root -ExtensionId $id } 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT'
  $key = $bases.Registry32.OpenSubKey($subkey, $false)
  try { Check ($key.GetValue('') -ceq $foreign -and $key.ValueCount -eq 1 -and $key.SubKeyCount -eq 0) } finally { $key.Dispose() }
  $bases.Registry32.DeleteSubKey($subkey, $false); $foreign = $null
  Write-Output ($counts | ConvertTo-Json -Compress)
} finally {
  if ($child) {
    if (-not $child.HasExited) { $child.Kill(); if (-not $child.WaitForExit(15000)) { throw 'COCKPIT_BRIDGE_CHILD_NOT_CLOSED' } }
    $child.Dispose()
  }
  if ($registered) { & (Join-Path $repo 'scripts\register-cockpit-native-bridge.ps1') -InstallRoot $root -Unregister | Out-Null }
  if ($foreign) {
    $key = $bases.Registry32.OpenSubKey($subkey, $false)
    if ($key) {
      try { $own = $key.GetValue('') -ceq $foreign -and $key.ValueCount -eq 1 -and $key.SubKeyCount -eq 0 } finally { $key.Dispose() }
      if ($own) { $bases.Registry32.DeleteSubKey($subkey, $false) }
    }
  }
  foreach ($base in $bases.Values) { $base.Dispose() }
  # Owned fresh scratch only; keep failing scratch for the admitted operator.
  # A successful caller may remove it after binding its source/receipt hashes.
}
