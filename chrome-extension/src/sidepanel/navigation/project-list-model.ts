import { isProject, type Project } from "../utils/project-request"
import { projectCopy } from "./project-copy"

export interface VisibleProjectInput {
  projects: Project[]
  query: string
  archiveView: boolean
}

export function visibleProjects(input: VisibleProjectInput): Project[] {
  const query = input.query.trim().toLocaleLowerCase()
  return input.projects.filter(project => {
    const archived = project.archived_at !== null
    if (input.archiveView !== archived) return false
    if (!query) return true
    return project.name.toLocaleLowerCase().includes(query)
  })
}

export interface ListSnapshot {
  revision: number
  projects: Project[]
  fetchedAt: string
  generation: number
}

export type ListApplyReason = "applied" | "older-revision"

export function sameListGeneration(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration
}

export function applyProjectListResult(current: ListSnapshot | null, incoming: ListSnapshot): { snapshot: ListSnapshot | null; applied: boolean; reason: ListApplyReason } {
  if (current && incoming.revision < current.revision) return { snapshot: current, applied: false, reason: "older-revision" }
  return { snapshot: incoming, applied: true, reason: "applied" }
}

export interface StoredProjectList {
  format: 1
  revision: number
  projects: Project[]
  fetchedAt: string
}

export const PROJECT_LIST_CACHE_KEY = "cmspark.project.list.v1"

export function parseProjectListCache(raw: string | null): StoredProjectList | null {
  if (!raw) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.format !== 1 || !Number.isSafeInteger(record.revision) || Number(record.revision) < 0) return null
  if (typeof record.fetchedAt !== "string" || !Array.isArray(record.projects) || record.projects.length > 256) return null
  if (!record.projects.every(isProject)) return null
  return { format: 1, revision: Number(record.revision), projects: record.projects, fetchedAt: record.fetchedAt }
}

export function bumpListGeneration(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0) throw new Error("bad generation")
  return current + 1
}

export function membershipEnabled(input: {
  connection: "connected" | "connecting" | "disconnected"
  busy: boolean
  pendingConfirmations: number
  metadataUnavailable: boolean
  hasThread: boolean
}): boolean {
  return input.connection === "connected" && input.hasThread && !input.busy && input.pendingConfirmations === 0 && !input.metadataUnavailable
}

export function sessionContextLines(input: {
  projectName: string | null
  threadTitle: string
  connection: "connected" | "connecting" | "disconnected"
  workspaceRoot: string | null | undefined
  busy: boolean
  pending: boolean
}): { breadcrumb: string; workspace: string; execution: string } {
  const root = typeof input.workspaceRoot === "string" ? input.workspaceRoot.trim() : ""
  const workspace = input.connection === "disconnected"
    ? (root ? `${root}，${projectCopy.workspaceUnrefreshed}` : projectCopy.workspaceStale)
    : input.connection === "connecting"
      ? (root ? `${root}，${projectCopy.workspaceUnrefreshed}` : projectCopy.workspaceStale)
      : (root ? root : projectCopy.workspaceUnbound)
  const execution = input.connection === "disconnected"
    ? projectCopy.executionOffline
    : input.connection === "connecting"
      ? projectCopy.executionConnecting
      : input.pending ? projectCopy.executionPending : input.busy ? projectCopy.executionBusy : projectCopy.executionIdle
  return { breadcrumb: `${input.projectName ?? projectCopy.outside} / ${input.threadTitle}`, workspace, execution }
}
