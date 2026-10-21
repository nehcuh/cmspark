/** Closed semantic settings catalog. Model output never names arbitrary config keys. */
export type SettingValue = boolean | number | string
export type SettingsSection = "voice" | "export" | "integrations" | "security" | "model"
export interface CatalogEntry {
  id: string
  label: string
  description: string
  scope: "companion" | "manual"
  section: SettingsSection
  destination?: "activity" | "todos"
  values?: readonly SettingValue[]
  min?: number
  max?: number
  prerequisites: readonly string[]
  read: (config: any) => SettingValue
  patch?: (value: SettingValue) => Record<string, unknown>
}
const manual = (id: string, label: string, description: string, section: SettingsSection, values: readonly SettingValue[], prerequisites: string[]): CatalogEntry => ({
  id, label, description, section, values, prerequisites, scope: "manual", read: () => "需在对应设置核对",
})
export const SETTINGS_CATALOG: readonly CatalogEntry[] = [
  { id: "history.retentionDays", label: "对话历史保留天数", description: "缩短保存期限，减少历史占用；到期清理后无法通过恢复设置找回历史。", scope: "companion", section: "export", min: 1, max: 3650,
    prerequisites: ["缩短期限可能使旧历史在清理时被删除，请先导出需要保留的内容。"], read: c => c.history_retention_days ?? 30, patch: value => ({ history_retention_days: value }) },
  { id: "logs.retentionDays", label: "运行日志保留天数", description: "减少本机日志保留，过短会限制故障排查。", scope: "companion", section: "integrations", min: 1, max: 365,
    prerequisites: ["到期日志清理不可撤销。"], read: c => c.log_retention_days ?? 14, patch: value => ({ log_retention_days: value }) },
  { id: "coding.autoSuggest", label: "编程助手建议", description: "是否主动建议使用编程助手；关闭可减少建议，不改变执行权限。", scope: "companion", section: "integrations", values: [true, false],
    prerequisites: [], read: c => c.coding_handoff?.auto_suggest ?? true, patch: value => ({ coding_handoff: { auto_suggest: value } }) },
  { id: "history.fullToolHistory", label: "保存完整工具历史", description: "只允许建议关闭完整工具历史归档，减少额外持久化。", scope: "companion", section: "export", values: [false],
    prerequisites: ["关闭只影响之后的归档；已有数据需要在原管理入口清理。"], read: c => c.persist_full_tool_history ?? false, patch: value => ({ persist_full_tool_history: value }) },
  { id: "history.backgroundDigest", label: "后台对话摘要", description: "只允许建议关闭后台摘要，减少后台模型调用。", scope: "companion", section: "export", values: [false],
    prerequisites: ["关闭后不再自动补充后台摘要，现有摘要不删除。"], read: c => c.thread_digest?.enabled ?? false, patch: value => ({ thread_digest: { enabled: value } }) },
  manual("voice.asrCorrection", "听写后纠错", "语音错字或标点不准确时，建议在输入与语音检查 ASR 纠错。纠错可能将转写文本发送到已配置模型，并增加处理时间。", "voice", [true, false], ["此项是浏览器偏好，需在原设置入口检查当前值并确认保存；模型纠错涉及转写文本。"]),
  manual("voice.dictationMode", "听写方式", "长段口述可尝试连续听写；短句可用经典短听，不能保证提高识别准确度。", "voice", ["continuous", "classic"], ["在输入与语音核对偏好；连续听写仍受麦克风和识别能力限制。"]),
  manual("voice.engine", "语音识别引擎", "希望本机处理时检查本机识别；希望实时字级出字时检查浏览器识别。浏览器识别可能使用其服务。", "voice", ["local", "browser"], ["本机识别需要单独下载模型、检查许可并显式启用；不可自动回退为云端。"]),
  manual("voice.hotkey", "按住说话热键", "不想频繁点麦克风时检查按住说话热键；误触时可关闭。", "voice", [true, false], ["在输入与语音核对热键，避免与系统快捷键冲突。"]),
  { ...manual("activity.privacy", "聊天记录与隐私", "仅记录指定应用；暂停采集、缩小应用范围或确认 OCR 文本发送范围。不能把本机截图等同于文本不外发。", "security", ["review", "pause", "localOnly"], ["采集需要独立选择应用与屏幕权限；模型或记录策略的变更需在活动记录入口确认。"]), destination: "activity" },
  { ...manual("tasks.reminders", "待办提醒策略", "减少打扰同时避免漏项：核对单条事项的提醒时间、截止时间及反馈要求；不能假设未实现的汇总或免打扰例外存在。", "integrations", ["review"], ["请到待办面板逐项确认提醒；系统通知权限、免打扰和本机后台服务会影响送达。"]), destination: "todos" },
  manual("security.permissions", "安全与信任", "执行权限或确认频率的调整必须走原安全设置确认流程。", "security", ["review"], ["授权、安装、配对、凭据和危险权限不通过语义候选自动修改。"]),
]
export function validSettingValue(entry: CatalogEntry, value: unknown): value is SettingValue {
  if (entry.values) return entry.values.some(v => v === value)
  return typeof value === "number" && Number.isInteger(value) && value >= entry.min! && value <= entry.max!
}
export function readSettingValue(entry: CatalogEntry, config: unknown): SettingValue {
  const value = entry.read(config)
  if (entry.scope === "manual") return "需在对应设置核对"
  if (entry.min !== undefined ? typeof value === "number" && Number.isFinite(value) : typeof value === "boolean") return value
  throw new Error("INVALID_CURRENT_SETTING")
}
