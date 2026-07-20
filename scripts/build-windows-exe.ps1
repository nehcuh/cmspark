# =============================================================================
# CMspark Windows EXE Builder
# =============================================================================
# Uses Node.js SEA (Single Executable Application) to produce a real .exe
# that users can run without installing Node.js separately.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows-exe.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows-exe.ps1 -SkipInstall
#
# Output:
#   dist-package\cmspark-windows-x64\cmspark-agent.exe   <- standalone exe
#   dist-package\CMspark-v0.2.0-windows-x64.zip          <- portable package
#   dist-package\CMspark-Setup-v0.2.0.exe                 <- installer (if NSIS found)
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
$Version      = "0.3.0-computer-use"

function Step($n, $total, $msg) {
    Write-Host "[$n/$total] $msg" -ForegroundColor Yellow
}

function Ok($msg) { Write-Host "  > $msg" -ForegroundColor Green }
function Warn($msg) { Write-Warning $msg }
function Fail($msg) { Write-Error $msg; exit 1 }

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

    # esbuild bundle: --external:systray2 so the Go binary is resolved at runtime
    # from node_modules/systray2 placed alongside the exe in the package;
    # --external:onnxruntime-node likewise (WP5 local model runtime, S-2 verified).
    npx esbuild dist/index.js `
        --bundle `
        --platform=node `
        --target=node22 `
        --external:systray2 `
        --external:canvas `
        --external:pdfjs-dist `
        --external:onnxruntime-node `
        --outfile=dist/cmspark-agent.js
    if ($LASTEXITCODE -ne 0) { Fail "esbuild bundle failed" }
    Ok "Bundle: dist/cmspark-agent.js"

    # WP5 I2: TinyClick inference worker as a SEPARATE bundle. In SEA mode the
    # runtime loads it as a sidecar file via eval (see tinyclick-runtime.ts);
    # onnxruntime-node stays external and is resolved with createRequire at runtime.
    npx esbuild dist/computer/tinyclick-worker.js `
        --bundle `
        --platform=node `
        --target=node22 `
        --external:onnxruntime-node `
        --outfile=dist/tinyclick-worker.js
    if ($LASTEXITCODE -ne 0) { Fail "esbuild worker bundle failed" }
    Ok "Bundle: dist/tinyclick-worker.js"
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
    if ($LASTEXITCODE -eq 0) { Ok "Chrome extension built" }
    else { Warn "Chrome extension build failed — extension not included (re-run when network is available)" }
} catch {
    Warn "Chrome extension build error: $($_.Exception.Message)"
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

if (Test-Path $DistDir) {
    Remove-Item $DistDir -Recurse -Force
    Ok "Cleaned previous dist-package"
}
New-Item -ItemType Directory -Force $StagingDir | Out-Null

# Core exe
Copy-Item "$CompanionDir\dist\cmspark-agent.exe" $StagingDir
Ok "cmspark-agent.exe"

# WP5 I2: TinyClick worker sidecar (SEA eval load; same trust level as the ORT dll sidecar)
Copy-Item "$CompanionDir\dist\tinyclick-worker.js" $StagingDir
Ok "tinyclick-worker.js (SEA sidecar)"

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
$WinScriptsSrc = "$CompanionDir\src\host-use\win\scripts"
if (Test-Path $WinScriptsSrc) {
    Copy-Item $WinScriptsSrc "$StagingDir\host-scripts-win" -Recurse -Filter *.ps1
    Ok "host-scripts-win/ (Windows host-use scripts)"
} else {
    Warn "win host-use scripts not found — host_read/host_write will not work in the package"
}

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

# onnxruntime-node (WP5 local model runtime, B7) — whitelist-copy ONLY the
# target-arch payload: full npm package is 259MB (darwin+linux+win32), the
# win32/x64 payload is 62MB (4 dll + .node). Anything else never ships.
$OrtSrc = "$CompanionDir\node_modules\onnxruntime-node"
if (Test-Path $OrtSrc) {
    $OrtDest = "$StagingDir\node_modules\onnxruntime-node"
    New-Item -ItemType Directory -Force "$OrtDest\bin\napi-v6\win32\x64" | Out-Null
    # package.json + dist/ (compiled JS; package main = dist/index.js — lib/ is
    # TypeScript source and must NOT ship) + target-arch native payload only.
    Copy-Item "$OrtSrc\package.json" $OrtDest
    Copy-Item "$OrtSrc\dist" "$OrtDest\dist" -Recurse
    Copy-Item "$OrtSrc\bin\napi-v6\win32\x64\*" "$OrtDest\bin\napi-v6\win32\x64" -Recurse
    if (Test-Path "$OrtSrc\LICENSE") { Copy-Item "$OrtSrc\LICENSE" $OrtDest }
    $OrtBytes = (Get-ChildItem $OrtDest -Recurse -File | Measure-Object -Property Length -Sum).Sum
    $OrtMB = [math]::Round($OrtBytes / 1MB, 1)
    # Size assertion (B7): 62MB payload + dist/package.json — hard budget 70MB.
    if ($OrtBytes -gt 70MB) { Fail "onnxruntime-node staging ${OrtMB}MB exceeds 70MB budget (expected ~63MB)" }
    Ok "node_modules/onnxruntime-node win32/x64 payload only: ${OrtMB}MB (budget 70MB)"

    # onnxruntime-common (runtime dependency of onnxruntime-node's dist/) — pure JS,
    # same copy shape: package.json + dist/ only (lib/ is TypeScript source).
    $CommonSrc = "$CompanionDir\node_modules\onnxruntime-common"
    $CommonDest = "$StagingDir\node_modules\onnxruntime-common"
    if (Test-Path $CommonSrc) {
        New-Item -ItemType Directory -Force $CommonDest | Out-Null
        Copy-Item "$CommonSrc\package.json" $CommonDest
        Copy-Item "$CommonSrc\dist" "$CommonDest\dist" -Recurse
        Ok "node_modules/onnxruntime-common (dist only)"
    } else {
        Fail "onnxruntime-common missing — onnxruntime-node dist/ requires it at runtime"
    }
} else {
    Warn "onnxruntime-node not installed — WP5 local model layer unavailable in this package"
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
            & makensis scripts\installer.nsi
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
