const fs = require("fs")
const path = require("path")
const root = path.join(__dirname, "..")
const out = process.argv[2]
if (!out) {
  console.error("usage: node scripts/render-project-navigation-fixture.cjs <dir> [--hold-storage] [--level=chat]")
  process.exit(1)
}
fs.mkdirSync(out, { recursive: true })
const entry = path.join(__dirname, "project-navigation-preview.tsx")
require(path.join(root, "node_modules/esbuild")).build({
  entryPoints: [entry],
  bundle: true,
  outfile: path.join(out, "app.js"),
  absWorkingDir: root,
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "css", ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl" },
}).then(() => {
  fs.writeFileSync(path.join(out, "index.html"), "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><body style=\"margin:0\"><div id=\"root\"></div><script src=\"app.js\"></script></body></html>")
  console.log(out)
}).catch(error => {
  console.error(error)
  process.exit(1)
})
