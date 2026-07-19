# computer-estop.ps1 — WP2 emergency-stop hotkey helper (plan §E.6).
#
# Resident per-user helper. Watches the global key chord Ctrl+Alt+End (edge-
# triggered, 50ms poll via GetAsyncKeyState); on press it (re)creates
# %TEMP%/cmspark-computer/estop.flag. Two consumers poll that flag: the TS
# executor's abortCheck (between actions / during waits) and
# computer-input.ps1 -StopFile (between type characters).
#
# Why GetAsyncKeyState polling instead of RegisterHotKey: a console-script
# thread queue is fragile (pumping semantics vary across hosts), another app
# can already OWN the chord (registration then fails closed and the kill
# switch is silently absent), and polling cannot be stolen. 50ms polling
# costs nothing and the press-to-flag latency stays well under 500ms.
#
# Liveness contract (fail-closed): estop-ready.json must parse, hotkeyOk must
# be true, and heartbeat must be < 3s old — otherwise the companion refuses
# to START a computer task (EMERGENCY_STOP_UNAVAILABLE). This script
# heartbeats every loop iteration and deletes the ready file on exit.
param(
  [string]$ReadyFile = "",
  [string]$FlagFile = ""
)
$ErrorActionPreference = 'Stop'

$dir = Join-Path $env:TEMP 'cmspark-computer'
if ($ReadyFile -eq "") { $ReadyFile = Join-Path $dir 'estop-ready.json' }
if ($FlagFile -eq "") { $FlagFile = Join-Path $dir 'estop.flag' }
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class EstopW32 {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
}
'@

$VK_CONTROL = 0x11; $VK_MENU = 0x12; $VK_END = 0x23

function Test-Chord {
  # High bit set = key is currently down. Require ALL THREE so a plain End or
  # a Ctrl+Alt combination never false-fires the kill switch.
  return (([EstopW32]::GetAsyncKeyState($VK_CONTROL) -band 0x8000) -ne 0) -and
         (([EstopW32]::GetAsyncKeyState($VK_MENU)    -band 0x8000) -ne 0) -and
         (([EstopW32]::GetAsyncKeyState($VK_END)     -band 0x8000) -ne 0)
}

function Write-Heartbeat {
  $tmp = "$ReadyFile.tmp"
  [IO.File]::WriteAllText($tmp, (ConvertTo-Json -Compress -InputObject ([ordered]@{
    pid = $PID; hotkeyOk = $true; heartbeat = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  })))
  Move-Item -Force -LiteralPath $tmp -Destination $ReadyFile
}

# A flag left by a PREVIOUS helper session must not abort the next task.
Remove-Item -LiteralPath $FlagFile -Force -ErrorAction SilentlyContinue

Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
  ok = $true; pid = $PID; hotkey = 'Ctrl+Alt+End'; mode = 'GetAsyncKeyState-poll'; readyFile = $ReadyFile; flagFile = $FlagFile
}))

$armed = $true # edge trigger: re-arm only after the chord is fully released
try {
  while ($true) {
    $down = Test-Chord
    if ($down -and $armed) {
      [IO.File]::WriteAllText($FlagFile, [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString())
      $armed = $false
    } elseif (-not $down) {
      $armed = $true
    }
    Write-Heartbeat
    Start-Sleep -Milliseconds 50
  }
} finally {
  Remove-Item -LiteralPath $ReadyFile -Force -ErrorAction SilentlyContinue
}
