export type ModelProfile = { id: string; name: string; model_name: string; base_url: string; has_key: boolean }
export type ModelCenterView = {
  profiles: ModelProfile[]
  chat_profile_id: string | null
  meeting_visual_profile_id?: string | null
  configured_vision?: { model_name: string; base_url: string } | null
  meeting_minutes_profile_id: string | null
}
export type ModelCenterState = {
  type: "model.center.state"
  id: string
  config_revision: string
  model_center: ModelCenterView
}
export type ModelCenterAction =
  | { kind: "save_current"; name: string }
  | { kind: "create"; name: string; provider: { protocol: "openai" | "anthropic"; base_url: string; model_name: string; api_key?: string } }
  | { kind: "rename"; profile_id: string; name: string }
  | { kind: "remove"; profile_id: string }
  | { kind: "bind"; scope: "chat" | "meeting_minutes" | "meeting_visual"; profile_id: string | null }

const errors: Record<string, string> = {
  CONFIG_REVISION_CONFLICT: "其他页面已修改配置。请刷新后重新核对。",
  MODEL_PROFILE_NAME_IN_USE: "已存在同名配置，请另取名字。",
  MODEL_PROFILE_IN_USE: "该配置仍在使用。先更换对应场景的模型。",
  MODEL_PROFILE_NOT_FOUND: "该配置已不存在。请刷新列表。",
  MODEL_NOT_CONFIGURED: "请输入可用的模型名称与服务密钥。",
  MODEL_ENDPOINT_INVALID: "服务地址不符合模型连接要求。",
}

export function requestModelCenter(signal: AbortSignal, save?: { action: ModelCenterAction; config_revision: string }): Promise<ModelCenterState> {
  return new Promise((resolve, reject) => {
    const id = "model-center-" + crypto.randomUUID()
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      clearTimeout(timer)
      chrome.runtime.onMessage.removeListener(receive)
      signal.removeEventListener("abort", cancel)
    }
    const fail = (detail: string) => { cleanup(); reject(new Error(detail)) }
    const cancel = () => fail("已取消等待，请核对当前配置。")
    const receive = (reply: any) => {
      if (reply?.id !== id) return
      if (reply.type === "model.center.state" && typeof reply.config_revision === "string" && Array.isArray(reply.model_center?.profiles)) {
        cleanup()
        resolve(reply as ModelCenterState)
      } else if (reply.type === "error") {
        fail(errors[reply.error] || "模型配置操作失败，请检查输入或刷新后重试。")
      }
    }
    if (signal.aborted) { cancel(); return }
    chrome.runtime.onMessage.addListener(receive)
    signal.addEventListener("abort", cancel, { once: true })
    timer = setTimeout(() => fail(save ? "保存结果未确认，请刷新核对。" : "未收到模型配置，请重试。"), 15_000)
    try {
      chrome.runtime.sendMessage(save ? { type: "model.center.save", id, ...save } : { type: "model.center.get", id }).then(reply => {
        if (reply?.ok === false) fail(reply.error || "未发送，请检查 Companion 连接。")
      }, () => fail("连接中断，请核对当前配置。"))
    } catch { fail("连接不可用。") }
  })
}
