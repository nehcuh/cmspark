# apps-enumerate.ps1 — enumerate add-app candidates for the App tab (WP2).
# Merges two sources (design §1, adversary D12 — registry Uninstall scan is P2):
#   (a) running GUI processes: Get-Process with a MainWindowTitle + resolvable .Path
#   (b) Get-StartApps: AppID containing "!" → UWP AUMID; otherwise treated as a
#       win32 path candidate and kept only when it resolves to an existing file.
#
# Contract (companion/src/host-use/win/powershell.ts):
#   exit 0 + single-line JSON on stdout:
#     {"apps":[{"name":"...","source":"running"|"startapps","path":"...","aumid":"..."}]}
#   (exactly one of path/aumid per entry)
#   failure → non-zero exit + stderr message.
# The script takes NO argv input — nothing caller-controlled is interpolated.

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$apps = New-Object System.Collections.Generic.List[object]
$seen = @{}   # dedupe key: lowercase canonical path, or "aumid:<lowercase id>"

# --- (a) running GUI processes ---------------------------------------------
# Best-effort: .Path can throw access-denied for elevated/system processes —
# those entries are skipped, not fatal.
try {
  Get-Process | Where-Object { -not [string]::IsNullOrEmpty($_.MainWindowTitle) } | ForEach-Object {
    $p = $null
    try { $p = $_.Path } catch { $p = $null }
    if ([string]::IsNullOrEmpty($p)) { return }
    $key = $p.ToLowerInvariant()
    if ($seen.ContainsKey($key)) { return }
    $seen[$key] = $true
    $name = $_.Description
    if ([string]::IsNullOrEmpty($name)) { $name = $_.ProcessName }
    $apps.Add(@{ name = [string]$name; source = "running"; path = [string]$p })
  }
} catch {
  # running-process enumeration is best-effort; startapps may still succeed.
}

# --- (b) Get-StartApps (win32 Start Menu + UWP) -----------------------------
try {
  Get-StartApps | ForEach-Object {
    $appId = [string]$_.AppID
    $name = [string]$_.Name
    if ([string]::IsNullOrEmpty($appId)) { return }
    if ($appId.Contains("!")) {
      # UWP / packaged app — AppID is an AUMID (PackageFamilyName!AppId).
      $key = "aumid:" + $appId.ToLowerInvariant()
      if ($seen.ContainsKey($key)) { return }
      $seen[$key] = $true
      $apps.Add(@{ name = $name; source = "startapps"; aumid = $appId })
    } else {
      # win32 entry: AppID may be a path (or a bare name). Keep only when it
      # resolves to an existing file — unresolved registry names are skipped
      # (surfacing them is P2 registry-Uninstall scope).
      $resolved = $null
      try {
        if (Test-Path -LiteralPath $appId) { $resolved = (Resolve-Path -LiteralPath $appId).Path }
      } catch { $resolved = $null }
      if ([string]::IsNullOrEmpty($resolved)) { return }
      $key = $resolved.ToLowerInvariant()
      if ($seen.ContainsKey($key)) { return }
      $seen[$key] = $true
      $apps.Add(@{ name = $name; source = "startapps"; path = $resolved })
    }
  }
} catch {
  # Get-StartApps unavailable (exotic SKU) — running-only result is still useful.
}

# NOTE: ConvertTo-Json in PS 5.1 rejects @($genericList) ("参数类型不匹配") —
# materialize with .ToArray() first.
Write-Output (ConvertTo-Json -Compress -InputObject @{ apps = $apps.ToArray() })
exit 0
