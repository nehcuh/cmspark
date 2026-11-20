import type { ReactNode } from "react"
import { projectCopy } from "../navigation/project-copy"
import { sessionContextLines } from "../navigation/project-list-model"

export function SessionContextBar({ projectName, projectId, threadTitle, connection, workspaceRoot, busy, pending, onProject, children, compact = false }: {
  projectName: string | null
  projectId: string | null
  threadTitle: string
  connection: "connected" | "connecting" | "disconnected"
  workspaceRoot: string | null | undefined
  busy: boolean
  pending: boolean
  children?: ReactNode
  compact?: boolean
  onProject: (projectId: string) => void
}) {
  const lines = sessionContextLines({ projectName, threadTitle, connection, workspaceRoot, busy, pending })
  const location = <p>{projectId && projectName ? <button type="button" onClick={() => onProject(projectId)}>{projectName}</button> : projectCopy.outside}{` / ${threadTitle}`}</p>
  return <header className="cm-session-location" role="banner" aria-label="会话位置">
    {!compact && location}
    <details>
      <summary>会话详情</summary>
      {compact && location}
      <p>{lines.workspace}</p>
      <p>{lines.execution}</p>
      {children}
    </details>
  </header>
}
