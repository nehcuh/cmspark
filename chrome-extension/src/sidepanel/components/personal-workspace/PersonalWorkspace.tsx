import { useEffect, useRef, useState } from 'react'
import { CONTEXT_PANEL_TABS, type ContextPanelId } from '../ContextPanelHost'
import { datetimeInput, taskDatePatch, dueToday, formatTaskTime, requestActivity, taskComplete, type ActivityApp, type ActivityConfig, type ActivityReply, type PersonalTodo, type TaskEvidence, type TodoCandidate } from './activity-request'
import type { ActivityController } from './useActivity'
import { RecentActivitySources } from './RecentActivitySources'

export type WorkspaceDestination = 'today' | 'todos' | 'chat' | 'materials' | 'activity'
export const WORKSPACE_DESTINATIONS: Array<{ id: WorkspaceDestination; label: string }> = [
  { id: 'today', label: '今日' }, { id: 'todos', label: '待办' }, { id: 'chat', label: '对话' }, { id: 'materials', label: '资料' }, { id: 'activity', label: '活动记录' },
]
const reminderLabels: Record<PersonalTodo['reminder']['status'], string> = { none: '未设置提醒', scheduled: '已排程', attempting: '正在提交系统通知', submitted: '已提交系统通知（不代表已读）', failed: '提醒提交失败', unknown: '提醒结果未知，请核实' }

export function PersonalWorkspace({ destination, controller, connected, navigate, openResource }: {
  destination: Exclude<WorkspaceDestination, 'chat'>; controller: ActivityController; connected: boolean; navigate: (view: WorkspaceDestination) => void; openResource: (panel: ContextPanelId) => void
}) {
  const { snapshot, loading, busy, error, notice, refresh } = controller
  const title = WORKSPACE_DESTINATIONS.find(item => item.id === destination)!.label
  const descriptions = {
    today: '先处理临期事项，再整理聊天中发现的新待办。来源、处理和反馈放在一起。',
    todos: '把分散在聊天里的承诺和督办收在一处，保留谁提出、何时截止、向哪里反馈。',
    materials: '继续使用已有资料与工具；会议、知识和执行记录仍归属于原来的对话。',
    activity: '只采集你指定的前台应用可见内容。先核对范围，再明确开启。',
  }
  return <section className="cm-personal" aria-label={`${title}工作区`}>
    <header className="cm-personal-head"><div><p className="cm-personal-eyebrow">个人工作中心</p><h1>{title}</h1><p>{descriptions[destination]}</p></div>
      <div className="cm-personal-actions"><span className="cm-personal-count">{connected ? '本机 Companion 已连接' : '本机服务未连接'}</span><button className="cm-p-button" type="button" disabled={!connected || loading || busy} onClick={() => void refresh()}>{loading ? '刷新中…' : '刷新'}</button></div>
    </header>
    {!connected && <div className="cm-personal-banner" role="alert">Companion 未连接。当前信息可能过期；连接恢复后才能保存或接收提醒。</div>}
    {error && <div className="cm-personal-banner" role="alert">{error}</div>}
    {notice && <div className="cm-personal-banner" role="status">{notice}</div>}
    <div className="cm-personal-body">
      {destination === 'materials' ? <MaterialsPanel openResource={openResource} /> : !snapshot ? <div className="cm-personal-empty"><h2>{loading ? '正在读取本机记录' : '还没有读取到工作记录'}</h2><p>{connected ? '点击刷新获取本机 Companion 的待办与采集状态。读取失败不会生成示例事项。' : '请先连接本机 Companion；待办与来源由同一后台服务保管。'}</p></div> : destination === 'activity' ? <ActivityPanel controller={controller} connected={connected} /> : <TodoPanel today={destination === 'today'} controller={controller} connected={connected} navigate={navigate} />}
    </div>
  </section>
}

function TodoPanel({ today, controller, connected, navigate }: { today: boolean; controller: ActivityController; connected: boolean; navigate: (view: WorkspaceDestination) => void }) {
  const { snapshot, busy, mutate } = controller
  const [filter, setFilter] = useState('open'), [query, setQuery] = useState(''), [selected, setSelected] = useState<string | null>(null)
  const [showCandidates, setShowCandidates] = useState(false)
  const candidates = snapshot!.candidates.filter(item => item.status === 'pending')
  const sourceAppName = (evidence: TaskEvidence) => snapshot!.sources.find(source => source.id === evidence.source_id)?.app_name
  const todos = snapshot!.todos.filter(item => {
    if (today && !dueToday(item)) return false
    if (!today && filter === 'open' && taskComplete(item)) return false
    if (!today && filter === 'own' && (item.kind !== 'own' || taskComplete(item))) return false
    if (!today && filter === 'supervise' && (item.kind !== 'supervise' || taskComplete(item))) return false
    if (!today && filter === 'feedback' && item.feedback_status !== 'pending') return false
    if (!today && filter === 'done' && !taskComplete(item)) return false
    return `${item.title} ${item.owner} ${item.evidence.group} ${item.evidence.sender} ${item.feedback_to}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  }).sort((a, b) => (a.due_at || '9999').localeCompare(b.due_at || '9999'))
  const selection = snapshot!.todos.find(item => item.id === selected) || candidates.find(item => item.id === selected)
  const [confirmDismiss, setConfirmDismiss] = useState<string | null>(null)
  useEffect(() => { setSelected(null); setShowCandidates(false); setQuery('') }, [today])
  const isCandidate = !!selection && 'status' in selection
  const listCandidates = showCandidates || today
  return <>
    {!today && <div className="cm-personal-filters" aria-label="待办筛选">
      {[['open', '全部待处理'], ['own', '我的待办'], ['supervise', '我督办的'], ['feedback', '待反馈'], ['done', '已完成']].map(([id, label]) => <button key={id} type="button" aria-pressed={!showCandidates && filter === id} onClick={() => { setFilter(id); setShowCandidates(false); setSelected(null) }}>{label}</button>)}
      <button type="button" aria-pressed={showCandidates} onClick={() => { setShowCandidates(true); setSelected(null) }}>待整理 {candidates.length}</button>
      <input className="cm-personal-search" aria-label="搜索待办及来源" placeholder="查找事项、群或提出人" value={query} onChange={event => setQuery(event.target.value)} />
    </div>}
    <div className="cm-personal-split" data-detail={!!selection}>
      <div className="cm-personal-list">
        {!showCandidates && <><div className="cm-personal-section-title"><h2>{today ? '今天及已逾期' : filter === 'done' ? '已完成事项' : '确认的事项'}</h2><span className="cm-personal-count">{todos.length} 项</span></div>
          <div className="cm-personal-ledger">{todos.map(todo => <button type="button" className="cm-personal-row" key={todo.id} aria-current={selected === todo.id ? 'true' : undefined} onClick={() => { setSelected(todo.id); setConfirmDismiss(null) }}>
            <span className="cm-personal-row-main"><span className="cm-personal-row-title">{todo.title}</span><span className="cm-personal-source-line">{sourceLine(todo.evidence, sourceAppName(todo.evidence))} · 负责人 {todo.owner}</span><span className="cm-personal-source-line">反馈至 {todo.feedback_to || '未指定'}{todo.kind === 'supervise' ? ' · 我督办的' : ''}</span></span>
            <span className="cm-personal-row-status"><span>{todo.due_at ? formatTaskTime(todo.due_at) : '无截止时间'}</span><span className="cm-personal-tag" data-warning={todo.feedback_status === 'pending'}>{todo.handling_status === 'open' ? '待处理' : todo.feedback_status === 'pending' ? '已处理 · 待反馈' : '已完成'}</span></span>
          </button>)}</div>
          {!todos.length && <div className="cm-personal-empty"><h2>{today ? '今天没有临期事项' : '这个分类还没有事项'}</h2><p>{today ? '有截止时间且尚未完成的事项会显示在这里。没有截止时间的事项仍可在待办中查看。' : '聊天抽取结果先进入待整理，只有你确认后才成为正式待办。'}</p><button type="button" className="cm-p-link" onClick={() => navigate(today ? 'todos' : 'activity')}>{today ? '查看全部待办' : '设置聊天采集'}</button></div>}
        </>}
        {listCandidates && <section style={{ marginTop: today ? 32 : 0 }} aria-label="待整理候选"><div className="cm-personal-section-title"><h2>从聊天中发现</h2><span className="cm-personal-count">{candidates.length} 项待确认</span></div>
          <p className="cm-personal-fieldnote" style={{ marginBottom: 14 }}>抽取可能误认责任人或时间；请核对原文后确认。不会自动变成待办或发出反馈。</p>
          <div className="cm-personal-ledger">{candidates.filter(item => `${item.title} ${item.evidence.group} ${item.evidence.sender}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(candidate => <button type="button" className="cm-personal-row cm-personal-candidate" key={candidate.id} aria-current={selected === candidate.id ? 'true' : undefined} onClick={() => { setSelected(candidate.id); setConfirmDismiss(null) }}><span className="cm-personal-row-main"><span className="cm-personal-row-title">{candidate.title}</span><span className="cm-personal-source-line">{sourceLine(candidate.evidence, sourceAppName(candidate.evidence))}</span></span><span className="cm-personal-tag">核对并整理</span></button>)}</div>
          {!candidates.length && <p className="cm-personal-fieldnote">暂无待整理内容。<button type="button" className="cm-p-link" onClick={() => navigate('activity')}>查看采集范围</button></p>}
        </section>}
      </div>
      {selection ? <div className="cm-personal-detail" key={selection.id}>
        <div className="cm-personal-detail-top"><span className="cm-personal-tag">{isCandidate ? '候选 · 需要你确认' : '个人事项'}</span><button className="cm-p-link" type="button" onClick={() => setSelected(null)}>返回列表</button></div>
        <h2>{selection.title}</h2><SourceEvidence appName={sourceAppName(selection.evidence)} evidence={selection.evidence} connected={connected} sourceAvailable={snapshot!.sources.some(source => source.id === selection.evidence.source_id && !source.deleted)} />
        <TaskEditor item={selection} busy={busy || !connected} onSave={async (task, revision) => {
          const saved = await mutate(isCandidate ? 'todo.confirm' : 'todo.update', isCandidate ? { candidate_id: selection.id, expected_revision: revision, task } : { todo_id: selection.id, expected_revision: revision, patch: task }, isCandidate ? '待办已确认并保存。' : '事项更改已保存。')
          if (saved) setSelected(null)
          return saved
        }} />
        {!isCandidate && <p className="cm-personal-fieldnote" style={{ marginTop: 16 }}>提醒：{reminderLabels[(selection as PersonalTodo).reminder.status]}{(selection as PersonalTodo).reminder.error ? ` · ${(selection as PersonalTodo).reminder.error}` : ''}。通知要求 Companion 持续运行，系统免打扰可能抑制通知。</p>}
        {isCandidate && <div className="cm-personal-save">{confirmDismiss === selection.id ? <><span className="cm-personal-fieldnote">忽略这条候选？不会删除来源记录。</span><button type="button" className="cm-p-button" disabled={busy || !connected} onClick={async () => { if (await mutate('todo.dismiss', { candidate_id: selection.id, expected_revision: selection.revision }, '候选已忽略。')) setSelected(null) }}>确认忽略</button><button type="button" className="cm-p-link" onClick={() => setConfirmDismiss(null)}>取消</button></> : <button type="button" className="cm-p-link" disabled={busy || !connected} onClick={() => setConfirmDismiss(selection.id)}>忽略候选</button>}</div>}
      </div> : <aside className="cm-personal-detail"><p className="cm-personal-eyebrow">来源与反馈</p><h2>把每个交代留在原处</h2><p className="cm-personal-fieldnote">选择一条事项，核对是谁在哪个群提出、什么时候截止，以及处理后向哪里反馈。</p><p className="cm-personal-fieldnote" style={{ marginTop: 12 }}>处理完成与反馈完成分别保存。这里的个人待办独立于对话中的 Agent 执行记录。</p></aside>}
    </div>
  </>
}

function sourceLine(evidence: TaskEvidence, appName?: string): string { return [appName || evidence.app_id || '应用未识别', evidence.group || '群 / 对话未识别', evidence.sender || '提出人未识别'].join(' / ') }
function SourceEvidence({ evidence, connected, onSource, sourceAvailable = true, appName }: { evidence: TaskEvidence; appName?: string; connected: boolean; onSource?: (source: NonNullable<ActivityReply['source']>) => void; sourceAvailable?: boolean }) {
  const [source, setSource] = useState<ActivityReply['source']>(), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => { setSource(undefined); setError(''); setLoading(false); return () => abort.current?.abort() }, [evidence.source_id, evidence.quote, sourceAvailable])
  async function load() {
    abort.current?.abort(); setLoading(true); setError(''); const controller = new AbortController(); abort.current = controller
    try { const result = await requestActivity('activity.source', { source_id: evidence.source_id }, controller.signal); if (!controller.signal.aborted && result.source?.id === evidence.source_id) { setSource(result.source); onSource?.(result.source) } }
    catch (e) { if (!controller.signal.aborted) setError((e as Error).message) }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  return <><p className="cm-personal-source-line">{sourceLine(evidence, appName || source?.app_name)}</p><dl><dt>消息时间</dt><dd>{evidence.message_time || '未识别，请核对原文'}</dd><dt>原始应用</dt><dd>{evidence.app_id || '未识别'}</dd></dl>
    <blockquote>{evidence.quote || '没有引用文本；请读取来源截图与 OCR 核对。'}</blockquote>
    <button type="button" className="cm-p-link" disabled={!connected || loading || !evidence.source_id || !sourceAvailable} onClick={() => void load()}>{!sourceAvailable ? '来源已清理' : loading ? '读取来源中…' : source ? '重新读取来源' : '查看原始截图与 OCR'}</button>
    {error && <p role="alert" className="cm-personal-fieldnote">{error}</p>}
    {sourceAvailable && source && <details open><summary className="cm-personal-source-line">{source.origin === 'manual_import' ? '导入于（原消息时间未知）' : '采集于'} {formatTaskTime(source.captured_at)} · {source.app_name || source.app_id}</summary>{source.image_data_url && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(source.image_data_url) ? <img className="cm-personal-source-image" src={source.image_data_url} alt={`${source.app_name || '应用'}在${formatTaskTime(source.captured_at)}的来源截图`} /> : <p className="cm-personal-fieldnote">截图已清理或不可读取。</p>}<p className="cm-personal-fieldnote" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 10 }}>{source.ocr_text || '无 OCR 文本'}</p></details>}
  </>
}

function TaskEditor({ item, busy, onSave }: { item: PersonalTodo | TodoCandidate; busy: boolean; onSave: (task: Record<string, unknown>, revision: number) => Promise<boolean> }) {
  const candidate = 'status' in item
  const revision = useRef(item.revision)
  const [title, setTitle] = useState(item.title), [owner, setOwner] = useState(item.owner)
  const initialDates = useRef({ due: datetimeInput(item.due_at), remind: datetimeInput(candidate ? null : item.remind_at) })
  const [due, setDue] = useState(initialDates.current.due), [remind, setRemind] = useState(initialDates.current.remind)
  const [feedbackTo, setFeedbackTo] = useState(item.feedback_to), [feedbackRequired, setFeedbackRequired] = useState(item.feedback_required)
  const [kind, setKind] = useState(candidate ? 'own' : item.kind)
  const [handlingDone, setHandlingDone] = useState(!candidate && item.handling_status === 'done')
  const [feedbackDone, setFeedbackDone] = useState(!candidate && item.feedback_status === 'done')
  const [error, setError] = useState('')
  const stale = revision.current !== item.revision
  return <form onSubmit={async event => {
    event.preventDefault(); setError('')
    if (stale) { setError('这条事项已在其他界面更改；请返回列表重新打开，再核对草稿。'); return }
    try {
      await onSave({ title: title.trim(), owner: owner.trim(), ...taskDatePatch(candidate, initialDates.current, { due, remind }), feedback_to: feedbackTo.trim(), feedback_required: feedbackRequired, kind, ...(!candidate ? { handling_status: handlingDone ? 'done' : 'open', feedback_status: !feedbackRequired ? 'not_required' : feedbackDone ? 'done' : 'pending' } : {}) }, revision.current)
    } catch { setError('日期无效，请重新核对。') }
  }}>
    <div className="cm-personal-form"><label className="cm-personal-wide">事项内容<input value={title} onChange={e => setTitle(e.target.value)} maxLength={300} required disabled={busy} /></label><label>负责人<input value={owner} onChange={e => setOwner(e.target.value)} maxLength={200} placeholder="核对后填写" required disabled={busy} /></label><label>事项归类<select value={kind} onChange={e => setKind(e.target.value as PersonalTodo['kind'])} disabled={busy}><option value="own">我的待办</option><option value="supervise">我督办的</option></select></label>
      <label>截止时间<input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} disabled={busy} /></label><label>提醒时间<input type="datetime-local" value={remind} onChange={e => setRemind(e.target.value)} disabled={busy} /></label>
      <p className="cm-personal-fieldnote cm-personal-wide">时间按当前设备时区（{Intl.DateTimeFormat().resolvedOptions().timeZone}）填写；空白表示不设置。</p>
      <label className="cm-personal-check cm-personal-wide"><input type="checkbox" checked={feedbackRequired} onChange={e => setFeedbackRequired(e.target.checked)} disabled={busy} />处理后需要反馈</label>
      <label className="cm-personal-wide">反馈给谁 / 在哪里反馈<input value={feedbackTo} onChange={e => setFeedbackTo(e.target.value)} maxLength={200} placeholder="例如：回项目群 @提出人，附方案链接" disabled={busy} /></label>
    </div>
    {!candidate && <div className="cm-personal-progress"><label><input type="checkbox" checked={handlingDone} onChange={e => setHandlingDone(e.target.checked)} disabled={busy} />处理已完成</label><label><input type="checkbox" checked={feedbackDone} onChange={e => setFeedbackDone(e.target.checked)} disabled={busy || !feedbackRequired} />已向来源反馈</label><p className="cm-personal-fieldnote">此处只记录你的确认，不会向聊天软件发送消息。</p></div>}
    {stale && <p role="alert" className="cm-personal-fieldnote">此事项已有更新。草稿保留；请返回列表重新打开后核对。</p>}{error && <p role="alert">{error}</p>}
    <div className="cm-personal-save"><span className="cm-personal-fieldnote">{candidate ? '确认后才建立正式事项和提醒。' : '分别核对处理与反馈状态。'}</span><button type="submit" className="cm-p-button cm-p-primary" disabled={busy || stale || !owner.trim() || !title.trim()}>{busy ? '等待后台确认…' : candidate ? '确认并加入待办' : '保存更改'}</button></div>
  </form>
}

function ActivityPanel({ controller, connected }: { controller: ActivityController; connected: boolean }) {
  const { snapshot, busy, mutate } = controller
  const [editing, setEditing] = useState(false), [deleteConfirm, setDeleteConfirm] = useState(false)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [loadedSource, setLoadedSource] = useState<ActivityReply['source']>(), [manual, setManual] = useState(false)
  const runtime = snapshot!.runtime, config = snapshot!.config
  const source = snapshot!.sources.find(item => item.id === sourceId)
  const status = !runtime.supported ? '当前环境仅支持主动导入截图' : runtime.scanning ? '正在采集与分析' : config.enabled ? '采集已开启' : '采集已暂停'
  return <>
    <div className="cm-personal-config"><div className="cm-personal-section-title"><h2>{status}</h2><button type="button" className="cm-p-button" disabled={!connected || busy || !runtime.supported || !config.enabled && !config.allowed_apps.length} onClick={() => void mutate('activity.configure', { expected_revision: snapshot!.revision, patch: { enabled: !config.enabled } }, config.enabled ? '已暂停后续采集。' : '采集已开启；仅覆盖指定的前台应用。')}>{config.enabled ? '暂停采集' : '开启采集'}</button></div>
      <p className="cm-personal-fieldnote">{runtime.coverage}</p><p className="cm-personal-fieldnote">{runtime.platform_note}</p>
      <div className="cm-personal-runtime"><div><span>最近成功采集</span><strong>{formatTaskTime(runtime.last_success_at)}</strong></div><div><span>指定应用</span><strong>{config.allowed_apps.length} 个 · 每 {config.interval_ms / 1000} 秒检查</strong></div><div><span>已保存来源</span><strong>{snapshot!.sources.length} 张 · {(snapshot!.sources.reduce((total, item) => total + item.bytes, 0) / 1024 / 1024).toFixed(1)} MB</strong></div></div>
      {runtime.error && <p role="alert">采集未完成：{runtime.error}</p>}
      <p className="cm-personal-fieldnote">OCR 语义抽取：{config.ocr_ai_enabled ? '已允许 OCR 文本发送给配置的模型' : '未授权模型读取 OCR 文本；不会自动抽取待办'}。原始截图留在本机。</p>
      <div className="cm-personal-actions" style={{ marginTop: 16 }}><button type="button" className="cm-p-button" disabled={busy || !connected} onClick={() => setEditing(value => !value)}>{editing ? '收起设置' : '设置应用与隐私'}</button><button type="button" className="cm-p-button" disabled={!connected || busy || !runtime.supported || !config.enabled} onClick={() => void mutate('activity.scan', {}, '本次采集请求已完成，请核对最近成功时间与待整理事项。')}>{busy ? '等待后台…' : '现在检查一次'}</button></div>
      {editing && <ActivityConfigEditor platform={runtime.platform} autoSupported={runtime.supported} config={config} revision={snapshot!.revision} busy={busy || !connected} onSave={async patch => { const saved = await mutate('activity.configure', { expected_revision: snapshot!.revision, patch }, '采集设置已保存。'); if (saved) setEditing(false) }} />}
      <section className="cm-personal-config-section"><h2>保留与清理</h2><p className="cm-personal-fieldnote" style={{ margin: '12px 0' }}>来源最多保留 {config.retention_days} 天，容量上限 {config.max_storage_mb} MB；清理截图与 OCR 后，已确认事项保留，引用原文也会移除。</p>{deleteConfirm ? <div className="cm-personal-actions"><span className="cm-personal-fieldnote">删除全部截图、OCR 和未确认候选？此操作不可撤销。</span><button className="cm-p-button cm-p-danger" type="button" disabled={busy || !connected} onClick={async () => { if (await mutate('activity.delete', {}, '来源与未确认候选已清理；已确认事项保留。')) setDeleteConfirm(false) }}>确认清理来源</button><button className="cm-p-button" type="button" onClick={() => setDeleteConfirm(false)}>取消</button></div> : <button className="cm-p-button cm-p-danger" type="button" disabled={!connected || busy} onClick={() => setDeleteConfirm(true)}>清理全部来源</button>}</section>
    </div>
    <ImportScreenshot busy={busy || !connected} onImport={image_base64 => mutate('activity.import', { image_base64 }, '截图已在本机 OCR；未发送模型。请核对来源后整理待办，或单独点击抽取。')} />
    <RecentActivitySources sources={snapshot!.sources} onSelect={id => { setSourceId(id); setLoadedSource(undefined); setManual(false) }} />
    {source && <section className="cm-personal-detail" key={source.id} style={{ maxWidth: 900, marginTop: 20 }}><div className="cm-personal-detail-top"><h2>采集来源</h2><button className="cm-p-link" type="button" onClick={() => setSourceId(null)}>关闭来源</button></div><SourceEvidence appName={source.app_name} connected={connected} onSource={setLoadedSource} evidence={{ source_id: source.id, app_id: source.app_id, group: '', sender: '', message_time: '', quote: '' }} />
      <div className="cm-personal-actions" style={{ marginTop: 16 }}><button type="button" className="cm-p-button" disabled={busy || !connected || !loadedSource} onClick={() => setManual(value => !value)}>{manual ? '收起待办草稿' : '手动整理为待办'}</button><button type="button" className="cm-p-button" disabled={busy || !connected || !config.ocr_ai_enabled} onClick={() => void mutate('activity.analyze', { source_id: source.id }, '该来源的待办抽取已完成，请到待整理中核对。')}>抽取待办</button></div>
      {!loadedSource && <p className="cm-personal-fieldnote">先点击“查看原始截图与 OCR”核对，再手动整理。</p>}
      {!config.ocr_ai_enabled && <p className="cm-personal-fieldnote">自动抽取需要先在隐私设置中允许模型处理 OCR 文本。手动整理不调用模型。</p>}
      {manual && loadedSource && <TaskEditor key={source.id} item={{ id: source.id, revision: snapshot!.revision, created_at: source.captured_at, title: '', owner: '', due_at: null, feedback_to: '', feedback_required: true, evidence: { source_id: source.id, app_id: source.app_id, group: '', sender: '', message_time: '', quote: loadedSource.ocr_text.slice(0, 2000) }, status: 'pending' }} busy={busy || !connected} onSave={async (task, revision) => { const saved = await mutate('todo.create', { source_id: source.id, expected_revision: revision, task }, '手动整理的待办已保存。'); if (saved) setManual(false); return saved }} />}
      </section>}
  </>
}

function ImportScreenshot({ busy, onImport }: { busy: boolean; onImport: (image: string) => Promise<boolean> }) {
  const reader = useRef<FileReader | null>(null), alive = useRef(true)
  const [reading, setReading] = useState(false), [error, setError] = useState('')
  useEffect(() => { alive.current = true; return () => { alive.current = false; reader.current?.abort() } }, [])
  return <section className="cm-personal-config-section"><h2>主动导入截图</h2>
    <p className="cm-personal-fieldnote">适用于 Wayland、无法后台采集的环境，或只想整理一张截图。选择不超过 6 MB 的 PNG，在本机 OCR；不会自动发送模型。来源标为用户导入，应用、群和消息时间均需人工核对。</p>
    <label className="cm-personal-fieldnote" style={{ display: 'block', marginTop: 12 }}>选择 PNG 并在本机识别<input style={{ display: 'block', maxWidth: '100%', marginTop: 8 }} aria-label="主动导入 PNG 截图" type="file" accept="image/png,.png" disabled={busy || reading} onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''
      if (!file) return
      setError('')
      if (!file.size || file.size > 6 * 1024 * 1024 || file.type && file.type !== 'image/png') { setError('请选择非空且不超过 6 MB 的 PNG 截图。'); return }
      reader.current?.abort(); const next = new FileReader(); reader.current = next; setReading(true)
      const done = () => { if (alive.current && reader.current === next) setReading(false) }
      next.onerror = () => { if (alive.current) setError('无法读取所选截图。'); done() }
      next.onabort = done
      next.onload = async () => {
        if (!alive.current || reader.current !== next) return
        try {
          if (typeof next.result !== 'string' || !next.result.startsWith('data:image/png;base64,')) throw new Error('PNG 数据无效')
          await onImport(next.result.slice(next.result.indexOf(',') + 1))
        } catch { if (alive.current) setError('截图导入未确认，请核对后台连接和本地 OCR。') }
        finally { done() }
      }
      next.readAsDataURL(file)
    }} /></label>{reading && <p role="status">正在等待本地 OCR…</p>}{error && <p role="alert">{error}</p>}
  </section>
}

function ActivityConfigEditor({ config, revision, busy, onSave, platform = 'darwin', autoSupported = true }: { platform?: string; autoSupported?: boolean; config: ActivityConfig; revision: number; busy: boolean; onSave: (patch: Partial<ActivityConfig>) => Promise<void> }) {
  const initialRevision = useRef(revision)
  const [apps, setApps] = useState(config.allowed_apps.join('\n')), [interval, setIntervalValue] = useState(config.interval_ms / 1000), [days, setDays] = useState(config.retention_days), [storage, setStorage] = useState(config.max_storage_mb), [ai, setAi] = useState(config.ocr_ai_enabled)
  const [language, setLanguage] = useState(config.ocr_language || 'zh-Hans')
  const [error, setError] = useState('')
  const [runningApps, setRunningApps] = useState<ActivityApp[] | null>(null), [loadingApps, setLoadingApps] = useState(false), [appsError, setAppsError] = useState('')
  const appsRequest = useRef<AbortController | null>(null)
  useEffect(() => () => appsRequest.current?.abort(), [])
  const selectedApps = [...new Set(apps.split(/[\n,]/).map(app => app.trim()).filter(Boolean))]
  const choices = [...(runningApps || []), ...selectedApps.filter(app => !runningApps?.some(choice => choice.app_id === app)).map(app_id => ({ app_id, app_name: app_id }))]
  async function loadApps() {
    appsRequest.current?.abort(); const controller = new AbortController(); appsRequest.current = controller
    setLoadingApps(true); setAppsError('')
    try { const reply = await requestActivity('activity.apps', {}, controller.signal); if (!controller.signal.aborted) setRunningApps(reply.apps || []) }
    catch (e) { if (!controller.signal.aborted) setAppsError((e as Error).message) }
    finally { if (!controller.signal.aborted) setLoadingApps(false) }
  }
  return <form onSubmit={event => {
    event.preventDefault(); setError('')
    if (revision !== initialRevision.current) { setError('设置已变化，请收起并重新打开设置后核对。'); return }
    const allowed = [...new Set(apps.split(/[\n,]/).map(app => app.trim()).filter(Boolean))]
    if (allowed.length > 20 || allowed.some(app => !/^[A-Za-z0-9][A-Za-z0-9.-]{2,199}$/.test(app) || /^(?:win|linux)\./.test(app) && !/^(?:win|linux)\.[a-f0-9]{64}$/.test(app))) { setError('请填写有效应用标识，每行一个，最多 20 个；Windows / Linux 标识应从应用列表选择。'); return }
    void onSave({ allowed_apps: allowed, interval_ms: interval * 1000, retention_days: days, max_storage_mb: storage, ocr_ai_enabled: ai, ocr_language: language })
  }}><div className="cm-personal-form"><section className="cm-personal-wide cm-personal-app-picker" aria-label="选择记录应用"><div className="cm-personal-section-title"><h2>允许记录的应用</h2><span className="cm-personal-count">已选择 {selectedApps.length} / 20 个</span></div><p className="cm-personal-fieldnote">点击后读取本机正在运行的应用名称；勾选只修改草稿，保存后仍需单独开启采集。</p><button type="button" className="cm-p-button" disabled={busy || loadingApps || !autoSupported} onClick={() => void loadApps()}>{loadingApps ? '读取应用列表…' : '选择正在运行的应用'}</button>
      {choices.length > 0 && <div className="cm-personal-app-choices">{choices.map(app => <label key={app.app_id} className="cm-personal-check"><input type="checkbox" checked={selectedApps.includes(app.app_id)} disabled={busy || selectedApps.length >= 20 && !selectedApps.includes(app.app_id)} onChange={event => { setApps(event.target.checked ? [...new Set([...selectedApps, app.app_id])].join('\n') : selectedApps.filter(id => id !== app.app_id).join('\n')) }} /><span>{app.app_name}{!runningApps?.some(choice => choice.app_id === app.app_id) && <span className="cm-personal-fieldnote"> · 已选择，当前列表未发现</span>}</span></label>)}</div>}
      {runningApps?.length === 0 && <p className="cm-personal-fieldnote">当前没有可选择的应用。请先打开目标聊天应用再刷新列表；已有选择保留。</p>}{appsError && <p role="alert" className="cm-personal-fieldnote">{appsError} 已有选择和草稿保留；可使用高级设置填写应用标识。</p>}
      <details className="cm-personal-advanced"><summary>高级设置：手动填写应用标识</summary><label>{platform === 'darwin' ? '应用 bundle ID（每行一个）' : '应用身份摘要（请从上方应用列表选择）'}<textarea value={apps} onChange={e => setApps(e.target.value)} placeholder={platform === 'darwin' ? 'com.tencent.xinWeChat\ncom.alibaba.DingTalkMac' : '通过应用选择器生成 win. 或 linux. 标识'} disabled={busy} /></label></details></section><p className="cm-personal-fieldnote cm-personal-wide">只支持前台应用当前可见窗口；密码管理器和系统敏感界面始终排除。不会打开、切换或滚动聊天。</p><label>检查间隔（秒）<input type="number" min={5} max={600} step={1} value={interval} onChange={e => setIntervalValue(Number(e.target.value))} disabled={busy} required /></label><label>保留天数<input type="number" min={1} max={90} step={1} value={days} onChange={e => setDays(Number(e.target.value))} disabled={busy} required /></label><label>存储上限（MB）<input type="number" min={16} max={10240} step={1} value={storage} onChange={e => setStorage(Number(e.target.value))} disabled={busy} required /></label>
    <label>本地 OCR 语言<select value={language} onChange={e => setLanguage(e.target.value as typeof language)} disabled={busy}><option value="zh-Hans">简体中文</option><option value="zh-Hant">繁体中文</option><option value="en-US">英语</option></select></label><p className="cm-personal-fieldnote">需安装相应系统 OCR / Tesseract 语言包；不会自动下载。Windows、Linux 应用标识由实际进程映像生成。</p>
    <label className="cm-personal-check cm-personal-wide"><input type="checkbox" checked={ai} onChange={e => setAi(e.target.checked)} disabled={busy} />允许将截图识别出的 OCR 文本发送给当前配置的模型，用于理解聊天并提出待办候选。聊天内容可能包含个人或企业信息。</label><p className="cm-personal-fieldnote cm-personal-wide">截图保存在本机；模型是否在本机取决于你的模型配置。关闭此项后不发送 OCR 文本。保存范围后仍需单独开启采集；需要系统权限的操作须由你在系统中单独授权。</p></div>{error && <p role="alert">{error}</p>}<div className="cm-personal-save"><button type="submit" className="cm-p-button cm-p-primary" disabled={busy}>保存范围与隐私设置</button></div></form>
}

function MaterialsPanel({ openResource }: { openResource: (panel: ContextPanelId) => void }) {
  const groups: Array<{ title: string; description: string; ids: ContextPanelId[] }> = [
    { title: '工作材料', description: '查找知识、会议记录和浏览器页面。已有导入、图谱和会议流程仍在原面板中。', ids: ['knowledge', 'meeting', 'tabs'] },
    { title: '对话执行记录', description: '查看当前对话的历史与 Agent 任务板；这里的执行事实与个人待办分开保留。', ids: ['history', 'board'] },
    { title: '技能与场景', description: '选择本次对话的能力，继续管理已安装的技能、场景与专家。', ids: ['skills', 'packs'] },
    { title: '连接与应用', description: '打开现有 MCP 与应用管理，核对连接和授权；菜单整理不改变原有权限。', ids: ['mcp', 'apps'] },
  ]
  return <div className="cm-personal-materials">{groups.map(group => <section key={group.title} className="cm-personal-material"><h2>{group.title}</h2><p>{group.description}</p><div className="cm-personal-actions">{group.ids.map(id => { const tab = CONTEXT_PANEL_TABS.find(item => item.id === id)!; return <button type="button" className="cm-p-button" key={id} onClick={() => openResource(id)}><tab.Icon size={15} />{id === 'board' ? 'Agent 执行记录' : tab.label}</button> })}</div></section>)}</div>
}
