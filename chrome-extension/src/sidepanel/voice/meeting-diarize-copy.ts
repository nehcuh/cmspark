/** Side Panel / tests: echo auto-selected K after meeting.diarized. */

export function formatMeetingDiarizeStatus(
  method: string | undefined | null,
  k?: number | null,
): string {
  const kPart =
    typeof k === "number" && Number.isFinite(k) && k >= 1 ? ` · K=${Math.floor(k)}` : ""
  if (method === "embedding") {
    return `已自动标匿名发言人（声纹 · 本机 · 非身份识别）${kPart}`
  }
  if (method === "text_gap") {
    return `已弱标说话人（按行交替 · 非声学）${kPart}`
  }
  return `已自动标匿名发言人（实验 · 非身份识别）${kPart}`
}

/**
 * #260 硬约束：模型未就绪必须显式引导下载，绝不静默落回旧引擎。
 * 标签只说「发言人N」——禁止任何「识别出是谁」的暗示。
 */
export function mapMeetingDiarizeError(code: string, message?: string): string {
  if (code === "embedding_model_required") {
    return "说话人分离模型未就绪：请到 设置 → 听写方式 下载「说话人分离模型」后重试（不会静默落回旧引擎）"
  }
  if (code === "diarize_runtime_unavailable") {
    return "本机推理组件不可用（onnxruntime 缺失）：请更新 Companion 后重试"
  }
  if (code === "timeout") {
    return "说话人分离超时，请重试"
  }
  if (code === "no_segments") {
    return "无音频段，无法做声纹分离"
  }
  if (message) {
    return `说话人分离失败（${code}）：${message}`
  }
  return `说话人分离失败：${code}`
}
