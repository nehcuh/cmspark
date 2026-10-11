$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Cmspark604Paths {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint GetShortPathName(string source, StringBuilder dest, uint size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint GetLongPathName(string source, StringBuilder dest, uint size);
}
'@
function Convert-OwnedPath([string]$Path, [bool]$Short) {
  $buffer = [System.Text.StringBuilder]::new(32768)
  $length = if ($Short) { [Cmspark604Paths]::GetShortPathName($Path, $buffer, 32768) } else { [Cmspark604Paths]::GetLongPathName($Path, $buffer, 32768) }
  if ($length -eq 0 -or $length -ge 32768) { throw "Native path conversion failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  return $buffer.ToString()
}
$fixture = Join-Path $env:TEMP "cmspark short path owned $([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
  $env:CMSPARK_TEST_LONG_ROOT = Convert-OwnedPath $fixture $false
  $env:CMSPARK_TEST_SHORT_ROOT = Convert-OwnedPath $env:CMSPARK_TEST_LONG_ROOT $true
  if ($env:CMSPARK_TEST_SHORT_ROOT -notmatch '~\d' -or $env:CMSPARK_TEST_SHORT_ROOT -eq $env:CMSPARK_TEST_LONG_ROOT) {
    throw 'A real Windows 8.3 alias is required; this test must not skip'
  }
  Write-Host "#604 native long root: $env:CMSPARK_TEST_LONG_ROOT"
  Write-Host "#604 native 8.3 root: $env:CMSPARK_TEST_SHORT_ROOT"
  Push-Location (Join-Path $PSScriptRoot '../../companion')
  try {
    node scripts/run-tests.mjs .test-dist/tests/mcp-short-path.test.js .test-dist/tests/integration/mcp-short-path-win.test.js
    if ($LASTEXITCODE -ne 0) { throw "#604 native Windows regressions failed: $LASTEXITCODE" }
  } finally { Pop-Location }
} finally {
  Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item Env:CMSPARK_TEST_LONG_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:CMSPARK_TEST_SHORT_ROOT -ErrorAction SilentlyContinue
}
