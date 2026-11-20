import { useState, type ReactNode } from "react"
import { useAgentStore } from "../store/agentStore"
import { displayThreadTitle } from "../utils/thread-timeline"
import { requestProject, requestProjectThread } from "../utils/project-request"
import { projectCopy } from "../navigation/project-copy"
import { membershipEnabled, type ListSnapshot } from "../navigation/project-list-model"
import type { NavigationSurface } from "../navigation/navigation-mode"
import { ProjectPanel } from "./ProjectPanel"
import { SessionContextBar } from "./SessionContextBar"

export function ProjectNavigationRoot({ surface, mode, shellClass, children, top, bottom, overlays, renderNavigation, onSelectThread }: {
  surface: NavigationSurface
  mode: "resident" | "layered"
  shellClass: string
  onSelectThread: () => void
  renderNavigation: (props: Pick<Parameters<typeof ProjectPanel>[0], "onSnapshot" | "onOpenProject">) => ReactNode
  children?: ReactNode
  top?: ReactNode
  bottom?: ReactNode
  overlays?: ReactNode
}) {
  const { state, dispatch } = useAgentStore()
  const [projects, setProjects] = useState<ListSnapshot | null>(null)
  const [bindNotice, setBindNotice] = useState("")
  const [localBind, setLocalBind] = useState("")
  const layer = state.navigationLayer
  const projectId = state.navigationProjectId
  const project = projects?.projects.find(item => item.id === projectId) || null
  const active = state.threads.find(thread => thread.id === state.activeThreadId) || null
  const activeProject = projects?.projects.find(item => item.id === active?.project_id) || null
  const projectThreads = state.threads.filter(thread => thread.project_id === projectId && !thread.trashed_at)
  const membership = membershipEnabled({
    connection: state.connectionState,
    busy: !!(active && state.threadBusyById[active.id]),
    pendingConfirmations: state.pendingSecurityConfirmations.length,
    metadataUnavailable: !!active?.project_metadata_unavailable,
    hasThread: !!active,
  })
  const moveCopy = state.connectionState === "connecting" ? projectCopy.connectingMove
    : state.connectionState !== "connected" ? projectCopy.offlineMove
    : projectCopy.busyMove
  function openProject(id: string) {
    dispatch({ type: "NAVIGATE", layer: "project", projectId: id })
  }
  async function bindNew() {
    if (!projectId || !projects) return
    const controller = new AbortController()
    const operation = crypto.randomUUID()
    try {
      const created = await requestProjectThread(controller.signal)
      const result = await requestProject("thread.project.set", {
        thread_id: created.id,
        project_id: projectId,
        user_gesture: true,
        expected_revision: projects.revision,
        operation_id: operation,
      }, controller.signal)
      const thread = { ...created, ...result.thread, id: created.id, project_id: projectId }
      dispatch({ type: "UPSERT_THREAD", thread })
      setLocalBind(projectCopy.bindOk)
      setBindNotice(projectCopy.bindOk)
    } catch {
      setLocalBind(projectCopy.bindFailed)
    }
  }
  function selectThread(id: string) {
    dispatch({ type: "SET_ACTIVE_THREAD", threadId: id })
    dispatch({ type: "NAVIGATE", layer: "session", projectId })
    chrome.runtime.sendMessage({ type: "thread.select", threadId: id })
    onSelectThread()
  }
  const detail = <section aria-label="项目详情" data-project-threads>
    <button type="button" onClick={() => dispatch({ type: "NAVIGATE", layer: "session", projectId: null })}>{projectCopy.back}</button>
    <h2>{project?.name || "项目"}</h2>
    {projectThreads.map(thread => <button type="button" key={thread.id} data-thread-id={thread.id} onClick={() => selectThread(thread.id)}>{displayThreadTitle(thread)}</button>)}
    {projectThreads.length === 0 && <p>{projectCopy.emptyProject}</p>}
    <button type="button" onClick={() => void bindNew()}>{projectCopy.inProject}</button>
    {localBind && <p role="status">{localBind}</p>}
    {bindNotice && <p role="status">{bindNotice}</p>}
  </section>
  const navigation = renderNavigation({ onSnapshot: setProjects, onOpenProject: openProject })
  return <div data-navigation-mode={mode} data-navigation-surface={surface} className={shellClass}>
    {mode === "resident" && navigation}
    <div className="cm-workspace-main cm-shell-column">
      {top}
      {mode === "layered" && navigation}
      <div className="cm-shell-layers">
        {!active && state.navigationHomeCopy && <p role="status">{state.navigationHomeCopy}</p>}
        {layer === "project" ? detail : <>
          {active && <SessionContextBar
            projectName={activeProject?.name || null}
            projectId={active.project_id || null}
            threadTitle={displayThreadTitle(active)}
            connection={state.connectionState}
            workspaceRoot={active.workspace_root}
            busy={!!state.threadBusyById[active.id]}
            pending={state.pendingSecurityConfirmations.length > 0}
            onProject={openProject}
          >
            <fieldset>
              <legend>{projectCopy.moveLegend}</legend>
              {!membership && <p>{moveCopy}</p>}
              {projects?.projects.filter(item => !item.archived_at).map(item => <button type="button" key={item.id} disabled={!membership} onClick={() => void requestProject("thread.project.set", { thread_id: active.id, project_id: item.id, user_gesture: true, expected_revision: projects.revision, operation_id: crypto.randomUUID() }, new AbortController().signal)}>{`移入 ${item.name}`}</button>)}
              <button type="button" disabled={!membership} onClick={() => void requestProject("thread.project.set", { thread_id: active.id, project_id: null, user_gesture: true, expected_revision: projects?.revision || 0, operation_id: crypto.randomUUID() }, new AbortController().signal)}>{projectCopy.moveOut}</button>
            </fieldset>
          </SessionContextBar>}
        </>}
        <div className="cm-chat-mount" hidden={layer === "project"}>{children}</div>
      </div>
      <div className="cm-thread-manager-mount" />
      <div className="cm-shell-bottom">{bottom}</div>
      {overlays}
    </div>
  </div>
}
