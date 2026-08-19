/**
 * file: URL parse + home/path cage (create_tab / navigate / set_tab_url).
 * Isolates HOME so offerable tests do not depend on the developer machine.
 */
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-file-url-adm-"))
process.env.HOME = tmpHome
process.env.USERPROFILE = tmpHome
process.on("exit", () => {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import {
  parseLocalFileUrl,
  assertFileOpenOfferable,
  FILE_OPEN_CAGE_TOKEN,
} from "../src/tool/file-url-admission"

const downloads = path.join(tmpHome, "Downloads")
fs.mkdirSync(downloads, { recursive: true })
const invoice = path.join(downloads, "dzfp_招商证券.pdf")
fs.writeFileSync(invoice, "pdf")

describe("parseLocalFileUrl", () => {
  it("accepts POSIX triple-slash under a real path", () => {
    const r = parseLocalFileUrl(pathToFileURL(invoice).href)
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.absPath, path.resolve(invoice))
  })

  it("accepts file://localhost/… as local", () => {
    const posix = invoice.startsWith("/") ? invoice : `/${invoice}`
    const r = parseLocalFileUrl(`file://localhost${posix}`)
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.absPath, path.resolve(invoice))
  })

  it("treats file://C:/… drive-letter host as local, not UNC", () => {
    const r = parseLocalFileUrl("file://C:/Users/x/Downloads/a.pdf")
    if (process.platform === "win32") {
      assert.equal(r.ok, true)
    } else {
      // On POSIX fileURLToPath may still yield a path; must not classify as UNC.
      if (!r.ok) assert.notEqual(r.kind, "unc")
    }
  })

  it("rejects UNC file://nas/share/…", () => {
    const r = parseLocalFileUrl("file://nas/share/a.pdf")
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.kind, "unc")
      assert.ok(r.error.includes(FILE_OPEN_CAGE_TOKEN))
    }
  })

  it("decodes percent-encoded CJK and %2e%2e before cage", () => {
    const encoded = pathToFileURL(invoice).href.replace("招商证券", encodeURIComponent("招商证券"))
    const r = parseLocalFileUrl(encoded)
    assert.equal(r.ok, true)
    if (r.ok) assert.match(r.absPath, /招商证券/)

    const traversal = `file://${invoice.split(path.sep).join("/")}/../../../../etc/passwd`.replace(
      /\/+/g,
      (m, i) => (i === 0 ? "///" : "/"),
    )
    void traversal
    const encodedTrav = "file:///Users/x/Downloads/%2e%2e/%2e%2e/etc/passwd"
    const t = parseLocalFileUrl(encodedTrav)
    assert.equal(t.ok, true)
    if (t.ok) {
      const n = t.absPath.replace(/\\/g, "/")
      assert.ok(n.includes("/etc/passwd") || n.endsWith("etc/passwd") || n.includes("etc/passwd"))
    }
  })

  it("rejects non-file schemes as invalid", () => {
    const r = parseLocalFileUrl("https://example.com/a.pdf")
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.kind, "invalid")
  })
})

describe("assertFileOpenOfferable", () => {
  it("offers a file under HOME/Downloads", () => {
    const r = assertFileOpenOfferable(invoice, tmpHome)
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(fs.realpathSync(r.realPath), fs.realpathSync(invoice))
  })

  it("cages /etc/passwd on every platform (path shape, not process.platform)", () => {
    const r = assertFileOpenOfferable("/etc/passwd", tmpHome)
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.error.includes(FILE_OPEN_CAGE_TOKEN))
  })

  it("cages Windows system32 shape on every platform", () => {
    const r = assertFileOpenOfferable("C:\\Windows\\System32\\config\\SAM", tmpHome)
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.error.includes(FILE_OPEN_CAGE_TOKEN))
  })

  it("cages .ssh under home (no dialog)", () => {
    const ssh = path.join(tmpHome, ".ssh", "id_rsa")
    const r = assertFileOpenOfferable(ssh, tmpHome)
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.error.includes(FILE_OPEN_CAGE_TOKEN))
  })

  it("cages Library/Mail and .config/gcloud home prefixes", () => {
    const mail = path.join(tmpHome, "Library", "Mail", "mbox")
    const gcloud = path.join(tmpHome, ".config", "gcloud", "application_default_credentials.json")
    assert.equal(assertFileOpenOfferable(mail, tmpHome).ok, false)
    assert.equal(assertFileOpenOfferable(gcloud, tmpHome).ok, false)
  })

  it("cages paths outside home (/tmp, /opt)", () => {
    assert.equal(assertFileOpenOfferable("/tmp/pwn.html", tmpHome).ok, false)
    assert.equal(assertFileOpenOfferable("/opt/apps/x.pdf", tmpHome).ok, false)
  })

  it("cages decoded %2e%2e traversal to /etc/passwd", () => {
    const t = parseLocalFileUrl("file:///Users/x/Downloads/%2e%2e/%2e%2e/etc/passwd")
    assert.equal(t.ok, true)
    if (!t.ok) return
    const offer = assertFileOpenOfferable(t.absPath, tmpHome)
    assert.equal(offer.ok, false)
    if (!offer.ok) assert.ok(offer.error.includes(FILE_OPEN_CAGE_TOKEN))
  })

  it("offers a missing file that is still lexically under home", () => {
    const missing = path.join(downloads, "not-written-yet.pdf")
    const r = assertFileOpenOfferable(missing, tmpHome)
    assert.equal(r.ok, true)
  })

  it("cages a symlink whose realpath leaves home", () => {
    const link = path.join(downloads, "escape.pdf")
    try {
      fs.symlinkSync("/etc/passwd", link)
    } catch {
      return // platform without symlink permission
    }
    const r = assertFileOpenOfferable(link, tmpHome)
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.error.includes(FILE_OPEN_CAGE_TOKEN))
  })
})
