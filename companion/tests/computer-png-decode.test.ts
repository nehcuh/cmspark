// WP5-I4 WI-4.3 — png-decode 单测：自研编码器往返一致性（过滤类型 0-4 ×
// color type 0/2/4/6）+ 畸形 fail-closed 矩阵。
//
// 编码器是测试内私有件：PNG spec §6 前向过滤（Sub/Up/Average/Paeth）正确实现，
// 往返一致即双向验证（解码器反过滤错则像素回不来了）。CRC 填零——解码器按
// 设计不校验 CRC（文件头注释：源流可信 + 证据链 sha256 已锁定字节）。
// 真实 System.Drawing 截图形态（8-bit 非隔行 ct6/2）被 ct6/ct2 用例覆盖。

import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

import { decodePngToRgba } from "../src/computer/png-decode";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

const BPP: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** RGBA 源像素 → 目标 colorType 的原始行字节（gray 取 r 通道，要求测试像素 r=g=b）。 */
function toSourceRows(rgba: Uint8Array, width: number, height: number, colorType: number): Uint8Array {
  const bpp = BPP[colorType]!;
  const out = new Uint8Array(width * height * bpp);
  for (let i = 0; i < width * height; i++) {
    const s = i * 4;
    const d = i * bpp;
    if (colorType === 6) {
      out[d] = rgba[s]!; out[d + 1] = rgba[s + 1]!; out[d + 2] = rgba[s + 2]!; out[d + 3] = rgba[s + 3]!;
    } else if (colorType === 2) {
      out[d] = rgba[s]!; out[d + 1] = rgba[s + 1]!; out[d + 2] = rgba[s + 2]!;
    } else if (colorType === 4) {
      out[d] = rgba[s]!; out[d + 1] = rgba[s + 3]!;
    } else {
      out[d] = rgba[s]!;
    }
  }
  return out;
}

function encodePng(opts: {
  width: number;
  height: number;
  colorType: 0 | 2 | 4 | 6;
  pixels: Uint8Array; // RGBA
  filter: 0 | 1 | 2 | 3 | 4;
  splitIdat?: boolean;
  bitDepth?: number;
  interlace?: number;
}): Buffer {
  const { width, height, colorType, filter } = opts;
  // 畸形用例（colorType 3）编码时按 RGBA 行处理，仅 IHDR 字节写目标值
  const bpp = BPP[colorType] ?? 4;
  const stride = width * bpp;
  const src = toSourceRows(opts.pixels, width, height, BPP[colorType] === undefined ? 6 : colorType);
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = filter;
    for (let i = 0; i < stride; i++) {
      const cur = src[y * stride + i]!;
      const left = i >= bpp ? src[y * stride + i - bpp]! : 0;
      const up = y > 0 ? src[(y - 1) * stride + i]! : 0;
      const upLeft = y > 0 && i >= bpp ? src[(y - 1) * stride + i - bpp]! : 0;
      let v: number;
      if (filter === 0) v = cur;
      else if (filter === 1) v = cur - left;
      else if (filter === 2) v = cur - up;
      else if (filter === 3) v = cur - ((left + up) >> 1);
      else v = cur - paeth(left, up, upLeft);
      raw[y * (1 + stride) + 1 + i] = v & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = opts.bitDepth ?? 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = opts.interlace ?? 0;
  const deflated = deflateSync(raw);
  const idats = opts.splitIdat
    ? [chunk("IDAT", deflated.subarray(0, 3)), chunk("IDAT", deflated.subarray(3))]
    : [chunk("IDAT", deflated)];
  return Buffer.concat([SIG, chunk("IHDR", ihdr), ...idats, chunk("IEND", Buffer.alloc(0))]);
}

/** 确定性伪随机 RGBA（可复现，不用 Math.random）。 */
function pixels(width: number, height: number, gray = false): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  let s = 0x2f6e2b1b;
  for (let i = 0; i < out.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const r = s & 0xff;
    const g = (s >> 8) & 0xff;
    const b = (s >> 16) & 0xff;
    out[i] = gray ? r : r;
    out[i + 1] = gray ? r : g;
    out[i + 2] = gray ? r : b;
    out[i + 3] = 255 - (i % 251);
  }
  return out;
}

test("往返一致：colorType 6 × 过滤 0-4", () => {
  const px = pixels(5, 3);
  for (const filter of [0, 1, 2, 3, 4] as const) {
    const png = encodePng({ width: 5, height: 3, colorType: 6, pixels: px, filter });
    const out = decodePngToRgba(png);
    assert.strictEqual(out.width, 5);
    assert.strictEqual(out.height, 3);
    assert.deepStrictEqual([...out.rgba], [...px], `filter=${filter} 像素须逐字节还原`);
  }
});

test("往返一致：退化尺寸 1×1 / 1×7 / 9×1（Sub/Paeth 左邻居边界）", () => {
  for (const [w, h] of [[1, 1], [1, 7], [9, 1]] as const) {
    for (const filter of [1, 4] as const) {
      const px = pixels(w, h);
      const png = encodePng({ width: w, height: h, colorType: 6, pixels: px, filter });
      const out = decodePngToRgba(png);
      assert.deepStrictEqual([...out.rgba], [...px], `${w}×${h} filter=${filter}`);
    }
  }
});

test("往返一致：colorType 2（RGB 扩展 alpha=255）与多 IDAT 拼接", () => {
  const px = pixels(4, 4);
  const png = encodePng({ width: 4, height: 4, colorType: 2, pixels: px, filter: 4, splitIdat: true });
  const out = decodePngToRgba(png);
  const expected = [...px];
  for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
  assert.deepStrictEqual([...out.rgba], expected);
});

test("往返一致：colorType 0（gray）与 4（gray+alpha）", () => {
  const px = pixels(3, 3, true);
  const g = encodePng({ width: 3, height: 3, colorType: 0, pixels: px, filter: 3 });
  const outG = decodePngToRgba(g);
  for (let i = 0; i < 9; i++) {
    assert.strictEqual(outG.rgba[i * 4], px[i * 4]);
    assert.strictEqual(outG.rgba[i * 4 + 1], px[i * 4]);
    assert.strictEqual(outG.rgba[i * 4 + 2], px[i * 4]);
    assert.strictEqual(outG.rgba[i * 4 + 3], 255);
  }
  const ga = encodePng({ width: 3, height: 3, colorType: 4, pixels: px, filter: 2 });
  const outGa = decodePngToRgba(ga);
  for (let i = 0; i < 9; i++) {
    assert.strictEqual(outGa.rgba[i * 4], px[i * 4]);
    assert.strictEqual(outGa.rgba[i * 4 + 3], px[i * 4 + 3], "gray+alpha 的 alpha 通道保留");
  }
});

test("畸形矩阵 fail-closed：签名/截断/bit depth/调色板/隔行/deflate/未知过滤", () => {
  const px = pixels(2, 2);
  const good = encodePng({ width: 2, height: 2, colorType: 6, pixels: px, filter: 0 });
  assert.throws(() => decodePngToRgba(Buffer.from("not a png at all")), /签名不符/);
  assert.throws(() => decodePngToRgba(good.subarray(0, good.length - 6)), /截断|IEND/);
  assert.throws(
    () => decodePngToRgba(encodePng({ width: 2, height: 2, colorType: 6, pixels: px, filter: 0, bitDepth: 16 })),
    /bit depth/,
  );
  assert.throws(
    () => decodePngToRgba(encodePng({ width: 2, height: 2, colorType: 3 as never, pixels: px, filter: 0 })),
    /color type/,
  );
  assert.throws(
    () => decodePngToRgba(encodePng({ width: 2, height: 2, colorType: 6, pixels: px, filter: 0, interlace: 1 })),
    /隔行/,
  );
  // deflate 损坏：翻转 IDAT 末数据字节（adler32 校验位区，inflate 必抛）
  const corrupted = Buffer.from(good);
  corrupted[corrupted.length - 17]! ^= 0xff;
  assert.throws(() => decodePngToRgba(corrupted), /deflate|长度不符/);
  // 未知过滤类型：手工构造 raw（filter=7）
  const stride = 2 * 4;
  const rawBad = Buffer.alloc(2 * (1 + stride));
  rawBad[0] = 7;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const bad = Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rawBad)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  assert.throws(() => decodePngToRgba(bad), /过滤类型/);
});

test("解压炸弹 fail-closed（I4 对抗 P2）：IDAT 解压量超 IHDR 期望 → inflate 期即拒（maxOutputLength 硬顶）", () => {
  // IHDR 声明 2×2 rgba（期望 2*(1+8)=18 字节），IDAT 实为 1MB 压缩负载——
  // maxOutputLength=expected 使超限在解压期抛 ERR_BUFFER_TOO_LARGE（实测
  // RangeError），解码器折叠为 fail-closed Error，不先全量解压再比对。
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const bomb = Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(1024 * 1024, 1))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  assert.throws(() => decodePngToRgba(bomb), /deflate 损坏或输出超限/);
  // 欠长形态（inflate 成功但长度不足）仍走长度比对 fail-closed——双路径皆拒
  const short = Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(5, 0))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  assert.throws(() => decodePngToRgba(short), /长度不符/);
});
