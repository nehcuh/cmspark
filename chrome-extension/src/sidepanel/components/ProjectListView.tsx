import { offlineCached, projectCopy } from "../navigation/project-copy"
import { visibleProjects } from "../navigation/project-list-model"
import type { Project } from "../utils/project-request"

export interface ProjectListViewProps {
  projects: Project[]
  query: string
  archiveView: boolean
  phase: "loading" | "refreshing" | "ready" | "list-error" | "offline"
  fetchedAt: string | null
  hasSnapshot: boolean
  onQuery: (value: string) => void
  onClearQuery: () => void
  onToggleArchive: () => void
  onRetry?: () => void
  onOpen: (projectId: string) => void
}

export function ProjectListView({ projects, query, archiveView, phase, fetchedAt, hasSnapshot, onQuery, onClearQuery, onToggleArchive, onOpen, onRetry }: ProjectListViewProps) {
  const rows = hasSnapshot ? visibleProjects({ projects, query, archiveView }) : []
  const status = !hasSnapshot && phase === "loading" ? projectCopy.loading
    : phase === "refreshing" ? projectCopy.updating
    : phase === "offline" && hasSnapshot && fetchedAt ? offlineCached(fetchedAt)
    : phase === "offline" ? projectCopy.offlineEmpty
    : phase === "list-error" && !hasSnapshot ? projectCopy.listFailed
    : null
  const detail = hasSnapshot && rows.length === 0 && query.trim() ? projectCopy.noMatch
    : hasSnapshot && rows.length === 0 && phase !== "loading" && phase !== "offline" && archiveView ? projectCopy.archiveEmpty
    : hasSnapshot && rows.length === 0 && phase === "ready" && !archiveView ? projectCopy.empty
    : null
  return <section aria-label={projectCopy.projects}>
    {status && <p role="status">{status}</p>}
    {phase === "list-error" && !hasSnapshot && onRetry && <button type="button" onClick={onRetry}>重试</button>}
    {phase === "list-error" && hasSnapshot && <p role="alert">{projectCopy.listFailed}</p>}
    <label>搜索项目<input aria-label="搜索项目" value={query} onChange={event => onQuery(event.target.value)} /></label>
    {query.trim() && <button type="button" onClick={onClearQuery}>{projectCopy.clearSearch}</button>}
    <button type="button" onClick={onToggleArchive}>{archiveView ? projectCopy.showActive : projectCopy.showArchived}</button>
    <div role="list">
      {rows.map(project => <div role="listitem" key={project.id}><button type="button" data-project-id={project.id} onClick={() => onOpen(project.id)}>{project.name}</button></div>)}
    </div>
    {detail && <p role="status">{detail}</p>}
  </section>
}
