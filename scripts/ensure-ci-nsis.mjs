// #633: same NSIS 3.12 installer, without Chocolatey's failing metadata lookup.
// Published nsis.install 3.12.0 SHA512 and separately verified bundled setup SHA256.
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

export const NSIS_PACKAGE_URL = "https://community.chocolatey.org/api/v2/package/nsis.install/3.12.0"
export const NSIS_PACKAGE_SHA512 = "e7057af08ff9c5a644e97ad71228af38edd1cb77a5e2bd92107a63a26f3b58459076ea6ba153bd00a07069024b52f260742172f54c5ad1430c66522038fb9bdb"
export const NSIS_SETUP_SHA256 = "3bc2b06253a7e4957111be152ac6a536e0c7478a706e19da814038db5d706495"
export const MAX_PACKAGE_BYTES = 8 * 1024 * 1024
const require = createRequire(new URL("../companion/package.json", import.meta.url))
const retryStatuses = new Set([429, 500, 502, 503, 504])
const retryCodes = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET"])

async function boundedBody(response) {
  const declared = Number(response.headers.get("content-length"))
  if (declared > MAX_PACKAGE_BYTES) {
    await response.body?.cancel()
    throw new Error("NSIS package exceeds size limit")
  }
  if (!response.body) throw new Error("NSIS package body missing")
  const reader = response.body.getReader(), chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PACKAGE_BYTES) {
        await reader.cancel()
        throw new Error("NSIS package exceeds size limit")
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks, size)
  } finally { reader.releaseLock() }
}

/** Dependency injection is for isolated transport tests; URL/version/pins have no CLI/env override. */
export async function fetchNsisPackage({ fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response
    try {
      response = await fetchImpl(NSIS_PACKAGE_URL, { signal: AbortSignal.timeout(30_000) })
    } catch (error) {
      const transient = error?.name === "TimeoutError" || retryCodes.has(error?.cause?.code || error?.code)
      if (!transient || attempt === 2) throw new Error("NSIS package transport failed", { cause: error })
      await sleep(500 * (attempt + 1))
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      if (!retryStatuses.has(response.status) || attempt === 2) throw new Error(`NSIS package HTTP ${response.status}`)
      await sleep(500 * (attempt + 1))
      continue
    }
    // Integrity, parsing and installation failures are outside the transport retry loop.
    return boundedBody(response)
  }
  throw new Error("NSIS package attempts exhausted")
}

export function verifiedNsisSetup(bytes) {
  if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new Error("NSIS package exceeds size limit")
  if (createHash("sha512").update(bytes).digest("hex") !== NSIS_PACKAGE_SHA512)
    throw new Error("NSIS package checksum mismatch")
  const AdmZip = require("adm-zip")
  const entry = new AdmZip(bytes).getEntry("tools/nsis-3.12-setup.exe")
  if (!entry || entry.isDirectory) throw new Error("NSIS pinned installer entry missing")
  // No upstream scripts or archive-controlled paths are extracted or executed.
  const setup = entry.getData()
  if (createHash("sha256").update(setup).digest("hex") !== NSIS_SETUP_SHA256 || setup.subarray(0, 2).toString() !== "MZ")
    throw new Error("NSIS installer checksum mismatch")
  return setup
}

export function requireWindowsCi(platform, env) {
  if (platform !== "win32" || env.GITHUB_ACTIONS !== "true") throw new Error("NSIS setup is restricted to Windows GitHub Actions")
}

async function main() {
  requireWindowsCi(process.platform, process.env)
  const setup = verifiedNsisSetup(await fetchNsisPackage())
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-ci-nsis-"))
  try {
    const exe = path.join(owned, "nsis-3.12-setup.exe")
    fs.writeFileSync(exe, setup, { flag: "wx" })
    const result = spawnSync(exe, ["/S"], { stdio: "inherit", timeout: 120_000, shell: false })
    if (result.error?.code === "ETIMEDOUT") throw new Error("NSIS pinned installer timed out (120s)")
    if (result.error) throw new Error("NSIS pinned installer could not start")
    if (![0, 3010].includes(result.status)) throw new Error(`NSIS pinned installer failed (exit ${Number.isInteger(result.status) ? result.status : "unknown"})`)
    const compiler = path.join(process.env["ProgramFiles(x86)"] || "", "NSIS", "makensis.exe")
    if (!fs.existsSync(compiler)) throw new Error("NSIS compiler missing after installation")
    console.log("NSIS 3.12 installer verified and available for native regressions")
  } finally { fs.rmSync(owned, { recursive: true, force: true }) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
