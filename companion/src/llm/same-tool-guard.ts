/**
 * Same-tool recoverable failures stop a turn so a model cannot spin forever.
 * A missed click (the text is not a visible control) is not that spin: the
 * goal is still open, so the first time the budget is spent we tell the model
 * to switch method instead of ending the turn.
 */

export const LOCATOR_MISS_CODES = new Set([
  "ELEMENT_NOT_FOUND",
  "ELEMENT_AMBIGUOUS",
  "SELECTOR_OR_TEXT_REQUIRED",
  "INVALID_SELECTOR",
])

export const LOCATOR_PIVOT_INSTRUCTION =
  "不要再点击这句文字。页面上没有对应的可见元素。请改用其它办法完成目标：先 get_page_text 阅读当前页面；若目标在下方就 scroll 后再按页面上真实的链接点击；若这句是要查证的标题而不是按钮，用搜索或 navigate 打开来源。"

export function isLocatorMiss(errorCode?: string, errorText?: string): boolean {
  if (errorCode && LOCATOR_MISS_CODES.has(errorCode)) return true
  const text = (errorText || "").toLowerCase()
  return (
    text.includes("element_not_found") ||
    text.includes("no visible element matching") ||
    text.includes("element_ambiguous") ||
    text.includes("elements match text")
  )
}

export type SameToolFailureDecision =
  | { action: "count" }
  | { action: "pivot"; instruction: string }
  | { action: "stop" }

export function decideSameToolFailure(input: {
  failCount: number
  threshold: number
  errorCode?: string
  errorText?: string
  alreadyPivoted: boolean
}): SameToolFailureDecision {
  if (input.failCount < input.threshold) return { action: "count" }
  if (!input.alreadyPivoted && isLocatorMiss(input.errorCode, input.errorText)) {
    return { action: "pivot", instruction: LOCATOR_PIVOT_INSTRUCTION }
  }
  return { action: "stop" }
}
