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

const cache = path.join(require("os").tmpdir(), "cmspark-sidebar-review-fixture")
function publish() {
  for (const name of ["app.js", "app.css"]) {
    const from = path.join(cache, name)
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(out, name))
  }
  fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html lang="zh"><meta charset="utf-8"><body style="margin:0"><div id="root"></div>
<link rel="stylesheet" href="/app.css"><script src="/app.js"></script>
`)
}

if (fs.existsSync(path.join(cache, "app.js"))) {
  publish()
} else {
  fs.mkdirSync(cache, { recursive: true })
  esbuild.build({
    absWorkingDir: path.join(__dirname, ".."),
    nodePaths: [path.join(__dirname, "../node_modules")],
    entryPoints: [path.join(__dirname, "sidebar-review-fixture.tsx")],
    bundle: true,
    outfile: path.join(cache, "app.js"),
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "css", ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl" },
    plugins: [{
      name: "inner-probe",
      setup(build) {
        build.onLoad({ filter: /agentStore\.tsx$/ }, (args) => {
          let text = fs.readFileSync(args.path, "utf8")
          text = text.replace(
            'import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from "react"',
            'import { createContext, useContext, useEffect, useReducer, type ReactNode, type Dispatch } from "react"',
          )
          text = text.replace(
            "{children}\n    </AgentContext.Provider>",
            "<ProbeBridge state={state} dispatch={dispatch} />\n      {children}\n    </AgentContext.Provider>",
          )
          text += "\n" + probe
          return { contents: text, loader: "tsx" }
        })
      },
    }],
  }).then(() => publish()).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
