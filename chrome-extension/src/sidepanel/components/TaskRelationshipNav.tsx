import type { TaskRelationship } from "../utils/task-relationship"

/** Presentation only: selecting a task is owned by the existing StatusRail action. */
export function TaskRelationshipNav({ relationship, onNavigate }: { relationship: TaskRelationship; onNavigate: (parentId: string) => void }) {
  if (relationship.kind === "normal") return <div className="cm-task-title" title={relationship.title}>{relationship.title}</div>
  const available = relationship.availability === "available" && Boolean(relationship.parentId)
  const status = relationship.availability === "missing" ? "主任务暂不可用"
    : relationship.availability === "trashed" ? "主任务在回收站"
    : relationship.availability === "invalid" ? "主任务关系无效" : ""
  const parentLabel = relationship.parentTitle ? `主任务 · ${relationship.parentTitle}` : status
  return <div className="cm-task-relationship" aria-label="任务归属">
    <button type="button" className="cm-parent-task-button" disabled={!available}
      aria-label={available ? `返回主任务 ${relationship.parentTitle}` : status}
      title={available ? `返回主任务 ${relationship.parentTitle}` : status}
      onClick={() => { if (available && relationship.parentId) onNavigate(relationship.parentId) }}>
      ← 主任务
    </button>
    <div className="cm-task-relationship-labels">
      <span className="cm-parent-task-title" title={parentLabel}>{parentLabel}</span>
      <span className="cm-child-task-title" title={`子任务 · ${relationship.title}`}>子任务 · {relationship.title}</span>
      {relationship.parentTitle && status && <span className="cm-parent-task-status">{status}</span>}
    </div>
  </div>
}
