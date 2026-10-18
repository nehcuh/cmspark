// Explicit root-local recovery only. Never used by CI, models or the application.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { recoverEvidence } from './windows-census-evidence.mjs'

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 8) throw Error('CENSUS_EVIDENCE_USAGE')
  const [bundleDir, outputDir, privateFile, head, tree, run, attempt, namespace] = args
  if (![bundleDir, outputDir, privateFile].every(p => path.isAbsolute(p))) throw Error('CENSUS_EVIDENCE_ABSOLUTE_PATH_REQUIRED')
  const stat = fs.lstatSync(privateFile)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw Error('CENSUS_EVIDENCE_PRIVATE_FILE_REQUIRED')
  const privateKey = crypto.createPrivateKey(fs.readFileSync(privateFile))
  const result = await recoverEvidence({ bundleDir, outputDir, privateKey, expected: { head, tree, run, attempt, namespace } })
  console.log(`CENSUS_EVIDENCE_RECOVERED files=${result.files} outcome=${result.status.outcome}`)
  return result.status.complete ? 0 : 1
}
let directEntry = false
try { directEntry = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)) } catch { /* importing never performs recovery */ }
if (directEntry) main().then(code => { process.exitCode = code }, () => { console.error('CENSUS_EVIDENCE_RECOVERY_FAILED'); process.exitCode = 1 })
