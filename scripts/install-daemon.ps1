# CMspark Windows Daemon Installer
# ================================
# Registers CMspark Companion as a Windows Task Scheduler job.
# Run as the target user (no admin required for user-level tasks).
#
# Usage: .\install-daemon.ps1

param(
    [switch]$Force
)

$Label = "cmspark-companion"
$TaskPath = "\$Label"
$DataDir = "$env:USERPROFILE\.cmspark-agent"
$LogDir = "$DataDir\logs"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Info($msg) { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Err($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }

# ---------------------------------------------------------------------------
# 0. Check prerequisites
# ---------------------------------------------------------------------------

Info "Checking prerequisites..."

$NodeCmd = $null
if (Get-Command node -ErrorAction SilentlyContinue) {
    $NodeCmd = "node"
} elseif (Test-Path "$RepoRoot\companion\node.exe") {
    $NodeCmd = "$RepoRoot\companion\node.exe"
} else {
    Err "Node.js not found. Please install Node.js or ensure node.exe is in the project root."
    exit 1
}

$AgentScript = "$RepoRoot\companion\dist\index.js"
if (-not (Test-Path $AgentScript)) {
    Warn "Companion not built yet. Building now..."
    Push-Location "$RepoRoot\companion"
    & $NodeCmd npm run build
    Pop-Location
    if (-not (Test-Path $AgentScript)) {
        Err "Build failed. Please run 'npm run build' in the companion directory."
        exit 1
    }
}

Info "Found Node.js: $NodeCmd"
Info "Found agent script: $AgentScript"

# ---------------------------------------------------------------------------
# 1. Create data directory
# ---------------------------------------------------------------------------

Info "Creating data directory: $DataDir"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ---------------------------------------------------------------------------
# 2. Remove existing task if present
# ---------------------------------------------------------------------------

$ExistingTask = Get-ScheduledTask -TaskName $Label -ErrorAction SilentlyContinue
if ($ExistingTask) {
    if ($Force) {
        Info "Removing existing task..."
        Unregister-ScheduledTask -TaskName $Label -Confirm:$false
    } else {
        Warn "Task '$Label' already exists. Use -Force to overwrite."
        exit 1
    }
}

# ---------------------------------------------------------------------------
# 3. Register Task Scheduler job
# ---------------------------------------------------------------------------

Info "Registering Task Scheduler job: $Label"

$Action = New-ScheduledTaskAction -Execute $NodeCmd -Argument "$AgentScript daemon start --daemonize" -WorkingDirectory "$RepoRoot\companion"

$Trigger = New-ScheduledTaskTrigger -AtLogOn

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -RunLevel Limited

Register-ScheduledTask `
    -TaskName $Label `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Force | Out-Null

# ---------------------------------------------------------------------------
# 4. Verify registration
# ---------------------------------------------------------------------------

$RegisteredTask = Get-ScheduledTask -TaskName $Label -ErrorAction SilentlyContinue
if (-not $RegisteredTask) {
    Err "Failed to register task. Check Event Viewer for details."
    exit 1
}

Info "Task registered successfully."

# ---------------------------------------------------------------------------
# 5. Start the task
# ---------------------------------------------------------------------------

Info "Starting Companion daemon..."
Start-ScheduledTask -TaskName $Label

Start-Sleep -Seconds 2

# ---------------------------------------------------------------------------
# 6. Create Start Menu shortcut
# ---------------------------------------------------------------------------

$StartMenuDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\CMspark"
New-Item -ItemType Directory -Force -Path $StartMenuDir | Out-Null

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$StartMenuDir\CMspark Agent.lnk")
$Shortcut.TargetPath = $NodeCmd
$Shortcut.Arguments = "$AgentScript tray"
$Shortcut.WorkingDirectory = "$RepoRoot\companion"
$Shortcut.Description = "CMspark Browser Agent Menu Bar"
$Shortcut.Save()

Info "Start Menu shortcut created."

# ---------------------------------------------------------------------------
# 7. Summary
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  CMspark Windows Install Complete" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Task name     : $Label"
Write-Host "  Data directory: $DataDir"
Write-Host "  Logs directory: $LogDir"
Write-Host "  Start Menu    : $StartMenuDir\CMspark Agent.lnk"
Write-Host ""
Write-Host "  Commands:"
Write-Host "    Start  : Start-ScheduledTask -TaskName $Label"
Write-Host "    Stop   : Stop-ScheduledTask -TaskName $Label"
Write-Host "    Status : Get-ScheduledTask -TaskName $Label"
Write-Host "    Remove : Unregister-ScheduledTask -TaskName $Label"
Write-Host ""
Write-Host "  To uninstall, run: .\scripts\uninstall-daemon.ps1"
Write-Host ""
