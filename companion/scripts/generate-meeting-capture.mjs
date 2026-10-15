import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const voice = path.join(root, "chrome-extension/src/sidepanel/voice")
const check = process.argv.includes("--check")
async function generate(entry, outfile, name, globalName) {
  const output = await esbuild.build({ absWorkingDir: root, entryPoints: [path.join(voice, entry)], bundle: true, write: false,
    format: "iife", platform: "browser", target: "es2020", ...(globalName ? { globalName } : {}), minify: false })
  const inputs = ["meeting-continuous-pcm.ts", entry, ...(entry.includes("capture") ? ["meeting-pcm-worklet-generated.ts"] : [])]
  const sha = crypto.createHash("sha256").update(inputs.map(f => fs.readFileSync(path.join(voice, f))).map(b => b.toString()).join("\n")).digest("hex")
  const text = `// GENERATED from canonical browser capture; esbuild ${esbuild.version}; source sha256 ${sha}.\n// Run companion/scripts/generate-meeting-capture.mjs; do not edit.\nexport const ${name} = ${JSON.stringify(output.outputFiles[0].text)}\n`
  if (check) { if (!fs.existsSync(outfile) || fs.readFileSync(outfile, "utf8") !== text) throw Error("Generated meeting capture differs: " + path.relative(root, outfile)) }
  else fs.writeFileSync(outfile, text)
}
await generate("meeting-pcm-worklet.ts", path.join(voice, "meeting-pcm-worklet-generated.ts"), "MEETING_PCM_WORKLET_JS")
await generate("meeting-continuous-capture.ts", path.join(root, "companion/src/summoner/meeting-continuous-generated.ts"), "MEETING_PCM_BROWSER_JS", "CMsparkMeetingPcm")
