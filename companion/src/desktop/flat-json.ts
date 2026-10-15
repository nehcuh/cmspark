/** Native channel frames are flat primitive records. Reject duplicate/escaped duplicate keys. */
export function parseDesktopFrame(raw: string): Record<string, unknown> | null {
  let value: any
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(v => v !== null && typeof v === "object")) return null
  let i = 0
  const space = () => { while (/\s/.test(raw[i] || "") && i < raw.length) i++ }
  const str = (): string | undefined => {
    if (raw[i] !== '"') return undefined
    const start = i++
    while (i < raw.length) {
      if (raw[i] === "\\") { i += 2; continue }
      if (raw[i++] === '"') { try { return JSON.parse(raw.slice(start, i)) } catch { return undefined } }
    }
    return undefined
  }
  space(); if (raw[i++] !== "{") return null
  const keys = new Set<string>()
  for (;;) {
    space(); if (raw[i] === "}") { i++; break }
    const key = str(); if (key === undefined || keys.has(key)) return null
    keys.add(key); space(); if (raw[i++] !== ":") return null
    space()
    if (raw[i] === '"') { if (str() === undefined) return null }
    else { const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(raw.slice(i)); if (!m) return null; i += m[0].length }
    space(); if (raw[i] === "}") { i++; break }; if (raw[i++] !== ",") return null
  }
  space(); return i === raw.length ? value : null
}
