/**
 * #439 LLM tools — search_threads / search_knowledge.
 *
 * Companion-local L1 read-only wrappers over summoner/read-search.ts.
 * Independent clamp (default 5, max 10) — do NOT reuse SUMMONER_SEARCH_LIMIT_*.
 * Hits omit `score`; knowledge snippets also pass redactSecrets.
 * Row-pool filter is the same predicate as message-router `thread.search`.
 */
import {
  isSearchableThreadRow,
  knowledgeSearchRows,
  normalizeSearchQuery,
  searchThreadRows,
  type KnowledgeSearchHit,
  type ThreadSearchHit,
} from "../summoner/read-search"
import { redactSecrets } from "../threads/distill"

export const LLM_SEARCH_LIMIT_DEFAULT = 5
export const LLM_SEARCH_LIMIT_MAX = 10

export function clampLlmSearchLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return LLM_SEARCH_LIMIT_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n)) return LLM_SEARCH_LIMIT_DEFAULT
  return Math.max(1, Math.min(LLM_SEARCH_LIMIT_MAX, Math.trunc(n)))
}

export type LlmThreadHit = {
  thread_id: string
  title: string
  alias: string
  updated_at: string | null
  snippet: string
}

export type LlmKnowledgeHit = {
  id: string
  title: string
  folder: string
  snippet: string
}

export type LlmSearchOk<T> = { ok: true; query: string; hits: T[] }
export type LlmSearchErr = { ok: false; error: string }
export type LlmSearchResult<T> = LlmSearchOk<T> | LlmSearchErr

function redactSnippet(raw: string): string {
  return redactSecrets(String(raw || "")).text.trim().slice(0, 200)
}

export function toLlmThreadHit(hit: ThreadSearchHit): LlmThreadHit {
  return {
    thread_id: hit.thread_id,
    title: hit.title,
    alias: hit.alias,
    updated_at: hit.updated_at,
    snippet: redactSnippet(hit.snippet),
  }
}

export function toLlmKnowledgeHit(hit: KnowledgeSearchHit): LlmKnowledgeHit {
  return {
    id: hit.id,
    title: hit.title,
    folder: hit.folder,
    snippet: redactSnippet(hit.snippet),
  }
}

type ThreadRow = {
  id: string
  alias?: string | null
  digest?: { tldr?: string; tags?: string[]; bullets?: string[] } | null
  last_message_at?: string | null
  updated_at?: string | null
  created_at?: string | null
  agent_role?: string | null
}

type KnowledgeDoc = {
  id?: string
  name?: string
  title?: string
  description?: string
  tags?: string[]
  folder?: string
}

export function runSearchThreads(
  rows: ThreadRow[],
  queryRaw: unknown,
  limitRaw?: unknown,
): LlmSearchResult<LlmThreadHit> {
  const query = normalizeSearchQuery(queryRaw)
  if (!query) return { ok: false, error: "query required" }
  const limit = clampLlmSearchLimit(limitRaw)
  const pool = rows.filter(isSearchableThreadRow)
  const hits = searchThreadRows(pool, query, limit).map(toLlmThreadHit)
  return { ok: true, query, hits }
}

export function runSearchKnowledge(
  docs: KnowledgeDoc[],
  queryRaw: unknown,
  limitRaw?: unknown,
): LlmSearchResult<LlmKnowledgeHit> {
  const query = normalizeSearchQuery(queryRaw)
  if (!query) return { ok: false, error: "query required" }
  const limit = clampLlmSearchLimit(limitRaw)
  const hits = knowledgeSearchRows(docs, query, limit).map(toLlmKnowledgeHit)
  return { ok: true, query, hits }
}
