import { z } from "zod"
import { citationSchema } from "../business-evidence/draft-contract"
import { businessReferenceSchema } from "./context"

export const REVIEW_LIMITS = { bytes: 65536, jobs: 16, storeBytes: 2 * 1024 * 1024 } as const
export function canonicalRepository(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error("INVALID_REPOSITORY_URL") }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("INVALID_REPOSITORY_URL")
  // WHATWG origin normalizes default ports and IDN; path remains case-sensitive.
  let pathname = url.pathname, previous: string
  do { previous = pathname; pathname = pathname.replace(/\/+$/, "").replace(/\.git$/, "") } while (pathname !== previous)
  if (!pathname || pathname === "/") throw new Error("INVALID_REPOSITORY_URL")
  return url.origin + pathname
}
const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
export const reviewCreateSchema = z.object({
  request_id: z.string().trim().min(1).max(128),
  repository: z.string().min(1).max(8192).transform(canonicalRepository),
  base: sha, head: sha,
  diff: citationSchema.optional(),
  identity_citations: z.array(citationSchema).max(8).default([]),
  business_context: z.array(businessReferenceSchema).max(64).optional(),
  materials: z.array(z.object({ draft_id: z.string().min(1).max(128), revision: z.number().int().safe().positive() }).strict()).max(2).optional(),
}).strict().refine(input => input.base.length === input.head.length && input.base !== input.head)
export type ReviewCreate = z.infer<typeof reviewCreateSchema>
export const reviewIdSchema = z.object({ review_id: z.string().uuid() }).strict()

export function boundRequest(input: unknown): void {
  const serialized = JSON.stringify(input)
  if (!serialized || Buffer.byteLength(serialized, "utf8") > REVIEW_LIMITS.bytes) throw new Error("CODE_REVIEW_CAPACITY")
}
