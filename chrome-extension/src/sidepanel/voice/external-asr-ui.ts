export type ExternalLimitNote = "deepseek-docs" | "openai-file-cap" | "unprobed-local-default"
export type ExternalCapReason = "duration" | "bytes"

const LIMIT_COPY: Record<ExternalLimitNote, string> = {
  "deepseek-docs": "DeepSeek 官方上限是 120 秒和 8 MiB。到点后转写已录的这一段。",
  "openai-file-cap": "OpenAI 文档写的是文件最大 25 MB，没有写统一时长。这不是对账号的探测。",
  "unprobed-local-default": "这是本机停止线，不是探测到的服务商上限。32 MiB 是本程序能留下的最大一段，不是对方的无限容量。",
}

export function externalLimitCopy(note: ExternalLimitNote): string {
  return LIMIT_COPY[note]
}

export function externalPrivacyCopy(): string {
  return "停止录音后，这段聊天音频会发到你填写的转写地址。cmspark 不保留音频。密钥只保存在这台电脑的 Companion 配置文件里，权限与现有聊天密钥相同，不是系统钥匙串。"
}

export function externalKeySaveCopy(): string {
  return "保存不会连接服务器，也不能证明该地址支持转写。"
}

export function externalRefineCopy(): string {
  return "打开后，转写文字还会发给聊天模型。音频不会因此再发一次。"
}

export function externalCancelCopy(sent: boolean): string {
  return sent ? "已停止等待。音频可能已经到达你填写的服务器。" : "已取消，没有发送音频。"
}

export function externalCapCopy(reason: ExternalCapReason): string {
  return reason === "bytes"
    ? "已到文件大小上限。正在转写已录的这一段。"
    : "已到录音时长上限。正在转写已录的这一段。"
}

export function externalLanguageTag(lang: string): string {
  const primary = lang.trim().toLowerCase().split("-")[0] ?? ""
  return primary || "zh"
}

export function externalShouldRefine(enabled: boolean, text: string): boolean {
  return enabled === true && text.trim() !== ""
}

export function externalRecordCap(
  maxDurationMs: number | null | undefined,
  maxBytes: number | undefined,
): { ms: number; reason: ExternalCapReason } {
  const bytes = typeof maxBytes === "number" && maxBytes > 44 ? maxBytes : 8_388_608
  const fromBytes = Math.max(1_000, Math.floor((bytes - 44) / 32))
  if (typeof maxDurationMs === "number" && maxDurationMs > 0 && maxDurationMs <= fromBytes) {
    return { ms: maxDurationMs, reason: "duration" }
  }
  return { ms: fromBytes, reason: "bytes" }
}
