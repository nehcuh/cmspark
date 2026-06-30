// Obsidian vault note index (P2).
//
// Builds a TF-vector index of the vault's notes (reusing vault-profiler.scanVault +
// semantic-match's tokenize/tokensToVec) so exports can link to semantically-related
// existing notes via [[wikilinks]]. Cached to ~/.cmspark-agent/obsidian/vault-index.json
// (same pattern as profile.json). Pure TF cosine (no IDF) — see plan risk note.

import * as fs from "fs"
import * as path from "path"
import { DATA_DIR } from "../config"
import { scanVault } from "./vault-profiler"
import { tokenize, tokensToVec, cosineSimilarity } from "../skills/semantic-match"

export interface VaultIndexEntry {
  name: string // basename without .md (Obsidian wikilinks resolve by filename)
  relPath: string
}

export interface VaultIndex {
  vault_path: string
  generated_at: string
  fingerprint: { file_count: number; newest_mtime_ms: number }
  entries: VaultIndexEntry[]
  vectors: Record<string, Record<string, number>> // name -> normalized TF vector
}

export const INDEX_PATH = path.join(DATA_DIR, "obsidian", "vault-index.json")

const TOP_K_DEFAULT = 5
const SIMILARITY_THRESHOLD = 0.28 // pure-TF has common-word bias; 0.28 cleanly separates true topical matches (~0.31+) from common-word collisions (~0.21-)
const UNSAFE_WIKILINK_CHARS = /[\]\[#|^]|[\x00-\x1f\x7f]/ // ] truncates, |/#/^ redirect/anchor, control breaks line

function noteNameFromRelPath(relPath: string): string {
  return path.basename(relPath).replace(/\.md$/i, "")
}

/**
 * Build a vault note index. Reuses scanVault's sample stream (relPath + 200-char body
 * preview), so no extra disk I/O beyond what profiling already does. Dedupes by note
 * name (one kept; selection is filesystem-enumeration-order dependent) since Obsidian
 * wikilinks target by filename.
 */
export function buildVaultIndex(vaultPath: string): VaultIndex {
  const { samples, fileCount, newestMtimeMs } = scanVault(vaultPath)
  const entries: VaultIndexEntry[] = []
  const vectors: Record<string, Record<string, number>> = {}
  for (const s of samples) {
    const name = noteNameFromRelPath(s.relPath)
    if (!name || vectors[name]) continue // skip empty names + dedupe
    const title = typeof s.frontmatter?.title === "string" ? s.frontmatter.title : ""
    const text = `${name} ${title} ${s.bodyPreview}`
    const vec = tokensToVec(tokenize(text))
    if (Object.keys(vec).length === 0) continue // untokenizable (e.g. symbol-only name)
    entries.push({ name, relPath: s.relPath })
    vectors[name] = vec
  }
  return {
    vault_path: path.resolve(vaultPath),
    generated_at: new Date().toISOString(),
    fingerprint: { file_count: fileCount, newest_mtime_ms: newestMtimeMs },
    entries,
    vectors,
  }
}

/**
 * Query the index for the top-K notes most similar to `queryText` (the export body).
 * Returns note names (for [[wikilinks]]), filtered by a similarity threshold to avoid
 * weak/common-word links. Empty array if nothing clears the bar.
 */
export function queryRelatedNotes(index: VaultIndex, queryText: string, k = TOP_K_DEFAULT): string[] {
  const queryVec = tokensToVec(tokenize(queryText || ""))
  if (Object.keys(queryVec).length === 0) return []
  const cap = Math.max(0, Math.floor(k))
  if (cap === 0) return []
  const scored: { name: string; score: number }[] = []
  for (const e of index.entries) {
    const v = index.vectors[e.name]
    if (!v) continue
    const score = cosineSimilarity(queryVec, v)
    if (score >= SIMILARITY_THRESHOLD) scored.push({ name: e.name, score })
  }
  if (scored.length === 0) return []
  scored.sort((a, b) => b.score - a.score)
  // Only emit names that are safe as [[wikilink]] targets; a name containing ], |, #, ^,
  // or control chars would render as a broken or mis-targeted link (e.g. "A|B" → link to
  // A with alias B), so skip it rather than emit something wrong.
  return scored
    .filter(s => isSafeWikilinkName(s.name))
    .slice(0, cap)
    .map(s => s.name)
}

/** A name is a safe [[wikilink]] target if it has no chars that break link syntax. */
function isSafeWikilinkName(name: string): boolean {
  return !!name && !UNSAFE_WIKILINK_CHARS.test(name)
}

export function saveIndex(index: VaultIndex, filePath: string = INDEX_PATH): void {
  fs.writeFileSync(filePath, JSON.stringify(index, null, 2), { mode: 0o600 })
}

/** Load the cached index for `vaultPath`. null if missing/unreadable/vault mismatch. */
export function loadCachedIndex(
  vaultPath: string | null | undefined,
  filePath: string = INDEX_PATH,
): VaultIndex | null {
  if (!vaultPath) return null
  try {
    const raw = fs.readFileSync(filePath, "utf-8")
    const index = JSON.parse(raw) as VaultIndex
    if (!index || !index.vault_path) return null
    if (index.vault_path !== path.resolve(vaultPath)) return null
    return index
  } catch {
    return null
  }
}
