// The independently distributed extension compiles its policy projection locally.
import { existsSync, readFileSync, writeFileSync } from "node:fs"

// Git may check out the two packages with different line endings on Windows.
const readSource = file => readFileSync(file, "utf8").replace(/\r\n/g, "\n")
const check = process.argv.includes("--check")
for (const name of ["reasoning-effort.ts", "chat-output-policy.ts"]) {
  const source = new URL("../src/llm/" + name, import.meta.url)
  const target = new URL("../../chrome-extension/src/sidepanel/utils/" + name, import.meta.url)
  const header = `// Generated from companion/src/llm/${name} by companion/scripts/generate-model-policy.mjs.\n`
  const generated = header + readSource(source)
  if (check) {
    if (!existsSync(target) || readSource(target) !== generated) {
      throw new Error(`Stale extension model policy (${name}). Run node companion/scripts/generate-model-policy.mjs from the repository root.`)
    }
  } else {
    writeFileSync(target, generated)
  }
}
