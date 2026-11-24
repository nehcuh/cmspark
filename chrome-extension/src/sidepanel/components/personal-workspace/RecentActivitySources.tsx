import { formatTaskTime, type ActivityRecognition, type ActivitySnapshot } from './activity-request'

export function recognitionLabel(receipt?: ActivityRecognition): string {
  if (!receipt) return '历史来源 · 识别结果未记录'
  switch (receipt.status) {
    case 'saved': return '已保存 · ' + receipt.reason
    case 'queued': return '等待识别'
    case 'running': return '正在识别'
    case 'failed': return formatTaskTime(receipt.completed_at) + ' 识别失败 · ' + receipt.reason
    case 'complete': return formatTaskTime(receipt.completed_at) + ' 已识别 · ' + receipt.candidates + ' 项行动'
  }
}

interface Props {
  sources: ActivitySnapshot['sources']
  onSelect: (id: string) => void
  localRetryOnly?: boolean
  onAnalyze?: (id: string) => void
  visibleCount?: number
  onMore?: () => void
}

export function RecentActivitySources({ sources, onSelect, onAnalyze, localRetryOnly, visibleCount = 30, onMore }: Props) {
  return <details className="cm-personal-sources" open>
    <summary>最近的采集来源（{sources.length} 张）</summary>
    <ul>{sources.slice(0, visibleCount).map(item => <li key={item.id} className="cm-personal-source-entry">
      <span>{item.app_name || item.app_id}<br />
        <span className="cm-personal-fieldnote">{formatTaskTime(item.captured_at)} · {item.conversation_title || item.window_title || '窗口无标题'}</span><br />
        <span className="cm-personal-fieldnote">{recognitionLabel(item.recognition)}</span>
      </span>
      <button type="button" className="cm-p-link" data-source-id={item.id} onClick={() => onSelect(item.id)}>查看截图</button>
      {onAnalyze && (!localRetryOnly || item.recognition?.status === 'failed') && item.recognition?.status !== 'queued' && item.recognition?.status !== 'running' &&
        <button type="button" className="cm-p-link" onClick={() => onAnalyze(item.id)}>{item.recognition?.status === 'failed' ? '重试识别' : '抽取待办'}</button>}
    </li>)}</ul>
    {sources.length > visibleCount && onMore && <button type="button" className="cm-p-link" onClick={onMore}>显示更多来源</button>}
    {!sources.length && <p className="cm-personal-fieldnote">暂无来源。开启采集后，符合范围的窗口画面会显示在这里。</p>}
  </details>
}
