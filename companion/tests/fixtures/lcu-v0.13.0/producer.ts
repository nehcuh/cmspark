import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import path from "node:path"
import { runInNewContext } from "node:vm"
import { STATUS_SOURCE, STATUS_SOURCE_SHA256, TESTED_SOURCE, TESTED_SOURCE_SHA256, TESTED_VERSIONS_SOURCE, TESTED_VERSIONS_SOURCE_SHA256 } from "./sources"

const sha = (value: string) => createHash("sha256").update(value).digest("hex")
export async function upstreamStatus(options: { platform?: string; appVersion?: string; runtime?: string; record?: "missing" | "malformed"; changed?: boolean } = {}): Promise<unknown> {
  assert.equal(sha(STATUS_SOURCE), STATUS_SOURCE_SHA256)
  assert.equal(sha(TESTED_SOURCE), TESTED_SOURCE_SHA256)
  assert.equal(sha(TESTED_VERSIONS_SOURCE), TESTED_VERSIONS_SOURCE_SHA256)
  const entries = JSON.parse(TESTED_VERSIONS_SOURCE).entries as Array<Record<string, string>>
  const pair = entries.find(entry => entry.platform === (options.platform ?? "darwin") && entry.architecture === "arm64")!
  assert.ok(pair, "exact pinned upstream record must contain this platform")
  const root = "/owned/lcu", descriptor = {
    platform: pair.platform, architecture: pair.architecture,
    package_version: options.changed ? "old-app" : options.appVersion ?? pair.app_version,
    runtime: options.runtime ?? pair.runtime,
  }
  const metadata = { version: options.appVersion ?? pair.app_version, runtime: options.runtime ?? pair.runtime }
  const readFileSync = () => {
    if (options.record === "missing") throw Object.assign(new Error("owned missing record"), { code: "ENOENT" })
    return options.record === "malformed" ? "{}" : TESTED_VERSIONS_SOURCE
  }
  // The complete real producer is evaluated with only inert builtins. The real
  // observe() receives metadata, so its dynamic runtime import is never reached.
  const tested = runInNewContext(`${TESTED_SOURCE.replace(/\bexport /g, "")}\n({ assess, observe, changedSinceInstall })`, {
    process: { getBuiltinModule: (name: string) => name === "node:fs" ? { readFileSync } : { join: path.posix.join } },
  })
  const start = STATUS_SOURCE.indexOf("export async function collect(root) {")
  const end = STATUS_SOURCE.indexOf("\nconst USAGE =", start)
  assert.ok(start >= 0 && end > start)
  const collect = runInNewContext(`${STATUS_SOURCE.slice(start, end).replace(/^export /, "")}\ncollect`, {
    join: path.posix.join,
    existsSync: () => true,
    readJson: (filename: string) => filename.endsWith("installation.json") ? descriptor : { version: "0.13.0" },
    paths: () => ({ app: "/Applications/ChatGPT.app", metadata }), tested,
    savedSetup: () => ({ pending: ["PRIVATE_SETUP_SENTINEL"], secret: "PRIVATE_SETUP_SENTINEL" }),
    crossTurn: () => ({ enabled: false, source: null }),
    update: { cachedNotice: () => "PRIVATE_UPDATE_SENTINEL" },
    diagnosticLog: { status: () => "PRIVATE_LOG_SENTINEL" },
  }) as (root: string) => Promise<unknown>
  return collect(root).then(result => JSON.parse(JSON.stringify(result)))
}
