# computer-ocr.ps1 — coordinate computer-use WP1 OCR layer (plan B.2 L1).
# Windows.Media.Ocr via the hello-verify WinRT call pattern (E3): unsigned
# PowerShell 5.1, no downloads, no new permissions.
#
# Language honesty (S-6): if the requested recognition language is not
# installed, the script DOES NOT silently fall back — it exits 3 with the
# stderr prefix OCRLANGMISSING:<lang> so the caller can skip the layer with a
# typed error.
#
# stdout contract: single-line JSON { ok, language, words:[{text,x,y,w,h}] }
# stderr contract:
#   OCRLANGMISSING:<lang>  language pack not installed (exit 3)
#   OCRFAILED:<detail>     decode/recognize failure (exit 5)
#   BADARGS:<detail>       missing/unreadable input (exit 2)
param(
  [string]$ImagePath = "",
  # BCP-47 tag, e.g. "zh-Hans" (default) or "en-US".
  [string]$Language = "zh-Hans",
  # Diagnostic mode: list installed recognizer languages and exit.
  [switch]$ListLanguages
)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Fail([string]$prefix, [string]$detail, [int]$code) {
  [Console]::Error.WriteLine("${prefix}:$detail")
  exit $code
}

# --- Load WinRT types ---------------------------------------------------------
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
  [Windows.Globalization.Language, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
  [Windows.Storage.StorageFile, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
} catch {
  Fail "OCRFAILED" "type-load: $($_.Exception.Message)" 5
}

# --- AsTask reflection bridge (PS 5.1 cannot await WinRT directly) ------------
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 } |
  Select-Object -First 1
$asTaskPlain = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and -not $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 } |
  Select-Object -First 1
if ($null -eq $asTaskGeneric -or $null -eq $asTaskPlain) { Fail "OCRFAILED" "AsTask-method-not-found" 5 }

function Wait-WinRtAsync($operation, [Type]$resultType) {
  if ($null -eq $resultType) {
    $task = $asTaskPlain.Invoke($null, @($operation))
    $task.Wait()
    return $null
  }
  $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($operation))
  $task.Wait()
  return $task.Result
}

# --- Diagnostic mode ----------------------------------------------------------
if ($ListLanguages) {
  $langs = @()
  foreach ($l in [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) {
    $langs += $l.LanguageTag
  }
  Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{ ok = $true; languages = $langs }))
  exit 0
}

if ($ImagePath -eq "" -or -not (Test-Path $ImagePath)) {
  Fail "BADARGS" "image not found: $ImagePath" 2
}

# --- Language gate (honest skip) ----------------------------------------------
$lang = $null
try { $lang = [Windows.Globalization.Language]::new($Language) } catch {
  Fail "OCRLANGMISSING" "$Language (invalid tag: $($_.Exception.Message))" 3
}
if (-not [Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lang)) {
  Fail "OCRLANGMISSING" "$Language" 3
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if ($null -eq $engine) { Fail "OCRLANGMISSING" "$Language (engine-null)" 3 }

# --- Decode image (scale down when larger than MaxImageDimension) -------------
try {
  $absPath = (Resolve-Path $ImagePath).Path
  $fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($absPath)
  $file = Wait-WinRtAsync $fileOp ([Windows.Storage.StorageFile])
  $streamOp = $file.OpenReadAsync()
  $stream = Wait-WinRtAsync $streamOp ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  $decOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
  $decoder = Wait-WinRtAsync $decOp ([Windows.Graphics.Imaging.BitmapDecoder])

  $maxDim = 4096
  try {
    # PS 5.1 projects some WinRT scalar properties as $null — read via reflection.
    $maxPi = $engine.GetType().GetProperty('MaxImageDimension')
    if ($maxPi) { $maxDim = [int]$maxPi.GetValue($engine, $null) }
  } catch {}
  $sw = [int]$decoder.PixelWidth; $sh = [int]$decoder.PixelHeight
  $bitmap = $null
  if ($sw -gt $maxDim -or $sh -gt $maxDim) {
    $scale = [Math]::Min($maxDim / $sw, $maxDim / $sh)
    $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
    $transform.ScaledWidth = [uint32][Math]::Max(1, [int]($sw * $scale))
    $transform.ScaledHeight = [uint32][Math]::Max(1, [int]($sh * $scale))
    $transform.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Linear
    $pxOp = $decoder.GetSoftwareBitmapAsync(
      [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
      [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
      $transform,
      [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation,
      [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)
    $bitmap = Wait-WinRtAsync $pxOp ([Windows.Graphics.Imaging.SoftwareBitmap])
    $script:scaleX = $sw / [double]$transform.ScaledWidth
    $script:scaleY = $sh / [double]$transform.ScaledHeight
  } else {
    $pxOp = $decoder.GetSoftwareBitmapAsync()
    $bitmap = Wait-WinRtAsync $pxOp ([Windows.Graphics.Imaging.SoftwareBitmap])
    $script:scaleX = 1.0; $script:scaleY = 1.0
  }
  $stream.Dispose()
} catch {
  Fail "OCRFAILED" "decode: $($_.Exception.Message)" 5
}

# --- Recognize -----------------------------------------------------------------
try {
  $recOp = $engine.RecognizeAsync($bitmap)
  $result = Wait-WinRtAsync $recOp ([Windows.Media.Ocr.OcrResult])
} catch {
  Fail "OCRFAILED" "recognize: $($_.Exception.Message)" 5
}

$words = @()
foreach ($line in $result.Lines) {
  foreach ($w in $line.Words) {
    $br = $w.BoundingRect
    $words += [ordered]@{
      text = $w.Text
      x = [Math]::Round($br.X * $script:scaleX, 1)
      y = [Math]::Round($br.Y * $script:scaleY, 1)
      w = [Math]::Round($br.Width * $script:scaleX, 1)
      h = [Math]::Round($br.Height * $script:scaleY, 1)
    }
  }
}

Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{
  ok = $true
  language = $Language
  scaled = ($script:scaleX -ne 1.0 -or $script:scaleY -ne 1.0)
  words = $words
}))
exit 0
