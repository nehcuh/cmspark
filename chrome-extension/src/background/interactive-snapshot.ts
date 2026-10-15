import { SnapshotRefusal, type SnapshotRow } from "./interactive-snapshot-cache"

/** Fixed isolated-world function. All helpers are lexical: its serialized source
 * accepts data only, never model code, CSS or an arbitrary function argument. */
export function interactiveSnapshotInWorld(this: Element | undefined, request: {
  mode: "collect" | "act"; action?: "click" | "type"; value?: string;
  expected?: { index: number; signature: string }
}, expectedDocument?: Document): any {
  const start = performance.now()
  let visits = 0, complete = true
  const budget = () => { if (++visits > 5000 || performance.now() - start > 100) { complete = false; return false } return true }
  const attr = (el: Element, name: string) => Element.prototype.getAttribute.call(el, name) || ""
  const normalized = (text: string) => text.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ").trim()
  const labelLimit = (text: string) => {
    let out = "", bytes = 0
    for (const cp of normalized(text)) {
      const n = new TextEncoder().encode(cp).length
      if (Array.from(out).length >= 64 || bytes + n > 128) break
      out += cp; bytes += n
    }
    return out
  }
  const visibleRect = (el: Element): number[] | undefined => {
    const r = Element.prototype.getBoundingClientRect.call(el)
    if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return
    let left = Math.max(0, r.left), top = Math.max(0, r.top), right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom)
    for (let p: Element | null = el; p; p = p.parentElement) {
      if (!budget()) return
      const style = getComputedStyle(p)
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0" || p.hasAttribute("inert")) return
      if (p !== el && /(hidden|clip|scroll|auto)/.test(style.overflowX + style.overflowY)) {
        const pr = Element.prototype.getBoundingClientRect.call(p)
        if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) { left = Math.max(left, pr.left); right = Math.min(right, pr.right) }
        if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) { top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom) }
      }
    }
    if (right <= left || bottom <= top) return
    return [r.x, r.y, r.width, r.height, left, top, right - left, bottom - top]
  }
  const textOf = (el: Element) => {
    let text = "", count = 0
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node && count < 32 && text.length < 256; node = walker.nextNode()) {
      if (!budget()) break
      count++
      if (node.parentElement && !(node.parentElement instanceof HTMLInputElement) && !(node.parentElement instanceof HTMLTextAreaElement) && !(node.parentElement instanceof HTMLSelectElement) && !node.parentElement.isContentEditable && visibleRect(node.parentElement)) text += " " + (node.textContent || "").slice(0, 256 - text.length)
    }
    return text
  }
  const nameOf = (el: Element) => {
    let label = attr(el, "aria-label").slice(0, 256) || attr(el, "placeholder").slice(0, 256)
    if (!label && !(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLSelectElement) && !(el as HTMLElement).isContentEditable && !["textbox", "combobox"].includes(attr(el, "role"))) label = textOf(el)
    if (!normalized(label) && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
      const labels = el.labels
      for (let i = 0; labels && i < Math.min(4, labels.length) && label.length < 256; i++) {
        if (!budget()) break
        if (visibleRect(labels[i])) label += " " + textOf(labels[i])
      }
    }
    return labelLimit(label)
  }
  const sensitive = (el: Element) => {
    if (!(el instanceof HTMLInputElement)) return false
    const autocomplete = attr(el, "autocomplete")
    return /^(hidden|password|file)$/.test(el.type) || autocomplete.length > 256 || /(?:^|\s)(?:one-time-code|current-password|new-password|username|cc-[a-z-]+)(?:\s|$)/i.test(autocomplete)
  }
  const roleOf = (el: Element): string | undefined => {
    if (sensitive(el)) return
    const tag = el.localName
    if (tag === "button") return "button"
    if (tag === "a" && attr(el, "href")) return "link"
    if (tag === "summary") return "summary"
    if (tag === "select") return "combobox"
    if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio") return el.type
      if (["text", "search", "email", "url", "tel"].includes(el.type)) return attr(el, "role") === "combobox" ? "combobox" : "textbox"
    }
    if (el instanceof HTMLTextAreaElement) return "textbox"
    const role = attr(el, "role")
    if (["button", "link", "textbox", "combobox", "checkbox", "radio", "menuitem", "tab", "option"].includes(role)) return role
  }
  const hit = (el: Element, rect: number[]) => {
    const at = document.elementFromPoint(rect[4] + rect[6] / 2, rect[5] + rect[7] / 2)
    return !!at && (at === el || Node.prototype.contains.call(el, at))
  }
  const gather = () => {
    const rows: SnapshotRow[] = [], nodes: Element[] = [], rects: number[][] = []
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT)
    for (let node = walker.currentNode as Element | null; node; node = walker.nextNode() as Element | null) {
      if (!budget()) break
      const role = roleOf(node)
      if (!role) continue
      const rect = visibleRect(node)
      if (!rect) { if (!complete) break; continue }
      if (rows.length === 64) { complete = false; break }
      const label = nameOf(node)
      if (!complete) break
      const disabled = node.matches(":disabled") || attr(node, "aria-disabled") === "true"
      const readonly = node.hasAttribute("readonly") || attr(node, "aria-readonly") === "true"
      const field = node instanceof HTMLTextAreaElement || (node instanceof HTMLInputElement && ["text", "search", "email", "url", "tel"].includes(node.type))
      const clickable = node instanceof HTMLButtonElement || node.localName === "summary" || field || (node instanceof HTMLInputElement && ["checkbox", "radio"].includes(node.type)) || (node instanceof HTMLAnchorElement && ["http:", "https:"].includes(node.protocol))
      let state = disabled ? "disabled" : readonly ? "readonly" : "ready"
      if (!disabled && !readonly && field) state = (node as HTMLInputElement).value.length === 0 ? "empty" : "filled"
      else if (!disabled && !readonly && node instanceof HTMLInputElement && ["checkbox", "radio"].includes(node.type)) state = node.checked ? "checked" : "unchecked"
      const actionable = !!label && !disabled && !readonly && hit(node, rect)
      rows.push({ id: rows.length + 1, role, label, state, can_click: actionable && clickable, can_type: actionable && field, ambiguous: false })
      nodes.push(node); rects.push(rect)
    }
    const counts = new Map<string, number>()
    for (const row of rows) if (row.label) counts.set(row.label, (counts.get(row.label) || 0) + 1)
    for (const row of rows) row.ambiguous = !!row.label && (counts.get(row.label) || 0) > 1
    return { rows, nodes, rects, complete, signature: JSON.stringify(rows.map((row, i) => [row, rects[i]])), documentType: document.contentType }
  }
  try {
    if (!["text/html", "application/xhtml+xml"].includes(document.contentType)) return { refused: "SNAPSHOT_UNSUPPORTED_DOCUMENT" }
    if (request.mode === "collect") return gather()
    const target = this, expected = request.expected
    if (!target || !expected || target.ownerDocument !== document || expectedDocument !== document || !target.isConnected) return { refused: "SNAPSHOT_STALE" }
    const rect = visibleRect(target)
    if (!rect) return { refused: complete ? "SNAPSHOT_STALE" : "SNAPSHOT_INCOMPLETE" }
    if (!hit(target, rect)) return { refused: "ELEMENT_OCCLUDED" }
    const current = gather()
    if (!current.complete) return { refused: "SNAPSHOT_INCOMPLETE" }
    if (current.nodes[expected.index] !== target || current.signature !== expected.signature) return { refused: "SNAPSHOT_STALE" }
    const row = current.rows[expected.index]
    if (row.ambiguous) return { refused: "ELEMENT_AMBIGUOUS" }
    if (request.action === "click") {
      if (!row.can_click) return { refused: "SNAPSHOT_UNSUPPORTED_CONTROL" }
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) HTMLElement.prototype.focus.call(target)
      HTMLElement.prototype.click.call(target)
      return { clicked: true, locator_kind: "snapshot" }
    }
    if (request.action === "type") {
      if (!row.can_type || typeof request.value !== "string" || new TextEncoder().encode(request.value).length > 16384) return { refused: "SNAPSHOT_UNSUPPORTED_CONTROL" }
      const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(target, request.value)
      target.dispatchEvent(new Event("input", { bubbles: true })); target.dispatchEvent(new Event("change", { bubbles: true }))
      return { typed: true, locator_kind: "snapshot", chars: Array.from(request.value).length }
    }
    return { refused: "SNAPSHOT_UNSUPPORTED_CONTROL" }
  } catch { return { refused: "SNAPSHOT_FAILED" } }
}

const roles = new Set(["button", "link", "textbox", "combobox", "checkbox", "radio", "menuitem", "tab", "option", "summary"])
const states = new Set(["empty", "filled", "unchecked", "checked", "disabled", "readonly", "ready"])
export function snapshotMetadata(raw: any): { rows: SnapshotRow[]; rects: number[][]; complete: boolean; signature: string } {
  if (!raw || typeof raw.complete !== "boolean" || typeof raw.signature !== "string" || raw.signature.length > 65536 || !Array.isArray(raw.rows) || raw.rows.length > 64 || !Array.isArray(raw.rects) || raw.rects.length !== raw.rows.length) throw new SnapshotRefusal("SNAPSHOT_FAILED")
  const rows = raw.rows.map((v: any, i: number) => {
    if (!v || v.id !== i + 1 || !roles.has(v.role) || !states.has(v.state) || typeof v.label !== "string" || Array.from(v.label).length > 64 || new TextEncoder().encode(v.label).length > 128 || [v.can_click, v.can_type, v.ambiguous].some(x => typeof x !== "boolean")) throw new SnapshotRefusal("SNAPSHOT_FAILED")
    return { id: v.id, role: v.role, label: v.label, state: v.state, can_click: v.can_click, can_type: v.can_type, ambiguous: v.ambiguous }
  })
  const rects = raw.rects.map((v: any) => { if (!Array.isArray(v) || v.length !== 8 || !v.every((x: any) => typeof x === "number" && Number.isFinite(x))) throw new SnapshotRefusal("SNAPSHOT_FAILED"); return [...v] })
  return { rows, rects, complete: raw.complete, signature: raw.signature }
}
export function snapshotOutput(id: string, ttl: number, rows: SnapshotRow[], complete: boolean) {
  const data = { snapshot_id: id, expires_in_ms: Math.max(0, Math.min(30000, Math.floor(ttl))), complete, rows: [...rows], table: "" }
  const table = () => data.rows.map(row => `[${row.id}] ${row.role} ${JSON.stringify(row.label)} · ${row.state}`).join("\n")
  data.table = table()
  while (new TextEncoder().encode(JSON.stringify({ success: true, data })).length > 24576) {
    if (data.rows.length === 0) throw new SnapshotRefusal("SNAPSHOT_FAILED")
    data.complete = false; data.rows.pop(); data.table = table()
  }
  return { success: true as const, data }
}
