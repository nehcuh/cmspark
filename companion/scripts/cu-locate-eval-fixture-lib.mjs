// #362 (CU-D) — CU 本机定位 held-out 评测夹具生成库（纯 Node、零依赖、确定性）。
//
// 设计基准：.omx/artifacts/cu-rethink-20260905/FINAL-SYNTHESIS.md 票 D。
//
// 与 #361 (CU-C) 红队语料的区别：
//   - #361 = 对抗集（伪指令/诱饵/假 UAC/注入/小弹层），判据是「执行器拒注」；
//   - 本集 = held-out 定位评测集（正常界面中文点按 + OSR 形态），判据是「定位
//     模型能否命中目标 bbox」。两集语义互补、样本不重叠——红队样本绝不进准确率
//     （票面红线）。
//
// 全部为【合成渲染 PNG】示意级界面（中文用与 #361 同款的 CJK 伪字形块；ASCII 用
// 5x7 点阵），权威文本层在 corpus.json 的 ocrWords 里。图像空间统一 640×480，
// window.rect=(100,100,640,480)、client=(10,40,620,430)，与 executor 单测 shot()
// 形态一致。坐标一律图像像素。
//
// 可重复性：无 Math.random / 无时间戳 / 无环境依赖——同一代码永远产出同一字节流
// （gen-cu-locate-eval-fixtures.mjs --check 逐字节校验入仓夹具）。

import { deflateSync } from "node:zlib"

// --- PNG 编码（与 #361 同款：RGBA / filter 0 / 真实 CRC） ----------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, "latin1"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/** RGBA 像素 → PNG 字节（colorType 6, filter 0, 单 IDAT）。 */
export function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = width * 4
  const raw = Buffer.alloc(height * (1 + stride))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (1 + stride) + 1)
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}

// --- 极简画布 -----------------------------------------------------------------

export function createCanvas(width, height, bg) {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = bg[0]
    rgba[i * 4 + 1] = bg[1]
    rgba[i * 4 + 2] = bg[2]
    rgba[i * 4 + 3] = bg.length > 3 ? bg[3] : 255
  }
  return { width, height, rgba }
}

export function fillRect(img, x, y, w, h, color) {
  const a = color.length > 3 ? color[3] : 255
  for (let yy = Math.max(0, y); yy < Math.min(img.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(img.width, x + w); xx++) {
      const i = (yy * img.width + xx) * 4
      img.rgba[i] = color[0]
      img.rgba[i + 1] = color[1]
      img.rgba[i + 2] = color[2]
      img.rgba[i + 3] = a
    }
  }
}

export function strokeRect(img, x, y, w, h, color, t = 2) {
  fillRect(img, x, y, w, t, color)
  fillRect(img, x, y + h - t, w, t, color)
  fillRect(img, x, y, t, h, color)
  fillRect(img, x + w - t, y, t, h, color)
}

// --- 文本（与 #361 同款伪字形；权威文本在 corpus ocrWords） --------------------

const FONT5X7 = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  A: [0x04, 0x0a, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1f],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e],
}

export function drawAscii(img, x, y, text, color, scale = 2) {
  let cx = x
  for (const ch of text) {
    const glyph = FONT5X7[ch]
    if (glyph) {
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row] & (0x10 >> col)) fillRect(img, cx + col * scale, y + row * scale, scale, scale, color)
        }
      }
    } else {
      strokeRect(img, cx, y, 5 * scale, 7 * scale, color, 1)
    }
    cx += 6 * scale
  }
}

/** CJK 伪字形块：确定性抽象字形（边框 + 码位派生点阵），不可读——权威文本在 ocrWords。 */
export function drawCjk(img, x, y, text, cell, color) {
  let cx = x
  for (const ch of text) {
    const code = ch.codePointAt(0) >>> 0
    let s = (code * 2654435761) >>> 0
    strokeRect(img, cx, y, cell, cell, color, Math.max(1, Math.round(cell / 12)))
    const inner = Math.max(2, cell - 6)
    const grid = 4
    const step = Math.max(1, Math.floor(inner / grid))
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        s = (s ^ (s << 13)) >>> 0
        s = (s ^ (s >>> 17)) >>> 0
        s = (s ^ (s << 5)) >>> 0
        if (s & 1) fillRect(img, cx + 3 + gx * step, y + 3 + gy * step, step, step, color)
      }
    }
    cx += cell + Math.max(2, Math.round(cell / 5))
  }
}

// --- 界面构件 -----------------------------------------------------------------

const GRAY_BG = [235, 235, 235, 255]
const TITLE_BAR = [70, 70, 78, 255]
const WHITE = [255, 255, 255, 255]
const BLUE = [40, 90, 200, 255]
const GREEN = [60, 140, 70, 255]
const RED = [190, 60, 50, 255]
const ORANGE = [230, 140, 20, 255]

function baseWindow(title, subtitleCjk) {
  const img = createCanvas(640, 480, GRAY_BG)
  fillRect(img, 0, 0, 640, 30, TITLE_BAR)
  drawAscii(img, 10, 8, title, WHITE, 2)
  if (subtitleCjk) drawCjk(img, 12, 44, subtitleCjk, 16, [60, 60, 60, 255])
  return img
}

function drawCjkButton(img, x, y, w, h, color, cjk, cell) {
  fillRect(img, x, y, w, h, color)
  strokeRect(img, x, y, w, h, [40, 40, 40, 255], 2)
  const total = cjk.length * (cell + Math.max(2, Math.round(cell / 5)))
  drawCjk(img, x + Math.max(4, Math.round((w - total) / 2)), y + Math.round((h - cell) / 2), cjk, cell, WHITE)
}

// --- 几何约定 ----------------------------------------------------------------

// 图像空间统一 640×480；window.rect 屏幕逻辑 = 图像 + (100,100)。
const RECT = { x: 100, y: 100, width: 640, height: 480 }
const CLIENT = { x: 10, y: 40, width: 620, height: 430 }

function fixtureShell(over) {
  return {
    window: { rect: RECT, client: CLIENT },
    uiaCapable: false,
    app: {
      token: "win.app.test",
      exePath: "C:\\Program Files\\TestApp\\app.exe",
      coordinateAllowed: true,
    },
    ...over,
  }
}

// --- 形态 A：中文桌面窗口（5 例） ----------------------------------------------
// 每例是「正常业务界面 + 中文点按任务」，无对抗注入。taskText 为模型收到的任务，
// targetText 是目标按钮文本，expected 为目标 bbox（用于命中判定）。

function desktopApproval() {
  // 「报销审批」：列表一行动作区有 通过 / 拒绝，任务点 通过。
  const img = baseWindow("EXPENSE REVIEW", "报销单审批")
  // 表格头
  drawAscii(img, 20, 70, "ID      AMOUNT   STATUS", WHITE, 2)
  // 三行
  const rows = [
    { y: 110, id: "E-1001", amt: "238.00" },
    { y: 160, id: "E-1002", amt: "512.50" },
    { y: 210, id: "E-1003", amt: "96.00" },
  ]
  for (const r of rows) {
    fillRect(img, 20, r.y, 600, 40, [250, 250, 250, 255])
    strokeRect(img, 20, r.y, 600, 40, [180, 180, 180, 255], 1)
    drawAscii(img, 30, r.y + 8, r.id, [40, 40, 40, 255], 2)
    drawAscii(img, 150, r.y + 8, r.amt, [40, 40, 40, 255], 2)
    drawCjk(img, 260, r.y + 8, "待审批", 18, [200, 140, 0, 255])
    // 动作按钮（目标行 E-1002 的 通过）
    if (r.id === "E-1002") {
      drawCjkButton(img, 480, r.y + 4, 60, 32, GREEN, "通过", 14)
      drawCjkButton(img, 550, r.y + 4, 60, 32, RED, "拒绝", 14)
    } else {
      drawCjkButton(img, 480, r.y + 4, 60, 32, [120, 120, 120, 255], "通过", 14)
      drawCjkButton(img, 550, r.y + 4, 60, 32, [120, 120, 120, 255], "拒绝", 14)
    }
  }
  const target = { x: 480, y: 164, w: 60, h: 32 }
  return {
    png: img,
    meta: fixtureShell({
      id: "d1-desktop-approve",
      form: "desktop",
      title: "中文桌面：报销审批列表，点击第二行「通过」",
      taskText: "在报销审批列表里，把 E-1002 这一行的单据点「通过」。",
      targetText: "通过",
      png: "d1-desktop-approve.png",
      target,
      ocrWords: [
        { text: "报销单审批", x: 12, y: 44, w: 96, h: 16 },
        { text: "待审批", x: 260, y: 112, w: 54, h: 18 },
        { text: "通过", x: target.x, y: target.y, w: 60, h: 32 },
      ],
    }),
  }
}

function desktopSettingsToggle() {
  // 「系统设置」列表：两行（自动更新 / 远程协助），任务点「远程协助」行（文字直指
  // 的可点行——不用无文本开关控件，否则基线无控件映射能力、判据不对称）。
  const img = baseWindow("SYSTEM SETTINGS", "系统设置")
  const rows = [
    { y: 120, label: "自动更新" },
    { y: 200, label: "远程协助" },
  ]
  for (const r of rows) {
    fillRect(img, 40, r.y, 560, 48, [250, 250, 250, 255])
    strokeRect(img, 40, r.y, 560, 48, [180, 180, 180, 255], 1)
    drawCjk(img, 60, r.y + 14, r.label, 20, [40, 40, 40, 255])
    drawAscii(img, 460, r.y + 18, ">", [140, 140, 140, 255], 2)
  }
  // 目标 = 含标签的可点整行（文字直指语义；基线点词中心与 VLM 点行同判据）
  const target = { x: 40, y: 200, w: 560, h: 48 }
  return {
    png: img,
    meta: fixtureShell({
      id: "d2-desktop-settingsrow",
      form: "desktop",
      title: "中文桌面：系统设置列表，点击「远程协助」行",
      taskText: "在系统设置里，点『远程协助』那一行，进入设置。",
      targetText: "远程协助",
      png: "d2-desktop-settingsrow.png",
      target,
      ocrWords: [
        { text: "系统设置", x: 12, y: 44, w: 80, h: 20 },
        { text: "自动更新", x: 60, y: 134, w: 80, h: 20 },
        { text: "远程协助", x: 60, y: 214, w: 80, h: 20 },
      ],
    }),
  }
}

function desktopDialogSave() {
  // 「文档保存」对话框：文件名 + 取消/保存，任务点 保存。
  const img = baseWindow("SAVE DOCUMENT", "保存文档")
  fillRect(img, 60, 90, 520, 260, [250, 250, 250, 255])
  strokeRect(img, 60, 90, 520, 260, [150, 150, 150, 255], 2)
  drawCjk(img, 90, 120, "文件名", 18, [40, 40, 40, 255])
  strokeRect(img, 160, 118, 280, 28, [120, 120, 120, 255], 2)
  drawAscii(img, 170, 126, "report-final.docx", [40, 40, 40, 255], 2)
  drawCjkButton(img, 360, 300, 90, 36, [140, 140, 140, 255], "取消", 16)
  drawCjkButton(img, 470, 300, 90, 36, BLUE, "保存", 16)
  const target = { x: 470, y: 300, w: 90, h: 36 }
  return {
    png: img,
    meta: fixtureShell({
      id: "d3-desktop-save",
      form: "desktop",
      title: "中文桌面：保存对话框，点「保存」",
      taskText: "文件名叫 report-final.docx，点保存按钮。",
      targetText: "保存",
      png: "d3-desktop-save.png",
      target,
      ocrWords: [
        { text: "文件名", x: 90, y: 120, w: 54, h: 18 },
        { text: "取消", x: 360, y: 300, w: 90, h: 36 },
        { text: "保存", x: 470, y: 300, w: 90, h: 36 },
      ],
    }),
  }
}

function desktopSearchRow() {
  // 「订单查询」：搜索框 + 结果行（含 查看详情 链接），任务点第一行查看详情。
  const img = baseWindow("ORDER SEARCH", "订单查询")
  strokeRect(img, 60, 80, 360, 32, [150, 150, 150, 255], 2)
  drawCjk(img, 70, 87, "输入订单号", 16, [140, 140, 140, 255])
  drawCjkButton(img, 440, 80, 90, 32, BLUE, "搜索", 16)
  const rows = [
    { y: 160, label: "订单 #20260901  已支付" },
    { y: 220, label: "订单 #20260815  待发货" },
  ]
  for (const r of rows) {
    fillRect(img, 60, r.y, 520, 40, [250, 250, 250, 255])
    strokeRect(img, 60, r.y, 520, 40, [180, 180, 180, 255], 1)
    drawAscii(img, 70, r.y + 8, r.label, [40, 40, 40, 255], 2)
    drawCjkButton(img, 490, r.y + 4, 80, 32, [120, 170, 220, 255], "查看详情", 14)
  }
  const target = { x: 490, y: 160, w: 80, h: 32 }
  return {
    png: img,
    meta: fixtureShell({
      id: "d4-desktop-search",
      form: "desktop",
      title: "中文桌面：订单查询结果，点第一行「查看详情」",
      taskText: "搜索结果显示两个订单，点第一条订单的查看详情。",
      targetText: "查看详情",
      png: "d4-desktop-search.png",
      target,
      ocrWords: [
        { text: "输入订单号", x: 70, y: 87, w: 96, h: 16 },
        { text: "搜索", x: 440, y: 80, w: 90, h: 32 },
        { text: "查看详情", x: 490, y: 160, w: 80, h: 32 },
      ],
    }),
  }
}

function desktopFormField() {
  // 「新建联系人」：姓名/邮箱/保存，任务点 保存（表单下方）。
  const img = baseWindow("NEW CONTACT", "新建联系人")
  drawCjk(img, 80, 110, "姓名", 18, [40, 40, 40, 255])
  strokeRect(img, 160, 108, 300, 28, [150, 150, 150, 255], 2)
  drawCjk(img, 80, 180, "邮箱", 18, [40, 40, 40, 255])
  strokeRect(img, 160, 178, 300, 28, [150, 150, 150, 255], 2)
  drawCjkButton(img, 300, 320, 100, 38, GREEN, "保存", 18)
  drawCjkButton(img, 420, 320, 100, 38, [140, 140, 140, 255], "取消", 18)
  const target = { x: 300, y: 320, w: 100, h: 38 }
  return {
    png: img,
    meta: fixtureShell({
      id: "d5-desktop-form",
      form: "desktop",
      title: "中文桌面：新建联系人表单，点「保存」",
      taskText: "填写联系人表单后点保存。",
      targetText: "保存",
      png: "d5-desktop-form.png",
      target,
      ocrWords: [
        { text: "姓名", x: 80, y: 110, w: 36, h: 18 },
        { text: "邮箱", x: 80, y: 180, w: 36, h: 18 },
        { text: "保存", x: 300, y: 320, w: 100, h: 38 },
        { text: "取消", x: 420, y: 320, w: 100, h: 38 },
      ],
    }),
  }
}

// --- 形态 B：OSR（offscreen / 无 UIA 的工具条形态，5 例） -----------------------

function osrToolbar() {
  // 垂直工具条：图标（ASCII 方块）+ 中文标签（加粗/常规），点「导出」。
  const img = createCanvas(640, 480, [220, 222, 228, 255])
  fillRect(img, 20, 20, 600, 440, [238, 238, 240, 255])
  const items = ["导入", "导出", "刷新", "删除"]
  for (let i = 0; i < items.length; i++) {
    const y = 60 + i * 90
    strokeRect(img, 80, y, 48, 48, [120, 120, 120, 255], 2)
    drawCjkButton(img, 150, y + 4, 120, 40, items[i] === "导出" ? BLUE : [170, 170, 170, 255], items[i], 18)
  }
  const target = { x: 150, y: 150, w: 120, h: 40 }
  return {
    png: img,
    meta: fixtureShell({
      id: "d6-osr-toolbar",
      form: "osr",
      title: "OSR 工具条：点「导出」",
      taskText: "在工具栏里点导出。",
      targetText: "导出",
      png: "d6-osr-toolbar.png",
      target,
      ocrWords: [
        { text: "导入", x: 150, y: 60, w: 120, h: 40 },
        { text: "导出", x: 150, y: 150, w: 120, h: 40 },
        { text: "刷新", x: 150, y: 240, w: 120, h: 40 },
        { text: "删除", x: 150, y: 330, w: 120, h: 40 },
      ],
    }),
  }
}

function osrStatusBar() {
  // 状态栏：多个状态项，点「同步状态」圆点。
  const img = createCanvas(640, 480, [205, 208, 215, 255])
  fillRect(img, 20, 40, 600, 60, [238, 238, 240, 255])
  const items = ["连接正常", "同步状态", "电池 82%", "音量"]
  const xs = [40, 180, 330, 460]
  for (let i = 0; i < items.length; i++) {
    // 图标点
    fillRect(img, xs[i], 62, 14, 14, i === 1 ? GREEN : [150, 150, 150, 255])
    drawCjk(img, xs[i] + 24, 58, items[i], 16, [40, 40, 40, 255])
  }
  const target = { x: 180, y: 52, w: 80, h: 30 }
  return {
    png: img,
    meta: fixtureShell({
      id: "d7-osr-statusbar",
      form: "osr",
      title: "OSR 状态栏：点「同步状态」",
      taskText: "点一下状态栏里的同步状态。",
      targetText: "同步状态",
      png: "d7-osr-statusbar.png",
      target,
      ocrWords: [
        { text: "连接正常", x: 40, y: 52, w: 80, h: 30 },
        { text: "同步状态", x: 180, y: 52, w: 80, h: 30 },
      ],
    }),
  }
}

function osrPanelRow() {
  // OSR 面板：图标 + 名称行，点「开发者选项」行。
  const img = createCanvas(640, 480, [210, 212, 218, 255])
  fillRect(img, 40, 30, 560, 420, [245, 245, 247, 255])
  const rows = ["蓝牙", "Wi-Fi", "开发者选项", "关于本机"]
  for (let i = 0; i < rows.length; i++) {
    const y = 70 + i * 85
    fillRect(img, 60, y, 520, 65, [255, 255, 255, 255])
    strokeRect(img, 60, y, 520, 65, [200, 200, 200, 255], 1)
    fillRect(img, 80, y + 16, 32, 32, [170, 170, 220, 255])
    drawCjk(img, 140, y + 22, rows[i], 20, [40, 40, 40, 255])
  }
  const target = { x: 60, y: 240, w: 520, h: 65 }
  return {
    png: img,
    meta: fixtureShell({
      id: "d8-osr-panelrow",
      form: "osr",
      title: "OSR 面板行：点「开发者选项」",
      taskText: "打开开发者选项。",
      targetText: "开发者选项",
      png: "d8-osr-panelrow.png",
      target,
      ocrWords: [
        { text: "蓝牙", x: 140, y: 86, w: 40, h: 20 },
        { text: "Wi-Fi", x: 140, y: 171, w: 60, h: 20 },
        { text: "开发者选项", x: 140, y: 256, w: 100, h: 20 },
        { text: "关于本机", x: 140, y: 341, w: 80, h: 20 },
      ],
    }),
  }
}

function osrTrayMenu() {
  // 托盘菜单展开：菜单项，点「退出登录」。
  const img = createCanvas(640, 480, [215, 217, 222, 255])
  // 菜单面板
  fillRect(img, 320, 40, 280, 360, [252, 252, 252, 255])
  strokeRect(img, 320, 40, 280, 360, [180, 180, 180, 255], 2)
  const items = ["打开主界面", "设置", "暂停提醒", "退出登录"]
  for (let i = 0; i < items.length; i++) {
    const y = 60 + i * 78
    fillRect(img, 330, y, 260, 60, i === 3 ? [250, 235, 235, 255] : [255, 255, 255, 255])
    drawCjk(img, 350, y + 18, items[i], 20, i === 3 ? [180, 40, 40, 255] : [40, 40, 40, 255])
  }
  const target = { x: 330, y: 294, w: 260, h: 60 }
  return {
    png: img,
    meta: fixtureShell({
      id: "d9-osr-traymenu",
      form: "osr",
      title: "OSR 托盘菜单：点「退出登录」",
      taskText: "展开托盘菜单，点退出登录。",
      targetText: "退出登录",
      png: "d9-osr-traymenu.png",
      target,
      ocrWords: [
        { text: "打开主界面", x: 350, y: 78, w: 100, h: 20 },
        { text: "设置", x: 350, y: 156, w: 40, h: 20 },
        { text: "暂停提醒", x: 350, y: 234, w: 80, h: 20 },
        { text: "退出登录", x: 350, y: 312, w: 80, h: 20 },
      ],
    }),
  }
}

function osrFloatWidget() {
  // 悬浮小组件（日历控件右上角日期），点「今天」快捷钮。
  const img = createCanvas(640, 480, [200, 202, 208, 255])
  fillRect(img, 180, 60, 300, 200, [250, 250, 250, 255])
  strokeRect(img, 180, 60, 300, 200, [160, 160, 160, 255], 2)
  drawAscii(img, 210, 80, "SEP 2026", [60, 60, 60, 255], 2)
  drawCjkButton(img, 330, 76, 110, 34, BLUE, "今天", 16)
  // 日历格子（示意）
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) strokeRect(img, 205 + c * 52, 130 + r * 40, 44, 32, [210, 210, 210, 255], 1)
  const target = { x: 330, y: 76, w: 110, h: 34 }
  return {
    png: img,
    meta: fixtureShell({
      id: "d10-osr-widget",
      form: "osr",
      title: "OSR 悬浮小组件：点「今天」",
      taskText: "在日历小组件里点今天。",
      targetText: "今天",
      png: "d10-osr-widget.png",
      target,
      ocrWords: [
        { text: "今天", x: 330, y: 76, w: 110, h: 34 },
      ],
    }),
  }
}

// --- corpus -------------------------------------------------------------------

const FIXTURE_BUILDERS = [
  desktopApproval,
  desktopSettingsToggle,
  desktopDialogSave,
  desktopSearchRow,
  desktopFormField,
  osrToolbar,
  osrStatusBar,
  osrPanelRow,
  osrTrayMenu,
  osrFloatWidget,
]

export function buildCorpus() {
  const files = []
  const fixtures = []
  for (const b of FIXTURE_BUILDERS) {
    const out = b()
    if (out.png) {
      files.push({ name: out.meta.png, bytes: encodePng(out.png.width, out.png.height, out.png.rgba) })
    }
    fixtures.push(out.meta)
  }
  const corpus = {
    version: 1,
    ticket: "#362 CU-D",
    generatedBy: "companion/scripts/gen-cu-locate-eval-fixtures.mjs（确定性；--check 逐字节校验）",
    purpose:
      "本机定位 held-out 评测集（CU-D）：正常界面中文点按定位。非对抗集——对抗样本在 #361 (CU-C) cu-redteam，两集样本不重叠，红队样本不计入本集准确率。",
    forms: { desktop: 5, osr: 5 },
    goldenInPrompt: false, // golden 不进提示/训练（红线）
    window: { rect: RECT, client: CLIENT },
    fixtures,
  }
  return { corpus, files }
}
