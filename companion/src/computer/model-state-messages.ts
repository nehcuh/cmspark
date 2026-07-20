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
      "模型目录占用将超过预算（computer.modelDiskBudgetMB，默认 2048MB）。" +
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
