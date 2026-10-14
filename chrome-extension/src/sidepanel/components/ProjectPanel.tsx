import { useEffect, useRef, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { requestProject, requestProjectThread, type ProjectState } from "../utils/project-request"

/** Organization metadata only. Selection is a list filter, never execution authority. */
export function ProjectPanel({ filter, onFilter }: { filter: string; onFilter: (id: string) => void }) {
  const { state, dispatch } = useAgentStore()
  const [snapshot, setSnapshot] = useState<ProjectState | null>(null)
  const [error, setError] = useState(""), [notice, setNotice] = useState("")
  const [name, setName] = useState(""), [rename, setRename] = useState("")
  const [selected, setSelected] = useState("")
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false), [opened, setOpened] = useState(false)
  const owner = useRef(state.activeThreadId), request = useRef<AbortController | null>(null)
  const creation = useRef<{ name: string; operation: string } | null>(null)
  const admittedCreation = useRef<{ id: string; selection: number } | null>(null)
  const selection = useRef(state.activeThreadSelectionRevision)
  const nameInput = useRef<HTMLInputElement>(null)
  owner.current = state.activeThreadId
  selection.current = state.activeThreadSelectionRevision
  const thread = state.threads.find(t => t.id === state.activeThreadId)
  const project = snapshot?.projects.find(p => p.id === selected)
  const current = snapshot?.projects.find(p => p.id === thread?.project_id)
  const matchingProjects = snapshot?.projects.filter(p => p.id === selected || p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const busyHint = !!(thread && state.threadBusyById[thread.id]) || state.pendingSecurityConfirmations.length > 0
  async function refresh() {
    const controller = new AbortController(); request.current?.abort(); request.current = controller
    try { const result = await requestProject("project.list", {}, controller.signal); setSnapshot({ revision: result.revision, projects: result.projects }); setError("") }
    catch (e) { if (!controller.signal.aborted) { setSnapshot(null); setError((e as Error).message) } }
    finally { if (request.current === controller) request.current = null }
  }
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => { if (saving && !(admittedCreation.current?.id === state.activeThreadId && admittedCreation.current.selection === state.activeThreadSelectionRevision)) { request.current?.abort(); setSaving(false); setNotice("已切换对话；保存结果请刷新核实。") } }, [state.activeThreadId, state.activeThreadSelectionRevision])
  async function mutate(type: string, fields: Record<string, any>) {
    if (!snapshot || saving) return
    const submittedOwner = state.activeThreadId, submittedSelection = state.activeThreadSelectionRevision, controller = new AbortController()
    const ownsView = () => owner.current === submittedOwner && selection.current === submittedSelection ||
      !!admittedCreation.current && owner.current === admittedCreation.current.id && selection.current === admittedCreation.current.selection
    admittedCreation.current = null
    request.current?.abort(); request.current = controller; setSaving(true); setError(""); setNotice("")
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
    } catch (e) {
      if (!controller.signal.aborted && ownsView()) {
        setError(created ? "新对话已创建在项目外；归入尚未确认，请刷新后显式整理。" : (e as Error).message)
        if (created) { dispatch({ type: "SET_ACTIVE_THREAD", threadId: created.id }); chrome.runtime.sendMessage({ type: "thread.select", threadId: created.id }) }
      }
    } finally { if (request.current === controller) { request.current = null; setSaving(false) } }
  }
  return <details className="cm-projects" open={opened} onToggle={event => {
    const open = event.currentTarget.open; setOpened(open)
    if (open && !snapshot && !request.current) { void refresh(); nameInput.current?.focus() }
  }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); request.current?.abort(); setOpened(false); event.currentTarget.querySelector<HTMLElement>("summary")?.focus() } }}>
    <summary>项目</summary>
    {opened && <div className="cm-project-controls">
      <p>可选组织上下文，不改变工作目录或权限。</p>
      <label>项目筛选<select aria-label="项目筛选" value={filter} onChange={e => onFilter(e.target.value)}><option value="*">全部对话</option><option value="">项目外对话</option>{snapshot?.projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.archived_at ? "（已归档）" : ""}</option>)}</select></label>
      <button type="button" disabled={saving} onClick={() => void refresh()}>刷新项目</button>
      <form onSubmit={e => { e.preventDefault(); void mutate("project.create", { name }) }}><label>新项目名称<input ref={nameInput} value={name} onChange={e => setName(e.target.value)} maxLength={160} disabled={saving} /></label><button type="submit" disabled={!snapshot || saving || !name.trim()}>创建项目</button></form>
      <label>搜索项目<input value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>管理项目<select aria-label="管理项目" value={selected} disabled={saving} onChange={e => { setSelected(e.target.value); setRename(snapshot?.projects.find(p => p.id === e.target.value)?.name || "") }}><option value="">选择项目</option>{matchingProjects?.map(p => <option key={p.id} value={p.id}>{p.name}{p.archived_at ? "（已归档）" : ""}</option>)}</select></label>
      {project && <><form onSubmit={e => { e.preventDefault(); void mutate("project.rename", { project_id: project.id, name: rename }) }}><label>项目新名称<input value={rename} onChange={e => setRename(e.target.value)} disabled={saving} maxLength={160} /></label><button disabled={saving || !rename.trim()}>改名</button></form><button type="button" disabled={saving} onClick={() => void mutate(project.archived_at ? "project.restore" : "project.archive", { project_id: project.id })}>{project.archived_at ? "恢复项目" : "归档项目"}</button><button type="button" disabled={saving || !!project.archived_at} onClick={() => void mutate("thread.project.new", {})}>项目内新对话</button></>}
      <p>当前对话项目：{thread?.project_metadata_unavailable ? "项目状态不可用" : current ? current.name + (current.archived_at ? "（已归档）" : "") : thread?.project_id ? "原项目不可用" : "项目外"}</p>
      <label>当前对话归属<select aria-label="选择当前对话项目" value={thread?.project_id || ""} disabled={!snapshot || saving || !thread || busyHint || thread.project_metadata_unavailable} onChange={e => void mutate("thread.project.set", { thread_id: thread!.id, project_id: e.target.value || null })}><option value="">项目外</option>{thread?.project_id && !current && <option value={thread.project_id} disabled>原项目不可用</option>}{snapshot?.projects.map(p => <option key={p.id} value={p.id} disabled={!!p.archived_at}>{p.name}{p.archived_at ? "（已归档）" : ""}</option>)}</select></label>
      {busyHint && <p>先结束执行或处理待确认操作，再整理。</p>}
      {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    </div>}
  </details>
}
