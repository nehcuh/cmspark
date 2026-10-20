/** Unshipped #723 acceptance controls; no product imports or native effects. */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
export const modes723 = ["printwindow", "minimized", "nonforeground", "partial", "occluded"] as const
export type Mode723 = typeof modes723[number]
const anchor723 = "$printed = [CapW32]::PrintWindow($hwndPtr, $hdc, 2)"
const forced723 = anchor723 + "; $printed = $false # TEST_ONLY_723_AFTER_REAL_PRINTWINDOW"
export function forcedFallback723(source: string): string {
  assert.equal(source.split(anchor723).length, 2, "exact unique real PrintWindow anchor required")
  assert.ok(!source.includes("TEST_ONLY_723"))
  const variant = source.replace(anchor723, forced723)
  assert.equal(variant.replace(forced723, anchor723), source, "whole script inverse")
  return variant
}
export function remaining723(deadline: number, now = performance.now(), minimum = 1): number {
  const remaining = Math.floor(deadline - now)
  assert.ok(remaining >= minimum, "D1_723_ORIGINAL_LIFETIME_EXHAUSTED")
  return remaining
}
export type Receipt723 = { hwnd: number; other: number; foreground: number; minimized: boolean; desktop51: boolean }
export function receipt723(text: string): Receipt723 {
  assert.ok(Buffer.byteLength(text) <= 1024)
  const value = JSON.parse(text)
  assert.ok(value && !Array.isArray(value) && Object.keys(value).sort().join() === "desktop51,foreground,hwnd,minimized,other")
  assert.ok([value.hwnd, value.other, value.foreground].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0))
  assert.ok(value.hwnd > 0 && value.foreground > 0 && typeof value.minimized === "boolean" && value.desktop51 === true)
  return value
}
export function assertSetup723(mode: Mode723, r: Receipt723): void {
  assert.equal(r.minimized, mode === "minimized")
  if (mode === "minimized" || mode === "nonforeground") assert.ok(r.other > 0 && r.other !== r.hwnd && r.foreground === r.other)
  else assert.ok(r.foreground === r.hwnd, "owned target must be foreground")
  if (mode === "occluded") assert.ok(r.other > 0 && r.other !== r.hwnd)
}
export function assertUnchanged723(before: Receipt723, after: Receipt723): void {
  assert.ok(Object.keys(before).every(key => (after as any)[key] === (before as any)[key]), "passive capture must not activate, restore, replace or close an owned window")
}
export interface Child723 { closed: Promise<void>; isClosed(): boolean; terminate(): boolean }
/** Retain all exact children through close; cleanup failures cannot replace primary. */
export async function cleanup723(children: Child723[], removeOwned: () => void, primary: unknown): Promise<void> {
  let error: unknown
  for (const c of [...children].reverse()) {
    try { if (!c.isClosed() && !c.terminate()) throw Error("D1_723_OWNED_TERMINATE_REFUSED") } catch (e) { error ??= e }
    try { await c.closed } catch (e) { error ??= e }
  }
  try { removeOwned() } catch (e) { error ??= e }
  if (primary !== undefined) throw primary
  if (error !== undefined) throw error
}
/** Initial snapshot plus event notifications, never polling/retrying a capture. */
export function waitReceipt723(file: string, owner: Child723, deadline: number, signal: AbortSignal): Promise<Receipt723> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown, value?: Receipt723) => {
      if (settled) return
      settled = true; clearTimeout(timer); watcher.close(); signal.removeEventListener("abort", abort)
      if (error !== undefined) reject(error); else resolve(value!)
    }
    const check = () => {
      try {
        signal.throwIfAborted()
        if (owner.isClosed()) throw Error("D1_723_OWNER_CLOSED")
        if (fs.existsSync(file)) {
          const stat = fs.lstatSync(file)
          assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 1024)
          finish(undefined, receipt723(fs.readFileSync(file, "utf8")))
        }
      } catch (e) { finish(e) }
    }
    const abort = () => finish(signal.reason ?? Error("D1_723_ABORTED"))
    const watcher = fs.watch(path.dirname(file), check)
    const timer = setTimeout(() => finish(Error("D1_723_ORIGINAL_LIFETIME_EXHAUSTED")), Math.max(1, deadline - performance.now()))
    watcher.on("error", e => finish(e)); signal.addEventListener("abort", abort, { once: true })
    void owner.closed.then(() => finish(Error("D1_723_OWNER_CLOSED")), e => finish(e))
    check()
  })
}
