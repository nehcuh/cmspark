/** Test-only observation of the original OCR call. No acceptance authority. */
import { types as utilTypes } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { PsRunner } from '../../src/host-use/win/powershell'

// Reuses the already reviewed census projector's logic with TS annotations. No raw command,
// message, path, output or arbitrary property name leaves this function.
const typedArrayByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!
export function childFailureChain(error: unknown) {
  const chain: Array<Record<string, number | boolean | string>> = [], seen = new Set()
  const own = (value: object, key: string) => {
    try { const d = Object.getOwnPropertyDescriptor(value, key); return d && 'value' in d ? d.value : undefined }
    catch { return undefined }
  }
  for (let current: any = error, depth = 0; current && typeof current === 'object' && !utilTypes.isProxy(current) && depth < 4 && !seen.has(current); depth++) {
    seen.add(current)
    const row: Record<string, number | boolean | string> = { depth }
    for (const key of ['code', 'exitCode', 'status', 'errno']) {
      const value = own(current, key)
      if (Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647) row[key] = value
    }
    const killed = own(current, 'killed'), signal = own(current, 'signal')
    if (typeof killed === 'boolean') row.killed = killed
    if (['SIGKILL', 'SIGTERM', 'SIGABRT', 'SIGSEGV'].includes(signal)) row.signal = signal
    for (const key of ['stdout', 'stderr']) {
      const value = own(current, key)
      if (typeof value === 'string') {
        if (value.length <= 16 * 1024 * 1024) row[key + '_bytes'] = Buffer.byteLength(value)
        else row[key + '_exceeds_projection_bound'] = true
      } else if (utilTypes.isUint8Array(value)) {
        try { row[key + '_bytes'] = typedArrayByteLength.call(value) } catch { /* unavailable */ }
      }
    }
    if (Object.keys(row).length > 1) chain.push(row)
    current = own(current, 'cause')
  }
  return chain
}

// Source order is the oracle. A last site bounds an interval, not its cause.
export const ocrSites758 = [
  'ENTRY', 'ADD_TYPE_RETURN', 'WINRT_TYPES_RETURN', 'GENERIC_LOOKUP_ENTER',
  'GENERIC_LOOKUP_RETURN', 'PLAIN_LOOKUP_RETURN', 'WAIT_INVOKE_ENTER',
  'WAIT_INVOKE_RETURN', 'WAIT_RETURN', 'PATH_GATE_ENTER', 'PATH_GATE_RETURN',
  'LANGUAGE_CREATE_RETURN', 'LANGUAGE_SUPPORTED', 'ENGINE_CREATE_RETURN',
  'RESOLVE_PATH_ENTER', 'RESOLVE_PATH_RETURN', 'FILE_API_RETURN', 'FILE_WAIT_RETURN',
  'STREAM_API_RETURN', 'STREAM_WAIT_RETURN', 'DECODER_API_RETURN', 'DECODER_WAIT_RETURN',
  'BITMAP_API_RETURN', 'BITMAP_WAIT_RETURN', 'RECOGNIZE_API_RETURN',
  'RECOGNIZE_WAIT_RETURN', 'JSON_EMIT_ENTER', 'JSON_EMIT_RETURN',
  'CAUGHT_EXCEPTION',
] as const

export function observedOcrSource758(original: string, trace: string) {
  if (!trace || /[\r\n\0]/.test(trace) || original.includes('TraceOcr758')) throw Error('OCR_OBSERVATION_SOURCE_REFUSED')
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const convert = (s: string) => s.replace(/\n/g, eol)
  const blocks: string[] = []
  let source = original
  const insert = (anchor: string, before: string, after = '') => {
    anchor = eol + convert(anchor); before = convert(before); after = convert(after)
    if (source.split(anchor).length !== 2) throw Error('OCR_OBSERVATION_ANCHOR_REFUSED')
    source = source.replace(anchor, eol + before + anchor.slice(eol.length) + after)
    for (const block of [before, after]) if (block) blocks.push(block)
  }
  const mark = (site: number) => `TraceOcr758 ${site}\n`
  const prefix = `$script:TraceOcr758Clock = [Diagnostics.Stopwatch]::StartNew()
$script:TraceOcr758Wait = 0
function TraceOcr758([int]$site, [int]$hr = 0) {
  try {
    $bucket = [int][Math]::Floor($script:TraceOcr758Clock.Elapsed.TotalMilliseconds / 250)
    [IO.File]::AppendAllText('${trace.replace(/'/g, "''")}', "$site,$script:TraceOcr758Wait,$bucket,$hr" + [char]10)
  } catch { }
}
function TraceOcr758Error($exception) {
  try {
    for ($i = 0; $i -lt 4 -and $null -ne $exception; $i = $i + 1) {
      TraceOcr758 29 ([int]$exception.HResult)
      $exception = $exception.InnerException
    }
  } catch { }
}
TraceOcr758 1
`
  insert('[Console]::OutputEncoding = [Text.Encoding]::UTF8', prefix)
  insert('  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null', '', '\n  '+mark(2))
  insert('  [Windows.Storage.StorageFile, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null', '', '\n  '+mark(3))
  for (const stage of ['type-load', 'decode', 'recognize']) insert(`  Fail "OCRFAILED" "${stage}:`, '  TraceOcr758Error ($_.Exception)\n')
  insert('try { $lang = [Windows.Globalization.Language]::new($Language) } catch {', '', ' TraceOcr758Error ($_.Exception);')
  insert('$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() |', mark(4))
  insert('$asTaskPlain = [System.WindowsRuntimeSystemExtensions].GetMethods() |', mark(5))
  insert('if ($null -eq $asTaskGeneric -or $null -eq $asTaskPlain)', mark(6))
  insert('function Wait-WinRtAsync($operation, [Type]$resultType) {', '', '\n  $script:TraceOcr758Wait = $script:TraceOcr758Wait + 1\n  '+mark(7))
  insert('    $task = $asTaskPlain.Invoke($null, @($operation))', '', '\n    '+mark(8))
  insert('    $task.Wait()', '', '\n    '+mark(9))
  insert('  $task = $asTask.Invoke($null, @($operation))', '', '\n  '+mark(8))
  insert('  $task.Wait()', '', '\n  '+mark(9))
  insert('if ($ImagePath -eq "" -or -not (Test-Path $ImagePath)) {', mark(10))
  insert('# --- Language gate (honest skip)', mark(11))
  insert('if (-not [Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lang)) {', mark(12))
  insert('$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)', mark(13), '\n'+mark(14))
  insert('  $absPath = (Resolve-Path $ImagePath).Path', '  '+mark(15), '\n  '+mark(16))
  const afterLines: Array<[string, number]> = [
    ['  $fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($absPath)', 17],
    ['  $file = Wait-WinRtAsync $fileOp ([Windows.Storage.StorageFile])', 18],
    ['  $streamOp = $file.OpenReadAsync()', 19],
    ['  $stream = Wait-WinRtAsync $streamOp ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])', 20],
    ['  $decOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)', 21],
    ['  $decoder = Wait-WinRtAsync $decOp ([Windows.Graphics.Imaging.BitmapDecoder])', 22],
    ['    $bitmap = Wait-WinRtAsync $pxOp ([Windows.Graphics.Imaging.SoftwareBitmap])', 24],
    ['  $recOp = $engine.RecognizeAsync($bitmap)', 25],
    ['  $result = Wait-WinRtAsync $recOp ([Windows.Media.Ocr.OcrResult])', 26],
  ]
  // Both original scale branches contain the same wait; surround each exact
  // preceding API block instead, keeping every original byte and statement.
  for (const [line, site] of afterLines.filter(([, s]) => s !== 24)) insert(line, '', '\n  '+mark(site))
  insert('    $bitmap = Wait-WinRtAsync $pxOp ([Windows.Graphics.Imaging.SoftwareBitmap])\n    $script:scaleX = $sw / [double]$transform.ScaledWidth', '    '+mark(23))
  insert('    $bitmap = Wait-WinRtAsync $pxOp ([Windows.Graphics.Imaging.SoftwareBitmap])\n    $script:scaleX = 1.0', '    '+mark(23))
  insert('  $stream.Dispose()', '  '+mark(24))
  insert('Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{\n  ok = $true\n  language = $Language\n  scaled = ($script:scaleX -ne 1.0 -or $script:scaleY -ne 1.0)\n  words = $words\n}))', mark(27), '\n'+mark(28))
  let inverse = source
  for (const block of blocks) {
    const at = inverse.indexOf(block)
    if (at < 0) throw Error('OCR_OBSERVATION_INVERSE_REFUSED')
    inverse = inverse.slice(0, at) + inverse.slice(at + block.length)
  }
  if (inverse !== original) throw Error('OCR_OBSERVATION_INVERSE_REFUSED')
  return { source, inverse }
}

export function ocrTrace758(bytes: Buffer) {
  if (bytes.length > 4096) return { status: 'UNKNOWN', reason: 'BOUND' } as const
  const text = bytes.toString('ascii'), rows: Array<{ site: number; wait: number; bucket: number; hresult?: number }> = []
  if (!bytes.equals(Buffer.from(text, 'ascii')) || !text.endsWith('\n')) return { status: 'UNKNOWN', reason: 'FORMAT' } as const
  for (const line of text.slice(0, -1).split('\n')) {
    const match = /^(\d{1,2}),(\d{1,2}),(\d{1,3}),(-?\d{1,10})$/.exec(line)
    if (!match || rows.length === 96) return { status: 'UNKNOWN', reason: 'FORMAT' } as const
    const [site, wait, bucket, hr] = match.slice(1).map(Number)
    if (site < 1 || site > ocrSites758.length || wait > 16 || bucket > 360 || hr < -2147483648 || hr > 2147483647 || (site !== 29 && hr !== 0) || (rows.length && bucket < rows.at(-1)!.bucket)) return { status: 'UNKNOWN', reason: 'FORMAT' } as const
    rows.push({ site, wait, bucket, ...(site === 29 ? { hresult: hr } : {}) })
  }
  if (rows[0]?.site !== 1 || rows[0]?.wait !== 0) return { status: 'UNKNOWN', reason: 'FORMAT' } as const
  return { status: 'OBSERVED', rows } as const
}

/** Exactly one original call; observer errors never replace its result/error. */
export async function observedOcrCall758(script: string, args: string[], directory: string, runner: PsRunner, diagnostic: (line: string) => void) {
  const original = fs.readFileSync(script), variant = path.join(directory, 'ocr-observed-758.ps1'), trace = path.join(directory, 'ocr-phases-758.txt')
  const built = observedOcrSource758(original.toString('utf8'), trace)
  if (!Buffer.from(built.inverse, 'utf8').equals(original)) throw Error('OCR_OBSERVATION_INVERSE_REFUSED')
  fs.writeFileSync(variant, built.source, { flag: 'wx', mode: 0o600 })
  const started = performance.now()
  let failure: unknown, rejected = false, stdoutBytes: number | null = null
  try {
    const stdout = await runner(variant, args)
    stdoutBytes = Buffer.byteLength(stdout)
    return stdout
  } catch (error) { rejected = true; failure = error; throw error }
  finally {
    try {
      let phases: ReturnType<typeof ocrTrace758> | { status: 'UNKNOWN'; reason: 'UNAVAILABLE' } = { status: 'UNKNOWN', reason: 'UNAVAILABLE' }
      // Read at most 4097 bytes; a damaged or oversized side-file is UNKNOWN.
      let fd: number | undefined
      try { fd = fs.openSync(trace, 'r'); const bytes = Buffer.alloc(4097), n = fs.readSync(fd, bytes, 0, bytes.length, 0); phases = ocrTrace758(bytes.subarray(0, n)) }
      catch { /* preserve the primary result/error */ }
      finally { if (fd !== undefined) fs.closeSync(fd) }
      const elapsedBucket = Math.floor((performance.now() - started) / 250)
      diagnostic('D758_OCR_OBSERVATION ' + JSON.stringify({ v: 1, sourceSHA256: createHash('sha256').update(original).digest('hex'), sourceUnchanged: fs.readFileSync(script).equals(original), rejected,
        elapsedBucket: Number.isSafeInteger(elapsedBucket) && elapsedBucket >= 0 && elapsedBucket <= 360 ? elapsedBucket : null,
        child: rejected ? childFailureChain(failure) : [], stdoutBytes, successStderr: 'UNKNOWN', phases }))
    } catch { /* passive observation cannot turn a failure into success or vice versa */ }
  }
}
