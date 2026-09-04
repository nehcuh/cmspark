/** #285: browser-picker cap (base64 WS) vs companion native picker (parseFile). */
export const KNOWLEDGE_UI_FILE_CAP_MB = 6
export const KNOWLEDGE_NATIVE_FILE_CAP_MB = 10

export function knowledgeImportOversizedCopy(oversizedNames: string[], keptCount: number): string | null {
  if (oversizedNames.length === 0) return null
  const n = oversizedNames.length
  const sample = oversizedNames.slice(0, 2).join("、")
  const names = n > 2 ? `${sample}…` : sample
  if (keptCount === 0) {
    return (
      `未导入：${n} 个文件超过 ${KNOWLEDGE_UI_FILE_CAP_MB}MB（${names}）。` +
      `浏览器「导入文件」上限 ${KNOWLEDGE_UI_FILE_CAP_MB}MB；${KNOWLEDGE_NATIVE_FILE_CAP_MB}MB 以内请改用「导入大文件」（Companion 原生选择，不经浏览器）。`
    )
  }
  return (
    `跳过 ${n} 个超过 ${KNOWLEDGE_UI_FILE_CAP_MB}MB（${names}）。` +
    `${KNOWLEDGE_NATIVE_FILE_CAP_MB}MB 以内可用「导入大文件」。`
  )
}

export function knowledgeImportSelectionCopy(keptCount: number, oversizedNames: string[]): string {
  const over = knowledgeImportOversizedCopy(oversizedNames, keptCount)
  if (keptCount === 0) return over || "没有可导入的文件"
  const head = `已选 ${keptCount} 个文件，请确认第一篇（其余请再次导入）`
  return over ? `${head} · ${over}` : head
}
