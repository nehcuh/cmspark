# computer-evidence-seal.ps1 — A7 evidence-at-rest protection.
# protect:   pixelate the given blur rects (credential neighborhoods detected by
#            the danger pipeline — ORIGINAL PIXELS ARE NEVER PERSISTED), then
#            DPAPI-encrypt (CurrentUser scope) the PNG bytes to OutPath and
#            delete the raw input.
# unprotect: DPAPI-decrypt a sealed file back to PNG bytes (read-back path for
#            the evidence viewer / tests).
#
# stdout: single-line JSON { ok, mode, outPath, sha256, blurred }
# stderr: SEALFAILED:<detail> (exit 5), BADARGS:<detail> (exit 2)
param(
  [Parameter(Mandatory=$true)][ValidateSet('protect','unprotect')] [string]$Mode,
  [Parameter(Mandatory=$true)][string]$InPath,
  [Parameter(Mandatory=$true)][string]$OutPath,
  # Semicolon-separated "x,y,w,h" rects (capture-image px — the sealed
  # bitmap's pixel space, NOT window-client space) to pixelate pre-seal.
  [string]$BlurRects = "",
  # Keep the raw input file (tests); production callers leave this off so the
  # unblurred capture is deleted after sealing.
  [switch]$KeepRaw
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security

function Fail([string]$prefix, [string]$detail, [int]$code) {
  [Console]::Error.WriteLine("${prefix}:$detail")
  exit $code
}

if (-not (Test-Path $InPath)) { Fail "BADARGS" "missing input: $InPath" 2 }
$outDir = Split-Path $OutPath -Parent
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

if ($Mode -eq 'unprotect') {
  try {
    $cipher = [System.IO.File]::ReadAllBytes($InPath)
    $plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
      $cipher, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [System.IO.File]::WriteAllBytes($OutPath, $plain)
    $sha = (Get-FileHash $OutPath -Algorithm SHA256).Hash.ToLower()
    Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
      ok = $true; mode = "unprotect"; outPath = $OutPath; sha256 = $sha; blurred = 0
    }))
    exit 0
  } catch {
    Fail "SEALFAILED" "unprotect: $($_.Exception.Message)" 5
  }
}

# ---- protect -------------------------------------------------------------------
$rects = @()
if ($BlurRects -ne "") {
  foreach ($part in $BlurRects.Split(';')) {
    $bits = $part.Split(',')
    if ($bits.Length -ne 4) { Fail "BADARGS" "bad blur rect '$part' (want x,y,w,h)" 2 }
    $rects += ,@([int]$bits[0], [int]$bits[1], [int]$bits[2], [int]$bits[3])
  }
}

try {
  $bmp = [System.Drawing.Bitmap]::FromFile($InPath)
  $blurred = 0
  foreach ($r in $rects) {
    $rx = [Math]::Max(0, $r[0]); $ry = [Math]::Max(0, $r[1])
    $rw = [Math]::Min($r[2], $bmp.Width - $rx); $rh = [Math]::Min($r[3], $bmp.Height - $ry)
    if ($rw -le 0 -or $rh -le 0) { continue }
    # Pixelate: average each 16x16 block and fill it with the average color.
    $block = 16
    for ($by = $ry; $by -lt ($ry + $rh); $by += $block) {
      for ($bx = $rx; $bx -lt ($rx + $rw); $bx += $block) {
        $bw = [Math]::Min($block, $rx + $rw - $bx); $bh = [Math]::Min($block, $ry + $rh - $by)
        $sr = 0; $sg = 0; $sb = 0; $n = 0
        for ($yy = $by; $yy -lt ($by + $bh); $yy++) {
          for ($xx = $bx; $xx -lt ($bx + $bw); $xx++) {
            $c = $bmp.GetPixel($xx, $yy); $sr += $c.R; $sg += $c.G; $sb += $c.B; $n++
          }
        }
        if ($n -eq 0) { continue }
        $avg = [System.Drawing.Color]::FromArgb([int]($sr / $n), [int]($sg / $n), [int]($sb / $n))
        for ($yy = $by; $yy -lt ($by + $bh); $yy++) {
          for ($xx = $bx; $xx -lt ($bx + $bw); $xx++) { $bmp.SetPixel($xx, $yy, $avg) }
        }
      }
    }
    $blurred++
  }
  $tmpPng = "$OutPath.tmp-$PID.png"
  $bmp.Save($tmpPng, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $bytes = [System.IO.File]::ReadAllBytes($tmpPng)
  $cipher = [System.Security.Cryptography.ProtectedData]::Protect(
    $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [System.IO.File]::WriteAllBytes($OutPath, $cipher)
  Remove-Item $tmpPng -Force -ErrorAction SilentlyContinue
  if (-not $KeepRaw) { Remove-Item $InPath -Force -ErrorAction SilentlyContinue }
  $sha = (Get-FileHash $OutPath -Algorithm SHA256).Hash.ToLower()
  Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
    ok = $true; mode = "protect"; outPath = $OutPath; sha256 = $sha; blurred = $blurred
  }))
  exit 0
} catch {
  Fail "SEALFAILED" "protect: $($_.Exception.Message)" 5
}
