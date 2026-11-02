import fs from 'node:fs'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { runOwnedCompiler758 } from './activity-native-fixture-758'

export async function buildScope825(root: string, signal: AbortSignal): Promise<string> {
  const framework = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319')
  const compiler = path.join(framework, 'csc.exe'), output = path.join(root, 'activity-scope825.exe')
  const references = ['System.dll', 'System.Core.dll', 'System.Web.Extensions.dll', 'System.Xaml.dll', 'PresentationFramework.dll', 'PresentationCore.dll', 'WindowsBase.dll'].map(name => {
    const found = [path.join(framework, 'WPF', name), path.join(framework, name)].find(file => fs.existsSync(file) && fs.statSync(file).isFile())
    if (!found) throw Error('OWNED_SCOPE825_REFERENCE_UNAVAILABLE')
    return '/reference:' + found
  })
  await runOwnedCompiler758(compiler, ['/noconfig', '/nologo', '/utf8output', '/target:winexe', '/platform:anycpu', '/out:' + output, ...references, path.resolve('tests/fixtures/activity-scope825-windows.cs')], { signal, timeout: 10000, maxBuffer: 4096, windowsHide: true })
  signal.throwIfAborted()
  if (!fs.statSync(output).isFile() || !fs.statSync(output).size) throw Error('OWNED_SCOPE825_BINARY_UNAVAILABLE')
  return output
}
export function scope825Receipt(file: string, child: ChildProcess, signal: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (error?: unknown, value?: unknown) => { if (done) return; done = true; clearTimeout(timer); watch.close(); child.off('close', closed); signal.removeEventListener('abort', aborted); error ? reject(error) : resolve(value) }
    const check = () => { try {
      const failure = path.join(path.dirname(file), 'failure.json')
      if (fs.existsSync(failure)) return finish(Error('OWNED_SCOPE825_FIXTURE_FAILED ' + fs.readFileSync(failure, 'utf8').slice(0, 512)))
      if (fs.existsSync(file)) finish(undefined, JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch (error) { finish(error) } }
    const closed = () => finish(Error('OWNED_SCOPE825_CHILD_CLOSED')), aborted = () => finish(signal.reason)
    const watch = fs.watch(path.dirname(file), check), timer = setTimeout(() => { check(); if (!done) finish(Error('OWNED_SCOPE825_RECEIPT_TIMEOUT')) }, 10000)
    child.once('close', closed); signal.addEventListener('abort', aborted, { once: true }); if (signal.aborted) aborted(); else check()
  })
}
