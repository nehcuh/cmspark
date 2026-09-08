import { deflateSync } from "node:zlib"
// CMspark: independent systems converge at one spark. 24-unit geometry, no blur.
export const BRAND_COLORS = { green: [22, 132, 93], red: [213, 67, 67], yellow: [182, 124, 24], template: [0, 0, 0] }
const endpoints = [[5, 5], [5, 19], [20, 12]]
function segmentDistance(x, y, ax, ay, bx, by) {
  const t = Math.max(0, Math.min(1, ((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)))
  return Math.hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay))
}
function insideMark(x, y) {
  return endpoints.some(([a,b]) => Math.hypot(x-a,y-b) <= 2.3 || segmentDistance(x,y,a,b,12,12) <= 1.15)
    || Math.abs(x-12)+Math.abs(y-12) <= 4.5
}
/** Coverage supersampling only at silhouette edges; interiors are solid color. */
export function renderMark(size, scheme = "green", tile = false) {
  const out = Buffer.alloc(size*size*4), samples = 4
  const mark = tile ? [76, 224, 170] : BRAND_COLORS[scheme]
  if (!mark) throw new Error("Unknown icon scheme")
  for (let py=0;py<size;py++) for(let px=0;px<size;px++) {
    let a=0,r=0,g=0,b=0
    for(let sy=0;sy<samples;sy++) for(let sx=0;sx<samples;sx++) {
      const x=(px+(sx+.5)/samples)*24/size,y=(py+(sy+.5)/samples)*24/size
      const mx=tile?(x-12)/.78+12:x,my=tile?(y-12)/.78+12:y
      let color = insideMark(mx,my) && !(scheme === "red" && Math.hypot(mx-12,my-12)<1.9) ? mark : null
      if (!color && tile) {
        const dx=Math.max(Math.abs(x-12)-6.5,0),dy=Math.max(Math.abs(y-12)-6.5,0)
        if (Math.hypot(dx,dy)<=4.5) color=[21,29,44]
      }
      if(color){a++;r+=color[0];g+=color[1];b+=color[2]}
    }
    const i=(py*size+px)*4
    if(a){out[i]=Math.round(r/a);out[i+1]=Math.round(g/a);out[i+2]=Math.round(b/a);out[i+3]=Math.round(a/(samples*samples)*255)}
  }
  return out
}
export function markSvg(color = "#16845d") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}"><path d="M5 5 12 12 5 19M12 12H20" fill="none" stroke="${color}" stroke-width="2.3" stroke-linecap="round"/>${endpoints.map(([x,y])=>`<circle cx="${x}" cy="${y}" r="2.3"/>`).join("")}<path d="m12 7.5 4.5 4.5-4.5 4.5L7.5 12Z"/></svg>
`
}
export function encodeICO(images) {
  const header=Buffer.alloc(6+16*images.length);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4)
  let offset=header.length
  images.forEach(({size,png},i)=>{const p=6+i*16;header[p]=size===256?0:size;header[p+1]=header[p];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(png.length,p+8);header.writeUInt32LE(offset,p+12);offset+=png.length})
  return Buffer.concat([header,...images.map(i=>i.png)])
}

export function encodePNG(width, height, rgbaPixels) {
  const scanlines = []
  for (let y = 0; y < height; y++) {
    const row = rgbaPixels.slice(y * width * 4, (y + 1) * width * 4)
    scanlines.push(Buffer.from([0]))  // filter: None
    scanlines.push(row)
  }
  const raw = Buffer.concat(scanlines)
  const compressed = deflateSync(raw, { level: 9 })

  const chunks = []
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)   // bit depth
  ihdr.writeUInt8(6, 9)   // RGBA
  chunks.push(pngChunk("IHDR", ihdr))
  chunks.push(pngChunk("IDAT", compressed))
  chunks.push(pngChunk("IEND", Buffer.alloc(0)))

  return Buffer.concat(chunks)
}

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii")
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0)
  return Buffer.concat([len, t, data, crcBuf])
}

function crc32(buf) {
  let crc = 0xffffffff
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[i] = c
  }
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
