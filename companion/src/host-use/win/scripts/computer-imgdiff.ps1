# computer-imgdiff.ps1 — A1 pixel-TOCTOU check + A2 dialog-difference heuristic.
# Compares two captures of the same subject (downsampled grayscale): reports
# diffRatio = fraction of sampled cells whose mean luma changed beyond
# threshold, and meanAbsDiff in [0,255].
#
# stdout: single-line JSON { ok, diffRatio, meanAbsDiff }
# stderr: DIFFFAILED:<detail> (exit 5), BADARGS:<detail> (exit 2)
param(
  [Parameter(Mandatory=$true)][string]$A,
  [Parameter(Mandatory=$true)][string]$B,
  # Optional crop applied to A before comparison (window-client px).
  [int]$CropX = -1, [int]$CropY = -1, [int]$CropW = 0, [int]$CropH = 0,
  [int]$Sample = 64,
  [double]$CellThreshold = 24.0
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Fail([string]$prefix, [string]$detail, [int]$code) {
  [Console]::Error.WriteLine("${prefix}:$detail")
  exit $code
}

if (-not (Test-Path $A)) { Fail "BADARGS" "missing image A: $A" 2 }
if (-not (Test-Path $B)) { Fail "BADARGS" "missing image B: $B" 2 }

function Load-Gray([string]$path, [int]$cx, [int]$cy, [int]$cw, [int]$ch, [int]$sample) {
  $bmp = [System.Drawing.Bitmap]::FromFile($path)
  try {
    $x = 0; $y = 0; $w = $bmp.Width; $h = $bmp.Height
    if ($cx -ge 0 -and $cy -ge 0 -and $cw -gt 0 -and $ch -gt 0) {
      $x = [Math]::Max(0, $cx); $y = [Math]::Max(0, $cy)
      $w = [Math]::Min($cw, $bmp.Width - $x); $h = [Math]::Min($ch, $bmp.Height - $y)
      if ($w -le 0 -or $h -le 0) { throw "crop outside image" }
    }
    $thumb = New-Object System.Drawing.Bitmap($sample, $sample)
    $g = [System.Drawing.Graphics]::FromImage($thumb)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear
    $g.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0, 0, $sample, $sample)), (New-Object System.Drawing.Rectangle($x, $y, $w, $h)), [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $gray = New-Object 'double[]' ($sample * $sample)
    for ($yy = 0; $yy -lt $sample; $yy++) {
      for ($xx = 0; $xx -lt $sample; $xx++) {
        $c = $thumb.GetPixel($xx, $yy)
        $gray[$yy * $sample + $xx] = ($c.R + $c.G + $c.B) / 3.0
      }
    }
    $thumb.Dispose()
    return ,$gray
  } finally {
    $bmp.Dispose()
  }
}

try {
  $ga = Load-Gray $A $CropX $CropY $CropW $CropH $Sample
  $gb = Load-Gray $B -1 -1 0 0 $Sample
  $n = $Sample * $Sample
  $changed = 0; $sum = 0.0
  for ($i = 0; $i -lt $n; $i++) {
    $d = [Math]::Abs($ga[$i] - $gb[$i])
    $sum += $d
    if ($d -gt $CellThreshold) { $changed++ }
  }
  $ratio = $changed / $n
  $mean = $sum / $n
  Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
    ok = $true
    diffRatio = [Math]::Round($ratio, 4)
    meanAbsDiff = [Math]::Round($mean, 2)
    cells = $n
    changed = $changed
  }))
  exit 0
} catch {
  Fail "DIFFFAILED" "$($_.Exception.Message)" 5
}
