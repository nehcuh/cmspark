import Foundation
import LocalAuthentication
import ApplicationServices
import Vision
import CoreGraphics
import CoreImage
import Security
import Carbon
import CryptoKit

// cmspark-host: minimal macOS binary that loads a precompiled .scpt and runs
// it in-process via NSAppleScript. The binary is the TCC-attribution anchor:
// the Automation permission dialog should name "cmspark-host", not osascript
// nor any parent process. See docs/decisions/computer-use-round2-synthesis.md.
//
// Subcommands (Phase 1 W5–W8):
//   - read-mail                        — read top-1 Mail inbox (Phase 0 path, retained)
//   - list-mail / list-notes / list-files — list TargetIds; FIXED top-100 cap
//     script-side (audit M8: argv cannot be passed into a precompiled .scpt
//     without NSAppleEventDescriptor handler invocation — Phase 2. The TS
//     layer applies smaller limits itself and does not send --limit.)
//   - read-message --target <TargetId> — read Mail message by stable id (W5)
//   - create-note / move-file          — writes (W6; biometric tier in W8)
//   - biometric-verify                 — Touch ID via LAContext (W8)
//
// The list-mail and read-message paths reuse findScript() + executeAndReturnError()
// for precompiled .scpt files. read-message constructs an AppleScript source
// string at runtime with the parsed TargetId args — this re-introduces ~300ms
// runtime compile cost per call (Round 1 D3 warned about this) but keeps the
// implementation simple. Phase 2 may refactor to NSAppleEventDescriptor handler
// invocation if the cost becomes a problem.

struct HostError: Error {
    let code: Int32
    let message: String
}

func findScript(_ name: String) -> URL? {
    let execURL = URL(fileURLWithPath: CommandLine.arguments[0])
    let scriptsDir = execURL.deletingLastPathComponent()
        .appendingPathComponent("host-scripts", isDirectory: true)
    for candidate in [name + ".scpt", name] {
        let url = scriptsDir.appendingPathComponent(candidate)
        if FileManager.default.fileExists(atPath: url.path) { return url }
    }
    return nil
}

func runCompiledScript(_ name: String) throws -> String {
    guard let scptURL = findScript(name) else {
        throw HostError(
            code: 3,
            message: "\(name).scpt not found next to cmspark-host executable"
        )
    }
    var initError: NSDictionary?
    guard let script = NSAppleScript(contentsOf: scptURL, error: &initError) else {
        let msg = initError.flatMap { $0[NSAppleScript.errorMessage] as? String } ?? "unknown"
        throw HostError(code: 3, message: "NSAppleScript init failed: \(msg)")
    }
    var execError: NSDictionary?
    let result = script.executeAndReturnError(&execError)
    if let err = execError {
        let msg = (err[NSAppleScript.errorMessage] as? String) ?? "\(err)"
        let num = (err[NSAppleScript.errorNumber] as? Int) ?? -1
        // -1743 errAEEventNotPermitted (TCC denied), -1719 errAEEventIndexMissed
        if num == -1743 || num == -1719 {
            throw HostError(code: 5, message: "TCC denied or sandbox blocked (oserr=\(num)): \(msg)")
        }
        throw HostError(code: 4, message: "AppleScript error (oserr=\(num)): \(msg)")
    }
    return result.stringValue ?? "{}"
}

// MARK: - read-message (Phase 1 W5: read by stable TargetId)
//
// TargetId format per docs/decisions/targetid-format-synthesis.md:
//   "macos:com.apple.mail:<account-name>:msg-<stable-id>"
// (The TS adapter decodes its base64url-validated id back to this raw form
// before spawning — audit M2.) Swift parses this and constructs an
// AppleScript source string at runtime — the account segment is interpolated
// into a DOUBLE-quoted literal escaped via appleScriptEscape (`"` and `\`
// are the dangerous delimiters there; audit M5) — and runs via NSAppleScript.
//
// Cost: ~300ms per call due to runtime compilation (Round 1 D3 tradeoff).
// Acceptable because read-by-id is NOT the hot path — Phase 0's read-mail
// (precompiled .scpt + executeAndReturnError) handles the top-1 fast path.

func parseTargetId(_ raw: String) throws -> (account: String, messageId: Int) {
    // "macos:com.apple.mail:<account>:msg-<id>"
    let prefix = "macos:com.apple.mail:"
    guard raw.hasPrefix(prefix) else {
        throw HostError(code: 6, message: "read-message: TargetId missing prefix \(prefix)")
    }
    let rest = String(raw.dropFirst(prefix.count))
    guard let msgSepRange = rest.range(of: ":msg-") else {
        throw HostError(code: 6, message: "read-message: TargetId missing :msg-<id> suffix")
    }
    let account = String(rest[..<msgSepRange.lowerBound])
    let idString = String(rest[msgSepRange.upperBound...])
    guard let msgId = Int(idString) else {
        throw HostError(code: 6, message: "read-message: TargetId msg id not an integer: \(idString)")
    }
    guard !account.isEmpty else {
        throw HostError(code: 6, message: "read-message: TargetId account segment empty")
    }
    return (account, msgId)
}

// Audit M5: account is interpolated into a DOUBLE-quoted AppleScript string
// literal below (`is "<account>"`) — the dangerous delimiters are `"` and `\`,
// NOT `'`. The previous guard (validateNoSingleQuote) checked the WRONG
// delimiter: it rejected `'` (harmless in a double-quoted context) while
// letting `"` and `\` through — only non-exploitable because the TS TargetId
// validator backstopped it; a direct binary invocation could inject.
// appleScriptEscape (see write subcommands below) escapes exactly `"` and `\`
// and leaves `'` intact (M7), so account names like "John's Gmail" work.
func runReadMessage(targetId: String) throws -> String {
    let (account, msgId) = try parseTargetId(targetId)
    let escAccount = appleScriptEscape(account)

    // Build AppleScript source. Account goes into a double-quoted literal
    // (escaped above). Message id is integer-coerced so no injection risk.
    // Audit M3: fields are wrapped in jsonEscape (same handler as
    // read-mail.applescript) — a message containing `"` or `\` previously
    // produced invalid JSON and was permanently unreadable.
    // maxChars is a fixed script-side cap (audit M8: the TS layer applies
    // smaller max_chars values itself after parsing).
    let source = """
    on jsonEscape(s)
        set oldTids to AppleScript's text item delimiters

        set AppleScript's text item delimiters to "\\\\"
        set sParts to text items of s
        set AppleScript's text item delimiters to "\\\\\\\\"
        set s to sParts as string

        set AppleScript's text item delimiters to "\\""
        set sParts to text items of s
        set AppleScript's text item delimiters to "\\\\""
        set s to sParts as string

        set AppleScript's text item delimiters to (character id 13)
        set sParts to text items of s
        set AppleScript's text item delimiters to "\\\\r"
        set s to sParts as string

        set AppleScript's text item delimiters to (character id 10)
        set sParts to text items of s
        set AppleScript's text item delimiters to "\\\\n"
        set s to sParts as string

        set AppleScript's text item delimiters to (character id 9)
        set sParts to text items of s
        set AppleScript's text item delimiters to "\\\\t"
        set s to sParts as string

        set AppleScript's text item delimiters to oldTids
        return s
    end jsonEscape

    set maxChars to 500
    set theSender to ""
    set theSubject to ""
    set theDate to ""
    set theBody to "[message not found]"
    tell application "Mail"
        repeat with m in messages of inbox
            try
                if (id of m) is \(msgId) then
                    if (name of account of mailbox of m) is "\(escAccount)" then
                        set theSender to sender of m
                        set theSubject to subject of m
                        set theDate to (date received of m) as string
                        set theBody to content of m
                        if (length of theBody) > maxChars then
                            set theBody to text 1 thru maxChars of theBody
                        end if
                        exit repeat
                    end if
                end if
            end try
        end repeat
    end tell
    return "{\\"sender\\":\\"" & my jsonEscape(theSender) & "\\",\\"subject\\":\\"" & my jsonEscape(theSubject) & "\\",\\"date_received\\":\\"" & my jsonEscape(theDate) & "\\",\\"body_preview\\":\\"" & my jsonEscape(theBody) & "\\"}"
    """

    var error: NSDictionary?
    guard let script = NSAppleScript(source: source) else {
        throw HostError(code: 3, message: "NSAppleScript source init failed")
    }
    let result = script.executeAndReturnError(&error)
    if let err = error {
        let msg = (err[NSAppleScript.errorMessage] as? String) ?? "\(err)"
        let num = (err[NSAppleScript.errorNumber] as? Int) ?? -1
        if num == -1743 || num == -1719 {
            throw HostError(code: 5, message: "TCC denied or sandbox blocked (oserr=\(num)): \(msg)")
        }
        throw HostError(code: 4, message: "AppleScript error (oserr=\(num)): \(msg)")
    }
    return result.stringValue ?? "{}"
}

// MARK: - argv parsing helpers

func argValue(_ key: String) -> String? {
    let argv = CommandLine.arguments
    for (i, a) in argv.enumerated() {
        if a == key && i + 1 < argv.count {
            return argv[i + 1]
        }
        if a.hasPrefix(key + "=") {
            return String(a.dropFirst(key.count + 1))
        }
    }
    return nil
}

// MARK: - biometric-verify subcommand (Phase 1 W8: Touch ID via LAContext)
//
// Round 2 §4.2 + Kimi+Pi W8 advisor: ALL writes go through biometric tier.
// Pi-sub implementation tips:
//   - localizedFallbackTitle = "" — NO password fallback (would collapse tier)
//   - LAError.userCancel / systemCancel → non-retryable
//   - LAError.biometryLockout → exit with specific code, clear message
//   - Pipe through existing cmspark-host binary (SecStaticCodeCheckValidity
//     covers biometric path too — no side channel)
//   - Nonce binds biometric success to specific tool_call_id (audit trail)

func runBiometricVerify(nonce: String, reason: String) throws -> String {
    let context = LAContext()
    context.localizedFallbackTitle = ""  // disable password fallback (Pi-sub)

    var error: NSError?
    let policy: LAPolicy = .deviceOwnerAuthenticationWithBiometrics
    guard context.canEvaluatePolicy(policy, error: &error) else {
        // biometryUnavailable / biometryNotEnrolled / biometryLockout
        let code = error?.code ?? -1
        let msg = error?.localizedDescription ?? "biometry unavailable"
        if code == LAError.biometryNotEnrolled.rawValue {
            throw HostError(code: 11, message: "Touch ID not enrolled: \(msg)")
        }
        if code == LAError.biometryLockout.rawValue {
            throw HostError(code: 12, message: "Touch ID locked out — open System Settings → Touch ID to unlock: \(msg)")
        }
        throw HostError(code: 10, message: "biometry unavailable (oserr=\(code)): \(msg)")
    }

    // Synchronous evaluation. Touch ID dialog appears; user must physically
    // touch the sensor. NO password fallback (would collapse tier per Pi-sub).
    // LAContext.evaluatePolicy is async (closure-based); we wrap in semaphore
    // because cmspark-host is a short-lived CLI binary — async/await would
    // require a Runloop and complicate exit handling.
    var evalError: NSError?
    var evalResult: Bool = false
    let semaphore = DispatchSemaphore(value: 0)
    context.evaluatePolicy(policy, localizedReason: reason) { success, err in
        evalResult = success
        evalError = err as NSError?
        semaphore.signal()
    }
    semaphore.wait()

    if !evalResult {
        let code = evalError?.code ?? -1
        let msg = evalError?.localizedDescription ?? "evaluation failed"
        // userCancel / systemCancel / appCancel → non-retryable per Pi-sub
        if code == LAError.userCancel.rawValue || code == LAError.systemCancel.rawValue || code == LAError.appCancel.rawValue {
            throw HostError(code: 13, message: "biometric canceled by user (non-retryable): \(msg)")
        }
        if code == LAError.userFallback.rawValue {
            // Shouldn't happen (localizedFallbackTitle="") but defense in depth
            throw HostError(code: 14, message: "password fallback attempted (blocked by policy)")
        }
        throw HostError(code: 15, message: "biometric failed (oserr=\(code)): \(msg)")
    }

    return "{\"verified\":true,\"nonce\":\"\(nonce)\"}"
}

// MARK: - write subcommand (Phase 1 W6: Notes create + Finder move)

// Escape a string for use inside an AppleScript DOUBLE-quoted string literal.
// In that context `"` and `\` are the only special delimiters; `'` has NO
// special meaning and passes through verbatim (audit M7 — the previous
// version rejected `'` outright, breaking legitimate values like
// "John's report.pdf"). Also used by read-message for the account literal
// (audit M5).
func appleScriptEscape(_ s: String) -> String {
    var out = ""
    for ch in s.unicodeScalars {
        switch ch {
        case "\\": out += "\\\\"
        case "\"": out += "\\\""
        case "\n": out += "\" & return & \""  // AppleScript line break concat
        case "\r": out += ""  // drop CR; treated as line break by AppleScript
        case "\t": out += "\\t"
        default: out.append(Character(ch))
        }
    }
    return out
}

// runCreateNote: create a new note in Notes.app with given name + body.
// Returns JSON {"target_id":"macos:com.apple.Notes:default:note-<id>","undoable":true}
func runCreateNote(name: String, body: String) throws -> String {
    let escName = appleScriptEscape(name)
    let escBody = appleScriptEscape(body)

    let source = """
    set outId to ""
    tell application "Notes"
        set newNote to make new note with properties {name:"\(escName)", body:"\(escBody)"}
        set outId to id of newNote as string
    end tell
    return "{\\"target_id\\":\\"macos:com.apple.Notes:default:note-" & outId & "\\",\\"undoable\\":true}"
    """

    var error: NSDictionary?
    guard let script = NSAppleScript(source: source) else {
        throw HostError(code: 3, message: "NSAppleScript source init failed")
    }
    let result = script.executeAndReturnError(&error)
    if let err = error {
        let msg = (err[NSAppleScript.errorMessage] as? String) ?? "\(err)"
        let num = (err[NSAppleScript.errorNumber] as? Int) ?? -1
        if num == -1743 || num == -1719 {
            throw HostError(code: 5, message: "TCC denied or sandbox blocked (oserr=\(num)): \(msg)")
        }
        throw HostError(code: 4, message: "AppleScript error (oserr=\(num)): \(msg)")
    }
    return result.stringValue ?? "{}"
}

// runMoveFile: move a POSIX file to a POSIX destination via Finder.
// Uses `trash`-compatible move (Finder move is reversible via Finder undo).
// Returns JSON {"target_id":"macos:com.apple.finder:<folder>:file-<name>","undoable":true}
// Audit M6: the TS adapter rejects non-absolute POSIX paths before spawning
// (a relative path would resolve against this process's inherited cwd).
// NOTE: `POSIX file <src> as alias` RESOLVES symlinks/Finder aliases — moving
// a link moves its TARGET (the original), leaving the link in place.
func runMoveFile(sourcePath: String, destPath: String) throws -> String {
    let escSrc = appleScriptEscape(sourcePath)
    let escDest = appleScriptEscape(destPath)

    let source = """
    tell application "Finder"
        set srcFile to POSIX file "\(escSrc)" as alias
        set destFolder to POSIX file "\(escDest)" as alias
        move srcFile to destFolder
    end tell
    return "{\\"target_id\\":\\"macos:com.apple.finder:moved:file-ok\\",\\"undoable\\":true}"
    """

    var error: NSDictionary?
    guard let script = NSAppleScript(source: source) else {
        throw HostError(code: 3, message: "NSAppleScript source init failed")
    }
    let result = script.executeAndReturnError(&error)
    if let err = error {
        let msg = (err[NSAppleScript.errorMessage] as? String) ?? "\(err)"
        let num = (err[NSAppleScript.errorNumber] as? Int) ?? -1
        if num == -1743 || num == -1719 {
            throw HostError(code: 5, message: "TCC denied or sandbox blocked (oserr=\(num)): \(msg)")
        }
        throw HostError(code: 4, message: "AppleScript error (oserr=\(num)): \(msg)")
    }
    return result.stringValue ?? "{}"
}

// MARK: - Entry point

let argv = CommandLine.arguments
guard argv.count >= 2 else {
    let usage = """
        usage: cmspark-host <subcommand> [options]
          read-mail                            — read top-1 Mail inbox (body capped at 500 chars script-side)
          list-mail                            — list inbox TargetIds (fixed top-100, script-side)
          read-message --target <TargetId>     — read message by stable id
          list-notes                           — list notes TargetIds (fixed top-100)
          list-files                           — list Documents folder TargetIds (fixed top-100)
          create-note --name N [--body B]      — create a new Note (Phase 1 W6, biometric in W8)
          move-file --source P --destination D — move file via Finder (Phase 1 W6, biometric in W8)
          biometric-verify --nonce N [--reason R] — Touch ID verification (Phase 1 W8)

        """
    FileHandle.standardError.write(usage.data(using: .utf8)!)
    exit(2)
}

let subcommand = argv[1]
do {
    let out: String
    switch subcommand {
    case "read-mail":
        out = try runCompiledScript("read-mail")
    case "list-mail":
        out = try runCompiledScript("list-mail")
    case "list-notes":
        out = try runCompiledScript("list-notes")
    case "list-files":
        out = try runCompiledScript("list-files")
    case "read-message":
        guard let target = argValue("--target") else {
            FileHandle.standardError.write("read-message: --target <TargetId> required\n".data(using: .utf8)!)
            exit(2)
        }
        out = try runReadMessage(targetId: target)
    case "create-note":
        guard let name = argValue("--name") else {
            FileHandle.standardError.write("create-note: --name <name> required\n".data(using: .utf8)!)
            exit(2)
        }
        let body = argValue("--body") ?? ""
        out = try runCreateNote(name: name, body: body)
    case "move-file":
        guard let src = argValue("--source") else {
            FileHandle.standardError.write("move-file: --source <posix-path> required\n".data(using: .utf8)!)
            exit(2)
        }
        guard let dest = argValue("--destination") else {
            FileHandle.standardError.write("move-file: --destination <posix-path> required\n".data(using: .utf8)!)
            exit(2)
        }
        out = try runMoveFile(sourcePath: src, destPath: dest)
    case "biometric-verify":
        guard let nonce = argValue("--nonce") else {
            FileHandle.standardError.write("biometric-verify: --nonce <id> required\n".data(using: .utf8)!)
            exit(2)
        }
        let reason = argValue("--reason") ?? "Confirm host_write operation"
        out = try runBiometricVerify(nonce: nonce, reason: reason)

    // --- WP3 coordinate computer-use subcommands ---
    case "window-list":
        let bid = argValue("--bundle-id")
        let widStr = argValue("--window-id"); let wid: UInt32? = widStr.flatMap { UInt32($0) }
        let fg = argv.contains("--foreground")
        out = cuWindowList(bundleId: bid, windowId: wid, foreground: fg)
    case "ax-probe":
        guard let ws = argValue("--window-id"), let w = UInt32(ws) else { fputs("ax-probe: --window-id required\n", stderr); exit(2) }
        out = cuAXProbe(windowId: w)
    case "ax-locate":
        guard let ws = argValue("--window-id"), let w = UInt32(ws), let target = argValue("--target") else { fputs("ax-locate: --window-id and --target required\n", stderr); exit(2) }
        out = cuAXLocate(windowId: w, target: target)
    case "screenshot":
        guard let ws = argValue("--window-id"), let w = UInt32(ws), let output = argValue("--output") else { fputs("screenshot: --window-id and --output required\n", stderr); exit(2) }
        out = cuScreenshot(windowId: w, outputPath: output)
    case "crop":
        guard let src = argValue("--source"), let dst = argValue("--output"),
              let xs = argValue("--x"), let ys = argValue("--y"),
              let ws = argValue("--width"), let hs = argValue("--height"),
              let x = Int(xs), let y = Int(ys), let w = Int(ws), let h = Int(hs) else { fputs("crop: args required\n", stderr); exit(2) }
        out = cuCrop(source: src, output: dst, x: x, y: y, w: w, h: h)
    case "imgdiff":
        guard let a = argValue("--a"), let b = argValue("--b") else { fputs("imgdiff: --a and --b required\n", stderr); exit(2) }
        let cx = argValue("--x").flatMap { Int($0) }; let cy = argValue("--y").flatMap { Int($0) }
        let cw = argValue("--width").flatMap { Int($0) }; let ch = argValue("--height").flatMap { Int($0) }
        out = cuImgDiff(aPath: a, bPath: b, cropX: cx, cropY: cy, cropW: cw, cropH: ch)
    case "ocr":
        guard let img = argValue("--image") else { fputs("ocr: --image required\n", stderr); exit(2) }
        let langs = argValue("--languages")?.split(separator: ",").map(String.init) ?? ["zh-Hans", "en-US"]
        out = cuOCR(imagePath: img, languages: langs)
    case "inject":
        guard let action = argValue("--action"), let ws = argValue("--window-id"), let w = UInt32(ws) else { fputs("inject: --action and --window-id required\n", stderr); exit(2) }
        let px = argValue("--x").flatMap { Int($0) }; let py = argValue("--y").flatMap { Int($0) }
        let d = argValue("--delta").flatMap { Int($0) }
        out = cuInject(action: action, windowId: w, x: px, y: py, text: argValue("--text"), chord: argValue("--chord"), delta: d, checkOcclusion: argv.contains("--check-occlusion"), checkSecureInput: argv.contains("--check-secure-input"), checkOnscreen: argv.contains("--check-onscreen"), estopFlag: argValue("--estop-flag"))
    case "security-check":
        out = cuSecurityCheck()
    case "preview":
        guard let img = argValue("--image") else { fputs("preview: --image required\n", stderr); exit(2) }
        let px = argValue("--x").flatMap { Int($0) }; let py = argValue("--y").flatMap { Int($0) }
        out = cuPreview(imagePath: img, x: px, y: py, blurRectsJSON: argValue("--blur-rects"))
    case "evidence-seal":
        guard let inp = argValue("--input"), let outp = argValue("--output") else { fputs("evidence-seal: --input and --output required\n", stderr); exit(2) }
        out = cuEvidenceSeal(inputPath: inp, outputPath: outp)

    default:
        FileHandle.standardError.write("unknown subcommand: \(subcommand)\n".data(using: .utf8)!)
        exit(2)
    }
    print(out)
    exit(0)
} catch let err as HostError {
    FileHandle.standardError.write("\(err.message)\n".data(using: .utf8)!)
    exit(err.code)
} catch {
    FileHandle.standardError.write("unexpected: \(error)\n".data(using: .utf8)!)
    exit(1)
}

// macOS coordinate computer-use (WP3) — subcommand implementations.
// Imported by host.swift at the top; functions are called from the switch block.
// Requires: ApplicationServices, Vision, CoreGraphics, Security, Carbon, CryptoKit.

import Foundation
import ApplicationServices
import Vision
import CoreGraphics
import Security
import Carbon
import CryptoKit

// MARK: - JSON helpers

func cuError(_ error: String, code: String = "INVALID_ACTION") -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: ["ok": false, "error": error, "error_code": code], options: []),
          let str = String(data: data, encoding: .utf8) else { return "{}" }
    return str
}

func cuJson(_ dict: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
          let str = String(data: data, encoding: .utf8) else { return "{}" }
    return str
}

// MARK: - helpers

func cuPidForWindow(_ windowId: UInt32) -> pid_t {
    guard let windows = CGWindowListCopyWindowInfo([.optionAll], windowId) as? [[String: Any]],
          let first = windows.first,
          let pid = first[kCGWindowOwnerPID as String] as? pid_t else { return 0 }
    return pid
}

func cuAppElementForPid(_ pid: pid_t) -> AXUIElement? {
    return AXUIElementCreateApplication(pid)
}

// MARK: - window-list

func cuWindowList(bundleId: String?, windowId: UInt32?, foreground: Bool) -> String {
    let options: CGWindowListOption = foreground ? [.optionOnScreenOnly] : [.optionAll]
    guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        return cuError("CGWindowListCopyWindowInfo failed")
    }
    var filtered: [[String: Any]] = []
    for w in windows {
        let wid = w[kCGWindowNumber as String] as? UInt32 ?? 0
        let owner = w[kCGWindowOwnerName as String] as? String ?? ""
        let name = w[kCGWindowName as String] as? String ?? ""
        let bounds = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
        let pid = w[kCGWindowOwnerPID as String] as? Int32 ?? 0
        let layer = w[kCGWindowLayer as String] as? Int32 ?? 0
        if let widFilter = windowId, wid != widFilter { continue }
        if let bidFilter = bundleId, owner != bidFilter { continue }
        if layer > 1000 { continue }
        filtered.append([
            "windowId": wid, "pid": pid, "ownerName": owner, "name": name,
            "bounds": ["x": bounds["X"] ?? 0, "y": bounds["Y"] ?? 0, "width": bounds["Width"] ?? 0, "height": bounds["Height"] ?? 0],
            "layer": layer,
        ])
    }
    return cuJson(["ok": true, "windows": filtered])
}

// MARK: - ax-probe

func cuAXProbe(windowId: UInt32) -> String {
    let pid = cuPidForWindow(windowId)
    guard let appElement = cuAppElementForPid(pid) else {
        return cuError("cannot get AX app element", code: "AX_FAILED")
    }
    var nodes = 0; var maxDepth = 0; var named = 0; var namedOnscreen = 0
    var interactive = 0; var edits = 0; var documents = 0
    var capped = false; var passANodes = 0

    func probe(_ element: AXUIElement, depth: Int) {
        if nodes >= 5000 { capped = true; return }
        nodes += 1; maxDepth = max(maxDepth, depth)

        var roleRef: CFTypeRef?; var nameRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleRef)
        AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &nameRef)
        let role = (roleRef as? String) ?? ""
        let name = (nameRef as? String) ?? ""

        var posRef: CFTypeRef?; var sizeRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef)
        AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef)
        let onscreen = posRef != nil && sizeRef != nil

        if !name.isEmpty { named += 1; if onscreen { namedOnscreen += 1 } }
        if ["AXButton","AXTextField","AXTextArea","AXPopUpButton","AXCheckBox","AXRadioButton","AXSlider","AXComboBox","AXMenuButton","AXMenuItem","AXLink","AXTabGroup"].contains(role) { interactive += 1 }
        if role == "AXTextArea" || role == "AXTextField" { edits += 1 }
        if role == "AXGroup" || role == "AXScrollArea" { documents += 1 }
        if role == "AXPasswordField" { passANodes += 1 }

        var children: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children)
        if let childArray = children as? [AXUIElement] {
            for child in childArray { probe(child, depth: depth + 1); if capped { return } }
        }
    }
    probe(appElement, depth: 0)

    return cuJson(["ok": true, "stats": [
        "nodes": nodes, "maxDepth": maxDepth, "named": named, "namedOnscreen": namedOnscreen,
        "interactive": interactive, "edits": edits, "documents": documents,
        "capped": capped, "hydrationRechecked": false, "passANodes": passANodes, "durationMs": 0,
    ]])
}

// MARK: - ax-locate

func cuAXLocate(windowId: UInt32, target: String) -> String {
    let pid = cuPidForWindow(windowId)
    guard let appElement = cuAppElementForPid(pid) else {
        return cuJson(["found": false])
    }
    var queue: [AXUIElement] = [appElement]
    var depth = 0
    while !queue.isEmpty && depth < 50 {
        var nextLevel: [AXUIElement] = []
        for element in queue {
            // Skip hidden/zero-size
            var hiddenRef: CFTypeRef?
            AXUIElementCopyAttributeValue(element, kAXHiddenAttribute as CFString, &hiddenRef)
            if let hidden = hiddenRef as? Bool, hidden { continue }
            var sizeRef: CFTypeRef?
            AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef)
            var sz = CGSize.zero
            if let s = sizeRef { AXValueGetValue(s as! AXValue, .cgSize, &sz) }
            if sz.width <= 1 && sz.height <= 1 { continue }

            var nameRef: CFTypeRef?; var roleRef: CFTypeRef?
            AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &nameRef)
            AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleRef)
            let name = (nameRef as? String) ?? ""
            if name.lowercased() == target.lowercased() || name.contains(target) {
                var posRef: CFTypeRef?; AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef)
                var pos = CGPoint.zero; var size = CGSize.zero
                if let p = posRef { AXValueGetValue(p as! AXValue, .cgPoint, &pos) }
                if let s = sizeRef { AXValueGetValue(s as! AXValue, .cgSize, &size) }
                return cuJson([
                    "found": true, "x": pos.x + size.width/2, "y": pos.y + size.height/2,
                    "bbox": ["x": pos.x, "y": pos.y, "width": size.width, "height": size.height],
                    "name": name, "role": (roleRef as? String) ?? "unknown", "confidence": 1.0, "candidates": 1,
                ])
            }
            var children: CFTypeRef?
            AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children)
            if let childArray = children as? [AXUIElement] { nextLevel.append(contentsOf: childArray) }
        }
        queue = nextLevel; depth += 1
    }
    return cuJson(["found": false])
}

// MARK: - screenshot (screencapture CLI)

func cuScreenshot(windowId: UInt32, outputPath: String) -> String {
    guard let info = CGWindowListCopyWindowInfo([.optionAll], windowId) as? [[String: Any]],
          let first = info.first,
          let bounds = first[kCGWindowBounds as String] as? [String: CGFloat] else {
        return cuError("cannot get window info")
    }
    let rect: [String: CGFloat] = ["x": bounds["X"] ?? 0, "y": bounds["Y"] ?? 0, "width": bounds["Width"] ?? 0, "height": bounds["Height"] ?? 0]
    var client: [String: CGFloat] = ["x": 0, "y": 0, "width": rect["width"] ?? 0, "height": rect["height"] ?? 0]

    let pid = cuPidForWindow(windowId)
    if let appElement = cuAppElementForPid(pid) {
        var windowsRef: CFTypeRef?
        AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsRef)
        if let axWindows = windowsRef as? [AXUIElement], let axWin = axWindows.first {
            var posRef: CFTypeRef?; var sizeRef: CFTypeRef?
            AXUIElementCopyAttributeValue(axWin, kAXPositionAttribute as CFString, &posRef)
            AXUIElementCopyAttributeValue(axWin, kAXSizeAttribute as CFString, &sizeRef)
            var pos = CGPoint.zero; var size = CGSize.zero
            if let p = posRef { AXValueGetValue(p as! AXValue, .cgPoint, &pos) }
            if let s = sizeRef { AXValueGetValue(s as! AXValue, .cgSize, &size) }
            let fx = rect["x"] ?? 0; let fy = rect["y"] ?? 0
            client = ["x": pos.x - fx, "y": pos.y - fy, "width": size.width, "height": size.height]
        }
    }

    let x = Int(rect["x"] ?? 0); let y = Int(rect["y"] ?? 0)
    let w = Int(rect["width"] ?? 0); let h = Int(rect["height"] ?? 0)
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    process.arguments = ["-x", "-R", "\(x),\(y),\(w),\(h)", "-t", "png", outputPath]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    do { try process.run(); process.waitUntilExit() } catch { return cuError("screencapture failed: \(error.localizedDescription)") }
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: outputPath)) else { return cuError("cannot read captured image") }
    let sha256 = SHA256.hash(data: data).compactMap { String(format: "%02x", $0) }.joined()
    return cuJson(["ok": true, "rect": rect, "client": client, "dpi": 72, "path": outputPath, "sha256": sha256])
}

// MARK: - crop + imgdiff + ocr + inject + security-check + preview + evidence-seal

func cuCrop(source: String, output: String, x: Int, y: Int, w: Int, h: Int) -> String {
    guard let srcImage = CGImageSourceCreateWithURL(URL(fileURLWithPath: source) as CFURL, nil),
          let cgImage = CGImageSourceCreateImageAtIndex(srcImage, 0, nil) else { return cuError("cannot read source image") }
    let rect = CGRect(x: CGFloat(x), y: CGFloat(y), width: CGFloat(w), height: CGFloat(h))
    guard let cropped = cgImage.cropping(to: rect) else { return cuError("crop rect out of bounds") }
    let dest = URL(fileURLWithPath: output)
    guard let destImg = CGImageDestinationCreateWithURL(dest as CFURL, "public.png" as CFString, 1, nil) else { return cuError("cannot create output") }
    CGImageDestinationAddImage(destImg, cropped, nil)
    CGImageDestinationFinalize(destImg)
    return cuJson(["ok": true])
}

func cuImgDiff(aPath: String, bPath: String, cropX: Int?, cropY: Int?, cropW: Int?, cropH: Int?) -> String {
    guard let aSrc = CGImageSourceCreateWithURL(URL(fileURLWithPath: aPath) as CFURL, nil),
          let bSrc = CGImageSourceCreateWithURL(URL(fileURLWithPath: bPath) as CFURL, nil),
          let aImg = CGImageSourceCreateImageAtIndex(aSrc, 0, nil),
          let bImg = CGImageSourceCreateImageAtIndex(bSrc, 0, nil) else { return cuError("cannot read images") }

    let aw = aImg.width; let ah = aImg.height
    let bw = bImg.width; let bh = bImg.height
    let w = min(aw, bw); let h = min(ah, bh)

    var aData = [UInt8](repeating: 0, count: w * h * 4)
    var bData = [UInt8](repeating: 0, count: w * h * 4)
    guard let aCtx = CGContext(data: &aData, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
          let bCtx = CGContext(data: &bData, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return cuError("cannot create bitmap contexts") }
    aCtx.draw(aImg, in: CGRect(x: 0, y: 0, width: w, height: h))
    bCtx.draw(bImg, in: CGRect(x: 0, y: 0, width: w, height: h))

    let cellW = max(1, w / 64); let cellH = max(1, h / 64)
    var changedCells = 0; let totalCells = 64 * 64
    var totalDiff: Double = 0

    for cy in 0..<64 {
        for cx in 0..<64 {
            var cellDiff: Double = 0
            for dy in 0..<cellH {
                for dx in 0..<cellW {
                    let idx = ((cy * cellH + dy) * w + (cx * cellW + dx)) * 4
                    let la = Double(aData[idx]) * 0.299 + Double(aData[idx+1]) * 0.587 + Double(aData[idx+2]) * 0.114
                    let lb = Double(bData[idx]) * 0.299 + Double(bData[idx+1]) * 0.587 + Double(bData[idx+2]) * 0.114
                    cellDiff += abs(la - lb) / 255.0
                }
            }
            cellDiff /= Double(cellW * cellH)
            totalDiff += cellDiff
            if cellDiff > 0.08 { changedCells += 1 }
        }
    }
    return cuJson(["ok": true, "diffRatio": totalDiff / Double(totalCells)])
}

func cuOCR(imagePath: String, languages: [String]) -> String {
    guard let ciImage = CIImage(contentsOf: URL(fileURLWithPath: imagePath)) else { return cuError("cannot read image") }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = languages
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(ciImage: ciImage, options: [:])
    do { try handler.perform([request]) } catch { return cuError("OCR failed: \(error.localizedDescription)", code: "OCR_FAILED") }

    var words: [[String: Any]] = []
    if let observations = request.results {
        let imgWidth = ciImage.extent.width; let imgHeight = ciImage.extent.height
        for obs in observations {
            guard let topCandidate = obs.topCandidates(1).first else { continue }
            let bbox = obs.boundingBox
            let x = bbox.origin.x * imgWidth
            let y = (1.0 - bbox.origin.y - bbox.size.height) * imgHeight
            words.append(["text": topCandidate.string, "x": x, "y": y, "w": bbox.size.width * imgWidth, "h": bbox.size.height * imgHeight])
        }
    }
    return cuJson(["ok": true, "language": languages.first ?? "en-US", "words": words])
}

func cuInject(action: String, windowId: UInt32, x: Int?, y: Int?, text: String?, chord: String?, delta: Int?, checkOcclusion: Bool, checkSecureInput: Bool, checkOnscreen: Bool, estopFlag: String?) -> String {
    if checkSecureInput && IsSecureEventInputEnabled() { return cuError("Secure Input active", code: "DESKTOP_DENIED") }
    if let flagPath = estopFlag, FileManager.default.fileExists(atPath: flagPath) { return cuError("E-Stop flag present", code: "TASK_ABORTED") }
    let pid = cuPidForWindow(windowId)
    guard pid != 0 else { return cuError("cannot find PID for window", code: "HWND_DEAD") }

    switch action {
    case "click", "double_click", "right_click":
        guard let px = x, let py = y else { return cuError("click requires --x and --y") }
        let cc: Int64 = (action == "double_click") ? 2 : 1
        let btn: CGMouseButton = (action == "right_click") ? .right : .left
        if let me = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: px, y: py), mouseButton: btn) {
            me.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid)); me.post(tap: .cghidEventTap)
        }
        usleep(50000)
        if let de = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: CGPoint(x: px, y: py), mouseButton: btn) {
            de.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
            de.post(tap: .cghidEventTap)
            for _ in 1..<cc { usleep(100000); de.post(tap: .cghidEventTap) }
        }
        usleep(50000)
        if let ue = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: CGPoint(x: px, y: py), mouseButton: btn) {
            ue.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid)); ue.post(tap: .cghidEventTap)
        }
        return cuJson(["ok": true, "action": action, "x": px, "y": py])

    case "type":
        guard let txt = text else { return cuError("type requires --text") }
        let src = CGEventSource(stateID: .hidSystemState)
        for ch in txt.unicodeScalars {
            var uc = UniChar(ch.value)
            if let ev = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true) {
                ev.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
                ev.keyboardSetUnicodeString(stringLength: 1, unicodeString: &uc)
                ev.post(tap: .cghidEventTap)
            }
            usleep(30000)
        }
        return cuJson(["ok": true, "action": "type", "chars": txt.count])

    case "key":
        guard let ch = chord else { return cuError("key requires --chord") }
        let keyMap: [String: CGKeyCode] = [
            "ctrl": 0x3B, "alt": 0x3A, "shift": 0x38, "win": 0x37, "cmd": 0x37,
            "enter": 0x24, "return": 0x24, "escape": 0x35, "tab": 0x30,
            "space": 0x31, "backspace": 0x33, "delete": 0x75,
            "up": 0x7E, "down": 0x7D, "left": 0x7B, "right": 0x7C,
            "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
        ]
        let modMap: [String: CGEventFlags] = ["ctrl": .maskControl, "alt": .maskAlternate, "shift": .maskShift, "win": .maskCommand, "cmd": .maskCommand]
        let keys = ch.split(separator: ",").map(String.init)
        var flags: CGEventFlags = []; var nonMods: [CGKeyCode] = []
        for k in keys {
            if let kc = keyMap[k.lowercased()] {
                if let mf = modMap[k.lowercased()] { flags.insert(mf) }
                else { nonMods.append(kc) }
            }
        }
        let src = CGEventSource(stateID: .hidSystemState)
        for kc in nonMods {
            if let ev = CGEvent(keyboardEventSource: src, virtualKey: kc, keyDown: true) {
                ev.flags = flags; ev.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid)); ev.post(tap: .cghidEventTap)
            }
            usleep(30000)
        }
        return cuJson(["ok": true, "action": "key", "chord": ch])

    case "scroll":
        guard let px = x, let py = y, let d = delta else { return cuError("scroll requires --x, --y, --delta") }
        if let ev = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(d), wheel2: 0, wheel3: 0) {
            ev.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid)); ev.post(tap: .cghidEventTap)
        }
        return cuJson(["ok": true, "action": "scroll", "delta": d])

    default:
        return cuError("unknown inject action: \(action)")
    }
}

func cuSecurityCheck() -> String {
    return cuJson(["ok": true, "axTrusted": AXIsProcessTrusted(), "secureInput": IsSecureEventInputEnabled()])
}

func cuPreview(imagePath: String, x: Int?, y: Int?, blurRectsJSON: String?) -> String {
    guard let srcImage = CGImageSourceCreateWithURL(URL(fileURLWithPath: imagePath) as CFURL, nil),
          let cgImage = CGImageSourceCreateImageAtIndex(srcImage, 0, nil) else { return cuJson(["ok": true]) }
    let w = cgImage.width; let h = cgImage.height
    var pixels = [UInt8](repeating: 0, count: w * h * 4)
    guard let ctx = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return cuJson(["ok": true]) }
    ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: w, height: h))

    if let px = x, let py = y {
        ctx.setStrokeColor(CGColor(red: 1, green: 0, blue: 0, alpha: 0.8)); ctx.setLineWidth(2)
        let s = 20
        ctx.move(to: CGPoint(x: px - s, y: py)); ctx.addLine(to: CGPoint(x: px + s, y: py))
        ctx.move(to: CGPoint(x: px, y: py - s)); ctx.addLine(to: CGPoint(x: px, y: py + s))
        ctx.strokePath()
        ctx.addArc(center: CGPoint(x: px, y: py), radius: CGFloat(s), startAngle: 0, endAngle: .pi * 2, clockwise: true)
        ctx.strokePath()
    }

    guard let annotated = ctx.makeImage() else { return cuJson(["ok": true]) }
    let scale = min(1.0, 800.0 / Double(w))
    let nw = Int(Double(w) * scale); let nh = Int(Double(h) * scale)
    guard let fc = CGContext(data: nil, width: nw, height: nh, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return cuJson(["ok": true]) }
    fc.draw(annotated, in: CGRect(x: 0, y: 0, width: nw, height: nh))
    guard let fi = fc.makeImage() else { return cuJson(["ok": true]) }
    let jpeg = NSMutableData()
    guard let jd = CGImageDestinationCreateWithData(jpeg, "public.jpeg" as CFString, 1, nil) else { return cuJson(["ok": true]) }
    CGImageDestinationAddImage(jd, fi, [kCGImageDestinationLossyCompressionQuality: 0.7] as CFDictionary)
    CGImageDestinationFinalize(jd)
    return cuJson(["ok": true, "base64": (jpeg as Data).base64EncodedString()])
}

var evidenceKey: SymmetricKey?

func cuLoadEvidenceKey() -> SymmetricKey {
    if let ek = evidenceKey { return ek }
    let tag = "com.cmspark.evidence".data(using: .utf8)!
    let query: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag, kSecReturnData as String: true]
    var item: CFTypeRef?
    if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let keyData = item as? Data, keyData.count == 32 {
        let k = SymmetricKey(data: keyData); evidenceKey = k; return k
    }
    let k = SymmetricKey(size: .bits256)
    let addQ: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag, kSecValueData as String: k.withUnsafeBytes { Data($0) }, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
    SecItemAdd(addQ as CFDictionary, nil)
    evidenceKey = k; return k
}

func cuEvidenceSeal(inputPath: String, outputPath: String) -> String {
    guard let inputData = try? Data(contentsOf: URL(fileURLWithPath: inputPath)) else { return cuJson(["ok": false, "error": "cannot read input", "error_code": "EVIDENCE_ERROR"]) }
    let key = cuLoadEvidenceKey()
    guard let sealed = try? AES.GCM.seal(inputData, using: key).combined else { return cuJson(["ok": false, "error": "encryption failed", "error_code": "EVIDENCE_ERROR"]) }
    try? sealed.write(to: URL(fileURLWithPath: outputPath))
    try? FileManager.default.removeItem(atPath: inputPath)
    let sha256 = SHA256.hash(data: sealed).compactMap { String(format: "%02x", $0) }.joined()
    return cuJson(["ok": true, "sha256": sha256])
}
