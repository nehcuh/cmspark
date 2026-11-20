import type { ReactNode } from "react"
import { projectCopy } from "../navigation/project-copy"
import { sessionContextLines } from "../navigation/project-list-model"

export function SessionContextBar({ projectName, projectId, threadTitle, connection, workspaceRoot, busy, pending, onProject, children }: {
  projectName: string | null
  projectId: string | null
  threadTitle: string
  connection: "connected" | "connecting" | "disconnected"
  workspaceRoot: string | null | undefined
  busy: boolean
  pending: boolean
  children?: ReactNode
  onProject: (projectId: string) => void
}) {
  const lines = sessionContextLines({ projectName, threadTitle, connection, workspaceRoot, busy, pending })
  return <header className="cm-session-location" role="banner" aria-label="会话位置">
    <p>{projectId && projectName ? <button type="button" onClick={() => onProject(projectId)}>{projectName}</button> : projectCopy.outside}{` / ${threadTitle}`}</p>
    <details>
      <summary>会话详情</summary>
      <p>{lines.workspace}</p>
      <p>{lines.execution}</p>
      {children}
    </details>
  </header>
}
