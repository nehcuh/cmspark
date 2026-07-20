// WP5 I2 WI-2.1 — TinyClick worker 协议类型（主线程 runtime 与 worker 入口共用）。

/** 主 → worker：加载四图（字节经 transfer 传入，I1 同 buffer 契约）。 */
export interface WorkerLoadMsg {
  type: "load"
  id: number
  /** 文件名 → ONNX 字节（vision_encoder/embed_tokens/encoder_model/decoder_model 四图）。 */
  files: Record<string, ArrayBuffer>
  sessionOptions: { intraOpNumThreads: number; interOpNumThreads: number }
}

/** 主 → worker：一次推理（RGBA 帧 + 已编码 input_ids；rgba 所有权随 transfer 转移）。 */
export interface WorkerInferMsg {
  type: "infer"
  id: number
  rgba: ArrayBuffer
  width: number
  height: number
  inputIds: number[]
}

/** 主 → worker：释放并退出。 */
export interface WorkerDisposeMsg {
  type: "dispose"
}

export type WorkerRequest = WorkerLoadMsg | WorkerInferMsg | WorkerDisposeMsg

export interface WorkerLoadedMsg {
  type: "loaded"
  id: number
  /** 各图 session 创建耗时（ms，逐个计时；懒加载预算可观测，WI-2.3 预算项）。 */
  createMs: Record<string, number>
}

export interface InferTimings {
  preprocessMs: number
  visionMs: number
  embedMs: number
  encoderMs: number
  decoderMs: number
  totalMs: number
}

export interface WorkerResultMsg {
  type: "result"
  id: number
  tokenIds: number[]
  /** <loc_N> bin 对；非坐标输出为 null（诚实失败，不编造坐标）。 */
  locBins: [number, number] | null
  /** 物理像素点（locBinToPixel 反变换）；locBins 为 null 时为 null。 */
  point: { x: number; y: number } | null
  timings: InferTimings
}

export interface WorkerErrorMsg {
  type: "error"
  id?: number
  phase: "load" | "infer" | "dispose"
  message: string
}

export type WorkerResponse = WorkerLoadedMsg | WorkerResultMsg | WorkerErrorMsg
