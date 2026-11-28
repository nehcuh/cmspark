// Runtime module graph for the two shipped JS applications. esbuild erases TS
// types and resolves the same relative imports, re-exports and index files as
// the bundler. Keep require() and import() edges visible in the JSON report.
import { readdirSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../", import.meta.url))
const { build } = createRequire(new URL("../companion/package.json", import.meta.url))("esbuild")
const roots = ["companion/src", "chrome-extension/src"]

// Kosaraju's two traversals partition nodes by mutual reachability. A component
// with a single member is cyclic only when the module imports itself.
function cycles(edges, include) {
  const outgoing = new Map()
  const incoming = new Map()
  for (const name of Object.keys(edges)) {
    outgoing.set(name, [])
    incoming.set(name, [])
  }
  for (const [from, imports] of Object.entries(edges)) {
    for (const { path: to, kind } of imports) {
      if (include(kind)) {
        outgoing.get(from).push(to)
        incoming.get(to).push(from)
      }
    }
  }

  const visited = new Set()
  function visit(name, graph, ordered) {
    if (visited.has(name)) return
    visited.add(name)
    for (const next of graph.get(name)) visit(next, graph, ordered)
    ordered.push(name)
  }
  const order = []
  for (const name of outgoing.keys()) visit(name, outgoing, order)
  visited.clear()
  const found = []
  for (const name of order.reverse()) {
    if (visited.has(name)) continue
    const component = []
    visit(name, incoming, component)
    if (component.length > 1 || outgoing.get(name).includes(name)) found.push(component.sort())
  }
  return found.sort((a, b) => a[0].localeCompare(b[0], "en"))
}

export async function inspectDependencies(root = repo) {
  const entryPoints = roots.flatMap(dir =>
    readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name))
      .map(entry => path.relative(root, path.join(entry.parentPath, entry.name))),
  ).sort()
  const { metafile } = await build({
    absWorkingDir: root, entryPoints, bundle: true, splitting: true, format: "esm",
    platform: "neutral", packages: "external", outbase: ".", outdir: ".architecture-out",
    metafile: true, write: false, logLevel: "silent", loader: { ".css": "empty" },
  })
  const modules = Object.fromEntries(Object.entries(metafile.inputs).sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([name, input]) => [name, input.imports.filter(edge => !edge.external).map(({ path, kind }) => ({ path, kind }))]))
  return {
    modules,
    staticCycles: cycles(modules, kind => kind === "import-statement"),
    runtimeCycles: cycles(modules, () => true),
  }
}

// A new edge inside an existing cyclic group matters even if the group does not grow.
export function cyclicEdges(report) {
  const edges = new Set()
  for (const group of report.runtimeCycles) {
    const members = new Set(group)
    for (const from of group) {
      for (const edge of report.modules[from]) {
        if (members.has(edge.path)) edges.add(`${from} --${edge.kind}--> ${edge.path}`)
      }
    }
  }
  return edges
}

if (import.meta.main) {
  const report = await inspectDependencies()
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`${Object.keys(report.modules).length} modules, ${report.staticCycles.length} static import cycles, ${report.runtimeCycles.length} cyclic groups including require() and import().`)
    if (report.runtimeCycles.length) console.log("Use --json for the members and import kinds of all cyclic groups.")
    for (const group of report.staticCycles) console.error("Static import cycle among:\n  " + group.join("\n  "))
  }
  const baseArg = process.argv.indexOf("--base-dir")
  let added = []
  if (baseArg !== -1) {
    const baseDir = process.argv[baseArg + 1]
    if (!baseDir || baseDir.startsWith("--")) throw new Error("--base-dir requires a checkout directory")
    const previous = cyclicEdges(await inspectDependencies(path.resolve(baseDir)))
    added = [...cyclicEdges(report)].filter(edge => !previous.has(edge)).sort()
    for (const edge of added) console.error("New cyclic dependency:", edge)
  }
  process.exitCode = report.staticCycles.length || added.length ? 1 : 0
}
