// The extension and the standalone settings page compile their policies locally.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const readSource = file => readFileSync(file, "utf8").replace(/\r\n/g, "\n")
function project(target, content) {
  if (!process.argv.includes("--check")) {
    mkdirSync(new URL(".", target), { recursive: true })
    writeFileSync(target, content)
    return
  }
  if (!existsSync(target) || readSource(target) !== content) {
    throw new Error(`Stale client contract (${fileURLToPath(target)}). Run node companion/scripts/generate-client-contracts.mjs.`)
  }
}

// Keep both packages independently buildable. Generated imports resolve entirely
// inside the extension; the Companion source owns the business rules.
const projections = [
  ...["reasoning-effort.ts", "chat-output-policy.ts", "native-vision-probe-cache.ts"]
    .map(name => [`llm/${name}`, `sidepanel/utils/${name}`]),
  ...["image-data-url.ts", "threads/related.ts", "threads/recency.ts", "skills/semantic-match.ts", "skills/site-matcher.ts"]
    .map(name => [name, `shared/${name}`]),
]
for (const [sourcePath, targetPath] of projections) {
  const source = new URL("../src/" + sourcePath, import.meta.url)
  const target = new URL("../../chrome-extension/src/" + targetPath, import.meta.url)
  const header = `// Generated from companion/src/${sourcePath} by companion/scripts/generate-client-contracts.mjs.\n`
  project(target, header + readSource(source))
}

// The settings HTML runs without a module loader. Include the model catalog and
// its endpoint predicates in the same browser scope as the exported heuristic.
const sourceDir = fileURLToPath(new URL("../src/llm/", import.meta.url))
const { outputFiles } = await build({
  absWorkingDir: sourceDir,
  stdin: { contents: 'export { likelyMultimodal } from "./reasoning-effort"', resolveDir: sourceDir },
  platform: "browser", target: "es2022", bundle: true, format: "iife", globalName: "settingsVision",
  legalComments: "none", charset: "utf8", write: false,
})
const script = outputFiles[0].text.trimEnd().split("\n")
project(new URL("../src/llm/settings-vision-script.generated.json", import.meta.url), JSON.stringify(script, null, 2) + "\n")
