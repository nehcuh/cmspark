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
export async function downloadArchive(app, destination, fetchImpl = fetch) {
  const fixed = catalog.find(p => p.token === app.token)
  if (!fixed || JSON.stringify(app) !== JSON.stringify(fixed)) throw new Error('UNPINNED_ARTIFACT')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_MS)
  let fd
  try {
    fd = fs.openSync(destination, 'wx', 0o600)
    let url = fixed.reference.artifactURL
    let response
    for (let redirects = 0; ; redirects++) {
      response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const next = new URL(response.headers.get('location') || '', url).href
      await response.body?.cancel()
      if (redirects >= 3 || !allowedRedirect(next, fixed.token)) throw new Error('REDIRECT_REJECTED')
      url = next
    }
    if (response.status !== 200 || !response.body) throw new Error('DOWNLOAD_REJECTED')
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > ARCHIVE_LIMIT)) throw new Error('ARCHIVE_LIMIT')
    const hash = createHash('sha256')
    let bytes = 0
    for await (const chunk of response.body) {
      bytes += chunk.byteLength
      if (bytes > ARCHIVE_LIMIT) throw new Error('ARCHIVE_LIMIT')
      hash.update(chunk)
      // writeSync may make partial progress; never silently hash unwritten data.
      let offset = 0
      while (offset < chunk.byteLength) offset += fs.writeSync(fd, chunk, offset, chunk.byteLength - offset)
    }
    const sha256 = hash.digest('hex')
    if (sha256 !== fixed.reference.packageSHA256) throw new Error('PACKAGE_SHA_MISMATCH')
    return { bytes, sha256 }
  } catch (err) {
    if (fd !== undefined) {
      fs.closeSync(fd); fd = undefined
      fs.unlinkSync(destination)
    }
    throw err
  } finally {
    clearTimeout(timer)
    controller.abort()
    if (fd !== undefined) fs.closeSync(fd)
  }
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

export async function main(output) {
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
        const pkg = await downloadArchive(app, archive)
        // Existing runner's 15s/16MiB bounds, unmodified. No application execution.
        const raw = await runPs(path.join(root, 'scripts/fixtures/app-gallery-reference-70.ps1'),
          [archive, exe, app.reference.referenceEXERelativePath, app.reference.packageSHA256])
        samples.push({ token: app.token, release: app.reference.release, architecture: app.reference.architecture,
          artifactURL: app.reference.artifactURL, packageBytes: pkg.bytes, packageSHA256: pkg.sha256, ...parseSample(raw, app), nativeStdout: raw })
      } finally {
        // Only exact files we exclusively own; never recursive removal/extraction.
        for (const target of [exe, archive]) { try { fs.unlinkSync(target) } catch (e) { if (e.code !== 'ENOENT') throw e } }
      }
    }
    fs.writeFileSync(evidence, JSON.stringify({ issue: 70, meaning: 'Fixed-release witness; installed file not compared; no authorization', samples }, null, 2) + '\n')
  } finally {
    fs.closeSync(evidence)
    if (owned) fs.rmdirSync(owned)
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
  main(process.argv[2]).catch(err => {
    // Fixed public failure enums only; never print subprocess argv/env/raw errors.
    const known = ['PS51_REQUIRED', 'HOSTED_WINDOWS_ONLY', 'UNPINNED_ENTRY', 'OWNED_PATH_REQUIRED', 'ARCHIVE_LIMIT',
      'PACKAGE_SHA_MISMATCH', 'EXACT_ONE_ENTRY_REQUIRED', 'ENTRY_REJECTED', 'ENTRY_LIMIT', 'ENTRY_LENGTH_MISMATCH',
      'PE_REJECTED', 'X64_REQUIRED', 'SIGNATURE_NOT_VALID', 'EXE_SHA_MISMATCH', 'SAMPLE_WIRE', 'REDIRECT_REJECTED', 'DOWNLOAD_REJECTED']
    const code = known.find(c => err?.message === c || String(err?.stderr || '').includes("'" + c + "'")) || 'GALLERY_REFERENCE_COLLECTION_FAILED'
    console.error(code)
    process.exitCode = 1
  })
}
