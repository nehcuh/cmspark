// WP4(WI-2):任务级 L2 标注截图 helper。
//
// 在 host_computer 确认闸门内(best-effort)生成:目标窗口截图 → OCR(凭证区
// 黑化 + 首动作锚文本定位)→ 首动作为坐标点击或锚文本命中时画十字线 →
// preview build → raw 帧立即删除。任务尚未批准——像素绝不持久化(R1 纪律,
// 只有批准后的 step 帧才进证据链密封)。
//
// 纪律(对抗裁决四护栏):
//  a) 调用点固定在闸门廉价前门(assertCoordinateAllowed/busy/rate-limit)之后
//     —— 见 server.ts host_computer 闸门(护栏注释同步在那里);
//  b) caption 强制三段式非绑定声明(P2)——十字线是闸门时刻的参考快照,不是
//     「批准的就是这一下」的执行背书;
//  c) 超时路径「杀进程 → 等 exit → 删 raw」(P5)——结构性保证:pipeline 的
//     finally 只在全部 ps1 await 结算后执行(runner 超时杀进程 = 杀,await 结算
//     = 等 exit,然后才删 raw);超时降级返回后 pipeline 仍后台走完 finally,
//     WP2 sweepComputerTempCaptures 为兜底;
//  d) 预览绝不进入工具结果/LLM 上下文——本模块的产出只进确认 details 的
//     preview_image/preview_caption 字段,不变量测试锁死。
//
// 全依赖注入(与 executor 同一 G.3 mock 边界);任何失败/超时/非 win32 一律
// 降级「无图」,绝不影响确认门。

import * as fs from "fs"

import { scanDanger } from "./danger"
import { sanitizeComputerCaption, type PreviewBuilder } from "./preview"
import {
  REGION_CROP_SIZE,
  type ComputerAction,
  type Locator,
  type RectPx,
  type ScreenCapturer,
  type WindowEnumerator,
} from "./types"

export interface L2PreviewImageDeps {
  windows: WindowEnumerator
  capturer: ScreenCapturer
  locator: Locator
  previewBuilder: PreviewBuilder
  /** 默认 fs.rm(force)——测试注入以断言「删 raw」的时机与顺序。 */
  removeFile?: (p: string) => Promise<void>
  log?: (event: string, data: Record<string, unknown>) => void
}

export interface L2PreviewImageOptions {
  /** 白名单条目的 exe 路径(hwnd 解析依据;无 exe 的 AUMID 条目由调用方跳过)。 */
  exePath: string
  appDisplayName: string
  actions: ComputerAction[]
  /** 确认门延迟预算(默认 5000ms)——超时降级「无图」。 */
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

export interface L2PreviewImageResult {
  /** base64 JPEG(凭证区已黑化;builder too_large/失败时为 null → 整体降级)。 */
  image: string
  /** 三段式非绑定声明(P2),构造链 = 模板化 + P3 字符类清洗。 */
  caption: string
}

/**
 * P2:三段式非绑定 caption。措辞为对抗裁决定案文案——
 * ① N 个动作逐条列出;② 十字线仅标注第 1 个动作的当前位置;
 * ③ 批准后按实时屏幕重新定位,实际点击位置以执行为准。
 * 应用名经 sanitizeComputerCaption 清洗(display_name 可被用户/预设定义,
 * 同属不可信内容)。
 */
export function buildL2PreviewCaption(appDisplayName: string, actionCount: number): string {
  return sanitizeComputerCaption(
    `① 将在 ${appDisplayName} 窗口中执行 ${actionCount} 个动作（下方逐条列出）；` +
      `② 十字线仅标注第 1 个动作的当前位置；` +
      `③ 批准后将按实时屏幕重新定位，实际点击位置以执行为准`,
  )
}

export async function buildComputerL2PreviewImage(
  deps: L2PreviewImageDeps,
  opts: L2PreviewImageOptions,
): Promise<L2PreviewImageResult | null> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const removeFile =
    deps.removeFile ??
    (async (p: string) => {
      try {
        await fs.promises.rm(p, { force: true })
      } catch {
        /* best-effort */
      }
    })
  const log = deps.log ?? (() => {})

  // pipeline 内部 try/catch 兜底(绝不 reject),finally 负责删 raw——
  // P5 的顺序由 async fn 语义结构性保证:finally 只在所有 await 结算后运行。
  const pipeline = (async (): Promise<L2PreviewImageResult | null> => {
    let rawPath: string | null = null
    try {
      // hwnd 解析(与 executor 同一规则:目标 exe 的最大可见窗口)。
      const wins = await deps.windows.enumerateByExe(opts.exePath)
      if (!Array.isArray(wins) || wins.length === 0) return null
      const win = [...wins].sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0]
      // 截图(raw 帧立即纳入追踪)。
      const shot = await deps.capturer.captureWindow(win.hwnd)
      rawPath = shot.path || null
      if (!rawPath) return null
      // OCR:凭证区黑化(与 executor 只读帧同一扫描)+ 首动作锚文本定位。
      const ocr = await deps.locator.ocr(shot.path)
      const wholeImg: RectPx = { x: 0, y: 0, width: shot.rect.width, height: shot.rect.height }
      const blur = scanDanger(ocr.words, wholeImg, REGION_CROP_SIZE).credentialRects
      // 首动作十字线:坐标点击 → client→image 换算;锚文本命中 → OCR bbox
      // 中心(locate 命中坐标本就是 image 坐标系,见 locate-chain)。
      let point: { x: number; y: number } | undefined
      const first = Array.isArray(opts.actions) ? opts.actions[0] : undefined
      if (
        first &&
        (first.action === "click" || first.action === "double_click" || first.action === "right_click")
      ) {
        if (typeof first.target === "string" && first.target) {
          const hit = deps.locator.locate(ocr, first.target)
          if (hit) point = { x: hit.x, y: hit.y }
        } else if (typeof first.x === "number" && typeof first.y === "number") {
          point = { x: shot.client.x + first.x, y: shot.client.y + first.y }
        }
      }
      const image = await deps.previewBuilder.build(shot.path, point, blur)
      if (!image) return null
      return {
        image,
        caption: buildL2PreviewCaption(opts.appDisplayName, Array.isArray(opts.actions) ? opts.actions.length : 0),
      }
    } catch (err) {
      log("computer.l2preview.failed", { error: String((err as Error)?.message ?? err) })
      return null
    } finally {
      // P5:raw 帧必删;且只在这里(全部 ps1 结算之后)删——被杀的 capture/OCR
      // ps1 不可能在删除之后完成写盘。Best-effort:删除失败由 WP2 sweep 兜底。
      if (rawPath) {
        try {
          await removeFile(rawPath)
        } catch {
          /* best-effort */
        }
      }
    }
  })()

  // 超时降级:确认门最多等 timeoutMs。超时返回 null 后,pipeline 仍后台结算,
  // raw 由其 finally 删除(杀 → 等 exit → 删的顺序不变)。
  const winner = await Promise.race([pipeline, sleep(timeoutMs).then(() => null as L2PreviewImageResult | null)])
  if (winner === null) {
    log("computer.l2preview.degraded", { timeoutMs })
    // pipeline 内部已 catch 兜底不会 reject;这里再接一层保险,杜绝 unhandled。
    pipeline.catch(() => {})
    return null
  }
  return winner
}
