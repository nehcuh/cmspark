# =============================================================================
# CMspark Windows EXE Builder
# =============================================================================
# Uses Node.js SEA (Single Executable Application) to produce a real .exe
# that users can run without installing Node.js separately.
#
# Version: read from companion/package.json (same SoT as package.sh / create-dmg.sh).
# Keep chrome-extension/package.json version in lock-step for the MV3 manifest.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows-exe.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows-exe.ps1 -SkipInstall
#
# Output (version from package.json, example 0.5.1):
#   dist-package\cmspark-windows-x64\cmspark-agent.exe   <- standalone SEA exe
#   dist-package\cmspark-windows-x64\bin\cmspark-whisper-win-x64.exe  <- local STT (if prepared)
#   dist-package\CMspark-v{version}-windows-x64.zip     <- portable package
#   dist-package\CMspark-Setup-v{version}.exe             <- NSIS installer (if makensis found)
#
# Local STT (Path B): whisper is NOT embedded inside the SEA blob. Stage a native
# binary before packaging:
#   companion\dist\bin\cmspark-whisper-win-x64.exe
# If missing, build still succeeds; local STT is disabled at runtime (binary_missing).
# =============================================================================

[CmdletBinding()]
param(
    [switch]$SkipInstall,  # Skip npm install (use if already installed)
    [switch]$SkipNsis      # Skip NSIS installer step even if makensis is found
)

$ErrorActionPreference = "Stop"

$ProjectRoot  = Split-Path -Parent $PSScriptRoot
$CompanionDir = Join-Path $ProjectRoot "companion"
$ChromeExtDir = Join-Path $ProjectRoot "chrome-extension"
$DistDir      = Join-Path $ProjectRoot "dist-package"
$StagingDir   = Join-Path $DistDir "cmspark-windows-x64"

# Single source of truth — never hardcode product version here.
$PkgJson = Join-Path $CompanionDir "package.json"
if (-not (Test-Path $PkgJson)) { Write-Error "missing $PkgJson"; exit 1 }
$Version = (Get-Content $PkgJson -Raw | ConvertFrom-Json).version
if (-not $Version) { Write-Error "companion/package.json has no version"; exit 1 }

function Step($n, $total, $msg) {
    Write-Host "[$n/$total] $msg" -ForegroundColor Yellow
}

function Ok($msg) { Write-Host "  > $msg" -ForegroundColor Green }
function Warn($msg) { Write-Warning $msg }
function Fail($msg) { Write-Error $msg; exit 1 }

# Cross-check extension (MV3) stays aligned — fail-closed for release packaging (S52 N4).
# Local override: $env:CMSPARK_ALLOW_VERSION_DRIFT=1 for intentional dev mismatch.
$ExtPkg = Join-Path $ChromeExtDir "package.json"
if (Test-Path $ExtPkg) {
    $ExtVer = (Get-Content $ExtPkg -Raw | ConvertFrom-Json).version
    if ($ExtVer -and $ExtVer -ne $Version) {
        $msg = "chrome-extension version ($ExtVer) != companion ($Version) — ship both at the same version"
        if ($env:CMSPARK_ALLOW_VERSION_DRIFT -eq "1") {
            Write-Warning $msg
        } else {
            Fail $msg
        }
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  CMspark Windows EXE Builder  v$Version" -ForegroundColor Cyan
Write-Host "============================================"
Write-Host ""

# ---------------------------------------------------------------------------
# [1/6] Install dependencies
# ---------------------------------------------------------------------------
Step 1 6 "Installing dependencies..."

if (-not $SkipInstall) {
    Push-Location $CompanionDir
    try {
        # Use --ignore-scripts on first pass to avoid postinstall failures;
        # then run postinstall manually (verify-systray2 is warn-only, build-swift-tray is macOS-only)
        npm install
        if ($LASTEXITCODE -ne 0) { Fail "npm install failed for companion" }
        Ok "companion dependencies installed"
    } finally { Pop-Location }

    Push-Location $ChromeExtDir
    try {
        npm install
        if ($LASTEXITCODE -ne 0) { Warn "npm install failed for chrome-extension (non-fatal)" }
        else { Ok "chrome-extension dependencies installed" }
    } finally { Pop-Location }
} else {
    Ok "Skipped (--SkipInstall)"
}

# ---------------------------------------------------------------------------
# [2/6] Build TypeScript + esbuild bundle
# ---------------------------------------------------------------------------
Step 2 6 "Building TypeScript and bundling with esbuild..."

Push-Location $CompanionDir
try {
    # TypeScript compilation (uses prebuild hook to generate tray icons)
    npx tsc
    if ($LASTEXITCODE -ne 0) { Fail "TypeScript compilation failed" }
    Ok "TypeScript compiled to dist/"

    # SoT: companion/scripts/esbuild-bundle-args.json (shared with package.sh / package.json)
    node scripts/run-esbuild-bundle.mjs
    if ($LASTEXITCODE -ne 0) { Fail "esbuild bundle failed" }
    Ok "Bundle: dist/cmspark-agent.js"
} finally { Pop-Location }

# ---------------------------------------------------------------------------
# [3/6] Build Chrome extension
# ---------------------------------------------------------------------------
Step 3 6 "Building Chrome extension..."

Push-Location $ChromeExtDir
try {
    # 2>&1 | Out-Null + $ErrorActionPreference override: prevent native command stderr
    # from throwing a terminating error that would abort the whole build.
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    npm run build 2>&1 | Out-Null
    $ErrorActionPreference = $prevEAP
    # P0 OPS-01: fail-closed — SEA product without extension is not a valid ship
    if ($LASTEXITCODE -eq 0) { Ok "Chrome extension built" }
    else {
        Fail "Chrome extension build failed (exit=$LASTEXITCODE) — refuse SEA without extension"
    }
} catch {
    Fail "Chrome extension build error: $($_.Exception.Message)"
} finally { Pop-Location }

# ---------------------------------------------------------------------------
# [4/6] Create cmspark-agent.exe using Node.js SEA
# ---------------------------------------------------------------------------
Step 4 6 "Creating cmspark-agent.exe (Node.js SEA)..."

Push-Location $CompanionDir
try {
    # Generate SEA blob
    Write-Host "  Generating SEA blob..." -ForegroundColor DarkGray
    node --experimental-sea-config sea-config.json
    if ($LASTEXITCODE -ne 0) { Fail "SEA blob generation failed" }
    if (-not (Test-Path "sea-prep.blob")) { Fail "sea-prep.blob not found after generation" }
    Ok "sea-prep.blob generated"

    # Copy node.exe as the base for our exe.
    # Resolve node.exe specifically — `Get-Command node` may return a node.cmd
    # shim (e.g. managed runtime wrappers), which postject cannot inject into.
    $NodeExe = $null
    foreach ($candidate in @("node.exe", "node")) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source -like "*.exe") { $NodeExe = $cmd.Source; break }
    }
    if (-not $NodeExe) { Fail "Could not resolve a real node.exe on PATH (found only shim wrappers)" }
    $AppExe  = Join-Path $CompanionDir "dist\cmspark-agent.exe"
    Copy-Item $NodeExe $AppExe -Force
    Ok "Copied: $NodeExe -> dist\cmspark-agent.exe"

    # Remove Authenticode signature so injection doesn't corrupt it
    # (signtool is part of Windows SDK — skip gracefully if not available)
    $SigTool = Get-Command signtool -ErrorAction SilentlyContinue
    if ($SigTool) {
        Write-Host "  Removing existing Authenticode signature..." -ForegroundColor DarkGray
        & signtool remove /s $AppExe 2>$null
        Ok "Signature removed"
    } else {
        Write-Host "  signtool not found — skipping signature removal (exe will still work)" -ForegroundColor DarkGray
    }

    # Inject SEA blob using postject
    # postject@1.0.0-alpha.6 is the version recommended by Node.js docs for SEA
    Write-Host "  Injecting SEA blob with postject..." -ForegroundColor DarkGray
    npx --yes postject@1.0.0-alpha.6 $AppExe NODE_SEA_BLOB sea-prep.blob `
        --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 `
        --overwrite
    if ($LASTEXITCODE -ne 0) { Fail "postject injection failed" }
    Ok "SEA blob injected into cmspark-agent.exe"

    # Cleanup blob
    Remove-Item "sea-prep.blob" -Force -ErrorAction SilentlyContinue

    # Change PE subsystem from CONSOLE (0x03) to WINDOWS (0x02) so that
    # double-clicking the exe from Explorer does NOT open a CMD window.
    # stdout/stderr are still captured when launched from a terminal.
    Write-Host "  Patching PE subsystem: CONSOLE → WINDOWS..." -ForegroundColor DarkGray
    $exeBytes = [System.IO.File]::ReadAllBytes($AppExe)
    # PE signature offset is at 0x3C (4 bytes, LE)
    $peOffset  = [BitConverter]::ToInt32($exeBytes, 0x3C)
    # Subsystem field: Optional Header starts at peOffset+0x18, subsystem is at +0x44 (x64)
    $subsysOff = $peOffset + 0x18 + 0x44
    $current   = [BitConverter]::ToUInt16($exeBytes, $subsysOff)
    if ($current -eq 3) {
        $exeBytes[$subsysOff]     = 2   # IMAGE_SUBSYSTEM_WINDOWS_GUI
        $exeBytes[$subsysOff + 1] = 0
        [System.IO.File]::WriteAllBytes($AppExe, $exeBytes)
        Ok "PE subsystem patched: CONSOLE → WINDOWS (no cmd window on launch)"
    } else {
        Write-Host "  PE subsystem is already $current — skipping patch" -ForegroundColor DarkGray
    }
} finally { Pop-Location }

# ---------------------------------------------------------------------------
# [5/6] Stage distribution package
# ---------------------------------------------------------------------------
Step 5 6 "Staging distribution package: $StagingDir"

function Stop-ProcessesUsingPath([string]$root) {
    # Best-effort: stop processes whose ExecutablePath lives under $root
    # (typical: a still-running cmspark-agent.exe from the last package build).
    if (-not $root -or -not (Test-Path $root)) { return }
    $rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\')
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
        $ep = $_.ExecutablePath
        if (-not $ep) { return }
        try {
            $epFull = [System.IO.Path]::GetFullPath($ep)
        } catch { return }
        if ($epFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            Write-Host "  Stopping process holding package path: pid=$($_.ProcessId) $($_.Name)" -ForegroundColor DarkYellow
            try {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
            } catch {
                Write-Host "  ! could not stop pid $($_.ProcessId): $($_.Exception.Message)" -ForegroundColor DarkYellow
            }
        }
    }
    Start-Sleep -Milliseconds 400
}

function Remove-TreeBestEffort([string]$path) {
    # Must not throw under $ErrorActionPreference=Stop: cmd rmdir writes to
    # stderr when a file is locked, and that used to abort the whole build
    # before the per-file fallback ran.
    if (-not (Test-Path $path)) { return $true }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        Stop-ProcessesUsingPath $path
        cmd /c "rmdir /s /q `"$path`"" 2>$null | Out-Null
        if (-not (Test-Path $path)) { return $true }

        Get-ChildItem $path -Recurse -Force -ErrorAction SilentlyContinue -File | ForEach-Object {
            try { Remove-Item $_.FullName -Force -ErrorAction Stop }
            catch { Write-Host "  ! skipped locked file: $($_.FullName)" -ForegroundColor DarkYellow }
        }
        Get-ChildItem $path -Recurse -Force -ErrorAction SilentlyContinue -Directory |
            Sort-Object { $_.FullName.Length } -Descending |
            ForEach-Object {
                try { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue } catch {}
            }
        try { Remove-Item $path -Force -Recurse -ErrorAction SilentlyContinue } catch {}
        if (-not (Test-Path $path)) { return $true }

        # Last resort: rename aside so we can stage into a clean path.
        $bak = "$path.old." + (Get-Date -Format "yyyyMMddHHmmss")
        try {
            Rename-Item -LiteralPath $path -NewName (Split-Path $bak -Leaf) -ErrorAction Stop
            Warn "Could not delete locked tree; moved aside to: $bak"
            Write-Host "  Close any Explorer window / still-running cmspark-agent from that folder, then delete the .old.* folder later." -ForegroundColor DarkYellow
            return $true
        } catch {
            return $false
        }
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

# Clean staging tree. Prefer not aborting on lock:
# - Often the folder itself is locked as some process CWD (e.g. companion
#   last cwd = dist-package\cmspark-windows-x64) while remaining *writable*.
# - In that case empty-and-reuse is enough; rmdir failure must not kill the build.
if (Test-Path $StagingDir) {
    $cleaned = Remove-TreeBestEffort $StagingDir
    if (-not $cleaned -and (Test-Path $StagingDir)) {
        $writable = $false
        try {
            $probe = Join-Path $StagingDir ".cmspark-build-write-probe"
            "ok" | Set-Content -LiteralPath $probe -ErrorAction Stop
            Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
            $writable = $true
        } catch {
            $writable = $false
        }
        if ($writable) {
            Warn "Staging dir is locked for delete (likely a process CWD) but still writable — reusing it."
            Write-Host "  Tip: close Explorer / stop cmspark-agent launched from this folder to allow full cleanup next time." -ForegroundColor DarkYellow
        } else {
            Fail @"
Cannot clear or write staging directory (locked by another process):
  $StagingDir

Fix:
  1. Stop Companion / tray if launched from dist-package (Task Manager: cmspark-agent.exe)
  2. Close Explorer windows open inside that folder
  3. Close terminals whose cwd is that folder (common after shell_exec from package path)
  4. Pause antivirus scan of the folder if needed
  5. Re-run .\build-package.bat
"@
        }
    } else {
        Ok "Cleaned previous staging package"
    }
} else {
    Ok "No previous staging package"
}
# Ensure parent + staging exist (reused if locked empty)
New-Item -ItemType Directory -Force $DistDir | Out-Null
New-Item -ItemType Directory -Force $StagingDir | Out-Null

# Core exe
Copy-Item "$CompanionDir\dist\cmspark-agent.exe" $StagingDir
Ok "cmspark-agent.exe"

# Qwen3-VL Python worker (experimental locate). Weights download on demand to
# ~/.cmspark-agent/models/qwen3-vl-* — not packaged in the zip/SEA.
$QwenWorkerCandidates = @(
    "$CompanionDir\dist\computer\qwen-vl-worker.py",
    "$CompanionDir\src\computer\qwen-vl-worker.py"
)
$QwenWorkerSrc = $null
foreach ($c in $QwenWorkerCandidates) {
    if (Test-Path $c) { $QwenWorkerSrc = $c; break }
}
if (-not $QwenWorkerSrc) {
    Fail "qwen-vl-worker.py missing — Qwen3-VL experimental locate hard-gate"
}
Copy-Item $QwenWorkerSrc "$StagingDir\qwen-vl-worker.py"
Ok "qwen-vl-worker.py (Qwen3-VL experimental locate)"

# Optional legacy models.manifest.json (not required for Qwen3-VL weights)
$ManifestSrc = "$CompanionDir\models.manifest.json"
if (Test-Path $ManifestSrc) {
    Copy-Item $ManifestSrc $StagingDir
    Ok "models.manifest.json (legacy optional)"
}

# WASM file for sql.js (loaded at runtime via getSqlWasmPath())
$WasmSrc = "$CompanionDir\node_modules\sql.js\dist\sql-wasm.wasm"
if (Test-Path $WasmSrc) {
    Copy-Item $WasmSrc $StagingDir
    Ok "sql-wasm.wasm"
} else {
    Warn "sql-wasm.wasm not found — history store may not work"
}

# Assets (tray icons, app icon)
$AssetsSrc = "$CompanionDir\assets"
if (Test-Path $AssetsSrc) {
    Copy-Item $AssetsSrc "$StagingDir\assets" -Recurse
    Ok "assets/"
}

# Builtin skills
$SkillsSrc = "$CompanionDir\builtin-skills"
if (Test-Path $SkillsSrc) {
    Copy-Item $SkillsSrc "$StagingDir\builtin-skills" -Recurse
    Ok "builtin-skills/"
}

# Windows host-use PowerShell scripts (computer-use). resolveWinScript candidate 0
# looks in <exe-dir>\host-scripts-win\ — without this, packaged host_read/host_write
# fail with ENOENT and Windows Hello silently downgrades to manual-nonce.
# P0-D: fail-closed (was Warn) — empty host-scripts-win must not ship.
$WinScriptsSrc = "$CompanionDir\src\host-use\win\scripts"
if (-not (Test-Path $WinScriptsSrc)) {
    Fail "win host-use scripts not found at $WinScriptsSrc — host_read/host_write would ENOENT"
}
Copy-Item $WinScriptsSrc "$StagingDir\host-scripts-win" -Recurse -Filter *.ps1
$WinPs1Count = @(Get-ChildItem "$StagingDir\host-scripts-win" -Filter *.ps1 -ErrorAction SilentlyContinue).Count
if ($WinPs1Count -lt 1) {
    Fail "host-scripts-win/*.ps1 empty after staging — refusing to ship"
}
Ok "host-scripts-win/ ($WinPs1Count Windows host-use scripts)"

# systray2 + its full transitive dependency tree.
# Module.createRequire(process.execPath) resolves from the exe's directory,
# so all packages must be in $StagingDir/node_modules/.
# Dependencies: systray2 → {debug → ms, fs-extra → {graceful-fs, jsonfile, universalify}}
$Systray2Packages = @(
    "systray2",     # tray backend
    "debug",        # systray2 dep
    "ms",           # debug dep
    "fs-extra",     # systray2 dep
    "graceful-fs",  # fs-extra dep
    "jsonfile",     # fs-extra dep
    "universalify"  # fs-extra dep
)
New-Item -ItemType Directory -Force "$StagingDir\node_modules" | Out-Null
$anySystray2Ok = $false
foreach ($pkg in $Systray2Packages) {
    $pkgSrc  = "$CompanionDir\node_modules\$pkg"
    $pkgDest = "$StagingDir\node_modules\$pkg"
    if (Test-Path $pkgSrc) {
        Copy-Item $pkgSrc $pkgDest -Recurse -Force
        $anySystray2Ok = $true
    } else {
        Warn "Package not found: $pkg (run npm install in companion/ first)"
    }
}
if ($anySystray2Ok) { Ok "node_modules/ systray2 + deps (tray support)" }
else { Warn "systray2 not installed — tray icon will not work" }

# onnxruntime-node is intentionally NOT staged. Experimental locate is Qwen3-VL
# (Python + on-demand HF/ModelScope weights). TinyClick/ORT packaging removed.

# Path B local STT: cmspark-whisper is a *sidecar* next to the SEA exe
# (NOT injected into the Node SEA blob). Runtime resolve looks under:
#   <exeDir>\bin\cmspark-whisper-win-x64.exe
#   <exeDir>\cmspark-whisper-win-x64.exe
#   PATH whisper-cli.exe (dev fallback)
# Prepare before build-package:
#   companion\dist\bin\cmspark-whisper-win-x64.exe
# (copy from a built whisper-cli, or: bash companion/scripts/build-cmspark-whisper.sh
#  with CMSPARK_WHISPER_SRC set on Git Bash / WSL)
$WhisperCandidates = @(
    "$CompanionDir\dist\bin\cmspark-whisper-win-x64.exe",
    "$CompanionDir\dist\bin\cmspark-whisper-win-x64",
    "$CompanionDir\bin\cmspark-whisper-win-x64.exe"
)
$WhisperSrc = $null
foreach ($c in $WhisperCandidates) {
    if (Test-Path $c) { $WhisperSrc = $c; break }
}
# Auto-fetch when missing (CMSPARK_WHISPER_AUTO_FETCH=0 to skip). Needs tsc dist already.
if (-not $WhisperSrc -and $env:CMSPARK_WHISPER_AUTO_FETCH -ne "0") {
    Write-Host "  Fetching cmspark-whisper-win-x64 (manifest-pinned)..." -ForegroundColor DarkGray
    Push-Location $CompanionDir
    try {
        node scripts/fetch-whisper-binary.mjs --arch win-x64 --dest (Join-Path $CompanionDir "dist\bin")
        if ($LASTEXITCODE -eq 0 -and (Test-Path (Join-Path $CompanionDir "dist\bin\cmspark-whisper-win-x64.exe"))) {
            $WhisperSrc = Join-Path $CompanionDir "dist\bin\cmspark-whisper-win-x64.exe"
            Ok "auto-fetched cmspark-whisper-win-x64.exe"
        } elseif ($LASTEXITCODE -eq 2) {
            Warn "whisper auto-fetch skipped (CMSPARK_WHISPER_AUTO_FETCH=0)"
        } else {
            Warn "whisper auto-fetch failed (exit $LASTEXITCODE) — package will ship without local STT binary"
        }
    } finally { Pop-Location }
}
if ($WhisperSrc) {
    $WhisperBinDir = Join-Path $StagingDir "bin"
    New-Item -ItemType Directory -Force $WhisperBinDir | Out-Null
    $WhisperDest = Join-Path $WhisperBinDir "cmspark-whisper-win-x64.exe"
    Copy-Item $WhisperSrc $WhisperDest -Force
    $WhisperSize = (Get-Item $WhisperDest).Length
    Ok "bin/cmspark-whisper-win-x64.exe (local STT, $WhisperSize bytes)"
    # Official whisper.cpp Windows builds load whisper.dll + ggml*.dll from the
    # exe directory (not the SEA blob). Stage sibling DLLs next to the sidecar.
    $WhisperSrcDir = Split-Path -Parent $WhisperSrc
    $DllCount = 0
    Get-ChildItem -Path $WhisperSrcDir -Filter "*.dll" -File -ErrorAction SilentlyContinue | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $WhisperBinDir $_.Name) -Force
        $DllCount++
    }
    if ($DllCount -gt 0) {
        Ok "bin/*.dll ($DllCount whisper/ggml runtime DLLs next to cmspark-whisper)"
    } else {
        Warn "no *.dll next to $WhisperSrc — whisper-cli may fail at runtime (DLL not found)"
    }
} else {
    Warn "companion/dist/bin/cmspark-whisper-win-x64.exe missing — local STT disabled in this package"
    Write-Host "  To enable: place whisper-cli as companion\dist\bin\cmspark-whisper-win-x64.exe then re-run build-package.bat" -ForegroundColor DarkYellow
}

# THIRD_PARTY_NOTICES must ship with the package (W3 §5.5 MIT notice obligation;
# generated from companion/src/computer/model-license.ts single source of truth).
$NoticeSrc = "$CompanionDir\THIRD_PARTY_NOTICES"
if (Test-Path $NoticeSrc) {
    Copy-Item $NoticeSrc $StagingDir
    Ok "THIRD_PARTY_NOTICES"
} else {
    Fail "THIRD_PARTY_NOTICES missing in companion/ — MIT notice must ship with the package"
}

# Launch / install scripts
foreach ($f in @("install.bat", "uninstall.bat", "launch.bat", "launch-hidden.vbs", "README.txt")) {
    $src = "$CompanionDir\$f"
    if (Test-Path $src) { Copy-Item $src $StagingDir; Ok $f }
}

# Chrome extension build output
$CrxBuild = "$ChromeExtDir\build\chrome-mv3-prod"
if (Test-Path $CrxBuild) {
    Copy-Item $CrxBuild "$StagingDir\chrome-extension" -Recurse
    Ok "chrome-extension/"
} else {
    Warn "Chrome extension build not found — skipping"
}

# ---------------------------------------------------------------------------
# [6/6] Create zip archive + optional NSIS installer
# ---------------------------------------------------------------------------
Step 6 6 "Packaging..."

$ZipPath = "$DistDir\CMspark-v$Version-windows-x64.zip"
Compress-Archive -Path "$StagingDir\*" -DestinationPath $ZipPath -Force
Ok "ZIP: $ZipPath"

# Optional NSIS installer (makensis must be in PATH)
# Install NSIS from: https://nsis.sourceforge.io/Download
if (-not $SkipNsis) {
    $MakeNsis = Get-Command makensis -ErrorAction SilentlyContinue
    if ($MakeNsis) {
        Write-Host ""
        Write-Host "[NSIS] Building installer exe..." -ForegroundColor Yellow
        Push-Location $ProjectRoot
        try {
            # Inject version from package.json so installer.nsi cannot drift.
            & makensis "/DPRODUCT_VERSION=$Version" scripts\installer.nsi
            if ($LASTEXITCODE -eq 0) {
                Ok "Installer: $DistDir\CMspark-Setup-v$Version.exe"
            } else {
                Warn "NSIS build failed (exit $LASTEXITCODE)"
            }
        } finally { Pop-Location }
    } else {
        Write-Host ""
        Write-Host "  [NSIS] makensis not found — skipping installer." -ForegroundColor DarkGray
        Write-Host "  [NSIS] To also build an installer .exe, install NSIS:" -ForegroundColor DarkGray
        Write-Host "         https://nsis.sourceforge.io/Download  (then re-run this script)" -ForegroundColor DarkGray
    }
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Build complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host "  EXE:  $StagingDir\cmspark-agent.exe" -ForegroundColor Green
Write-Host "  ZIP:  $ZipPath" -ForegroundColor Green
Write-Host ""
Write-Host "  To run the exe locally:" -ForegroundColor Cyan
Write-Host "    $StagingDir\cmspark-agent.exe tray" -ForegroundColor Cyan
Write-Host ""
