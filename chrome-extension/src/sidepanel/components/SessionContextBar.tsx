import { projectCopy } from "../navigation/project-copy"
import { sessionContextLines } from "../navigation/project-list-model"

export function SessionContextBar({ projectName, projectId, threadTitle, connection, workspaceRoot, busy, pending, onProject }: {
  projectName: string | null
  projectId: string | null
  threadTitle: string
  connection: "connected" | "connecting" | "disconnected"
  workspaceRoot: string | null | undefined
  busy: boolean
  pending: boolean
  onProject: (projectId: string) => void
}) {
  const lines = sessionContextLines({ projectName, threadTitle, connection, workspaceRoot, busy, pending })
  return <header role="banner" aria-label="会话位置">
    <p>{projectId && projectName ? <button type="button" onClick={() => onProject(projectId)}>{projectName}</button> : projectCopy.outside}{` / ${threadTitle}`}</p>
    <p>{lines.workspace}</p>
    <p>{lines.execution}</p>
  </header>
}
