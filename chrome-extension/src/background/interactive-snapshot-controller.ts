import { InteractiveSnapshotCache, SnapshotRefusal, type SnapshotOwner, type SnapshotSlot, type SnapshotBinding, type SnapshotRecord, type SnapshotCode, SnapshotCleanup } from "./interactive-snapshot-cache"
import { interactiveSnapshotInWorld, snapshotMetadata, snapshotOutput } from "./interactive-snapshot"

type Cdp = (tabId: number, method: string, params?: any) => Promise<any>
const refused = new Set<SnapshotCode>(["SNAPSHOT_SCOPE_REQUIRED", "SNAPSHOT_STALE", "SNAPSHOT_INCOMPLETE", "SNAPSHOT_CAPACITY", "SNAPSHOT_UNSUPPORTED_DOCUMENT", "SNAPSHOT_UNSUPPORTED_CONTROL", "ELEMENT_OCCLUDED", "SNAPSHOT_FAILED", "ELEMENT_AMBIGUOUS"])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export class InteractiveSnapshotController {
  readonly cache: InteractiveSnapshotCache
  constructor(private cdp: Cdp, private tab: (tabId: number) => Promise<{ url?: string }>, cleanup?: SnapshotCleanup) {
    this.cache = new InteractiveSnapshotCache(undefined, undefined, cleanup, () => this.cleanupQuarantines())
  }
  private async cleanupQuarantines() {
    for (const claim of this.cache.cleanup.takeQuarantineCleanup()) {
      try {
        // This direct same-extension command proves an existing client; never attach.
        const proof = await this.cdp(claim.tabId, "Page.getFrameTree")
        if (typeof proof?.frameTree?.frame?.id === "string") await this.cdp(claim.tabId, "Runtime.releaseObjectGroup", { objectGroup: claim.group })
      } catch { /* Keep every inherited claim quarantined, even after successful release. */ }
    }
  }
  private async view(tabId: number, guard: () => void) {
    const tab = await this.tab(tabId); guard()
    if (!tab.url || !/^https?:\/\//.test(tab.url)) throw new SnapshotRefusal("SNAPSHOT_UNSUPPORTED_DOCUMENT")
    const { frameTree } = await this.cdp(tabId, "Page.getFrameTree"); guard()
    const f = frameTree?.frame
    if (typeof f?.id !== "string" || !f.id || typeof f.loaderId !== "string" || !f.loaderId || (f.url + (f.urlFragment || "")) !== tab.url) throw new SnapshotRefusal("SNAPSHOT_STALE")
    const { root } = await this.cdp(tabId, "DOM.getDocument", { depth: 0, pierce: false }); guard()
    if (!Number.isSafeInteger(root?.backendNodeId) || root.backendNodeId <= 0) throw new SnapshotRefusal("SNAPSHOT_STALE")
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tab.url)); guard()
    const urlHash = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("")
    return { frameId: f.id as string, loaderId: f.loaderId as string, documentId: root.backendNodeId as number, urlHash }
  }
  private async verify(s: SnapshotSlot, binding: SnapshotBinding) {
    this.cache.check(s)
    const current = await this.view(s.tabId, () => this.cache.check(s))
    this.cache.check(s)
    if (current.frameId !== binding.frameId || current.loaderId !== binding.loaderId || current.documentId !== binding.documentId || current.urlHash !== binding.urlHash) throw new SnapshotRefusal("SNAPSHOT_STALE")
  }
  private value(reply: any): any {
    if (reply?.exceptionDetails || !reply?.result || !Object.hasOwn(reply.result, "value")) throw new SnapshotRefusal("SNAPSHOT_FAILED")
    const value = reply.result.value
    if (value?.refused) throw new SnapshotRefusal(refused.has(value.refused) ? value.refused : "SNAPSHOT_FAILED")
    return value
  }
  private async release(s: SnapshotSlot, group: string) {
    // Direct existing-session command: cleanup must NEVER ensureAttached/take over.
    try { await this.cdp(s.tabId, "Runtime.releaseObjectGroup", { objectGroup: group }); return true }
    catch { this.cache.holdFailedCleanup(s); return false }
  }
  async collect(owner: SnapshotOwner, tabId: number, existing?: SnapshotSlot) {
    const s = existing ?? await this.cache.begin(owner, tabId), group = s.claim.group
    this.cache.check(s)
    if (s.owner.scope_id !== owner.scope_id || s.owner.thread_id !== owner.thread_id || s.tabId !== tabId) throw new SnapshotRefusal("SNAPSHOT_STALE")
    let groupStarted = false, released = false
    let binding!: SnapshotBinding, records!: SnapshotRecord[], output!: ReturnType<typeof snapshotOutput>
    try {
      for (const method of ["Page.enable", "Runtime.enable", "DOM.enable"]) { await this.cdp(tabId, method); this.cache.check(s) }
      const first = await this.view(tabId, () => this.cache.check(s)); this.cache.check(s)
      const world = await this.cdp(tabId, "Page.createIsolatedWorld", { frameId: first.frameId, worldName: "cmspark-numbered-controls-v1" }); this.cache.check(s)
      if (!Number.isSafeInteger(world?.executionContextId) || world.executionContextId <= 0) throw new SnapshotRefusal("SNAPSHOT_FAILED")
      s.initializing = false
      binding = { ...first, contextId: world.executionContextId, signature: "" }
      s.binding = binding
      await this.verify(s, binding); this.cache.check(s)
      groupStarted = true
      const collect = await this.cdp(tabId, "Runtime.callFunctionOn", { functionDeclaration: interactiveSnapshotInWorld.toString(), executionContextId: binding.contextId, arguments: [{ value: { mode: "collect" } }], objectGroup: group, returnByValue: false, awaitPromise: false })
      this.cache.check(s)
      if (collect?.exceptionDetails || typeof collect?.result?.objectId !== "string") throw new SnapshotRefusal("SNAPSHOT_FAILED")
      const objectId = collect.result.objectId
      const raw = this.value(await this.cdp(tabId, "Runtime.callFunctionOn", { objectId, functionDeclaration: "function(){return {refused:this.refused,rows:this.rows,rects:this.rects,complete:this.complete,signature:this.signature}}", returnByValue: true }))
      this.cache.check(s)
      const meta = snapshotMetadata(raw); binding.signature = meta.signature
      const array = await this.cdp(tabId, "Runtime.callFunctionOn", { objectId, functionDeclaration: "function(){return this.nodes}", objectGroup: group, returnByValue: false }); this.cache.check(s)
      if (typeof array?.result?.objectId !== "string") throw new SnapshotRefusal("SNAPSHOT_FAILED")
      const props = await this.cdp(tabId, "Runtime.getProperties", { objectId: array.result.objectId, ownProperties: true, generatePreview: false }); this.cache.check(s)
      if (!Array.isArray(props?.result) || props.result.length > 65) throw new SnapshotRefusal("SNAPSHOT_FAILED")
      records = []
      for (let i = 0; i < meta.rows.length; i++) {
        const property = props.result.find((p: any) => p?.name === String(i))
        if (typeof property?.value?.objectId !== "string") throw new SnapshotRefusal("SNAPSHOT_FAILED")
        const node = await this.cdp(tabId, "DOM.describeNode", { objectId: property.value.objectId, depth: 0, pierce: false }); this.cache.check(s)
        if (!Number.isSafeInteger(node?.node?.backendNodeId) || node.node.backendNodeId <= 0) throw new SnapshotRefusal("SNAPSHOT_FAILED")
        records.push({ row: meta.rows[i], rect: meta.rects[i], backendId: node.node.backendNodeId })
      }
      await this.verify(s, binding); this.cache.check(s)
      output = snapshotOutput(s.id, this.cache.remaining(s), meta.rows, meta.complete)
    } catch (e) {
      if (groupStarted) released = await this.release(s, group)
      else released = true
      if (released) await this.cache.finish(s)
      throw e instanceof SnapshotRefusal ? e : new SnapshotRefusal("SNAPSHOT_FAILED")
    }
    released = !groupStarted || await this.release(s, group)
    if (!released) throw new SnapshotRefusal("SNAPSHOT_FAILED")
    try { this.cache.commit(s, binding, records, output.data.complete) }
    catch (e) { await this.cache.finish(s); throw e }
    return output
  }
  async act(owner: SnapshotOwner, tabId: number, action: "click" | "type", params: Record<string, any>) {
    if (typeof params.snapshot_id !== "string" || !uuid.test(params.snapshot_id) || !Number.isInteger(params.element_id) || params.element_id < 1 || params.element_id > 64 || ["selector", "text", "exact"].some(k => Object.hasOwn(params, k))) throw new SnapshotRefusal("SNAPSHOT_STALE")
    if (action === "type" && (typeof params.value !== "string" || new TextEncoder().encode(params.value).length > 16384)) throw new SnapshotRefusal("SNAPSHOT_UNSUPPORTED_CONTROL")
    const s = this.cache.reserve(owner, tabId, params.snapshot_id), group = s.claim.group
    let groupStarted = false
    try {
      const binding = s.binding, record = s.records[params.element_id - 1]
      if (!binding || !record) throw new SnapshotRefusal("SNAPSHOT_STALE")
      await this.verify(s, binding); this.cache.check(s)
      groupStarted = true
      const target = await this.cdp(tabId, "DOM.resolveNode", { backendNodeId: record.backendId, executionContextId: binding.contextId, objectGroup: group }); this.cache.check(s)
      const doc = await this.cdp(tabId, "DOM.resolveNode", { backendNodeId: binding.documentId, executionContextId: binding.contextId, objectGroup: group }); this.cache.check(s)
      if (typeof target?.object?.objectId !== "string" || typeof doc?.object?.objectId !== "string") throw new SnapshotRefusal("SNAPSHOT_STALE")
      await this.verify(s, binding); this.cache.check(s)
      const reply = await this.cdp(tabId, "Runtime.callFunctionOn", { objectId: target.object.objectId, functionDeclaration: interactiveSnapshotInWorld.toString(), arguments: [{ value: { mode: "act", action, ...(action === "type" ? { value: params.value } : {}), expected: { index: params.element_id - 1, signature: binding.signature } } }, { objectId: doc.object.objectId }], returnByValue: true, awaitPromise: false })
      const data = this.value(reply)
      if (action === "click" ? data?.clicked !== true || data.locator_kind !== "snapshot" : data?.typed !== true || data.locator_kind !== "snapshot") throw new SnapshotRefusal("SNAPSHOT_FAILED")
      return { success: true as const, data }
    } catch (e) { throw e instanceof SnapshotRefusal ? e : new SnapshotRefusal("SNAPSHOT_FAILED") }
    finally {
      if (!groupStarted || await this.release(s, group)) await this.cache.finish(s)
    }
  }
}
