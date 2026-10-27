'use strict'
// Execute the actual registered callback with real surface ownership and inert native boundaries.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')

exports.runFailure723 = async function (sourceFile, data, surface, helpers, point, signal) {
  const source = fs.readFileSync(sourceFile, 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const callbacks = [], injected = Error('CPU_723_INJECTED'), env = { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', CMSPARK_DATA_DIR: data, TEMP: 'original-temp', TMP: 'original-tmp', TMPDIR: 'original-tmpdir' }
  let subprocessCalls = 0
  const cp = { execFile() { subprocessCalls++; throw Error('NATIVE_SUBPROCESS_FORBIDDEN') } }
  const fakefs = new Proxy(fs, { get(target, key) {
    if (point === 'before' && key === 'mkdtempSync') return () => { throw injected }
    if (point === 'inside' && key === 'mkdirSync') return () => { throw injected }
    return target[key]
  } })
  const require723 = id => {
    if (id === 'node:test') return (_name, _options, cb) => callbacks.push(cb)
    if (id === 'node:fs') return fakefs
    if (id === 'node:child_process') return cp
    if (id === './fixtures/native-surface-650') return surface
    if (id === './helpers/capture-native-723') return helpers
    if (id.startsWith('node:')) return require(id)
    throw Error('CPU_UNDECLARED_IMPORT')
  }
  const context = vm.createContext({ require: require723, exports: {}, __dirname: path.dirname(sourceFile), process: { platform: 'win32', env }, performance, Buffer, console })
  vm.runInContext(code, context, { filename: sourceFile })
  let error
  try { await callbacks[0]({ signal, diagnostic() {} }) } catch (caught) { error = caught }
  return { error, injected, subprocessCalls, env }
}
