import { useEffect, useRef, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { requestProject, requestProjectThread } from "../utils/project-request"
import { projectCopy } from "../navigation/project-copy"
import {
  PROJECT_LIST_CACHE_KEY,
  applyProjectListResult,
  bumpListGeneration,
  parseProjectListCache,
  sameListGeneration,
  type ListSnapshot,
} from "../navigation/project-list-model"
import { ProjectListView } from "./ProjectListView"

/** Organization metadata only. Opening a row is a view, never execution authority. */
export function ProjectPanel({ filter, onFilter, onSnapshot, onOpenProject }: {
  filter: string
  onFilter: (id: string) => void
  onSnapshot?: (snapshot: ListSnapshot | null) => void
  onOpenProject?: (id: string) => void
}) {
  void filter
  void onFilter
  const { state, dispatch } = useAgentStore()
  const [snapshot, setSnapshot] = useState<ListSnapshot | null>(null)
  const [notice, setNotice] = useState("")
  const [saveFailed, setSaveFailed] = useState(false)
  const [bindError, setBindError] = useState("")
  const [name, setName] = useState(""), [rename, setRename] = useState("")
  const [selected, setSelected] = useState("")
  const [search, setSearch] = useState("")
  const [archiveView, setArchiveView] = useState(false)
  const [saving, setSaving] = useState(false), [opened, setOpened] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [listFailed, setListFailed] = useState(false)
  const owner = useRef(state.activeThreadId)
  const creation = useRef<{ name: string; operation: string } | null>(null)
  const admittedCreation = useRef<{ id: string; selection: number } | null>(null)
  const selection = useRef(state.activeThreadSelectionRevision)
  const listGeneration = useRef(0)
  const snapshotRef = useRef<ListSnapshot | null>(null)
  const previousConnection = useRef(state.connectionState)
  const request = useRef<AbortController | null>(null)
  owner.current = state.activeThreadId
  selection.current = state.activeThreadSelectionRevision
  const thread = state.threads.find(t => t.id === state.activeThreadId)
  const project = snapshot?.projects.find(p => p.id === selected)
  const current = snapshot?.projects.find(p => p.id === thread?.project_id)
  async function refresh() {
    const generation = bumpListGeneration(listGeneration.current)
    listGeneration.current = generation
    const controller = new AbortController()
    setRefreshing(true)
    try {
      const result = await requestProject("project.list", {}, controller.signal)
      if (!sameListGeneration(generation, listGeneration.current)) return
      const applied = applyProjectListResult(snapshotRef.current, {
        revision: result.revision,
        projects: result.projects,
        fetchedAt: new Date().toISOString(),
        generation,
      })
      if (!applied.snapshot || !applied.applied) return
      snapshotRef.current = applied.snapshot
      setSnapshot(applied.snapshot)
      setListFailed(false)
      chrome.storage.local.set({
        [PROJECT_LIST_CACHE_KEY]: JSON.stringify({
          format: 1,
          revision: applied.snapshot.revision,
          projects: applied.snapshot.projects,
          fetchedAt: applied.snapshot.fetchedAt,
        }),
      })
    } catch {
      if (controller.signal.aborted || !sameListGeneration(generation, listGeneration.current)) return
      setListFailed(true)
    } finally {
      if (sameListGeneration(generation, listGeneration.current)) setRefreshing(false)
    }
  }
  useEffect(() => {
    chrome.storage.local.get(PROJECT_LIST_CACHE_KEY, stored => {
      const raw = stored?.[PROJECT_LIST_CACHE_KEY]
      const parsed = parseProjectListCache(typeof raw === "string" ? raw : null)
      if (!parsed || snapshotRef.current) return
      const next = { revision: parsed.revision, projects: parsed.projects, fetchedAt: parsed.fetchedAt, generation: listGeneration.current }
      snapshotRef.current = next
      setSnapshot(next)
    })
  }, [])
  useEffect(() => { onSnapshot?.(snapshot) }, [snapshot])
  useEffect(() => {
    if (previousConnection.current !== "connected" && state.connectionState === "connected" && opened) void refresh()
    previousConnection.current = state.connectionState
  }, [state.connectionState, opened])
  useEffect(() => { if (saving && !(admittedCreation.current?.id === state.activeThreadId && admittedCreation.current.selection === state.activeThreadSelectionRevision)) { request.current?.abort(); setSaving(false); setNotice("已切换对话；保存结果请刷新核实。") } }, [state.activeThreadId, state.activeThreadSelectionRevision])
  async function mutate(type: string, fields: Record<string, any>) {
    if (!snapshot || saving) return
    const submittedOwner = state.activeThreadId, submittedSelection = state.activeThreadSelectionRevision, controller = new AbortController()
    const ownsView = () => owner.current === submittedOwner && selection.current === submittedSelection ||
      !!admittedCreation.current && owner.current === admittedCreation.current.id && selection.current === admittedCreation.current.selection
    admittedCreation.current = null
    request.current?.abort(); request.current = controller; setSaving(true); setSaveFailed(false); setBindError(""); setNotice("")
    const normalized = name.normalize("NFC").trim()
    let operation: string = crypto.randomUUID()
    if (type === "project.create") {
      if (creation.current?.name === normalized) operation = creation.current.operation
      else creation.current = { name: normalized, operation }
    }
    let created: any
    try {
      if (type === "thread.project.new") {
        created = await requestProjectThread(controller.signal, thread => { if (!submittedOwner) admittedCreation.current = { id: thread.id, selection: submittedSelection + 1 } })
        dispatch({ type: "UPSERT_THREAD", thread: created })
        type = "thread.project.set"; fields = { thread_id: created.id, project_id: selected }
      }
      const result = await requestProject(type, { ...fields, user_gesture: true, expected_revision: snapshot.revision, operation_id: operation }, controller.signal)
      if (controller.signal.aborted || !ownsView()) return
      if (result.thread) dispatch({ type: "UPSERT_THREAD", thread: result.thread })
      if (created) { dispatch({ type: "SET_ACTIVE_THREAD", threadId: created.id }); chrome.runtime.sendMessage({ type: "thread.select", threadId: created.id }) }
      if (type === "project.create") { creation.current = null; setName(""); setSelected(result.project.id) }
      setNotice("项目记录已保存。")
      setSaving(false)
      await refresh()
    } catch {
      if (!controller.signal.aborted && ownsView()) {
        if (created) {
          setBindError("新对话已创建在项目外；归入尚未确认，请刷新后显式整理。")
          dispatch({ type: "SET_ACTIVE_THREAD", threadId: created.id }); chrome.runtime.sendMessage({ type: "thread.select", threadId: created.id })
        } else setSaveFailed(true)
      }
    } finally { if (request.current === controller) { request.current = null; setSaving(false) } }
  }
  const offline = state.connectionState === "disconnected"
  const phase = offline ? "offline" : listFailed ? "list-error" : refreshing && snapshot ? "refreshing" : snapshot ? "ready" : "loading"
  return <details className="cm-projects" open={opened} onToggle={event => {
    const open = event.currentTarget.open; setOpened(open)
    if (open) void refresh()
  }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpened(false); event.currentTarget.querySelector<HTMLElement>("summary")?.focus() } }}>
    <summary>{projectCopy.projects}</summary>
    {opened && <div className="cm-project-controls">
      <p>可选组织上下文，不改变工作目录或权限。</p>
      <ProjectListView
        projects={snapshot?.projects || []}
        query={search}
        archiveView={archiveView}
        phase={phase}
        fetchedAt={snapshot?.fetchedAt || null}
        hasSnapshot={!!snapshot}
        onQuery={setSearch}
        onRetry={() => void refresh()}
        onClearQuery={() => setSearch("")}
        onToggleArchive={() => setArchiveView(value => !value)}
        onOpen={id => {
          setSelected(id)
          setRename(snapshot?.projects.find(item => item.id === id)?.name || "")
          onOpenProject?.(id)
        }}
      />
      {!onOpenProject && selected && <button type="button" onClick={() => setSelected("")}>{projectCopy.back}</button>}
      <details>
        <summary>{projectCopy.createSummary}</summary>
        <form onSubmit={event => { event.preventDefault(); void mutate("project.create", { name }) }}><label>新项目名称<input aria-label="新项目名称" value={name} onChange={event => setName(event.target.value)} maxLength={160} disabled={saving} /></label><button type="submit" disabled={!snapshot || saving || !name.trim()}>创建项目</button></form>
      </details>
      <details>
        <summary>{projectCopy.manageSummary}</summary>
        {project && <><form onSubmit={event => { event.preventDefault(); void mutate("project.rename", { project_id: project.id, name: rename }) }}><label>项目新名称<input value={rename} onChange={event => setRename(event.target.value)} disabled={saving} maxLength={160} /></label><button disabled={saving || !rename.trim()}>改名</button></form><button type="button" disabled={saving} onClick={() => void mutate(project.archived_at ? "project.restore" : "project.archive", { project_id: project.id })}>{project.archived_at ? "恢复项目" : "归档项目"}</button></>}
      </details>
      <p>当前对话项目：{thread?.project_metadata_unavailable ? "项目状态不可用" : current ? current.name + (current.archived_at ? "（已归档）" : "") : thread?.project_id ? "原项目不可用" : "项目外"}</p>
      {notice && <p role="status">{notice}</p>}
      {saveFailed && <p role="alert">{projectCopy.saveFailed}</p>}
      {bindError && <p role="alert">{bindError}</p>}
    </div>}
  </details>
}
