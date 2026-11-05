// Read only the CFB streams used to identify Word 97–2003. The existing
// Office converter remains responsible for parsing the document itself.
const CFB_SIGNATURE = Buffer.from("d0cf11e0a1b11ae1", "hex")
const FREE = 0xffffffff
const END = 0xfffffffe
const FAT_SECTOR = 0xfffffffd
const DIFAT_SECTOR = 0xfffffffc
const MINI_SIZE = 64
const MINI_CUTOFF = 4096
const DIRECTORY_ENTRY_SIZE = 128
// nFib -> number of 8-byte offset/length pairs in the FIB.
const FIB_FIELD_COUNTS = new Map([
  [0x00c1, 93], [0x00d9, 108], [0x0101, 136], [0x010c, 164], [0x0112, 183],
])

function requireStructure(condition: unknown): asserts condition {
  if (!condition) throw new Error("Invalid Word compound file")
}

function readWordStreams(file: Buffer): { word: Buffer; table: Buffer } {
  requireStructure(file.length >= 512 && file.subarray(0, 8).equals(CFB_SIGNATURE))
  const version = file.readUInt16LE(26)
  const sectorShift = file.readUInt16LE(30)
  requireStructure((version === 3 && sectorShift === 9) || (version === 4 && sectorShift === 12))
  const sectorSize = 1 << sectorShift
  const sectorCount = file.length / sectorSize - 1
  requireStructure(Number.isInteger(sectorCount) && sectorCount >= 2 &&
    file.readUInt16LE(28) === 0xfffe && file.readUInt16LE(32) === 6 &&
    file.readUInt32LE(56) === MINI_CUTOFF)

  // Each physical sector may be used once across the allocation structures
  // and streams we read. This also bounds malformed chains with cycles.
  const used = new Set<number>()
  function takeSector(index: number): Buffer {
    requireStructure(index < sectorCount && !used.has(index))
    used.add(index)
    return file.subarray((index + 1) * sectorSize, (index + 2) * sectorSize)
  }

  const fatCount = file.readUInt32LE(44)
  const difatCount = file.readUInt32LE(72)
  requireStructure(fatCount > 0 && fatCount + difatCount < sectorCount &&
    fatCount * (sectorSize / 4) >= sectorCount)
  const fatSectors: Buffer[] = []
  const fatIndices: number[] = []
  const difatIndices: number[] = []
  function collectFat(block: Buffer) {
    for (let offset = 0; offset < block.length; offset += 4) {
      const index = block.readUInt32LE(offset)
      if (index === FREE) continue
      requireStructure(fatSectors.length < fatCount)
      fatSectors.push(takeSector(index))
      fatIndices.push(index)
    }
  }

  collectFat(file.subarray(76, 512))
  let nextDifat = file.readUInt32LE(68)
  for (let i = 0; i < difatCount; i++) {
    difatIndices.push(nextDifat)
    const sector = takeSector(nextDifat)
    collectFat(sector.subarray(0, sectorSize - 4))
    nextDifat = sector.readUInt32LE(sectorSize - 4)
  }
  requireStructure(fatSectors.length === fatCount && (nextDifat === END || (difatCount === 0 && nextDifat === FREE)))

  function fatNext(index: number): number {
    const byteOffset = index * 4
    return fatSectors[Math.floor(byteOffset / sectorSize)].readUInt32LE(byteOffset % sectorSize)
  }
  requireStructure(fatIndices.every(index => fatNext(index) === FAT_SECTOR) &&
    difatIndices.every(index => fatNext(index) === DIFAT_SECTOR))

  function readChain(start: number, count?: number): Buffer {
    const sectors: Buffer[] = []
    for (let index = start; index !== END; index = fatNext(index)) {
      requireStructure(count === undefined || sectors.length < count)
      sectors.push(takeSector(index))
    }
    requireStructure(count === undefined || sectors.length === count)
    return Buffer.concat(sectors)
  }

  const directory = readChain(file.readUInt32LE(48), version === 4 ? file.readUInt32LE(40) : undefined)
  requireStructure(directory.length >= DIRECTORY_ENTRY_SIZE && directory[66] === 5)
  const root = directory.subarray(0, DIRECTORY_ENTRY_SIZE)
  const children = new Map<string, Buffer>()
  const pending = [root.readUInt32LE(76)]
  const seen = new Set<number>()
  while (pending.length) {
    const index = pending.pop()!
    if (index === FREE) continue
    requireStructure(index > 0 && index < directory.length / DIRECTORY_ENTRY_SIZE && !seen.has(index))
    seen.add(index)
    const offset = index * DIRECTORY_ENTRY_SIZE
    const entry = directory.subarray(offset, offset + DIRECTORY_ENTRY_SIZE)
    const nameLength = entry.readUInt16LE(64)
    requireStructure((entry[66] === 1 || entry[66] === 2) &&
      nameLength >= 4 && nameLength <= 64 && nameLength % 2 === 0 &&
      entry.readUInt16LE(nameLength - 2) === 0)
    const name = entry.toString("utf16le", 0, nameLength - 2).toLowerCase()
    requireStructure(!children.has(name))
    children.set(name, entry)
    pending.push(entry.readUInt32LE(68), entry.readUInt32LE(72))
  }

  function streamSize(entry: Buffer): number {
    const size = entry.readUInt32LE(120)
    requireStructure(size > 0 && size <= file.length && (version === 3 || entry.readUInt32LE(124) === 0))
    return size
  }

  // MS-CFB permits stream chains to allocate more sectors than the declared size.
  function readRegularStream(start: number, size: number): Buffer {
    const stream = readChain(start)
    requireStructure(stream.length >= size)
    return stream.subarray(0, size)
  }

  let miniFat: Buffer | undefined
  let miniStream: Buffer | undefined
  const usedMini = new Set<number>()
  function readStream(name: string): Buffer {
    const entry = children.get(name)
    requireStructure(entry?.[66] === 2)
    const size = streamSize(entry)
    let index = entry.readUInt32LE(116)
    if (size >= MINI_CUTOFF) {
      return readRegularStream(index, size)
    }
    if (!miniFat || !miniStream) {
      const rootSize = streamSize(root)
      miniFat = readChain(file.readUInt32LE(60), file.readUInt32LE(64))
      miniStream = readRegularStream(root.readUInt32LE(116), rootSize)
    }

    const parts: Buffer[] = []
    for (let offset = 0; index !== END; offset += MINI_SIZE) {
      const start = index * MINI_SIZE
      requireStructure(start + MINI_SIZE <= miniStream.length && index * 4 + 4 <= miniFat.length && !usedMini.has(index))
      usedMini.add(index)
      if (offset < size) parts.push(miniStream.subarray(start, start + MINI_SIZE))
      index = miniFat.readUInt32LE(index * 4)
    }
    requireStructure(parts.length * MINI_SIZE >= size)
    return Buffer.concat(parts, size)
  }

  const word = readStream("worddocument")
  requireStructure(word.length >= 154 && word.readUInt16LE(0) === 0xa5ec)
  const flags = word.readUInt16LE(10)
  requireStructure((flags & 0x0100) === 0) // fEncrypted covers password encryption and XOR obfuscation
  return { word, table: readStream(flags & 0x0200 ? "1table" : "0table") }
}

/** MS-DOC FibRgFcLcb97 and Clx identify the actual text pieces in WordDocument. */
export function isWpsWithWordDocContent(file: Buffer): boolean {
  try {
    const { word, table } = readWordStreams(file)
    const fieldCount = word.readUInt16LE(152)
    const extensionOffset = 154 + fieldCount * 8
    requireStructure(word.readUInt16LE(32) === 14 && word.readUInt16LE(62) === 22 &&
      extensionOffset + 2 <= word.length)
    const extensionWords = word.readUInt16LE(extensionOffset)
    const fibEnd = extensionOffset + 2 + extensionWords * 2
    requireStructure(fibEnd <= word.length && [0, 2, 5].includes(extensionWords))
    const baseVersion = word.readUInt16LE(2)
    const version = extensionWords === 0 ? baseVersion : word.readUInt16LE(extensionOffset + 2)
    requireStructure(FIB_FIELD_COUNTS.has(baseVersion) && FIB_FIELD_COUNTS.get(version) === fieldCount)
    const clxField = 154 + 33 * 8
    let offset = word.readUInt32LE(clxField)
    const end = offset + word.readUInt32LE(clxField + 4)
    requireStructure(end <= table.length)
    while (offset + 3 <= end && table[offset] === 1) {
      offset += 3 + table.readUInt16LE(offset + 1)
    }
    if (offset + 5 > end || table[offset] !== 2) return false
    const pieceTableSize = table.readUInt32LE(offset + 1)
    const pieceCount = (pieceTableSize - 4) / 12
    const positions = offset + 5
    if (positions + pieceTableSize !== end || !Number.isInteger(pieceCount) ||
        pieceCount < 1 || table.readUInt32LE(positions) !== 0) return false
    const pieces = positions + (pieceCount + 1) * 4
    const mainTextLength = word.readUInt32LE(76)
    let previous = 0
    for (let i = 0; i < pieceCount; i++) {
      const next = table.readUInt32LE(positions + (i + 1) * 4)
      const fc = table.readUInt32LE(pieces + i * 8 + 2)
      const compressed = (fc & 0x40000000) !== 0
      const byteOffset = (fc & 0x3fffffff) / (compressed ? 2 : 1)
      const byteLength = (next - previous) * (compressed ? 1 : 2)
      if (next <= previous || fc >= 0x80000000 || !Number.isInteger(byteOffset) ||
          byteOffset < fibEnd || byteOffset + byteLength > word.length) return false
      previous = next
    }
    return mainTextLength > 0 && previous >= mainTextLength
  } catch {
    return false
  }
}
