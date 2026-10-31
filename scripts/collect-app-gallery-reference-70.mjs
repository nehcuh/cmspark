// #70 evidence-only fixed-release sampling. Never imported by the application.
// Execute ONLY on hosted Windows after build; never runs the sampled executable.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'companion/src/apps/preset-gallery-references.json'), 'utf8'))
export const ARCHIVE_LIMIT = 384 * 1024 * 1024
export const EXE_LIMIT = 256 * 1024 * 1024
export const DOWNLOAD_MS = 120_000

export function requireHostedWindows(platform = process.platform, env = process.env) {
  if (platform !== 'win32' || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_OS !== 'Windows') {
    throw new Error('HOSTED_WINDOWS_ONLY')
  }
}

function allowedRedirect(value, token) {
  const u = new URL(value)
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) return false
  return token === 'win.app.notepadpp'
    ? u.hostname === 'release-assets.githubusercontent.com'
    : u.hostname === 'vscode.download.prss.microsoft.com'
}

/** Exact fixed catalog row, streamed into an exclusive file. No URL from a caller. */
export async function downloadArchive(app, destination, fetchImpl = fetch, trace) {
  const fixed = catalog.find(p => p.token === app.token)
  if (!fixed || JSON.stringify(app) !== JSON.stringify(fixed)) {
    try { if (trace) Object.assign(trace, { origin: 'FIXED_ROW', thrown: 'FIXED_ROW', cleanup: [] }) } catch {}
    throw new Error('UNPINNED_ARTIFACT')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_MS)
  let fd
  let phase = 'OPEN', origin = 'NONE', thrown = 'NONE'
  const cleanup = []
  const event = value => { try { if (cleanup.length < 3) cleanup.push(value) } catch {} }
  const save = () => { try { if (trace) Object.assign(trace, { origin, thrown, cleanup: [...cleanup] }) } catch {} }
  try {
    fd = fs.openSync(destination, 'wx', 0o600)
    let url = fixed.reference.artifactURL
    let response
    for (let redirects = 0; ; redirects++) {
      phase = 'REQUEST'
      response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      phase = 'REDIRECT'
      const next = new URL(response.headers.get('location') || '', url).href
      await response.body?.cancel()
      if (redirects >= 3 || !allowedRedirect(next, fixed.token)) throw new Error('REDIRECT_REJECTED')
      url = next
    }
    phase = 'STATUS'
    if (response.status !== 200 || !response.body) throw new Error('DOWNLOAD_REJECTED')
    phase = 'LENGTH'
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > ARCHIVE_LIMIT)) throw new Error('ARCHIVE_LIMIT')
    phase = 'DIGEST'
    const hash = createHash('sha256')
    let bytes = 0
    phase = 'BODY_READ'
    for await (const chunk of response.body) {
      bytes += chunk.byteLength
      if (bytes > ARCHIVE_LIMIT) throw new Error('ARCHIVE_LIMIT')
      phase = 'DIGEST'
      hash.update(chunk)
      // writeSync may make partial progress; never silently hash unwritten data.
      let offset = 0
      phase = 'WRITE'
      while (offset < chunk.byteLength) {
        const written = fs.writeSync(fd, chunk, offset, chunk.byteLength - offset)
        if (!Number.isSafeInteger(written) || written <= 0 || written > chunk.byteLength - offset) throw new Error('ARCHIVE_WRITE_NO_PROGRESS')
        offset += written
      }
      phase = 'BODY_READ'
    }
    phase = 'DIGEST'
    const sha256 = hash.digest('hex')
    if (sha256 !== fixed.reference.packageSHA256) throw new Error('PACKAGE_SHA_MISMATCH')
    return { bytes, sha256 }
  } catch (err) {
    origin = phase; thrown = phase
    if (fd !== undefined) {
      try { fs.closeSync(fd); event('CLOSE_RETURNED') } catch (e) { thrown = 'CLOSE'; event('CLOSE_THREW'); throw e }
      fd = undefined
      try { fs.unlinkSync(destination); event('UNLINK_RETURNED') } catch (e) { thrown = 'UNLINK'; event('UNLINK_THREW'); throw e }
    }
    throw err
  } finally {
    clearTimeout(timer)
    controller.abort()
    if (fd !== undefined) {
      try { fs.closeSync(fd); event('FINALLY_CLOSE_RETURNED') }
      catch (e) { thrown = 'FINALLY_CLOSE'; event('FINALLY_CLOSE_THREW'); save(); throw e }
    }
    save()
  }
}

/** Fixed download-only observation. No exception, path, URL or response is serialized. */
export function projectDownloadTrace(value) {
  try {
    const phases = new Set(['NONE', 'FIXED_ROW', 'OPEN', 'REQUEST', 'REDIRECT', 'STATUS', 'LENGTH', 'BODY_READ', 'WRITE', 'DIGEST', 'CLOSE', 'UNLINK', 'FINALLY_CLOSE'])
    const events = new Set(['CLOSE_RETURNED', 'CLOSE_THREW', 'UNLINK_RETURNED', 'UNLINK_THREW', 'FINALLY_CLOSE_RETURNED', 'FINALLY_CLOSE_THREW'])
    if (!value) return null
    const origin = value.origin, thrown = value.thrown, rawCleanup = value.cleanup
    if (!phases.has(origin) || !phases.has(thrown) || !Array.isArray(rawCleanup)) return null
    const length = rawCleanup.length
    if (!Number.isSafeInteger(length) || length < 0 || length > 3) return null
    const cleanup = []
    for (let i = 0; i < length; i++) {
      const event = rawCleanup[i]
      if (!events.has(event)) return null
      cleanup.push(event)
    }
    return { kind: 'GALLERY70_DOWNLOAD_OBSERVATION', origin, downloadThrown: thrown, cleanup }
  } catch { return null }
}

/** Strict producer wire; no mocked positive signature receipt is accepted as evidence. */
export function parseSample(stdout, app) {
  if (typeof stdout !== 'string' || stdout.length > 16_384) throw new Error('SAMPLE_WIRE')
  const value = JSON.parse(stdout.trim())
  const keys = ['entry', 'exeBytes', 'exeSHA256', 'signatureStatus', 'certificateSHA256DER', 'subject', 'collectedAtUTC', 'psVersion', 'machine', 'fileVersion']
  if (!value || Object.keys(value).sort().join() !== keys.sort().join()) throw new Error('SAMPLE_WIRE')
  if (value.entry !== app.reference.referenceEXERelativePath || !Number.isSafeInteger(value.exeBytes) || value.exeBytes <= 0 || value.exeBytes > EXE_LIMIT ||
      !/^[a-f0-9]{64}$/.test(value.exeSHA256) || value.signatureStatus !== 'Valid' || !/^[a-f0-9]{64}$/.test(value.certificateSHA256DER) ||
      typeof value.subject !== 'string' || value.subject.length === 0 || value.subject.length > 2048 ||
      typeof value.collectedAtUTC !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/.test(value.collectedAtUTC) ||
      typeof value.psVersion !== 'string' || !/^5\.1\.\d+\.\d+$/.test(value.psVersion) || value.machine !== 'x64' ||
      typeof value.fileVersion !== 'string' || value.fileVersion.length > 120 ||
      !(value.fileVersion === app.reference.release || value.fileVersion.startsWith(app.reference.release + ' '))) throw new Error('SAMPLE_WIRE')
  if (app.reference.referenceEXESHA256 && value.exeSHA256 !== app.reference.referenceEXESHA256) throw new Error('EXE_SHA_MISMATCH')
  return value
}

// Error-only, fixed source stages. Never echo native stderr, paths, argv or
// exception text; this is a failure locator, not a signature-success receipt.
export function sampleFailureDiagnostic(error) {
  const order = ['ENTERED', 'ASSEMBLY_READY', 'ARCHIVE_VERIFIED', 'ZIP_OPENED',
    'ENTRY_SELECTED', 'ENTRY_OPENED', 'OUTPUT_OPENED', 'BUFFER_READY', 'ENTRY_WRITTEN',
    'EXE_VERIFIED', 'SIGNATURE_ENTERED', 'SIGNATURE_RETURNED', 'COMPLETE']
  const phases = []
  let last = -1, lastElapsed = -1
  const observedStderr = error?.stderr
  const stderr = typeof observedStderr === 'string' ? observedStderr : ''
  const available = typeof observedStderr === 'string' && stderr.length <= 16 * 1024 * 1024
  let phaseState = observedStderr == null ? 'STDERR_MISSING'
    : typeof observedStderr !== 'string' ? 'STDERR_NONSTRING'
    : !available ? 'STDERR_LIMIT' : 'NO_PHASE_MARKERS'
  let bodyState = available ? 'NOT_OBSERVED' : 'UNAVAILABLE'
  if (available) {
    for (const line of stderr.split(/\r?\n/)) {
      if (line.includes('GALLERY70_BODY_ENTERED=')) {
        bodyState = line === 'GALLERY70_BODY_ENTERED=1' && bodyState === 'NOT_OBSERVED'
          ? 'OBSERVED' : 'INVALID_BODY_MARKER'
      }
      if (!line.includes('GALLERY70_PHASE=')) continue
      // A marker-like rejected line is distinguished from an absent marker.
      const match = /^GALLERY70_PHASE=([A-Z_]+):(0|[1-9]\d{0,8})$/.exec(line)
      const index = match ? order.indexOf(match[1]) : -1
      const elapsed = match ? Number(match[2]) : -1
      if (phaseState === 'INVALID_PHASE_CHAIN' || index !== last + 1 || elapsed < lastElapsed) {
        phases.length = 0; phaseState = 'INVALID_PHASE_CHAIN'; continue
      }
      phases.push({ phase: order[index], elapsed_ms: elapsed })
      phaseState = 'VALID_PHASE_PREFIX'
      last = index; lastElapsed = elapsed
    }
  }
  const code = error?.code
  const signal = error?.signal
  return { kind: 'GALLERY70_SAMPLE_FAILURE', phases, phaseState, bodyState,
    stderrCodeUnits: available ? stderr.length : null,
    code: Number.isInteger(code) && code >= -2147483648 && code <= 4294967295 ? code
      : ['ENOENT', 'EACCES', 'EPERM', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(code) ? code : null,
    killed: error?.killed === true,
    signal: ['SIGTERM', 'SIGKILL'].includes(signal) ? signal : null }
}

export async function main(output, failure = { seen: false }) {
  const mark = (stage, error) => { failure.seen = true; failure.stage = stage; failure.error = error }
  requireHostedWindows()
  if (!output || !path.isAbsolute(output)) throw new Error('ABSOLUTE_NEW_OUTPUT_REQUIRED')
  // Reserve before acquisition, so an existing evidence file cannot be overwritten.
  const evidence = fs.openSync(output, 'wx', 0o600)
  let owned
  try {
    const { runPs } = createRequire(import.meta.url)(path.join(root, 'companion/dist/host-use/win/powershell.js'))
    owned = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-gallery70-'))
    const samples = []
    for (const [i, app] of catalog.entries()) {
      const archive = path.join(owned, `${i}.zip`)
      const exe = path.join(owned, app.reference.referenceEXERelativePath)
      try {
        let pkg
        const trace = {}
        try { pkg = await downloadArchive(app, archive, fetch, trace) } catch (e) {
          try { failure.download = trace } catch {}
          mark('DOWNLOAD', e); throw e
        }
        // Existing runner's 15s/16MiB bounds, unmodified. No application execution.
        const raw = await runPs(path.join(root, 'scripts/fixtures/app-gallery-reference-70.ps1'),
          [archive, exe, app.reference.referenceEXERelativePath, app.reference.packageSHA256])
          .catch(e => { mark('RUN_PS', e); throw e })
        let sample
        try { sample = parseSample(raw, app) } catch (e) { mark('PARSE', e); throw e }
        samples.push({ token: app.token, release: app.reference.release, architecture: app.reference.architecture,
          artifactURL: app.reference.artifactURL, packageBytes: pkg.bytes, packageSHA256: pkg.sha256, ...sample, nativeStdout: raw })
      } finally {
        // Only exact files we exclusively own; never recursive removal/extraction.
        for (const target of [exe, archive]) { try { fs.unlinkSync(target) } catch (e) { if (e.code !== 'ENOENT') { mark('CLEANUP', e); throw e } } }
      }
    }
    fs.writeFileSync(evidence, JSON.stringify({ issue: 70, meaning: 'Fixed-release witness; installed file not compared; no authorization', samples }, null, 2) + '\n')
  } finally {
    try { fs.closeSync(evidence) } catch (e) { mark('CLEANUP', e); throw e }
    if (owned) { try { fs.rmdirSync(owned) } catch (e) { mark('CLEANUP', e); throw e } }
  }
}

/** Node canonicalizes the module URL; argv may name a real directory alias. */
export function isCLIEntrypoint(entry, moduleURL = import.meta.url) {
  if (!entry) return false
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(moduleURL))
  } catch {
    // Imported modules, missing entries and unsupported URLs are not CLI calls.
    return false
  }
}

if (isCLIEntrypoint(process.argv[1])) {
  const failure = { seen: false }
  main(process.argv[2], failure).catch(err => {
    // Fixed public failure enums only; never print subprocess argv/env/raw errors.
    const known = ['PS51_REQUIRED', 'HOSTED_WINDOWS_ONLY', 'UNPINNED_ENTRY', 'OWNED_PATH_REQUIRED', 'ARCHIVE_LIMIT',
      'PACKAGE_SHA_MISMATCH', 'EXACT_ONE_ENTRY_REQUIRED', 'ENTRY_REJECTED', 'ENTRY_LIMIT', 'ENTRY_LENGTH_MISMATCH',
      'PE_REJECTED', 'X64_REQUIRED', 'SIGNATURE_NOT_VALID', 'EXE_SHA_MISMATCH', 'SAMPLE_WIRE', 'REDIRECT_REJECTED', 'DOWNLOAD_REJECTED', 'ARCHIVE_WRITE_NO_PROGRESS']
    const code = known.find(c => err?.message === c || String(err?.stderr || '').includes("'" + c + "'")) || 'GALLERY_REFERENCE_COLLECTION_FAILED'
    console.error(code)
    console.error('GALLERY70_FAILURE_STAGE=' + (failure.seen && Object.is(failure.error, err) ? failure.stage : 'UNKNOWN'))
    console.error(JSON.stringify(sampleFailureDiagnostic(err)))
    process.exitCode = 1
    try {
      const observation = projectDownloadTrace(failure.download)
      if (observation) console.error(JSON.stringify(observation))
    } catch { /* Diagnostics must not alter the original failure. */ }
  })
}
