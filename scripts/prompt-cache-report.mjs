// Run with one or more Companion log files or log directories. Rows from older
// versions may lack routing and cache fields. Keep them visible as unknown.
import { createReadStream } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { createInterface } from "node:readline"

async function logFiles(paths) {
  const files = new Set()
  for (const path of paths.map(name => resolve(name))) {
    if ((await stat(path)).isDirectory()) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isFile() && /^companion-\d{4}-\d{2}-\d{2}(?:\.1)?\.log$/.test(entry.name)) {
          files.add(join(path, entry.name))
        }
      }
    } else {
      files.add(path)
    }
  }
  return files
}

function usageGroup({ kind, round }) {
  if (kind !== "chat") return kind ?? "unknown"
  if (round === 1) return "chat.round_1"
  if (round > 1) return "chat.round_2_plus"
  return "chat.round_unknown"
}

async function report(paths) {
  const groups = new Map()
  let malformed = 0
  for (const file of await logFiles(paths)) {
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
    for await (const line of lines) {
      if (!line.trim()) continue
      let event
      try {
        event = JSON.parse(line)
      } catch {
        malformed++
        continue
      }
      if (event?.event !== "llm.usage") continue
      const data = event.data ?? {}
      const route = [data.base_host ?? "unknown", data.protocol ?? "unknown", data.model ?? "unknown", usageGroup(data)]
      const key = JSON.stringify(route)
      let row = groups.get(key)
      if (!row) {
        row = {
          base_host: route[0], protocol: route[1], model: route[2], group: route[3],
          reported_requests: 0, unknown_requests: 0, hit_requests: 0,
          cached_input_tokens: 0, measured_input_tokens: 0,
        }
        groups.set(key, row)
      }
      const { cached_input_tokens: read, prompt_tokens: input } = data
      if (!Number.isSafeInteger(read) || !Number.isSafeInteger(input) || read < 0 || input < read) {
        row.unknown_requests++
        continue
      }
      row.reported_requests++
      if (read > 0) row.hit_requests++
      row.cached_input_tokens += read
      row.measured_input_tokens += input
    }
  }
  if (malformed) console.error(`Skipped ${malformed} malformed JSONL line(s).`)
  return Array.from(groups.keys()).sort().map(key => {
    const row = groups.get(key)
    const percent = row.measured_input_tokens > 0
      ? Number((100 * row.cached_input_tokens / row.measured_input_tokens).toFixed(2))
      : null
    return { ...row, token_hit_rate_percent: percent }
  })
}

const paths = process.argv.slice(2)
if (!paths.length || paths.includes("--help")) {
  console.log("Usage: node scripts/prompt-cache-report.mjs <log file or directory> [...]")
  process.exitCode = paths.length ? 0 : 1
} else {
  try {
    console.log(JSON.stringify(await report(paths), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
