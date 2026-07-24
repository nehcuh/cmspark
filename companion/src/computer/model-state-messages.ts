// WP5 I1 WI-1.7 — 模型三态文案映射（缺文件/错哈希/断网 及全词表）。
//
// I1 集成验收交付物：把下载门禁全部结构化 reason（model-manifest.ts 的
// ModelGateError.code 与 model-download.ts 的 ModelUnavailableReason）映射为
// 用户可见文案 hook。I3 设置页/通知直接消费本表——reason 词表即协议
// （computer.model.state 的 error 字段），文案只许从本表取，禁止 UI 侧私编。
//
// 三态锚点（plan WI-1.7 验收）：
//   缺文件  model-file-missing  → 「模型未下载或已被删除」+ 去下载
//   错哈希  model-hash-mismatch → 「可能被篡改或损坏，已拒绝加载」+ 删除重下
//   断网    network-error       → 「下载中断，已自动降级」+ 重试
// 共同语义：任何一态都永不阻塞 UIA/OCR/云端定位层（§C.2.4），文案必须明示。

export interface ModelStateMessage {
  /** 设置页状态行/通知标题（短句） */
  title: string
  /** 详情说明（含对其他定位层无影响的明示） */
  detail: string
  /** 建议动作按钮文案；null = 无动作（仅告知） */
  action: string | null
}

export const MODEL_STATE_MESSAGES: Record<string, ModelStateMessage> = {
  // --- 三态锚点 ----------------------------------------------------------------
  "model-file-missing": {
    title: "模型文件缺失",
    detail:
      "TinyClick 模型未下载或已被删除。UIA / OCR / 用户框选定位不受影响；" +
      "在设置页下载模型后可启用本实验层。",
    action: "下载模型",
  },
  "model-hash-mismatch": {
    title: "模型文件校验失败",
    detail:
      "模型文件与登记 sha256 不一致（可能被篡改或损坏），已拒绝加载。" +
      "UIA / OCR / 用户框选定位不受影响；请删除后重新下载。",
    action: "删除并重新下载",
  },
  "network-error": {
    title: "模型下载失败",
    detail:
      "网络错误导致下载中断（断点已保留，重试可续传）。已自动降级，" +
      "UIA / OCR / 云端定位不受影响。",
    action: "重试下载",
  },
  // --- 下载管理器其余原因（与 ModelUnavailableReason 词表对齐） ------------------
  "model-unknown": {
    title: "模型未登记",
    detail: "manifest 中不存在该模型条目（发版内容异常）。其余定位层不受影响。",
    action: null,
  },
  "variant-unknown": {
    title: "模型变体未登记",
    detail: "manifest 中不存在该交付变体（发版内容异常）。其余定位层不受影响。",
    action: null,
  },
  "mirror-scheme-denied": {
    title: "镜像地址被拒绝",
    detail:
      "computer.modelMirror 仅允许 https 主机（file:// / UNC 本地替换面已关闭）。" +
      "请检查设置后重试；其余定位层不受影响。",
    action: "检查镜像设置",
  },
  "disk-budget-exceeded": {
    title: "磁盘预算超限",
    detail:
      "模型根目录占用（全部变体合计）将超过预算（computer.modelDiskBudgetMB，默认 2048MB）。" +
      "可调大预算或删除其他变体后重试；其余定位层不受影响。",
    action: "调整磁盘预算",
  },
  "disk-full": {
    title: "磁盘空间不足",
    detail: "目标卷剩余空间不足以下载模型文件。请释放磁盘空间后重试；其余定位层不受影响。",
    action: null,
  },
  "http-error": {
    title: "模型下载失败",
    detail:
      "模型服务器返回异常状态。若使用镜像，请检查镜像可用性；其余定位层不受影响，可稍后重试。",
    action: "重试下载",
  },
  "size-mismatch": {
    title: "模型文件大小异常",
    detail:
      "下载完成的文件大小与登记不符（分发链异常），已删除并拒绝使用。" +
      "其余定位层不受影响；请重试下载，复现请向项目反馈。",
    action: "重试下载",
  },
  "hash-mismatch": {
    title: "模型文件校验失败",
    detail:
      "下载完成的文件 sha256 与登记不符（分片级篡改或分发链异常），已删除分片并拒绝使用。" +
      "其余定位层不受影响；请重试下载，复现请向项目反馈。",
    action: "重试下载",
  },
  "oversize-stream": {
    title: "模型下载数据异常",
    detail:
      "下载源吐出的字节超过登记大小（分发链异常或镜像不可信），已在传输中途截断并清理。" +
      "其余定位层不受影响；请检查镜像设置后重试，复现请向项目反馈。",
    action: "重试下载",
  },
  // --- manifest 层其余原因（与 ModelGateError.code 词表对齐） ----------------------
  "model-size-mismatch": {
    title: "模型文件大小异常",
    detail: "磁盘上的模型文件大小与登记不符，已拒绝加载。请删除后重新下载；其余定位层不受影响。",
    action: "删除并重新下载",
  },
  "manifest-invalid": {
    title: "模型登记信息损坏",
    detail: "models.manifest.json 未通过 schema 校验（发版内容异常）。其余定位层不受影响。",
    action: null,
  },
  "manifest-source-remote": {
    title: "模型登记来源被拒绝",
    detail:
      "模型 manifest 只接受随发版的本地文件（运行时网络更新 manifest 的通道已关闭）。" +
      "其余定位层不受影响。",
    action: null,
  },
  // --- WP5-I4 WI-4.2 开关族文案 -----------------------------------------------------
  "download-host-unset": {
    title: "模型发布地址未配置",
    detail:
      "模型发布地址尚未配置（发布链 owner 决策中）——当前构建不可下载模型。" +
      "UIA / OCR / 用户框选定位不受影响。",
    action: null,
  },
  "model-variant-missing": {
    title: "当前变体未下载",
    detail:
      "当前配置交付变体的模型文件未下载或不完整。下载当前变体后方可启用实验层；" +
      "UIA / OCR / 用户框选定位不受影响。",
    action: "下载当前变体",
  },
  // --- WP5-I4 WI-4.4 熔断状态文案（runtime 熔断广播 reason=circuit-breaker） ---------
  "circuit-breaker": {
    title: "模型层已熔断停用",
    detail:
      "模型层连续故障达到熔断阈值，已自动停用（无自动恢复）。UIA / OCR / 用户框选定位" +
      "不受影响；排查后可在设置页重置熔断。",
    action: "重置熔断",
  },
}

/** 取 reason 对应文案；未知 reason 给兜底（词表外新码不应让 UI 崩溃）。 */
export function modelStateMessage(reason: string): ModelStateMessage {
  return (
    MODEL_STATE_MESSAGES[reason] ?? {
      title: "模型层不可用",
      detail: `未登记的原因（${reason}）。其余定位层不受影响。`,
      action: null,
    }
  )
}

// --- WI-3.4 三层开关交互文案（设置页单一真源） -------------------------------------
//
// 三层开关语义（依赖方向 ①→②→③，任一层关闭即下层整体不参与）：
//   ① 主开关 computer.use：关闭 → 实验层不参与任何定位（连编排器都不进）。
//   ② 应用层 coordinateAllowed：当前 app 未在允许列表 → 对该 app 不参与。
//   ③ 实验层开关本体：语义 = 定位链 L2 建议层——输出仅作坐标候选，
//      命中仍需人工确认（G4 reL2 门），未校准，可能完全错误。
// 共同纪律：默认关闭；首次开启经许可证门（LICENSE_DOOR_TEXT）；任何态下
// UIA / OCR / 用户框选兜底不受影响（§C.2.4）；文案只许从本表取，禁止 UI 侧私编。

export interface ModelSwitchCopy {
  /** 实验层开关行标签与旁注（含默认关闭语义） */
  switchLabel: string
  switchHint: string
  /** ①主开关关闭时实验层开关的禁用态提示 */
  masterOffHint: string
  /** ②当前 app 未在 coordinateAllowed 时的提示 */
  appNotAllowedHint: string
  /** ③实验层开关本体语义（L2 建议层 + 人工确认 + 未校准披露 + P2 per-task 生效语义） */
  layerSemantics: string
  /** 首次开启的许可证门引导提示 */
  licenseDoorHint: string
  /** 时间线文案（WI-3.5④：首触加载上界声明；loadTimeoutMs 默认 30s + 余量） */
  firstLoadTimeline: string
  /** P2：任务运行中拨动开关的旁注（per-task 生效 + estop 引导） */
  switchRunningNote: string
  /** 状态行：模型就绪且实验层已开启 */
  statusReadyEnabled: string
  /** 状态行：模型就绪但实验层未开启 */
  statusReadyDisabled: string
  /** 状态行：下载中文本前缀（百分比/文件名由逻辑层拼接） */
  downloadInProgress: string
  /** 许可证已拒绝的恒态提示（永久跳过，无 UI 复位——裁决 2） */
  licenseDeclinedNotice: string
}

export const MODEL_SWITCH_COPY: ModelSwitchCopy = {
  switchLabel: "实验层：TinyClick 本地视觉定位",
  switchHint:
    "默认关闭。开启后仅作为定位链第 2 层（L2）的坐标候选建议；" +
    "命中在执行前仍会弹出人工确认。",
  masterOffHint: "主开关（computer.use）已关闭——实验层不参与任何定位。",
  appNotAllowedHint:
    "当前应用未加入允许列表（coordinateAllowed）——实验层对该应用不参与定位。",
  // P2（WP5-I4 对抗修订）：补 per-task 生效语义 + estop 引导——被坏建议惊动而
  // 关开关的用户恰是最需要 estop 引导的人；「任务运行中关闭即生效」是虚假保证。
  layerSemantics:
    "本层是定位链的实验性建议层（L2）：模型输出仅作为坐标候选，" +
    "任何点击执行前必经人工确认；本层未校准，可能完全错误。" +
    "关闭开关按任务粒度生效——任务运行中关闭将于当前任务结束后生效；" +
    "若需立即停止（含当前任务），请按 Ctrl+Alt+End 急停或中止当前任务。" +
    "拒绝建议或关闭本层后，UIA / OCR / 用户框选兜底不受影响。",
  licenseDoorHint:
    "首次开启需阅读并接受模型许可证与研究品免责声明；" +
    "拒绝则本实验层永久跳过，其余定位层不受影响。",
  firstLoadTimeline:
    "模型首次加载最长约 35 秒（超时自动降级，且不计入故障熔断）；" +
    "加载期间 UIA / OCR / 用户框选定位不受影响。",
  switchRunningNote:
    "当前有任务正在运行——开关变更将于当前任务结束后生效；" +
    "立即停止请按 Ctrl+Alt+End 急停或中止任务。",
  statusReadyEnabled:
    "实验层已开启，模型就绪。任务执行中每个模型建议在点击前仍需人工确认。",
  statusReadyDisabled: "模型已下载就绪——实验层未开启。",
  downloadInProgress: "模型下载中",
  licenseDeclinedNotice:
    "你已拒绝实验层许可证——本层永久跳过，其余定位层不受影响。" +
    "（复位路径 = 手动编辑 config.json，属显式 owner opt-in。）",
}
