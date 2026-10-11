// Literal paths must survive XML and systemd escaping without shell expansion.
import fs from 'node:fs'

const [mode, source, home, node, agent] = process.argv.slice(2)
const xml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
const unit = value => value.replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
const shell = value => "'" + value.replace(/'/g, "'\\''") + "'"
for (const value of [home, node, agent]) {
  if (/[\r\n\0]/.test(value)) throw new Error('Service paths cannot contain line breaks or NUL')
}
if (mode === 'applescript') {
  const command = `${shell(node)} ${shell(agent)} tray`
  const quoted = JSON.stringify(command)
  process.stdout.write(`on run\n  do shell script ${quoted}\nend run\non open theFiles\n  do shell script ${quoted}\nend open\n`)
} else if (mode === 'shell') {
  process.stdout.write(`#!/bin/bash\nexec ${shell(node)} ${shell(agent)} tray\n`)
} else {
  if (mode !== 'plist' && mode !== 'systemd') throw new Error('Unknown service format')
  const escape = mode === 'plist' ? xml : unit
  const values = { HOME: home, NODE_PATH: node, CMSPARK_AGENT_PATH: agent }
  process.stdout.write(fs.readFileSync(source, 'utf8').replace(/\{\{(HOME|NODE_PATH|CMSPARK_AGENT_PATH)\}\}/g, (_, key) => escape(values[key])))
}
