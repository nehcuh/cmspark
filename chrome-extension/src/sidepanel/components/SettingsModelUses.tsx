import { useEffect, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { modelEndpointLabel, type SettingsDestinationId } from "../utils/settings-navigation"
import { requestModelCenter, type ModelCenterState } from "../utils/model-center"
import { useMeetingAsrState } from "./MeetingExternalAsrSettings"
import { SettingsNavRow } from "./SettingsPage"
import { useActivity } from "./personal-workspace/useActivity"
import { resolveNativeVision } from "./vision-reuse-logic"

export function SettingsModelUses({ active, onOpen }: { active: boolean; onOpen: (id: SettingsDestinationId) => void }) {
  const { state } = useAgentStore()
  const connected = state.connectionState === "connected"
  const { snapshot, snapshotCurrent } = useActivity(active && connected, state.codingHistoryConnectionRevision)
  const activity = snapshotCurrent ? snapshot : null
  const { snapshot: meetingAsr } = useMeetingAsrState(active && connected)
  const [modelCenter, setModelCenter] = useState<ModelCenterState | null>(null)
  useEffect(() => {
    if (!active || !connected) return
    const controller = new AbortController()
    setModelCenter(null)
    void requestModelCenter(controller.signal).then(next => {
      if (!controller.signal.aborted) setModelCenter(next)
    }).catch(() => {})
    return () => controller.abort()
  }, [active, connected, state.configRevision])
  const config = state.config
  const main = config.model_name && (config.api_key_set || state.companionConfig?.api_key_set || config.api_key)
    ? [config.model_name, modelEndpointLabel(config.base_url)].filter(Boolean).join(" · ")
    : "未配置模型"
  const nativeVision = resolveNativeVision({ modelName: config.model_name, baseUrl: config.base_url, mode: config.native_vision })
  const vision = config.vision_enabled && config.vision_model_name
    ? [config.vision_model_name, modelEndpointLabel(config.vision_base_url)].filter(Boolean).join(" · ")
    : undefined
  const attachmentVision = nativeVision ? main : config.file_upload_vision !== false ? vision : undefined
  const screenshotVision = nativeVision ? main : vision
  const chatVision = attachmentVision === screenshotVision
    ? attachmentVision ?? "未启用视觉服务"
    : `附图 · ${attachmentVision ?? "未启用"} / 截图 · ${screenshotVision ?? "未启用"}`
  const voice = state.voiceModel
  const external = voice?.external
  const engine = voice?.sttEngine === "local" ? `本机 Whisper · ${voice.localModelId}`
    : voice?.sttEngine === "system" ? "Windows 系统语音识别"
    : voice?.sttEngine === "external" ? [
      "外部转写",
      external?.style === "deepseek" ? "DeepSeek" : external?.model,
      modelEndpointLabel(external?.normalizedUrl || external?.baseUrl),
    ].filter(Boolean).join(" · ")
    : voice ? "浏览器语音识别" : "等待引擎状态"
  const voiceData = voice?.sttEngine === "local" || voice?.sttEngine === "system"
    ? "音频在本机识别，回退时按浏览器识别的确认流程处理。"
    : voice?.sttEngine === "external" ? "录音按听写确认发送到已选转写服务。"
    : "浏览器语音识别可能由浏览器厂商处理录音。"
  const activityTarget = activity?.config.extraction_mode === "ocr" || (activity && !activity.config.extraction_mode)
    ? activity.config.ocr_ai_enabled ? `OCR → ${main}` : "本机 OCR"
    : activity?.runtime.model_target?.replace(/ · (openai|anthropic)$/, "")
  const currentBindings = connected && modelCenter?.config_revision === state.configRevision ? modelCenter.model_center : null
  const minutesId = currentBindings?.meeting_minutes_profile_id
  const minutesProfile = currentBindings?.profiles.find(profile => profile.id === minutesId)
  const minutes = !currentBindings ? "等待配置状态" : !minutesId ? `继承对话模型 · ${main}`
    : minutesProfile?.has_key ? [minutesProfile.name, minutesProfile.model_name, modelEndpointLabel(minutesProfile.base_url)].filter(Boolean).join(" · ")
    : "独立纪要模型未就绪"
  const visualId = currentBindings?.meeting_visual_profile_id
  const visual = visualId === "configured_vision" ? currentBindings?.configured_vision : currentBindings?.profiles.find(profile => profile.id === visualId)
  const meetingEngine = connected && meetingAsr?.mode === "external"
    ? [meetingAsr.ready ? "导入用外部转写" : "外部转写未就绪", meetingAsr.model, modelEndpointLabel(meetingAsr.normalizedUrl)].filter(Boolean).join(" · ")
    : connected && meetingAsr ? "本机转写" : "录制音频在本机转写"
  const local = state.computerModel
  const rows: { id: SettingsDestinationId; title: string; current?: string; description: string }[] = [
    { id: "model-chat", title: "对话模型", current: main, description: "日常对话优先选响应快、工具调用稳定的文本模型。处理对话、附件内容和所需工具结果。" },
    { id: "model-vision", title: "看图与截图", current: chatVision, description: "选支持图片输入的模型。启用时将附图或截图发送给对应服务。" },
    { id: "input-asr-refiner", title: "听写纠错", current: state.asrRefinerEnabled ? `继承对话模型 · ${main}` : "已关闭", description: "启用后，按听写的确认流程发送转写文本。" },
    { id: "input-dictation-engine", title: "聊天听写", current: engine, description: voiceData },
    { id: "model-meeting-transcribe", title: "会议转写", current: meetingEngine, description: "导入音频可选择外部转写，提交前核对本次音频和目标。" },
    { id: "model-meeting-visual", title: "会议画面理解", current: !currentBindings ? "等待配置状态" : visual?.model_name ?? (visualId ? "所选服务未就绪" : "已关闭"), description: "确认后，向所选模型发送截图和相邻转写。" },
    { id: "model-meeting-minutes", title: "会议纪要", current: minutes, description: "长会议适合能稳定处理长文本并按模板输出的模型。确认后发送逐字稿、模板和所选参考笔记。" },
    { id: "model-activity", title: "活动提取", current: activityTarget ?? "打开活动记录核对目标", description: "取决于活动设置，可使用本机 OCR、文本模型或视觉模型。" },
    { id: "model-local", title: "本机模型", current: local ? `Qwen3-VL ${local.variant} · ${local.modelEnabled ? "已启用" : "未启用"}` : "等待本机状态", description: "本机处理视觉定位。下载、许可和启用分别操作。" },
    { id: "model-background", title: "后台任务", current: `继承对话模型 · ${main}`, description: "摘要与标签适合低延迟、结构化输出稳定的模型，处理相应会话文本。" },
    { id: "model-profiles", title: "文本模型配置", description: "保存文本模型连接为命名配置，供会议等用途引用。" },
  ]
  return <div className="cm-settings-nav-list">
    {rows.map(({ id, title, current, description }) => <SettingsNavRow key={id} title={title} current={current}
      description={description} destination={id} onClick={() => onOpen(id)} />)}
  </div>
}
