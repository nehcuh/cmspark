/** Private native resource boundary. Files and snapshots never enter a renderer DTO. */
import fs from "node:fs"
import path from "node:path"
import { createHash, randomBytes } from "node:crypto"
import matter from "../passive-frontmatter"
import { redactSecrets } from "../threads/distill"

export type ResourceKind = "skill" | "knowledge"
export type ResourceRecord = { id?: string; name: string; title?: string; description: string; tags?: string[]; content: string; builtin: boolean; source_file: string; dir?: string }
export type ResourceDoc = { kind: ResourceKind; resource_id: string; title: string; description: string; tags: string[]; text: string; complete: boolean; truncated: boolean; redacted: boolean; builtin: boolean; writable: boolean; read_only_reason: string | null; revision: string | null }
export type ResourceImport = { kind: ResourceKind; id: string; title: string; text: string; destination: string; raw: string; parents?: string[] }
export type ResourceSnapshot = { doc: ResourceDoc; record: ResourceRecord; identity: string; revision: string; invalidated: boolean; release(): void }
export type DesktopResourceStore = ReturnType<typeof createDesktopResourceStore>
const BODY_CAP = 524288, FILE_CAP = 6291456
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")
const conflict = () => { throw Error("DESKTOP_RESOURCE_CONFLICT") }
function statIdentity(st: fs.BigIntStats) {
  return [st.dev, st.ino, st.mode, st.birthtimeNs, st.ctimeNs, st.mtimeNs, st.size].map(String)
}
/** Reject links along the entire fixed canonical parent chain; retain identities. */
function parents(file: string, roots: string[], allowMissing = false): string[] {
  const resolved = path.resolve(file)
  if (!roots.some(root => resolved.startsWith(path.resolve(root) + path.sep))) return conflict()
  const chain: string[] = []
  for (let current = path.dirname(resolved);; current = path.dirname(current)) {
    try {
      const st = fs.lstatSync(current, { bigint: true })
      if (st.isSymbolicLink() || !st.isDirectory()) return conflict()
      // Directory mtime changes on sibling writes; its physical identity must not.
      chain.push(JSON.stringify([current, String(st.dev), String(st.ino), String(st.mode), String(st.birthtimeNs)]))
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      chain.push(JSON.stringify([current, "missing"]))
    }
    if (path.dirname(current) === current) break
  }
  return chain
}
function readIdentity(file: string, roots: string[]) {
  const beforeParents = parents(file, roots), before = fs.lstatSync(file, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(FILE_CAP)) return conflict()
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const opened = fs.fstatSync(fd, { bigint: true })
    if (!opened.isFile() || JSON.stringify(statIdentity(opened)) !== JSON.stringify(statIdentity(before))) return conflict()
    // Bounded read even if another process grows the file after the first stat.
    const buffer = Buffer.alloc(Number(opened.size) + 1)
    let length = 0
    while (length < buffer.length) { const n = fs.readSync(fd, buffer, length, buffer.length - length, null); if (!n) break; length += n }
    const raw = buffer.subarray(0, length)
    const after = fs.fstatSync(fd, { bigint: true }), final = fs.lstatSync(file, { bigint: true })
    if (raw.length !== Number(opened.size) || raw.length > FILE_CAP || JSON.stringify(statIdentity(opened)) !== JSON.stringify(statIdentity(after)) || JSON.stringify(statIdentity(after)) !== JSON.stringify(statIdentity(final)) || JSON.stringify(beforeParents) !== JSON.stringify(parents(file, roots))) return conflict()
    return { raw, identity: hash(JSON.stringify([beforeParents, statIdentity(after), hash(raw)])) }
  } finally { fs.closeSync(fd) }
}
export function createDesktopResourceStore(services: {
  roots: string[]; refresh(): void; fresh(): void; records(kind: ResourceKind): ResourceRecord[];
  observe(listener: () => void): () => void;
  prepare(kind: ResourceKind, text: string): ResourceImport;
  update(id: string, patch: Record<string, unknown>): unknown;
}) {
  function resolve(kind: ResourceKind, id: string): ResourceRecord {
    const found = services.records(kind).filter(s => (s.id || s.name) === id)
    if (found.length !== 1) return conflict()
    return found[0]
  }
  function snapshot(kind: ResourceKind, id: string): ResourceSnapshot {
    services.refresh()
    const record = resolve(kind, id), disk = readIdentity(record.source_file, services.roots)
    const parsed = matter(disk.raw.toString("utf8")), body = parsed.content
    // Canonical cache and current file must agree, never project a stale body.
    if (body !== record.content) return conflict()
    const truncated = Buffer.byteLength(body, "utf8") > BODY_CAP
    const rawText = truncated ? Buffer.from(body).subarray(0, BODY_CAP).toString("utf8") : body
    const title = record.title || record.name, description = record.description || "", tags = record.tags || []
    // Existing canonical metadata limits also bound the native read projection.
    // Refuse an oversized legacy value; do not silently present it as complete.
    if (typeof title !== "string" || title.length > 200 || typeof description !== "string" || description.length > 500 || !Array.isArray(tags) || tags.length > 8 || tags.some(v => typeof v !== "string" || v.length > 24)) return conflict()
    const fields = [title, description, ...tags, rawText]
    if (fields.some(v => typeof v !== "string")) return conflict()
    const safe = fields.map(v => redactSecrets(v)), redacted = safe.some(v => v.hits > 0)
    const reason = record.builtin ? "builtin" : record.dir ? "folder" : truncated ? "truncated" : redacted ? "redacted" : null
    const revision = hash(randomBytes(32).toString("hex") + disk.identity)
    const value: ResourceSnapshot = { record, identity: disk.identity, revision, invalidated: false, release: () => {}, doc: {
      kind, resource_id: id, title: safe[0].text, description: safe[1].text, tags: safe.slice(2, -1).map(v => v.text), text: safe.at(-1)!.text,
      complete: !truncated && !redacted, truncated, redacted, builtin: record.builtin, writable: reason === null, read_only_reason: reason, revision: reason === null ? revision : null,
    } }
    value.release = services.observe(() => { value.invalidated = true })
    return value
  }
  function validate(value: ResourceSnapshot) {
    services.fresh()
    if (value.invalidated || !value.doc.writable) return conflict()
    const current = resolve(value.doc.kind, value.doc.resource_id)
    if (current.builtin || current.dir || current.source_file !== value.record.source_file || readIdentity(current.source_file, services.roots).identity !== value.identity) return conflict()
  }
  function prepareImport(kind: ResourceKind, text: string) {
    if (typeof text !== "string" || !text || Buffer.byteLength(text, "utf8") > BODY_CAP || redactSecrets(text).hits) throw Error("DESKTOP_RESOURCE_INPUT_INVALID")
    // gray-matter supports executable language extensions (e.g. ---js). The
    // native text entry accepts bare YAML frontmatter or ordinary Markdown only.
    // This check must precede every canonical parser call on submitted text.
    const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0]
    if (firstLine.startsWith("---") && firstLine.trim() !== "---") throw Error("DESKTOP_RESOURCE_INPUT_INVALID")
    // gray-matter/YAML is the canonical parser. Unknown authority fields never reach it as settings.
    const parsed = matter(text), allowed = ["name", "id", "title", "description", "type", "site", "tags", "priority"]
    if (Object.keys(parsed.data).some(k => !allowed.includes(k))) throw Error("DESKTOP_RESOURCE_INPUT_INVALID")
    for (const key of ["name", "id", "title", "description", "type", "site"]) if (parsed.data[key] !== undefined && typeof parsed.data[key] !== "string") throw Error("DESKTOP_RESOURCE_INPUT_INVALID")
    if (parsed.data.tags !== undefined && (!Array.isArray(parsed.data.tags) || parsed.data.tags.some((v: unknown) => typeof v !== "string"))) throw Error("DESKTOP_RESOURCE_INPUT_INVALID")
    if (parsed.data.priority !== undefined && (typeof parsed.data.priority !== "number" || !Number.isFinite(parsed.data.priority))) throw Error("DESKTOP_RESOURCE_INPUT_INVALID")
    const types = kind === "skill" ? ["prompt_template", "tool_chain", "sub_agent", "site_knowledge", "domain_knowledge"] : ["site_knowledge", "domain_knowledge"]
    if (parsed.data.type !== undefined && !types.includes(parsed.data.type)) throw Error("DESKTOP_RESOURCE_INPUT_INVALID")
    services.fresh()
    const plan = services.prepare(kind, text)
    return { ...plan, parents: parents(plan.destination, services.roots, true) }
  }
  function commitImport(plan: ResourceImport, current: () => boolean) {
    // Repeat canonical duplicate/identity/target choice immediately before publication.
    const now = prepareImport(plan.kind, plan.text)
    if (JSON.stringify(now) !== JSON.stringify(plan)) return conflict()
    fs.mkdirSync(path.dirname(plan.destination), { recursive: true, mode: 0o700 })
    const chain = parents(plan.destination, services.roots)
    if (!plan.parents || plan.parents.some(token => JSON.parse(token)[1] !== "missing" && !chain.includes(token))) return conflict()
    let fd: number | undefined, created: fs.BigIntStats | undefined
    try {
      if (!current()) return conflict()
      fd = fs.openSync(plan.destination, "wx", 0o600); created = fs.fstatSync(fd, { bigint: true })
      if (JSON.stringify(chain) !== JSON.stringify(parents(plan.destination, services.roots))) return conflict()
      fs.writeFileSync(fd, plan.raw, "utf8"); fs.fsyncSync(fd)
    } catch (error) {
      // Windows cannot unlink an open file. Close our own descriptor first,
      // without replacing the original write/flush failure with cleanup failure.
      if (fd !== undefined) { try { fs.closeSync(fd) } catch {} fd = undefined }
      // Roll back only our own new inode, never a replacement or sibling.
      if (created) { try { const st = fs.lstatSync(plan.destination, { bigint: true }); if (st.dev === created.dev && st.ino === created.ino) fs.unlinkSync(plan.destination) } catch {} }
      throw error
    } finally { if (fd !== undefined) fs.closeSync(fd) }
    services.refresh() // A post-publication refresh fault is reported as unknown by the actor.
    return plan.id
  }
  return { snapshot, validate, prepareImport, commitImport,
    update(value: ResourceSnapshot, patch: Record<string, unknown>, current: () => boolean) { validate(value); if (value.doc.kind !== "knowledge" || !current()) return conflict(); return services.update(value.doc.resource_id, patch) },
    remove(value: ResourceSnapshot, current: () => boolean) { validate(value); if (!current()) return conflict(); fs.unlinkSync(value.record.source_file); services.refresh() },
  }
}
