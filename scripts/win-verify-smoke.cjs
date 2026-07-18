// Windows host-use smoke verification — run AFTER `npm run build` in companion/
//   node scripts/win-verify-smoke.cjs
// Expectations on a machine WITHOUT classic Outlook / OneNote / Hello hardware:
//   checks 1,4,5 = typed honest errors; checks 2,3,6,7 = pass
const path = require("path")
const fs = require("fs")
const os = require("os")

const { hostRead } = require("../companion/dist/host-use/win/index.js")
const { WinHostAdapter } = require("../companion/dist/host-use/win/adapter.js")

let pass = 0, fail = 0
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${extra ? " — " + extra : ""}`) }
  else { fail++; console.log(`FAIL  ${name}${extra ? " — " + extra : ""}`) }
}

async function main() {
  // 1. host_read default (win.outlook.classic) → WinAppNotAvailable on New-Outlook machines
  try {
    await hostRead({})
    ok("1 host_read throws on this machine", false, "unexpectedly succeeded")
  } catch (e) {
    ok("1 host_read typed error (WinAppNotAvailable)", e.name === "WinAppNotAvailable", `${e.name}: ${String(e.message).slice(0, 90)}`)
  }

  const adapter = new WinHostAdapter()
  const docs = path.join(os.homedir(), "Documents")
  const desktop = path.join(os.homedir(), "Desktop")

  // 2. file listing returns win:fs ids that pass the validator
  const ids = await adapter.listReadTargets("file", { limit: 5 })
  ok("2 listReadTargets(file) returns ids", Array.isArray(ids))
  let firstValid = true
  for (const id of ids.slice(0, 5)) { try { adapter.validateTargetId(id) } catch { firstValid = false } }
  ok("2b listed ids pass validateTargetId", firstValid, `${ids.length} ids`)

  // 3. metadata readOne on a listed file (skip gracefully if none listed)
  if (ids.length > 0) {
    const meta = await adapter.readOne(adapter.validateTargetId(ids[0]))
    ok("3 readOne metadata-only (file_path, no body)", !!meta.file_path && meta.body_preview === undefined)
  } else {
    ok("3 readOne metadata-only", true, "skipped (no files in allowlisted roots)")
  }

  // 4. wrong-platform / forged ids rejected
  let forgedRejected = true
  for (const bad of ["macos:com.apple.mail:x:msg-1", "win:evilapp:x:file-AAAA", "win:fs:docs:file-..%2Fx"]) {
    try { adapter.validateTargetId(bad); forgedRejected = false } catch { /* expected */ }
  }
  ok("4 forged/wrong-platform ids rejected", forgedRejected)

  // 5. move within allowlist works (Documents -> Desktop folder -> back)
  // NOTE: destination is a FOLDER (Finder parity — basename preserved)
  const stamp = Date.now()
  const srcName = `cmspark-smoke-${stamp}.txt`
  const src = path.join(docs, srcName)
  const dstFile = path.join(desktop, srcName)
  fs.writeFileSync(src, "smoke")
  try {
    const srcId = "win:fs:documents:file-" + Buffer.from(srcName, "utf8").toString("base64url")
    const r1 = await adapter.writeOne(adapter.validateTargetId(srcId), { kind: "move", destination: desktop, source_path: src })
    const moved = fs.existsSync(dstFile) && !fs.existsSync(src)
    // move back
    fs.renameSync(dstFile, src)
    ok("5 move Documents→Desktop (folder destination)", moved && r1.undoable === true)
  } catch (e) {
    ok("5 move Documents→Desktop (folder destination)", false, `${e.name}: ${e.message}`)
  } finally {
    try { fs.unlinkSync(src) } catch { /* already moved */ }
    try { fs.unlinkSync(dstFile) } catch { /* ok */ }
  }

  // 6. move escaping allowlist → WinPathOutsideAllowlist
  const srcName2 = `cmspark-smoke-${stamp}-b.txt`
  const src2 = path.join(docs, srcName2)
  fs.writeFileSync(src2, "smoke")
  try {
    const srcId2 = "win:fs:documents:file-" + Buffer.from(srcName2, "utf8").toString("base64url")
    await adapter.writeOne(adapter.validateTargetId(srcId2), { kind: "move", destination: "C:\\Windows\\Temp\\evil.txt", source_path: src2 })
    ok("6 move to C:\\Windows\\Temp rejected", false, "unexpectedly allowed")
  } catch (e) {
    ok("6 move to C:\\Windows\\Temp rejected (WinPathOutsideAllowlist)", e.name === "WinPathOutsideAllowlist", e.name)
  } finally {
    try { fs.unlinkSync(src2) } catch { /* ok */ }
  }

  // 7. update/delete honest not-implemented
  let honest = 0
  for (const p of [{ kind: "update", body: "x" }, { kind: "delete" }]) {
    try {
      const id = adapter.validateTargetId("win:fs:documents:file-" + Buffer.from("a.txt").toString("base64url"))
      await adapter.writeOne(id, p)
    } catch (e) { if (/not implemented|requires biometric/i.test(e.message)) honest++ }
  }
  ok("7 update/delete throw not-implemented", honest === 2)

  console.log(`\n${pass} pass / ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(2) })
