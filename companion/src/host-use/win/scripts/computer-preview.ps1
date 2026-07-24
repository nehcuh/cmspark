# computer-preview.ps1 — WP2 per-action preview image builder (plan §E.4).
#
# Reads a captured PNG, optionally:
#   - blacks out credential neighborhoods (-BlurRects, same format/semantics
#     as computer-evidence-seal.ps1 — the panel must never see a password),
#   - draws a crosshair at the actuation point (-X/-Y, IMAGE coordinates),
# downscales to <= -MaxWidth px wide, encodes JPEG (-Quality), and prints
# single-line JSON { ok, bytes, base64 }. When the JPEG would exceed
# -MaxBytes it retries at quality 50, then reports ok:false reason=too_large
# (the caller drops the image and continues — preview is best-effort).
#
# stderr contract: BADARGS:<d> (2)  PREVIEWFAILED:<d> (12)
param(
  [Parameter(Mandatory=$true)][string]$InPath,
  [int]$X = -1,
  [int]$Y = -1,
  [string]$BlurRects = "",
  [int]$MaxWidth = 800,
  [int]$Quality = 70,
  [int]$MaxBytes = 286720
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Fail([string]$prefix, [string]$detail, [int]$code) {
  [Console]::Error.WriteLine("${prefix}:$detail")
  exit $code
}

if (-not (Test-Path -LiteralPath $InPath)) { Fail "BADARGS" "input not found: $InPath" 2 }

Add-Type -AssemblyName System.Drawing

$img = $null; $g = $null; $out = $null
try {
  $img = [System.Drawing.Image]::FromFile($InPath)

  # --- credential blackout (BEFORE any annotation; coordinates are image-space)
  if ($BlurRects -ne "") {
    $g = [System.Drawing.Graphics]::FromImage($img)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
    foreach ($part in $BlurRects.Split(';')) {
      if ($part -eq "") { continue }
      $n = $part.Split(',')
      if ($n.Count -ne 4) { continue }
      $g.FillRectangle($brush, [int]$n[0], [int]$n[1], [int]$n[2], [int]$n[3])
    }
    $brush.Dispose()
    $g.Dispose(); $g = $null
  }

  # --- crosshair at the actuation point
  if ($X -ge 0 -and $Y -ge 0) {
    $g = [System.Drawing.Graphics]::FromImage($img)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Red, 3)
    $r = 18
    $g.DrawEllipse($pen, $X - $r, $Y - $r, 2 * $r, 2 * $r)
    $g.DrawLine($pen, $X - 2 * $r, $Y, $X + 2 * $r, $Y)
    $g.DrawLine($pen, $X, $Y - 2 * $r, $X, $Y + 2 * $r)
    $pen.Dispose()
    $g.Dispose(); $g = $null
  }

  # --- downscale
  $w = $img.Width; $h = $img.Height
  if ($w -gt $MaxWidth) {
    $nh = [int]($h * $MaxWidth / $w)
    $out = New-Object System.Drawing.Bitmap($img, $MaxWidth, $nh)
  } else {
    $out = New-Object System.Drawing.Bitmap($img)
  }

  $jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ms = New-Object System.IO.MemoryStream
  foreach ($q in @($Quality, 50)) {
    $ms.SetLength(0)
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$q)
    $out.Save($ms, $jpeg, $ep)
    if ($ms.Length -le $MaxBytes) { break }
    $ep.Dispose()
  }
  if ($ms.Length -gt $MaxBytes) {
    Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{ ok = $false; reason = "too_large"; bytes = $ms.Length }))
    exit 0
  }
  Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
    ok = $true; bytes = $ms.Length; base64 = [Convert]::ToBase64String($ms.ToArray())
  }))
  exit 0
} catch {
  Fail "PREVIEWFAILED" $_.Exception.Message 12
} finally {
  if ($g) { $g.Dispose() }
  if ($out) { $out.Dispose() }
  if ($img) { $img.Dispose() }
}
