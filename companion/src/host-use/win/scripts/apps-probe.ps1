# apps-probe.ps1 — post-launch process-existence probe for the App tab (WP3, D7).
#
# Answers one question: "is a process with this EXACT image name running?"
# Used by apps/launch.ts to classify launch evidence semantically
# ("process_running" / "already_running") instead of the quick-exit heuristic
# that would misreport single-instance apps (网易云 stub launcher, Spotify).
#
# Contract (companion/src/host-use/win/powershell.ts):
#   exit 0 + single-line JSON on stdout: {"running":<bool>,"count":<n>,"main_window":<bool>}
#   any failure → non-zero exit + stderr message.
# The image name travels exclusively as argv (-ImageName) and is matched with
# -eq (exact, case-insensitive) — NEVER Get-Process -Name, which would treat
# wildcard characters (* ? [ ]) in the name as a pattern.

param(
  [Parameter(Mandatory=$true)][string]$ImageName
)

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

try {
  # Exact ProcessName match (no wildcard semantics); fastest via direct filter.
  $procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq $ImageName })
  $withWindow = @($procs | Where-Object { $_.MainWindowHandle -ne 0 }).Count
  Write-Output (ConvertTo-Json -Compress -InputObject @{
    running     = ($procs.Count -gt 0)
    count       = $procs.Count
    main_window = ($withWindow -gt 0)
  })
  exit 0
} catch {
  [Console]::Error.WriteLine("apps-probe: $($_.Exception.Message)")
  exit 1
}
