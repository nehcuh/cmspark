// The browser build is self-contained. Ship it and the licenses of its embedded modules.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

const require = createRequire(import.meta.url)
const destination = process.argv[2]
const dependencies = new URL("../node_modules/", import.meta.url)
const licenses = [
  ["markdown-it", "LICENSE"], ["entities", "LICENSE"], ["linkify-it", "LICENSE"],
  ["mdurl", "LICENSE"], ["punycode.js", "LICENSE-MIT.txt"], ["uc.micro", "LICENSE.txt"],
]
mkdirSync(destination, { recursive: true })
copyFileSync(require.resolve("markdown-it/browser"), join(destination, "markdown-it.umd.min.js"))
const notices = licenses.map(([name, file]) =>
  name + "\n\n" + readFileSync(new URL(name + "/" + file, dependencies), "utf8").trimEnd())
writeFileSync(join(destination, "markdown-it.LICENSE"), notices.join("\n\n") + "\n")
