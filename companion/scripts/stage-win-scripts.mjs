import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.argv.includes('--windows-only') && process.platform !== 'win32') process.exit(0)
const source = fileURLToPath(new URL('../src/host-use/win/scripts/', import.meta.url))
const destination = fileURLToPath(new URL('../dist/host-scripts-win/', import.meta.url))
mkdirSync(destination, { recursive: true })
for (const name of readdirSync(source).filter(name => name.endsWith('.ps1'))) {
  copyFileSync(join(source, name), join(destination, name))
}
const verifier = fileURLToPath(new URL('../../scripts/verify-windows-host-scripts.mjs', import.meta.url))
execFileSync(process.execPath, [verifier, source, destination], { stdio: 'inherit' })
