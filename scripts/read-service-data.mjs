// Recover the data binding from a registered source service before stopping it.
import fs from 'node:fs'
import path from 'node:path'
const [mode, file] = process.argv.slice(2)
const source = fs.readFileSync(file, 'utf8')
let value
if (mode === 'plist') {
  const match = source.match(/<key>CMSPARK_DATA_DIR<\/key>\s*<string>(.*?)<\/string>/s)
  if (match) value = match[1].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
} else if (mode === 'systemd') {
  const match = source.match(/^Environment="CMSPARK_DATA_DIR=(.*)"\s*$/m)
  if (match) value = match[1].replace(/%%/g, '%').replace(/\\([\\"])/g, '$1')
} else throw new Error('Unknown registered service format')
// Legacy registrations without a data binding keep their original fallback.
if (value !== undefined) {
  if (!path.isAbsolute(value) || /[\r\n\0]/.test(value)) throw new Error('Registered service data directory must be an absolute literal path')
  process.stdout.write(value)
}
