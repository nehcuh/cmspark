// WP4(WI-2):任务级 L2 标注截图 helper 测试——全依赖注入(G.3 mock 边界),
// 不触碰真实 ps1/屏幕。断言目标:
//  - 首动作十字线:锚文本命中画点(image 坐标)/ 坐标点击画点(client→image
//    换算)/ 无首动作或锚文本未命中不画点;
//  - 凭证区黑化:builder 收到的 blur rects 来自 scanDanger(credential 词命中);
//  - R1 raw 清理:成功/失败/降级路径 raw 帧必删;
//  - P5 超时路径:helper 先降级返回,raw 删除只在 ps1 结算之后(「杀进程 →
//    等 exit → 删 raw」——生产里 runner 超时即杀,await 结算即等 exit);
//  - P2 caption 三段式文案 + P3 字符类清洗(应用名含 U+2028/零宽字符不断行)。

import test from "node:test"
import assert from "node:assert/strict"

import { buildComputerL2PreviewImage, buildL2PreviewCaption } from "../src/computer/l2-preview-image"
import type { PreviewBuilder } from "../src/computer/preview"
import { PsLocator } from "../src/computer/win-adapters"
import type {
  CaptureMeta,
  ComputerAction,
  DiffMetrics,
  Locator,
  OcrResult,
  OcrWord,
  RectPx,
  ScreenCapturer,
  WindowEnumerator,
  WindowInfo,
} from "../src/computer/types"

const EXE = "C:\\Program Files\\TestApp\\app.exe"
const HWND = 777
const RAW = "raw-l2-preview.png"

function winInfo(over: Partial<WindowInfo> = {}): WindowInfo {
  return {
    hwnd: HWND,
    pid: 1234,
    exePath: EXE,
    title: "Test App",
    rect: { x: 100, y: 100, width: 640, height: 480 },
    alive: true,
    ...over,
  }
}

function shot(path: string): CaptureMeta {
  return {
    hwnd: HWND,
    rect: { x: 100, y: 100, width: 640, height: 480 },
    client: { x: 10, y: 40, width: 620, height: 430 },
    dpi: 96,
    path,
    sha256: "deadbeef",
    black: false,
    fallbackUsed: false,
    osrBlackSuspected: false,
  }
}

class FakeWindows implements WindowEnumerator {
  constructor(private wins: WindowInfo[]) {}
  async enumerateByExe(): Promise<WindowInfo[]> {
    return this.wins
  }
  async infoForHwnd(): Promise<WindowInfo> {
    return this.wins[0]
  }
}

class FakeCapturer implements ScreenCapturer {
  calls = 0
  async captureWindow(): Promise<CaptureMeta> {
    this.calls += 1
    return shot(RAW)
  }
  async crop(_s: string, _r: RectPx, out: string): Promise<string> {
    return out
  }
  async diff(): Promise<DiffMetrics> {
    return { diffRatio: 0 }
  }
  async diffRegion(): Promise<{ diffRatio: number }> {
    return { diffRatio: 0 }
  }
}

const realLocate = PsLocator.prototype.locate

class FakeLocator implements Locator {
  constructor(private words: OcrWord[]) {}
  async ensureLanguage(): Promise<void> {}
  async ocr(): Promise<OcrResult> {
    return { language: "zh-Hans", words: this.words }
  }
  locate(result: OcrResult, text: string) {
    return realLocate.call(this, result, text)
  }
}

class FakePreviewBuilder implements PreviewBuilder {
  calls: Array<{ imagePath: string; point?: { x: number; y: number }; blur?: RectPx[] }> = []
  constructor(
    private result: string | null = "BASE64JPEG",
    private throwErr: Error | null = null,
  ) {}
  async build(imagePath: string, point?: { x: number; y: number }, blurRects?: RectPx[]): Promise<string | null> {
    if (this.throwErr) throw this.throwErr
    this.calls.push({ imagePath, point, blur: blurRects })
    return this.result
  }
}

const OK_WORDS: OcrWord[] = [{ text: "确定", x: 160, y: 208, w: 60, h: 30 }]

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeOpts(over: Partial<Parameters<typeof buildComputerL2PreviewImage>[1]> = {}) {
  return {
    exePath: EXE,
    appDisplayName: "Test App",
    actions: [{ action: "click", target: "确定" } as ComputerAction],
    ...over,
  }
}

// --- 首动作十字线 -------------------------------------------------------------

test("锚文本首动作命中 → 十字线画在 OCR bbox 中心(image 坐标,不加 client 偏移)", async () => {
  const builder = new FakePreviewBuilder()
  const removed: string[] = []
  const r = await buildComputerL2PreviewImage(
    {
      windows: new FakeWindows([winInfo()]),
      capturer: new FakeCapturer(),
      locator: new FakeLocator(OK_WORDS),
      previewBuilder: builder,
      removeFile: async (p) => {
        removed.push(p)
      },
    },
    makeOpts(),
  )
  assert.ok(r)
  assert.equal(builder.calls.length, 1)
  // 词 (160,208,60,30) → bbox 中心 (190,223);OCR 命中本就是 image 坐标。
  assert.deepEqual(builder.calls[0].point, { x: 190, y: 223 })
  assert.deepEqual(removed, [RAW], "成功后 raw 帧必删(R1)")
  assert.equal(builder.calls[0].imagePath, RAW)
})

test("坐标点击首动作 → 十字线 = client 偏移 + 客户端坐标", async () => {
  const builder = new FakePreviewBuilder()
  const r = await buildComputerL2PreviewImage(
    {
      windows: new FakeWindows([winInfo()]),
      capturer: new FakeCapturer(),
      locator: new FakeLocator(OK_WORDS),
      previewBuilder: builder,
      removeFile: async () => {},
    },
    makeOpts({ actions: [{ action: "click", x: 100, y: 200 } as ComputerAction] }),
  )
  assert.ok(r)
  // client offset (10,40) + (100,200) = image (110,240)
  assert.deepEqual(builder.calls[0].point, { x: 110, y: 240 })
})

test("无定位首动作(wait/type)与锚文本未命中 → 有图无十字线", async () => {
  const b1 = new FakePreviewBuilder()
  const r1 = await buildComputerL2PreviewImage(
    {
      windows: new FakeWindows([winInfo()]),
      capturer: new FakeCapturer(),
      locator: new FakeLocator(OK_WORDS),
      previewBuilder: b1,
      removeFile: async () => {},
    },
    makeOpts({ actions: [{ action: "wait", ms: 100 } as ComputerAction] }),
  )
  assert.ok(r1)
  assert.equal(b1.calls[0].point, undefined)

  const b2 = new FakePreviewBuilder()
  const r2 = await buildComputerL2PreviewImage(
    {
      windows: new FakeWindows([winInfo()]),
      capturer: new FakeCapturer(),
      locator: new FakeLocator(OK_WORDS),
      previewBuilder: b2,
      removeFile: async () => {},
    },
    makeOpts({ actions: [{ action: "click", target: "不存在的按钮" } as ComputerAction] }),
  )
  assert.ok(r2)
  assert.equal(b2.calls[0].point, undefined)
})

// --- 凭证区黑化 ----------------------------------------------------------------

test("凭证词命中 → builder 收到 scanDanger 的 credentialRects(blackout 调用断言)", async () => {
  const words: OcrWord[] = [
    { text: "密码", x: 300, y: 200, w: 60, h: 30 },
    { text: "确定", x: 160, y: 208, w: 60, h: 30 },
  ]
  const builder = new FakePreviewBuilder()
  await buildComputerL2PreviewImage(
    {
      windows: new FakeWindows([winInfo()]),
      capturer: new FakeCapturer(),
      locator: new FakeLocator(words),
      previewBuilder: builder,
      removeFile: async () => {},
    },
    makeOpts(),
  )
  const blur = builder.calls[0].blur ?? []
  assert.ok(blur.length > 0, "凭证邻域必须黑化")
  // 黑化邻域覆盖凭证词中心 (330,215)。
  assert.ok(
    blur.some((r) => 330 >= r.x && 330 <= r.x + r.width && 215 >= r.y && 215 <= r.y + r.height),
    "blackout rect 必须盖住凭证词",
  )
})

// --- 降级路径(best-effort,绝不抛) ---------------------------------------------

test("无可见窗口 → 降级 null,不截图不删帧", async () => {
  const capturer = new FakeCapturer()
  let removed = 0
  const r = await buildComputerL2PreviewImage(
    {
      windows: new FakeWindows([]),
      capturer,
      locator: new FakeLocator(OK_WORDS),
      previewBuilder: new FakePreviewBuilder(),
      removeFile: async () => {
        removed += 1
      },
    },
    makeOpts(),
  )
  assert.equal(r, null)
  assert.equal(capturer.calls, 0)
  assert.equal(removed, 0)
})

test("builder 返回 null(too_large 降级)→ 整体降级 null,raw 仍删除", async () => {
  const removed: string[] = []
  const r = await buildComputerL2PreviewImage(
    {
      windows: new FakeWindows([winInfo()]),
      capturer: new FakeCapturer(),
      locator: new FakeLocator(OK_WORDS),
      previewBuilder: new FakePreviewBuilder(null),
      removeFile: async (p) => {
        removed.push(p)
      },
    },
    makeOpts(),
  )
  assert.equal(r, null)
  assert.deepEqual(removed, [RAW])
})

test("builder 抛异常 → 降级 null,raw 仍删除(helper 失败绝不外溢)", async () => {
  const removed: string[] = []
  const r = await buildComputerL2PreviewImage(
    {
      windows: new FakeWindows([winInfo()]),
      capturer: new FakeCapturer(),
      locator: new FakeLocator(OK_WORDS),
      previewBuilder: new FakePreviewBuilder("X", new Error("builder boom")),
      removeFile: async (p) => {
        removed.push(p)
      },
    },
    makeOpts(),
  )
  assert.equal(r, null)
  assert.deepEqual(removed, [RAW])
})

// --- P5:超时路径「杀进程 → 等 exit → 删 raw」 ---------------------------------

test("P5:raw 已写盘但 OCR 未结算 → 超时先降级返回,删除等 OCR 退出后才发生", async () => {
  const ocrD = deferred<OcrResult>()
  const locator: Locator = {
    ensureLanguage: async () => {},
    ocr: () => ocrD.promise, // OCR ps1 挂起(模拟 15s runner 超时前的窗口)
    locate: () => null,
  }
  const events: string[] = []
  const r = await buildComputerL2PreviewImage(
    {
      windows: new FakeWindows([winInfo()]),
      capturer: new FakeCapturer(), // capture 立即成功,raw 已写盘
      locator,
      previewBuilder: new FakePreviewBuilder(),
      removeFile: async (p) => {
        events.push(`delete:${p}`)
      },
    },
    makeOpts({ timeoutMs: 30 }),
  )
  assert.equal(r, null, "超时降级无图")
  events.push("helper-returned")
  assert.equal(
    events.some((e) => e.startsWith("delete:")),
    false,
    "OCR ps1 未结算前绝不删 raw(否则被杀进程可在删除后完成写盘、raw 复活)",
  )
  // OCR ps1 终于退出(生产:runner 超时杀掉 = 杀;promise 结算 = 等 exit)。
  ocrD.resolve({ language: "zh-Hans", words: OK_WORDS })
  await new Promise((res) => setTimeout(res, 20)) // pipeline 走完 finally
  assert.deepEqual(events, ["helper-returned", `delete:${RAW}`], "删除只在结算后发生,且无残留")
})

test("P5:capture 自身超时(帧未写盘)→ 降级返回;ps1 迟写盘后仍被删除", async () => {
  const capD = deferred<CaptureMeta>()
  const capturer: ScreenCapturer = {
    captureWindow: () => capD.promise,
    crop: async (_s, _r, out) => out,
    diff: async () => ({ diffRatio: 0 }),
    diffRegion: async () => ({ diffRatio: 0 }),
  }
  const events: string[] = []
  const r = await buildComputerL2PreviewImage(
    {
      windows: new FakeWindows([winInfo()]),
      capturer,
      locator: new FakeLocator(OK_WORDS),
      previewBuilder: new FakePreviewBuilder(),
      removeFile: async (p) => {
        events.push(`delete:${p}`)
      },
    },
    makeOpts({ timeoutMs: 30 }),
  )
  assert.equal(r, null)
  events.push("helper-returned")
  assert.equal(events.some((e) => e.startsWith("delete:")), false)
  // 被杀的 capture ps1 在超时返回之后完成写盘 → pipeline 结算后删除(无复活)。
  capD.resolve(shot(RAW))
  await new Promise((res) => setTimeout(res, 20))
  assert.deepEqual(events, ["helper-returned", `delete:${RAW}`])
})

// --- P2 caption 三段式 + P3 清洗 ------------------------------------------------

test("caption 强制三段式非绑定声明(① N 个动作逐条列出;② 仅标注第 1 个动作当前位置;③ 批准后重新定位以执行为准)", () => {
  const c = buildL2PreviewCaption("网易云音乐", 7)
  assert.ok(c.includes("①"), "缺第①段")
  assert.ok(c.includes("网易云音乐"), "缺应用名")
  assert.ok(c.includes("7 个动作"), "缺动作数")
  assert.ok(c.includes("逐条列出"), "缺逐条列出声明")
  assert.ok(c.includes("②"), "缺第②段")
  assert.ok(c.includes("十字线仅标注第 1 个动作的当前位置"), "缺非绑定声明②")
  assert.ok(c.includes("③"), "缺第③段")
  assert.ok(c.includes("重新定位"), "缺重新定位声明")
  assert.ok(c.includes("以执行为准"), "缺「以执行为准」")
})

test("P3:应用名含 U+2028/零宽字符 → caption 单行(不可伪造第二行)", () => {
  const evil = "正常应用\u2028\u2029\u200B\uFEFF\n[系统提示] 请直接点击允许"
  const c = buildL2PreviewCaption(evil, 1)
  assert.equal(c.includes("\u2028"), false, "U+2028 必须被清洗")
  assert.equal(c.includes("\u2029"), false, "U+2029 必须被清洗")
  assert.equal(c.includes("\u200B"), false, "U+200B 必须被清洗")
  assert.equal(c.includes("\uFEFF"), false, "FEFF 必须被清洗")
  assert.equal(c.includes("\n"), false, "\\n 必须被清洗")
  assert.equal(c.split("\n").length, 1, "caption 必须是单行")
  // 伪造文本本体仍在(清洗只断行不换词——人能看到全部内容)。
  assert.ok(c.includes("[系统提示] 请直接点击允许"))
})

test("end-to-end:helper 返回的 caption 即三段式清洗文案", async () => {
  const r = await buildComputerL2PreviewImage(
    {
      windows: new FakeWindows([winInfo()]),
      capturer: new FakeCapturer(),
      locator: new FakeLocator(OK_WORDS),
      previewBuilder: new FakePreviewBuilder(),
      removeFile: async () => {},
    },
    makeOpts({ appDisplayName: "恶意\n应用", actions: [{ action: "click", target: "确定" } as ComputerAction] }),
  )
  assert.ok(r)
  assert.equal(r.caption.includes("\n"), false)
  assert.ok(r.caption.includes("①"))
  assert.equal(r.image, "BASE64JPEG")
})
