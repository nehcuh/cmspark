/** Pure Settings copy + Save-guard helpers for llm.context_window (B0 / #268). */

const TINY = 16000
const FLOOR = 128000
const HUGE = 1_000_000

export function contextWindowHelpText(disk: number): string {
  const n = Number.isFinite(disk) ? disk : NaN
  if (!Number.isFinite(n) || n <= 0 || n < TINY) {
    const shown = Number.isFinite(n) ? String(n) : String(disk)
    return `当前 ${shown} 过小，本轮按 ${FLOOR} 生效，未改配置文件`
  }
  if (n >= HUGE) {
    return `当前 ${n} 极大，自动压缩几乎不触发`
  }
  return "新默认 512000 是 Agent 工作预算；请按模型真实上限填写。填太大则压缩来不及挡供应商 400。"
}

export function settingsSaveDisabled(hydratedFromCompanion: boolean): boolean {
  return !hydratedFromCompanion
}

export function settingsSaveDisabledTitle(hydratedFromCompanion: boolean): string | undefined {
  return hydratedFromCompanion ? undefined : "等待 Companion 配置同步后再保存"
}
