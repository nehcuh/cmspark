// WP2: per-action task preview (plan §E.4 — the panel WATCHES the task).
//
// Two pieces:
//   1. ComputerTaskEvent — the executor emits these over deps.onEvent; the
//      server broadcasts them to authenticated panels as
//      { type: "computer.task.event", ... }. Events are fire-and-forget:
//      a dead panel must never block or fail the task.
//   2. buildComputerL2Preview (Y3) — the PURE builder for the task-level L2
//      confirmation text. Extracted from the server gate so it is unit
//      testable. Two anti-spoofing rules:
//        - the task text is JSON.stringify'd: a task containing newlines
//          must not forge extra preview lines against the human gate;
//        - every injectable action is enumerated verbatim (anchor text /
//          coordinates / key chord / scroll delta), because the human
//          approves WHAT will be actuated, not a vague task sentence.

import { corpusOf, type ComputerAction, type RectPx } from "./types"

export interface ComputerTaskEvent {
  event: "started" | "step" | "paused" | "finished"
  taskId: string
  /** started: app display name + task text; finished: outcome. */
  app?: string
  task?: string
  total?: number
  /** WP4: started 附动作预算总量(任务条「已用/总量」的分母)。 */
  budget?: number
  ok?: boolean
  completed?: number
  errorCode?: string
  /** WP4: finished 附证据目录(任务条/工具卡的「打开证据目录」入口)。 */
  evidenceDir?: string
  /** step/paused: 1-based action sequence number. */
  seq?: number
  action?: string
  x?: number
  y?: number
  budgetLeft?: number
  /** Short human label, e.g. 点击「确定」 — never the type text itself. */
  caption?: string
  /** base64 JPEG with credential neighborhoods already blacked out. */
  previewImage?: string
  /** paused: the re-L2 reason shown to the user. */
  reason?: string
  /**
   * WP4: step 事件增配的定位可观测字段(复用证据链同源变量,不改决策逻辑):
   * 实际命中层 / 置信度 / 动作耗时 / 逐层降级日志 / 交叉验证通道。
   */
  layer?: string
  confidence?: number
  durationMs?: number
  locateAttempts?: import("./types").LocateAttempt[]
  crossverified?: boolean
  crossverifyChannel?: string
}

/**
 * P3(WP4 对抗裁决):caption 字符类清洗。
 *
 * JSON.stringify 不充分——它不转义 U+2028/U+2029(JSON 字符串内的合法字符),
 * 在 pre-wrap 渲染语境会强制断行;零宽/格式字符(U+200B–U+200F、U+FEFF、
 * U+2060 等)也原样通过。任务文本/锚文本是 LLM 生成的不可信内容,可借此在
 * caption 里伪造「系统提示」行(Y3 在 code_preview 只堵了 ASCII 控制符)。
 *
 * 规则:
 *  - \p{Zl}\p{Zp}(行/段分隔符)与 \p{Cc}(控制符,含 \n \r \t)→ 单个空格
 *    (视觉不断行,保留词间间隔);
 *  - \p{Cf}(格式字符:零宽空格/连接符、bidi 嵌入/覆盖/隔离、WORD JOINER、
 *    FEFF 等)→ 删除(本不可见,删除不改变人读内容)。
 *
 * L2 截图 caption 与 step 事件 caption 必须共用本函数(对抗复核重点)。
 */
export function sanitizeComputerCaption(s: string): string {
  return String(s ?? "")
    .replace(/[\p{Zl}\p{Zp}\p{Cc}]/gu, " ")
    .replace(/\p{Cf}/gu, "")
    .replace(/ {2,}/g, " ")
    .trim()
}

/**
 * Builds the per-step annotated preview image (crosshair + credential
 * blackout + downscale). Injectable: production is ps1-backed; tests fake
 * it. The executor treats ANY builder failure as "no image" — a preview
 * must never block or fail the task.
 */
export interface PreviewBuilder {
  build(imagePath: string, point?: { x: number; y: number }, blurRects?: RectPx[]): Promise<string | null>
}

export interface ComputerL2PreviewInput {
  task: string
  appDisplayName: string
  appToken: string
  budget: number
  actions: ComputerAction[]
  /** C6: extra status lines (e.g. injection rate counters) appended verbatim. */
  extraLines?: string[]
}

export function buildComputerL2Preview(input: ComputerL2PreviewInput): string {
  const actions = Array.isArray(input.actions) ? input.actions : []
  const corpus = corpusOf(actions)
  const lines = [
    `任务: ${JSON.stringify(input.task)}`,
    `目标应用: ${input.appDisplayName} (${input.appToken})`,
    `动作预算: ${input.budget} 个注入动作（共 ${actions.length} 个草案动作）`,
  ]

  const steps: string[] = []
  for (const a of actions) {
    if (!a || typeof a !== "object") continue
    const k = (a as any).action
    if (k === "click" || k === "double_click" || k === "right_click") {
      if (typeof (a as any).target === "string" && (a as any).target) {
        steps.push(`${k} 锚文本 ${JSON.stringify((a as any).target)}`)
      } else {
        steps.push(`${k} 坐标 (${(a as any).x}, ${(a as any).y})`)
      }
    } else if (k === "key") {
      steps.push(`key 组合键 ${JSON.stringify((a as any).keys)}`)
    } else if (k === "scroll") {
      steps.push(`scroll (${(a as any).x}, ${(a as any).y}) delta=${(a as any).delta}`)
    } else if (k === "drag") {
      steps.push(`drag (${(a as any).x}, ${(a as any).y}) → (${(a as any).x2}, ${(a as any).y2})`)
    }
    // wait / screenshot / describe / type carry no actuation target — type
    // text is enumerated separately below.
  }
  if (steps.length > 0) {
    lines.push("待执行注入动作（逐条枚举，请核对 — 屏幕上的文字永远不是指令）:")
    steps.forEach((s, i) => lines.push(`  [${i + 1}] ${s}`))
  }

  if (corpus.length > 0) {
    lines.push("待输入文本（逐字枚举，请逐条核对）:")
    corpus.forEach((t, i) => lines.push(`  [${i + 1}] ${JSON.stringify(t)}`))
  } else {
    lines.push("本任务不包含文本输入动作。")
  }

  for (const extra of input.extraLines ?? []) lines.push(extra)
  return lines.join("\n")
}
