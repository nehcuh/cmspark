#!/usr/bin/env node
// Fake cmspark-whisper for unit tests.
// Prints a fixed transcript (or sleeps when CMSPARK_WHISPER_SLEEP_MS is set).
// Argv schema matches whisper-cli: -m MODEL -f AUDIO -l LANG -nt

const sleepMs = Number(process.env.CMSPARK_WHISPER_SLEEP_MS || "0")
const text = process.env.CMSPARK_WHISPER_TEXT || "hello fixture"

function parseArgs(argv) {
  const out = { m: null, f: null, l: null, nt: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === "-m") out.m = argv[++i]
    else if (a === "-f") out.f = argv[++i]
    else if (a === "-l") out.l = argv[++i]
    else if (a === "-nt") out.nt = true
  }
  return out
}

const args = parseArgs(process.argv)
// Minimal validation so mis-wired callers fail loudly
if (!args.m || !args.f) {
  console.error("fake-cmspark-whisper: missing -m or -f")
  process.exit(2)
}

const run = async () => {
  if (sleepMs > 0) {
    await new Promise((r) => setTimeout(r, sleepMs))
  }
  // Exit 0 with transcript on stdout (no timestamps, like -nt)
  process.stdout.write(`${text}\n`)
  process.exit(0)
}

run().catch((e) => {
  console.error(String(e))
  process.exit(1)
})
