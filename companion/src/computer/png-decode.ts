// WP5-I4 WI-4.3 — 最小 PNG 解码（→ RGBA），decodeFrame 生产实现的唯一缺失件。
//
// 为什么自研（不引依赖）：
//   - 无新依赖纪律（WP5 风险边界）：companion dependencies 无 pngjs/sharp/jimp，
//     新增依赖即供应链面扩大；Node 内置 zlib 已覆盖 inflate，本模块只做
//     chunk 解析 + scanline 反过滤（确定性纯逻辑，测试锁定往返一致）。
//   - 输入形态收敛：decodeFrame 唯一生产来源是 computer-capture.ps1
//     （System.Drawing ImageFormat::Png → 8-bit、非隔行、color type 6/2）。
//     本解码器覆盖 color type 0/2/4/6 + 过滤类型 0-4；16-bit / 调色板 /
//     Adam7 隔行一律抛错——locator 折叠为 tinyclick-error 诚实失败，
//     不静默降级、不编造帧。
//   - 不校验 CRC：源流是本地采集进程的可信输出，且 shot.sha256 已在证据链
//     锁定字节；解码本身失败即诚实信号。畸形（签名错/截断/未知过滤类型）
//     全部 fail-closed 抛 Error。

import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 防御性上限：截图不可能超 8192²（locator 包线另有 1920 帧宽上限）。 */
const MAX_DIMENSION = 8192;

function fail(message: string): never {
  throw new Error(`PNG 解码失败: ${message}`);
}

/** Paeth 预测器（PNG spec §6.6）。 */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * PNG 字节 → RGBA 帧。支持 8-bit gray(0)/rgb(2)/gray+alpha(4)/rgba(6)，
 * 非隔行；输出恒 RGBA（gray/rgb 扩展 alpha=255）。
 * 任何不支持形态或畸形输入抛 Error（fail-closed）。
 */
export function decodePngToRgba(bytes: Uint8Array): {
  rgba: Uint8Array;
  width: number;
  height: number;
} {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) fail("签名不符");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawIhdr = false;
  const idat: Buffer[] = [];
  let sawIend = false;

  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) fail(`chunk ${type} 截断`);
    if (!sawIhdr && type !== "IHDR") fail("首个 chunk 非 IHDR");
    if (type === "IHDR") {
      if (length !== 13) fail("IHDR 长度异常");
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8]!;
      colorType = buf[dataStart + 9]!;
      if (buf[dataStart + 10] !== 0) fail("未知压缩方式");
      if (buf[dataStart + 11] !== 0) fail("未知过滤方式");
      interlace = buf[dataStart + 12]!;
      sawIhdr = true;
    } else if (type === "IDAT") {
      idat.push(buf.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      sawIend = true;
      break;
    }
    // 其余 chunk（PLTE/tEXt/…）跳过；调色板图在下方 colorType 检查拒绝
    offset = dataEnd + 4;
  }
  if (!sawIhdr) fail("缺少 IHDR");
  if (!sawIend) fail("缺少 IEND（文件截断）");
  if (idat.length === 0) fail("缺少 IDAT");
  if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    fail(`尺寸越界 ${width}×${height}`);
  }
  if (bitDepth !== 8) fail(`不支持 bit depth ${bitDepth}（仅 8-bit）`);
  if (interlace !== 0) fail("不支持 Adam7 隔行");
  // colorType → 每像素字节数（0=gray,2=rgb,4=gray+alpha,6=rgba；3=调色板拒绝）
  const bpp = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (bpp === 0) fail(`不支持 color type ${colorType}（调色板/未知形态）`);

  const stride = width * bpp;
  const expected = height * (1 + stride);
  let raw: Buffer;
  try {
    // I4 对抗 P2：maxOutputLength 硬顶前移——IHDR 尺寸 inflate 前已知，超限
    // 输入（解压炸弹形）在解压期即拒（ERR_BUFFER_TOO_LARGE），不再先全量
    // 解压到 MAX_LENGTH 上限再比对长度。纵深防御一行修：输入源虽收敛于本机
    // 采集进程输出 + shot.sha256 证据链，硬顶成本为零。
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
  } catch (err) {
    fail(`deflate 损坏或输出超限: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (raw.length !== expected) fail(`解压长度不符：期望 ${expected}，实际 ${raw.length}`);

  // 反过滤（recon 原地重建；prior = 上一行 recon）
  const recon = Buffer.allocUnsafe(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (1 + stride)]!;
    const rowIn = y * (1 + stride) + 1;
    const rowOut = y * stride;
    switch (filter) {
      case 0: // None
        raw.copy(recon, rowOut, rowIn, rowIn + stride);
        break;
      case 1: // Sub
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? recon[rowOut + i - bpp]! : 0;
          recon[rowOut + i] = (raw[rowIn + i]! + left) & 0xff;
        }
        break;
      case 2: // Up
        for (let i = 0; i < stride; i++) {
          const up = y > 0 ? recon[rowOut - stride + i]! : 0;
          recon[rowOut + i] = (raw[rowIn + i]! + up) & 0xff;
        }
        break;
      case 3: // Average
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? recon[rowOut + i - bpp]! : 0;
          const up = y > 0 ? recon[rowOut - stride + i]! : 0;
          recon[rowOut + i] = (raw[rowIn + i]! + ((left + up) >> 1)) & 0xff;
        }
        break;
      case 4: // Paeth
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? recon[rowOut + i - bpp]! : 0;
          const up = y > 0 ? recon[rowOut - stride + i]! : 0;
          const upLeft = y > 0 && i >= bpp ? recon[rowOut - stride + i - bpp]! : 0;
          recon[rowOut + i] = (raw[rowIn + i]! + paeth(left, up, upLeft)) & 0xff;
        }
        break;
      default:
        fail(`未知过滤类型 ${filter}`);
    }
  }

  // 扩展为 RGBA
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * bpp;
    const d = i * 4;
    if (colorType === 6) {
      rgba[d] = recon[s]!;
      rgba[d + 1] = recon[s + 1]!;
      rgba[d + 2] = recon[s + 2]!;
      rgba[d + 3] = recon[s + 3]!;
    } else if (colorType === 2) {
      rgba[d] = recon[s]!;
      rgba[d + 1] = recon[s + 1]!;
      rgba[d + 2] = recon[s + 2]!;
      rgba[d + 3] = 255;
    } else if (colorType === 4) {
      rgba[d] = recon[s]!;
      rgba[d + 1] = recon[s]!;
      rgba[d + 2] = recon[s]!;
      rgba[d + 3] = recon[s + 1]!;
    } else {
      rgba[d] = recon[s]!;
      rgba[d + 1] = recon[s]!;
      rgba[d + 2] = recon[s]!;
      rgba[d + 3] = 255;
    }
  }
  return { rgba, width, height };
}
