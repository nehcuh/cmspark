import { useEffect, useState, type ReactNode } from "react"
import { useAgentStore } from "../store/agentStore"
import { displayThreadTitle } from "../utils/thread-timeline"
import { requestProject, requestProjectThread } from "../utils/project-request"
import { projectCopy } from "../navigation/project-copy"
import { membershipEnabled, type ListSnapshot } from "../navigation/project-list-model"
import { navigationMode, type NavigationSurface } from "../navigation/navigation-mode"
import { ProjectPanel } from "./ProjectPanel"
import { SessionContextBar } from "./SessionContextBar"

export function ProjectNavigationRoot({ surface, children }: { surface: NavigationSurface; children?: ReactNode }) {
  const { state, dispatch } = useAgentStore()
  const [width, setWidth] = useState(() => window.innerWidth)
  const [projects, setProjects] = useState<ListSnapshot | null>(null)
  const [bindNotice, setBindNotice] = useState("")
  const [localBind, setLocalBind] = useState("")
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  const mode = navigationMode({ surface, innerWidth: width })
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
  const projectsLayer = <div>
    {state.navigationHomeCopy && <p role="status">{state.navigationHomeCopy}</p>}
    <button type="button" onClick={() => dispatch({ type: "NAVIGATE", layer: "recent", projectId: null })}>{projectCopy.recent}</button>
    <ProjectPanel filter="*" onFilter={() => {}} onSnapshot={setProjects} onOpenProject={openProject} />
  </div>
  const recent = <section aria-label="最近对话">
    <button type="button" onClick={() => dispatch({ type: "NAVIGATE", layer: "projects", projectId: null })}>{projectCopy.back}</button>
    {state.threads.filter(thread => !thread.trashed_at).map(thread => <button type="button" key={thread.id} onClick={() => { dispatch({ type: "SET_ACTIVE_THREAD", threadId: thread.id }); dispatch({ type: "NAVIGATE", layer: "session", projectId: null }) }}>{displayThreadTitle(thread)}</button>)}
  </section>
  const detail = <section aria-label="项目详情" data-project-threads>
    <button type="button" onClick={() => dispatch({ type: "NAVIGATE", layer: "projects", projectId: null })}>{projectCopy.back}</button>
    <h2>{project?.name || "项目"}</h2>
    {projectThreads.map(thread => <button type="button" key={thread.id} data-thread-id={thread.id} onClick={() => { dispatch({ type: "SET_ACTIVE_THREAD", threadId: thread.id }); dispatch({ type: "NAVIGATE", layer: "session", projectId }) }}>{displayThreadTitle(thread)}</button>)}
    {projectThreads.length === 0 && <p>{projectCopy.emptyProject}</p>}
    <button type="button" onClick={() => void bindNew()}>{projectCopy.inProject}</button>
    {localBind && <p role="status">{localBind}</p>}
    {bindNotice && <p role="status">{bindNotice}</p>}
  </section>
  const session = <div>
    {mode === "layered" && <button type="button" onClick={() => dispatch({ type: "NAVIGATE", layer: "projects", projectId: null })}>{projectCopy.back}</button>}
    <SessionContextBar
      projectName={activeProject?.name || null}
      projectId={active?.project_id || null}
      threadTitle={active ? displayThreadTitle(active) : "对话"}
      connection={state.connectionState}
      workspaceRoot={active?.workspace_root}
      busy={!!(active && state.threadBusyById[active.id])}
      pending={state.pendingSecurityConfirmations.length > 0}
      onProject={openProject}
    />
    <fieldset>
      <legend>{projectCopy.moveLegend}</legend>
      {!membership && <p>{moveCopy}</p>}
      {projects?.projects.filter(item => !item.archived_at).map(item => <button type="button" key={item.id} disabled={!membership} onClick={() => active && void requestProject("thread.project.set", { thread_id: active.id, project_id: item.id, user_gesture: true, expected_revision: projects.revision, operation_id: crypto.randomUUID() }, new AbortController().signal)}>{`移入 ${item.name}`}</button>)}
      <button type="button" disabled={!membership} onClick={() => active && void requestProject("thread.project.set", { thread_id: active.id, project_id: null, user_gesture: true, expected_revision: projects?.revision || 0, operation_id: crypto.randomUUID() }, new AbortController().signal)}>{projectCopy.moveOut}</button>
    </fieldset>
    {children}
  </div>
  const showProjects = mode === "resident" || layer === "projects"
  const showRecent = layer === "recent"
  const showDetail = layer === "project"
  const showSession = layer === "session"
  return <div data-navigation-mode={mode} data-navigation-surface={surface}>
    <div hidden={!showProjects}>{projectsLayer}</div>
    <div hidden={!showRecent}>{recent}</div>
    <div hidden={!showDetail}>{detail}</div>
    <div hidden={!showSession}>{session}</div>
  </div>
}
