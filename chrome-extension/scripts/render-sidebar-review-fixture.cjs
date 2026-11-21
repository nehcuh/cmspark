const fs = require("fs")
const path = require("path")
const esbuild = require(path.join(__dirname, "../node_modules/esbuild"))

const out = process.argv[2]
if (!out) {
  console.error("usage: render-sidebar-review-fixture.cjs <directory>")
  process.exit(2)
}
fs.mkdirSync(out, { recursive: true })

const probe = `
import { useEffect } from "react"
function ProbeBridge({ state, dispatch }) {
  useEffect(() => {
    window.fixtureState = state
    window.dispatchUI = dispatch
  })
  return null
}
`

esbuild.build({
  absWorkingDir: path.join(__dirname, ".."),
  nodePaths: [path.join(__dirname, "../node_modules")],
  entryPoints: [path.join(__dirname, "sidebar-review-fixture.tsx")],
  bundle: true,
  outfile: path.join(out, "app.js"),
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "css", ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl" },
  plugins: [{
    name: "inner-probe",
    setup(build) {
      build.onLoad({ filter: /agentStore\.tsx$/ }, (args) => {
        let text = fs.readFileSync(args.path, "utf8").replace(/\r\n/g, "\n")
        const provider = "{children}\n    </AgentContext.Provider>"
        if (!text.includes(provider)) throw new Error("Fixture provider mount changed")
        text = 'import { useEffect } from "react"\n' + text
        text = text.replace(provider, "<ProbeBridge state={state} dispatch={dispatch} />\n      " + provider)
        return { contents: text + "\n" + probe.replace('import { useEffect } from "react"', ""), loader: "tsx" }
      })
    },
  }],
}).then(() => {
  fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html lang="zh"><meta charset="utf-8"><body style="margin:0"><div id="root"></div>
<link rel="stylesheet" href="/app.css"><script src="/app.js"></script>
`)
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
