// Minimal .npy (v1/v2) reader for little-endian f4/i8 arrays.
const fs = require("fs");

function readNpy(path) {
  const buf = fs.readFileSync(path);
  if (!(buf[0] === 0x93 && buf.toString("latin1", 1, 6) === "NUMPY")) {
    throw new Error("not an npy file: " + path);
  }
  const major = buf[6];
  let off, hlen;
  if (major === 1) {
    hlen = buf.readUInt16LE(8);
    off = 10;
  } else {
    hlen = buf.readUInt32LE(8);
    off = 12;
  }
  const header = buf.toString("latin1", off, off + hlen);
  const descr = /'descr'\s*:\s*'([^']+)'/.exec(header)[1];
  const fortran = /'fortran_order'\s*:\s*(True|False)/.exec(header)[1] === "True";
  const shape = /'shape'\s*:\s*\(([^)]*)\)/.exec(header)[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  if (fortran) throw new Error("fortran order unsupported");
  const dataOff = off + hlen;
  const count = shape.reduce((a, b) => a * b, 1);
  let data;
  if (descr === "<f4") {
    data = new Float32Array(buf.buffer, buf.byteOffset + dataOff, count);
  } else if (descr === "<i8") {
    data = new BigInt64Array(buf.buffer, buf.byteOffset + dataOff, count);
  } else if (descr === "<f8") {
    data = new Float64Array(buf.buffer, buf.byteOffset + dataOff, count);
  } else {
    throw new Error("unsupported dtype " + descr);
  }
  return { data, shape, descr };
}

module.exports = { readNpy };
