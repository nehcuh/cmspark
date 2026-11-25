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
      "Qwen3-VL 模型未下载或已被删除。桌面操作不受影响；" +
      "可在设置页下载模型，再到工作中心选择本机模型。",
    action: "下载模型",
  },
  "model-hash-mismatch": {
    title: "模型文件校验失败",
    detail:
      "模型文件与登记 sha256 不一致（可能被篡改或损坏），已拒绝加载。" +
      "桌面操作不受影响；请删除后重新下载。",
    action: "删除并重新下载",
  },
  "sha256-mismatch": {
    title: "模型文件校验失败",
    detail:
      "模型文件与发版钉死的 sha256 不一致（可能被篡改或损坏），已拒绝加载。" +
      "桌面操作不受影响；请删除后重新下载。",
    action: "删除并重新下载",
  },
  "network-error": {
    title: "模型下载失败",
    detail:
      "网络错误导致下载中断（断点已保留，重试可续传）。已自动降级，" +
      "桌面操作不受影响。",
    action: "重试下载",
  },
  // --- 下载管理器其余原因（与 ModelUnavailableReason 词表对齐） ------------------
  "model-unknown": {
    title: "模型未登记",
    detail: "manifest 中不存在该模型条目（发版内容异常）。桌面操作不受影响。",
    action: null,
  },
  "variant-unknown": {
    title: "模型变体未登记",
    detail: "manifest 中不存在该交付变体（发版内容异常）。桌面操作不受影响。",
    action: null,
  },
  "mirror-scheme-denied": {
    title: "镜像地址被拒绝",
    detail:
      "computer.modelMirror 仅允许 https 主机（file:// / UNC 本地替换面已关闭）。" +
      "请检查设置后重试；桌面操作不受影响。",
    action: "检查镜像设置",
  },
  "disk-budget-exceeded": {
    title: "磁盘预算超限",
    detail:
      "可用磁盘不足以容纳所选模型变体（需约「下载体积 + 2GB」余量）。" +
      "请释放磁盘空间或删除其他变体后重试；桌面操作不受影响。",
    action: "释放磁盘空间",
  },
  "disk-full": {
    title: "磁盘空间不足",
    detail: "目标卷剩余空间不足以下载模型文件。请释放磁盘空间后重试；桌面操作不受影响。",
    action: null,
  },
  "http-error": {
    title: "模型下载失败",
    detail:
      "模型服务器返回异常状态。若使用镜像，请检查镜像可用性；桌面操作不受影响，可稍后重试。",
    action: "重试下载",
  },
  "size-mismatch": {
    title: "模型文件大小异常",
    detail:
      "下载完成的文件大小与登记不符（分发链异常），已删除并拒绝使用。" +
      "桌面操作不受影响；请重试下载，复现请向项目反馈。",
    action: "重试下载",
  },
  "hash-mismatch": {
    title: "模型文件校验失败",
    detail:
      "下载完成的文件 sha256 与登记不符（分片级篡改或分发链异常），已删除分片并拒绝使用。" +
      "桌面操作不受影响；请重试下载，复现请向项目反馈。",
    action: "重试下载",
  },
  "oversize-stream": {
    title: "模型下载数据异常",
    detail:
      "下载源吐出的字节超过登记大小（分发链异常或镜像不可信），已在传输中途截断并清理。" +
      "桌面操作不受影响；请检查镜像设置后重试，复现请向项目反馈。",
    action: "重试下载",
  },
  // --- manifest 层其余原因（与 ModelGateError.code 词表对齐） ----------------------
  "model-size-mismatch": {
    title: "模型文件大小异常",
    detail: "磁盘上的模型文件大小与登记不符，已拒绝加载。请删除后重新下载；桌面操作不受影响。",
    action: "删除并重新下载",
  },
  "manifest-invalid": {
    title: "模型登记信息损坏",
    detail: "models.manifest.json 未通过 schema 校验（发版内容异常）。桌面操作不受影响。",
    action: null,
  },
  "manifest-source-remote": {
    title: "模型登记来源被拒绝",
    detail:
      "模型 manifest 只接受随发版的本地文件（运行时网络更新 manifest 的通道已关闭）。" +
      "桌面操作不受影响。",
    action: null,
  },
  // --- WP5-I4 WI-4.2 开关族文案 -----------------------------------------------------
  "download-host-unset": {
    title: "模型发布地址未配置",
    detail:
      "模型发布地址尚未配置——当前构建不可下载模型。" +
      "桌面操作不受影响。",
    action: null,
  },
  "python-missing": {
    title: "需要先安装 Python 3",
    detail:
      "实验层在本机 Companion 中下载与运行，需要 Python 3（≥ 3.10）。" +
      "Windows：winget install -e --id Python.Python.3.12，或从 python.org 安装并勾选 PATH；" +
      "Mac：brew install python3；Linux：用发行版包管理器安装 python3。" +
      "完成后重启 CMspark。也可在设置 → 实验功能按环境检查中的安装命令操作。" +
      "桌面操作不受影响。",
    action: null,
  },
  "hf-hub-missing": {
    title: "本机尚未准备好「模型下载组件」",
    detail:
      "还不能从当前下载源拉取模型。请打开设置 → 实验功能，按「环境检查」清单复制安装命令到终端执行（约 1～3 分钟），或改选下载源「魔搭 ModelScope」。" +
      "桌面操作不受影响。",
    action: "查看环境检查",
  },
  "modelscope-missing": {
    title: "本机尚未准备好「模型下载组件」",
    detail:
      "当前为大陆推荐源，仍需在本机安装下载组件。请打开设置 → 实验功能，按红色/橙色「环境检查」清单中的一键命令在终端执行后再点下载。" +
      "桌面操作不受影响。",
    action: "查看环境检查",
  },
  "download-failed": {
    title: "模型下载失败",
    detail:
      "网络或下载源暂时不可用。可改选「魔搭 ModelScope」或「HF 镜像」后重试；并确认磁盘空间充足。" +
      "桌面操作不受影响。",
    action: "重试下载",
  },
  "model-variant-missing": {
    title: "当前规模尚未下载",
    detail:
      "所选模型规模的文件未下载或不完整。请先完成环境检查中的软件项，再点「下载模型」。" +
      "桌面操作不受影响。",
    action: "下载当前规模",
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
      detail: `未登记的原因（${reason}）。桌面操作不受影响。`,
      action: null,
    }
  )
}
