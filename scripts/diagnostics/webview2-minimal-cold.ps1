param([Parameter(Mandatory=$true)][ValidateSet('os-only','known-local-app-data')][string]$Mode)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows') { throw 'DISPOSABLE_WINDOWS_REQUIRED' }
$root = Join-Path $env:RUNNER_TEMP ('cmspark-minimal-webview2-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$process = $null
try {
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = (Resolve-Path -LiteralPath 'companion/dist/desktop-native/webview2-minimal-cold.exe').Path
  $start.WorkingDirectory = $root
  $start.UseShellExecute = $false
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $os = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
  $start.Environment.Clear()
  $start.Environment['PATH'] = "$os\System32;$os"
  $start.Environment['SystemRoot'] = $os
  $start.Environment['SystemDrive'] = [IO.Path]::GetPathRoot($os).TrimEnd('\')
  $start.Environment['TEMP'] = $root
  $start.Environment['TMP'] = $root
  if ($Mode -ceq 'known-local-app-data') {
    $local = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if (-not [IO.Directory]::Exists($local)) { throw 'KNOWN_LOCAL_APP_DATA_REQUIRED' }
    $start.Environment['LOCALAPPDATA'] = $local
  }
  "Image=$env:ImageVersion Mode=$Mode"
  $runtime = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'
  Get-ChildItem -LiteralPath $runtime -Directory | Where-Object Name -Match '^\d+\.\d+\.\d+\.\d+$' | ForEach-Object { "WebView2=$($_.Name)" }
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $process = [Diagnostics.Process]::Start($start)
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  $finished = $process.WaitForExit([Math]::Max(0, 20000 - [int]$timer.ElapsedMilliseconds))
  if (-not $finished) { $process.Kill(); $null = $process.WaitForExit(3000) }
  if ($stdout.Wait(3000)) {
    $stdout.Result -split '\r?\n' | Where-Object { $_ -cmatch '^WEBVIEW2_PHASE (MAIN|ENV_CALL|ENV_RETURN|ENV_CALLBACK|CONTROLLER_CALL|CONTROLLER_RETURN|CONTROLLER_CALLBACK) \d{1,6} 0x[0-9A-F]{8}$' }
  }
  if (-not $finished) { throw 'DIAGNOSTIC_20_SECOND_DEADLINE' }
  if ($process.ExitCode -ne 0) { throw ('DIAGNOSTIC_EXIT_' + [int]$process.ExitCode) }
} finally {
  if ($null -ne $process) { $process.Dispose() }
  $resolved = [IO.Path]::GetFullPath($root)
  $expectedParent = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
  if ([IO.Path]::GetDirectoryName($resolved) -ceq $expectedParent -and [IO.Path]::GetFileName($resolved) -cmatch '^cmspark-minimal-webview2-[0-9a-f]{32}$') {
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
  }
}
