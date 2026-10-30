// Build-time comparison of the checked-in tray source and emitted JS.
// This does not replace a typecheck or establish the tray binary's provenance.
export function assertFreshTraySource({ typescript, source, compiled, compilerOptions, fileName }) {
  const result = typescript.transpileModule(source, {
    compilerOptions,
    fileName,
    reportDiagnostics: true,
  })
  if (result.diagnostics?.some(d => d.category === typescript.DiagnosticCategory.Error)) {
    throw new Error("TRAY_SOURCE_TRANSPILE_FAILED")
  }
  if (result.outputText !== compiled) throw new Error("TRAY_COMPILED_SOURCE_STALE")
}
