// TypeScript emits JavaScript only. Keep the helper locations the same in dist/.
import { chmodSync, copyFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

const helpers = [
  "computer/qwen-vl-worker.py",
  "activity/linux-recorder.py",
  "mini/linux-mini-orb.py",
  "mini/linux-mini-region.py",
]
for (const helper of helpers) {
  const target = join("dist", helper)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join("src", helper), target)
}
if (process.platform !== "win32") chmodSync("dist/index.js", 0o755)
