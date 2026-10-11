# CMspark Windows Daemon Uninstaller
# ==================================
# Removes the CMspark Companion Windows Task Scheduler job.
#
# Usage: .\uninstall-daemon.ps1 [-Purge]

param(
    [switch]$Purge
)

$ErrorActionPreference = "Stop"
$Label = "cmspark-companion"
$DataDir = if ($env:CMSPARK_DATA_DIR) { $env:CMSPARK_DATA_DIR } else { "$env:USERPROFILE\.cmspark-agent" }
$StartMenuDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\CMspark"

function Info($msg) { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }

# ---------------------------------------------------------------------------
# 1. Stop and remove scheduled task
# ---------------------------------------------------------------------------

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$AgentScript = "$RepoRoot\companion\dist\index.js"
$ExistingTask = Get-ScheduledTask -TaskName $Label -ErrorAction SilentlyContinue
if (Test-Path $AgentScript) {
    $NodeCmd = if (Get-Command node -ErrorAction SilentlyContinue) { (Get-Command node -ErrorAction Stop).Source }
        elseif (Test-Path "$RepoRoot\companion\node.exe") { "$RepoRoot\companion\node.exe" }
        else { throw "Node.js missing; daemon state preserved" }
    & $NodeCmd $AgentScript daemon stop
    if ($LASTEXITCODE -ne 0) { throw "Daemon did not stop; uninstall aborted and state preserved" }
} elseif ((Test-Path "$DataDir\daemon.pid") -or ($ExistingTask -and $ExistingTask.State -eq "Running")) { throw "Agent entrypoint missing; daemon state preserved" }
if ($ExistingTask) {
    Info "Stopping scheduled task: $Label"
    Stop-ScheduledTask -TaskName $Label -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Info "Removing scheduled task: $Label"
    Unregister-ScheduledTask -TaskName $Label -Confirm:$false
} else {
    Warn "Scheduled task '$Label' not found."
}

# ---------------------------------------------------------------------------
# 2. Remove Start Menu shortcut
# ---------------------------------------------------------------------------

if (Test-Path "$StartMenuDir\CMspark Agent.lnk") {
    Info "Removing Start Menu shortcut..."
    Remove-Item -Path "$StartMenuDir\CMspark Agent.lnk" -Force
}
if (Test-Path $StartMenuDir) {
    $Remaining = Get-ChildItem $StartMenuDir -ErrorAction SilentlyContinue
    if (-not $Remaining) {
        Remove-Item -Path $StartMenuDir -Force
    }
}

# ---------------------------------------------------------------------------
# 3. Clean up lock files
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 4. Optionally purge data directory
# ---------------------------------------------------------------------------

if ($Purge) {
    if (Test-Path $DataDir) {
        Info "Purging data directory: $DataDir"
        Remove-Item -Path $DataDir -Recurse -Force
    }
} else {
    if (Test-Path $DataDir) {
        Write-Host ""
        $Answer = Read-Host "Also delete data directory $DataDir? [y/N]"
        if ($Answer -match '^[Yy]$') {
            Info "Removing data directory: $DataDir"
            Remove-Item -Path $DataDir -Recurse -Force
        } else {
            Info "Data directory preserved: $DataDir"
        }
    }
}

# ---------------------------------------------------------------------------
# 5. Summary
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  CMspark Windows Uninstall Complete" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
