/** #465 strict, bounded text unified-diff reader. Syntax is not host coverage. */
export interface DiffLine { text: string; old_line: number | null; new_line: number | null }
export interface DiffFile { old_path: string | null; new_path: string | null; lines: DiffLine[] }

export function validDiffPath(value: string): boolean {
  return value.length > 0 && value.length <= 8192 && !/[\x00-\x1f\x7f-\x9f\\"]/u.test(value)
    && !value.startsWith("/") && !value.split("/").some(part => !part || part === "." || part === "..")
}

export function parseUnifiedDiff(text: string): DiffFile[] {
  function fail(): never { throw new Error("UNSUPPORTED_OR_INCOMPLETE_UNIFIED_DIFF") }
  if (Buffer.byteLength(text, "utf8") > 65536) throw new Error("CODE_REVIEW_CAPACITY")
  const rows = text.split("\n")
  if (rows.at(-1) === "") rows.pop()
  let i = 0
  const files: DiffFile[] = []
  while (i < rows.length) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(rows[i++])
    if (!header || !validDiffPath(header[1]) || !validDiffPath(header[2]) || files.length >= 128) fail()
    // Renames, binary, mode-only and quoted names require explicit future adapters.
    if (header[1] !== header[2]) fail()
    while (/^(index [0-9a-f]+\.\.[0-9a-f]+(?: [0-7]{6})?|(?:new|deleted) file mode [0-7]{6})$/.test(rows[i] || "")) i++
    const old = rows[i++], next = rows[i++]
    if (old !== `--- a/${header[1]}` && old !== "--- /dev/null") fail()
    if (next !== `+++ b/${header[2]}` && next !== "+++ /dev/null") fail()
    const file: DiffFile = { old_path: old === "--- /dev/null" ? null : header[1], new_path: next === "+++ /dev/null" ? null : header[2], lines: [] }
    if (!file.old_path && !file.new_path) fail()
    if (files.some(item => item.old_path === file.old_path && item.new_path === file.new_path)) fail()
    let previousOldEnd = -1, previousNewEnd = -1, hunks = 0
    while (i < rows.length && !rows[i].startsWith("diff --git ")) {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(rows[i++])
      if (!hunk) fail()
      let oldLine = Number(hunk[1]), newLine = Number(hunk[3])
      let oldLeft = Number(hunk[2] ?? 1), newLeft = Number(hunk[4] ?? 1)
      if (![oldLine, newLine, oldLeft, newLeft].every(Number.isSafeInteger)
        || !Number.isSafeInteger(oldLine + oldLeft) || !Number.isSafeInteger(newLine + newLeft)
        || oldLeft + newLeft === 0 || oldLeft > 65536 || newLeft > 65536
        || oldLeft > 0 && oldLine === 0 || newLeft > 0 && newLine === 0
        || oldLine < previousOldEnd || newLine < previousNewEnd
        || !file.old_path && oldLeft !== 0 || !file.new_path && newLeft !== 0) fail()
      while (oldLeft > 0 || newLeft > 0) {
        const row = rows[i++]
        if (typeof row !== "string" || ![" ", "+", "-"].includes(row[0])) fail()
        const takesOld = row[0] !== "+", takesNew = row[0] !== "-"
        if (takesOld && oldLeft <= 0 || takesNew && newLeft <= 0) fail()
        file.lines.push({ text: row.slice(1), old_line: takesOld ? oldLine++ : null, new_line: takesNew ? newLine++ : null })
        if (takesOld) oldLeft--
        if (takesNew) newLeft--
        if (rows[i] === "\\ No newline at end of file") i++
      }
      previousOldEnd = oldLine; previousNewEnd = newLine; hunks++
    }
    if (!hunks || !file.lines.some(line => line.old_line === null || line.new_line === null)) fail()
    files.push(file)
  }
  if (!files.length) fail()
  return files
}
