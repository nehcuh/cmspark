import * as fs from "fs"
import * as path from "path"

/** Fallback must stay lock-step with companion/package.json (test-package-gates). */
export const CLI_VERSION_FALLBACK = "0.6.7"

export function resolveCliVersion(): string {
  const candidates = [
    path.join(__dirname, "..", "package.json"),
    path.join(__dirname, "..", "..", "package.json"),
  ]
  for (const pkgPath of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: unknown }
      if (typeof pkg.version === "string" && pkg.version.trim()) return pkg.version.trim()
    } catch {
      /* try next layout (dist/ vs .test-dist/src/) */
    }
  }
  return CLI_VERSION_FALLBACK
}
