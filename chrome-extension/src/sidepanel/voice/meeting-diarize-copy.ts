/** Side Panel / tests: echo auto-selected K after meeting.diarized. */

export function formatMeetingDiarizeStatus(
  method: string | undefined | null,
  k?: number | null,
): string {
  const kPart =
    typeof k === "number" && Number.isFinite(k) && k >= 1 ? ` · K=${Math.floor(k)}` : ""
  if (method === "text_gap") {
    return `已弱标说话人（按行交替 · 非声学）${kPart}`
  }
  return `已自动标匿名发言人（实验 · 非身份识别）${kPart}`
}
