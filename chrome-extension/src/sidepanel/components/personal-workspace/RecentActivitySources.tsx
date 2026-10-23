import { formatTaskTime, type ActivitySnapshot } from './activity-request'

/** Companion stores sources newest first; preserve that order so recent manual capture stays reachable. */
export function RecentActivitySources({ sources, onSelect }: { sources: ActivitySnapshot['sources']; onSelect: (id: string) => void }) {
  return <details className="cm-personal-sources" open><summary>最近的采集来源{sources.length > 30 ? '（最近 30 条）' : ''}</summary><ul>{sources.slice(0, 30).map(item => <li key={item.id} className="cm-personal-source-entry"><span>{item.app_name || item.app_id}<br /><span className="cm-personal-fieldnote">{formatTaskTime(item.captured_at)} · {item.window_title || '窗口无标题'}</span></span><button type="button" className="cm-p-link" data-source-id={item.id} onClick={() => onSelect(item.id)}>核对来源</button></li>)}</ul>{!sources.length && <p className="cm-personal-fieldnote">暂无来源。授权应用位于前台且采集已开启时，才会保存可见内容。</p>}</details>
}
