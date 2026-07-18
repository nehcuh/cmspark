# computer-imgdiff.ps1 — A1 pixel-TOCTOU check + A2 dialog-difference heuristic.
# Compares two captures of the same subject (downsampled grayscale): reports
# diffRatio = fraction of sampled cells whose mean luma changed beyond
# threshold, and meanAbsDiff in [0,255].
#
# X1 zoned metrics (a whole-window ratio quantitatively MISSES local popups:
# a 500x350 dialog in a 1054x736 window is ~22% of cells, ~8% maximized):
#   maxZoneRatio — the Sample x Sample grid divided into 8x8 macro-zones
#                  (zone = 8x8 cells); the highest per-zone changed fraction.
#                  A dialog covering a zone wholesale scores ~1.0 there.
#   maxBlobRatio — largest 4-connected cluster of changed cells / total cells;
#                  a dialog is one big connected blob (~0.22), a blinking
#                  cursor is a handful of cells (~0.001).
#
# stdout: single-line JSON { ok, diffRatio, meanAbsDiff, maxZoneRatio, maxBlobRatio }
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
  $map = New-Object 'bool[]' $n
  for ($i = 0; $i -lt $n; $i++) {
    $d = [Math]::Abs($ga[$i] - $gb[$i])
    $sum += $d
    if ($d -gt $CellThreshold) { $changed++; $map[$i] = $true }
  }
  $ratio = $changed / $n
  $mean = $sum / $n

  # X1: 8x8-cell macro-zones; maxZoneRatio = highest per-zone changed fraction.
  $zoneSide = 8
  $zoneCount = [Math]::Ceiling($Sample / $zoneSide)
  $maxZone = 0.0
  for ($zy = 0; $zy -lt $zoneCount; $zy++) {
    for ($zx = 0; $zx -lt $zoneCount; $zx++) {
      $cells = 0; $hits = 0
      $yEnd = [Math]::Min(($zy + 1) * $zoneSide, $Sample)
      $xEnd = [Math]::Min(($zx + 1) * $zoneSide, $Sample)
      for ($yy = $zy * $zoneSide; $yy -lt $yEnd; $yy++) {
        for ($xx = $zx * $zoneSide; $xx -lt $xEnd; $xx++) {
          $cells++
          if ($map[$yy * $Sample + $xx]) { $hits++ }
        }
      }
      if ($cells -gt 0 -and ($hits / $cells) -gt $maxZone) { $maxZone = $hits / $cells }
    }
  }

  # X1: largest 4-connected changed blob via iterative DFS (pwsh 5.1 safe).
  # Right/left neighbours guard against row wrap-around.
  $visited = New-Object 'bool[]' $n
  $maxBlob = 0
  $stack = New-Object 'System.Collections.Generic.Stack[int]'
  for ($i = 0; $i -lt $n; $i++) {
    if (-not $map[$i] -or $visited[$i]) { continue }
    $stack.Clear(); $stack.Push($i); $visited[$i] = $true; $size = 0
    while ($stack.Count -gt 0) {
      $cur = $stack.Pop(); $size++
      $cx = $cur % $Sample; $cy = [int]($cur / $Sample)
      $nb = $cur - 1
      if ($cx -gt 0 -and $map[$nb] -and -not $visited[$nb]) { $visited[$nb] = $true; $stack.Push($nb) }
      $nb = $cur + 1
      if ($cx -lt ($Sample - 1) -and $map[$nb] -and -not $visited[$nb]) { $visited[$nb] = $true; $stack.Push($nb) }
      $nb = $cur - $Sample
      if ($cy -gt 0 -and $map[$nb] -and -not $visited[$nb]) { $visited[$nb] = $true; $stack.Push($nb) }
      $nb = $cur + $Sample
      if ($cy -lt ($Sample - 1) -and $map[$nb] -and -not $visited[$nb]) { $visited[$nb] = $true; $stack.Push($nb) }
    }
    if ($size -gt $maxBlob) { $maxBlob = $size }
  }

  Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
    ok = $true
    diffRatio = [Math]::Round($ratio, 4)
    meanAbsDiff = [Math]::Round($mean, 2)
    maxZoneRatio = [Math]::Round($maxZone, 4)
    maxBlobRatio = [Math]::Round(($maxBlob / $n), 4)
    cells = $n
    changed = $changed
  }))
  exit 0
} catch {
  Fail "DIFFFAILED" "$($_.Exception.Message)" 5
}
