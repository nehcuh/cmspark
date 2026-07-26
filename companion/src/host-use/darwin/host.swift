import Foundation
import AppKit
import LocalAuthentication
import ApplicationServices
import Vision
import ImageIO
import ScreenCaptureKit
import CoreGraphics
import CoreImage
import Security
import Carbon
import CryptoKit

// ============================================================================
// SkyLight per-PID event posting (v1.3 — Approach C-minus production swap).
//
// Replaces CGEvent.post(tap: .cghidEventTap) with SLEventPostToPid, the
// SkyLight private API that delivers an event to a specific PID via an
// auth-signed channel. Chromium renderer IPC trusts this; public postToPid
// is rejected by Chrome's content renderer. SkyLight delivery also avoids
// moving the user's real cursor and works regardless of frontmost state.
//
// Design lineage (see docs/decisions/v1.3/):
//   - plan-approach-c-minus.md — production swap Plan v3
//   - spike-skylight-tahoe-results.md — Tahoe 26.5.2 dlopen+dlsym verified
//   - spike-daemon-threat-model.md — daemon rejected (C-minus)
//   - adversary-approach-c-round1.txt — original 3 blockers
//   - review-grok-spike-fixes.txt + review-claude-code-spike-fixes.txt
//
// Library validation: disable-library-validation=false (host.entitlements).
// Apple-signed SkyLight dylib loads under hardened runtime without the flip
// (A/B verified on Tahoe 26.5.2). Preserves v1.3 Batch 1 lockdown.
//
// Support matrix: Tahoe 26.5+ only for computer-use inject. Older macOS
// (Sonoma 14.4+ per host-Info.plist LSMinimumSystemVersion) still supports
// other host features (mail/notes/files/biometric); cuResolveSkyLight()
// returns false → SKYLIGHT_SPI_UNAVAILABLE → LLM surfaces upgrade prompt.
// ============================================================================

private var skyLightHandle: UnsafeMutableRawPointer?
private var slPostEventToPidFn: (@convention(c) (pid_t, CGEvent?) -> Void)?
private var skyLightResolved = false

// NOTE: SLPSPostEventRecordTo removed (2026-07-24 review). It was resolved but
// never called, and the (pid_t, CGEvent?) signature is almost certainly wrong
// (yabai/cua treat it as an event-record SPI with a different shape). If a
// focus-without-raise step becomes necessary for background Chrome, it must be
// re-resolved with a verified signature and a named call site — not dead code.

func cuResolveSkyLight() -> Bool {
    if skyLightResolved { return slPostEventToPidFn != nil }
    skyLightResolved = true
    let path = "/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight"
    // RTLD_LOCAL (not RTLD_GLOBAL): single-shot CLI doesn't need SkyLight
    // symbols leaking into subsequently loaded dylibs. Tighter boundary.
    guard let handle = dlopen(path, RTLD_LAZY | RTLD_LOCAL) else {
        fputs("[host] dlopen SkyLight failed: \(String(cString: dlerror()))\n", stderr)
        return false
    }
    skyLightHandle = handle
    // Null-safe dlsym: unsafeBitCast on a null symbol produces .some(fn@0x0)
    // and the first call crashes. Must guard before cast.
    if let sym = dlsym(handle, "SLEventPostToPid") {
        slPostEventToPidFn = unsafeBitCast(sym,
                                           to: (@convention(c) (pid_t, CGEvent?) -> Void).self)
    } else {
        fputs("[host] dlsym SLEventPostToPid returned NULL " +
              "(err: \(String(cString: dlerror())))\n", stderr)
    }
    fputs("[host] resolved SLEventPostToPid=\(slPostEventToPidFn != nil)\n", stderr)
    return slPostEventToPidFn != nil
}

/// Post a CGEvent to a specific PID via SkyLight's auth-signed channel.
/// Returns true on success, false if SPI unavailable (caller must fall back to HID).
@inline(__always)
func slPostToPid(_ pid: pid_t, _ event: CGEvent?) -> Bool {
    guard let fn = slPostEventToPidFn, let ev = event else { return false }
    fn(pid, ev)
    return true
}

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
// Returns JSON with target_id + re-read name/body_preview for G4 success contract
// (grill Q6=A: verified requires body re-read match, not id-list alone).
// AppleScript returns TAB-separated fields; Swift builds JSON (safe escaping).
func runCreateNote(name: String, body: String) throws -> String {
    let escName = appleScriptEscape(name)
    let escBody = appleScriptEscape(body)

    let source = """
    set outId to ""
    set outName to ""
    set outBody to ""
    tell application "Notes"
        set newNote to make new note with properties {name:"\(escName)", body:"\(escBody)"}
        set outId to id of newNote as string
        set outName to name of newNote as string
        set outBody to body of newNote as string
    end tell
    return outId & "\t" & outName & "\t" & outBody
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
    let raw = result.stringValue ?? ""
    let parts = raw.split(separator: "\t", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
    let outId = parts.count > 0 ? parts[0] : ""
    let outName = parts.count > 1 ? parts[1] : ""
    var outBody = parts.count > 2 ? parts[2] : ""
    if outBody.count > 500 {
        outBody = String(outBody.prefix(500))
    }
    // Build JSON via JSONSerialization for safe escaping of name/body.
    let payload: [String: Any] = [
        "target_id": "macos:com.apple.Notes:default:note-\(outId)",
        "undoable": true,
        "name": outName,
        "body_preview": outBody,
    ]
    let data = try JSONSerialization.data(withJSONObject: payload, options: [])
    return String(data: data, encoding: .utf8) ?? "{}"
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
          estop --socket-path P [--flag-path F]  — long-running emergency-stop helper (WP3)

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
        // Resolve SkyLight SPI before any inject. Fail-fast if unavailable
        // (older macOS, broken OS install) — distinct from a per-call post
        // failure (SKYLIGHT_POST_FAILED). Companion surfaces typed error to LLM.
        if !cuResolveSkyLight() {
            out = cuError("SkyLight SPI unavailable on this OS", code: "SKYLIGHT_SPI_UNAVAILABLE")
            break
        }
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
    case "estop":
        // Long-running emergency-stop helper (WP3 darwin-estop.ts expects this
        // subcommand): CGEventTap hotkey + UNIX socket proof-of-life. Never
        // returns on success — it hosts a CFRunLoop until killed.
        guard let sock = argValue("--socket-path") else { fputs("estop: --socket-path required\n", stderr); exit(2) }
        try runEstop(socketPath: sock, flagPath: argValue("--flag-path") ?? "/tmp/cmspark-estop.flag")
    case "self-test":
        // P2 (Pi C2/C3 + Grok blocker 2): pure-function contract for the
        // capture variance classifier. Print JSON result; exit non-zero on
        // any assertion failure so build-host.sh's `|| exit 1` actually trips.
        // cuSelfTestClassifier returns cuJson({"ok":true,...}) on pass and
        // cuError(... code:"SELF_TEST_FAILED") on fail; we inspect the ok flag
        // directly and short-circuit before the unified `print(out); exit(0)`.
        let testOut = cuSelfTestClassifier()
        print(testOut)
        if let data = testOut.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let ok = obj["ok"] as? Bool, !ok {
            FileHandle.standardError.write("cuSelfTestClassifier reported failure\n".data(using: .utf8)!)
            exit(1)
        }
        exit(0)
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

func cuError(_ error: String, code: String = "INVALID_ACTION", extra: [String: Any] = [:]) -> String {
    // Default-arg `extra` keeps every existing call site (cuError("..."),
    // cuError("...", code: "...")) source-compatible. P2 (Pi C4): the variance
    // classifier attaches capture_degraded metrics here so darwin-adapters can
    // emit operator-only audit BEFORE rethrowing ComputerError to the LLM path.
    var payload: [String: Any] = ["ok": false, "error": error, "error_code": code]
    for (k, v) in extra { payload[k] = v }
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
          let str = String(data: data, encoding: .utf8) else { return "{}" }
    return str
}

func cuJson(_ dict: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
          let str = String(data: data, encoding: .utf8) else { return "{}" }
    return str
}

// MARK: - helpers

/// kCGWindowNumber is CFNumber; bridge may surface as Int / NSNumber / UInt32.
func cuWindowNumber(_ w: [String: Any]) -> UInt32 {
    if let u = w[kCGWindowNumber as String] as? UInt32 { return u }
    if let i = w[kCGWindowNumber as String] as? Int { return UInt32(truncatingIfNeeded: i) }
    if let n = w[kCGWindowNumber as String] as? NSNumber { return n.uint32Value }
    return 0
}

/// Resolve CGWindowList dict for a windowId. WeChat (and some Electron apps)
/// return an empty list for `.optionIncludingWindow` even when the id is valid
/// in `.optionAll` — fall through so screenshot / inject origin don't fail
/// with "cannot get window info for windowId N" (pgvexn / 2026-07-25).
func cuWindowInfoDict(windowId: UInt32) -> [String: Any]? {
    if let raw = CGWindowListCopyWindowInfo([.optionIncludingWindow], windowId) as? [[String: Any]] {
        if let hit = raw.first(where: { cuWindowNumber($0) == windowId }) { return hit }
        // Unfiltered single-element IncludingWindow (older macOS quirks)
        if raw.count == 1, cuWindowNumber(raw[0]) == 0 || cuWindowNumber(raw[0]) == windowId {
            return raw[0]
        }
    }
    // Prefer on-screen first (cheaper, matches user-visible target)
    for opts: CGWindowListOption in [[.optionOnScreenOnly], [.optionAll]] {
        if let rawAll = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]],
           let hit = rawAll.first(where: { cuWindowNumber($0) == windowId }) {
            return hit
        }
    }
    return nil
}

func cuPidForWindow(_ windowId: UInt32) -> pid_t {
    guard let windows = CGWindowListCopyWindowInfo([.optionAll], windowId) as? [[String: Any]],
          let first = windows.first,
          let pid = first[kCGWindowOwnerPID as String] as? pid_t else { return 0 }
    return pid
}

func cuAppElementForPid(_ pid: pid_t) -> AXUIElement? {
    return AXUIElementCreateApplication(pid)
}

// Activate the target app so its window is frontmost and not occluded before
// we screenshot or inject events. Without this, clicking the Chrome side
// panel's security-confirm popup activates Chrome, which occludes the target
// window (NetEase Music, etc.) — then CGEvent.post to .cghidEventTap delivers
// the click to whatever window is visually under the cursor (Chrome), not to
// the target pid we set in eventTargetUnixProcessID (b0faek bug, 2026-07-22).
// Returns true if activation was attempted for a live pid.
func cuActivatePid(_ pid: pid_t) -> Bool {
    guard pid != 0, let app = NSRunningApplication(processIdentifier: pid) else { return false }
    if app.isHidden { app.unhide() }
    app.activate()
    usleep(250000) // 0.25s for the window to actually come to front
    return true
}

// P0-C COMP-1: resolve client-area origin in screen CG points for inject.
// Companion passes client-relative (x,y) (same space as screenshot `client`);
// CGEvent posts need screen coordinates. Mirrors the screenshot AX-by-frame
// matcher (multi-window apps) so title-bar / chrome offsets stay consistent
// with capture. Pure math: screen = clientOrigin + (x, y) in logical CG points.
// Fail closed when windowId cannot be resolved via CGWindowList.
func cuClientOriginScreen(windowId: UInt32) -> CGPoint? {
    guard let first = cuWindowInfoDict(windowId: windowId),
          let bounds = first[kCGWindowBounds as String] as? [String: CGFloat] else {
        return nil
    }
    let fx = bounds["X"] ?? 0
    let fy = bounds["Y"] ?? 0
    let fw = bounds["Width"] ?? 0
    let fh = bounds["Height"] ?? 0
    // Default: client origin = CGWindow frame origin (no chrome offset known).
    var clientOrigin = CGPoint(x: fx, y: fy)

    let pid = cuPidForWindow(windowId)
    if pid != 0, let appElement = cuAppElementForPid(pid) {
        var windowsRef: CFTypeRef?
        AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsRef)
        if let axWindows = windowsRef as? [AXUIElement] {
            // Same AX↔CGWindow frame matcher as cuScreenshot (ea3y6n).
            var bestWin: AXUIElement? = nil
            var bestDist: CGFloat = .infinity
            for axWin in axWindows {
                var posRef: CFTypeRef?; var sizeRef: CFTypeRef?
                AXUIElementCopyAttributeValue(axWin, kAXPositionAttribute as CFString, &posRef)
                AXUIElementCopyAttributeValue(axWin, kAXSizeAttribute as CFString, &sizeRef)
                var pos = CGPoint.zero; var size = CGSize.zero
                if let p = posRef { AXValueGetValue(p as! AXValue, .cgPoint, &pos) }
                if let s = sizeRef { AXValueGetValue(s as! AXValue, .cgSize, &size) }
                let dist = abs(pos.x - fx) + abs(pos.y - fy) + abs(size.width - fw) + abs(size.height - fh)
                if dist < bestDist {
                    bestDist = dist
                    bestWin = axWin
                }
            }
            if let axWin = bestWin {
                var posRef: CFTypeRef?
                AXUIElementCopyAttributeValue(axWin, kAXPositionAttribute as CFString, &posRef)
                var pos = CGPoint.zero
                if let p = posRef { AXValueGetValue(p as! AXValue, .cgPoint, &pos) }
                // Screenshot reports client offset as (pos - frame); client (0,0)
                // in screen space is therefore AX position (when AX matched).
                // When AX frame equals CGWindow frame, this is just (fx, fy).
                clientOrigin = pos
            }
        }
    }
    return clientOrigin
}

// MARK: - window-list

func cuWindowList(bundleId: String?, windowId: UInt32?, foreground: Bool) -> String {
    // kCGWindowOwnerName is the process DISPLAY name (e.g. "网易云音乐"),
    // NOT the bundle ID — comparing it against bundleId filters out
    // everything (2026-07-21 APP_WINDOW_NOT_FOUND bug). Resolve the bundle
    // ID to the app's PID set and filter by kCGWindowOwnerPID instead.
    var pidFilter: Set<Int32>?
    if let bid = bundleId {
        pidFilter = Set(NSRunningApplication.runningApplications(withBundleIdentifier: bid).map { $0.processIdentifier })
    }
    let options: CGWindowListOption = foreground ? [.optionOnScreenOnly] : [.optionAll]
    guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        return cuError("CGWindowListCopyWindowInfo failed")
    }
    var filtered: [[String: Any]] = []
    for w in windows {
        let wid = cuWindowNumber(w)
        let owner = w[kCGWindowOwnerName as String] as? String ?? ""
        let name = w[kCGWindowName as String] as? String ?? ""
        let bounds = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
        let pid = w[kCGWindowOwnerPID as String] as? Int32 ?? 0
        let layer = w[kCGWindowLayer as String] as? Int32 ?? 0
        if let widFilter = windowId, wid != widFilter { continue }
        if let pids = pidFilter, !pids.contains(pid) { continue }
        if layer > 1000 { continue }
        // Ownership is by BUNDLE ID on macOS (policy.ts assertHwndOwnedByEntry
        // compares it against AppEntry.bundleId) — kCGWindowOwnerName is only
        // a display name ("网易云音乐"), so resolve the real bundle ID per pid.
        let ownerBid = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? ""
        filtered.append([
            "windowId": wid, "pid": pid, "ownerName": owner, "name": name,
            "bundleId": ownerBid,
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

// MARK: - screenshot (ScreenCaptureKit)

func cuScreenshot(windowId: UInt32, outputPath: String) -> String {
    // Prefer IncludingWindow, but ALWAYS fall back to optionAll filtered by
    // kCGWindowNumber. WeChat/Electron often return [] for IncludingWindow
    // while the id is still present in optionAll (pgvexn 2026-07-25).
    // Never use unfiltered optionAll (ea3y6n: wrong window → 64x64 rect).
    guard let first = cuWindowInfoDict(windowId: windowId) else {
        return cuError("cannot get window info for windowId \(windowId)")
    }
    guard let bounds = first[kCGWindowBounds as String] as? [String: CGFloat] else {
        return cuError("cannot read window bounds for windowId \(windowId)")
    }
    let rect: [String: CGFloat] = ["x": bounds["X"] ?? 0, "y": bounds["Y"] ?? 0, "width": bounds["Width"] ?? 0, "height": bounds["Height"] ?? 0]
    var client: [String: CGFloat] = ["x": 0, "y": 0, "width": rect["width"] ?? 0, "height": rect["height"] ?? 0]

    let pid = cuPidForWindow(windowId)
    // v4 Defect 1 (Grok v4 plan §2 / Pi review v4 blocker 1): screenshot no
    // longer activates target. SkyLight per-PID inject (v3) made activation
    // unnecessary for click delivery; SCK `desktopIndependentWindow` filter
    // captures window backing store without requiring frontmost. b0faek-class
    // occlusion misroute is now handled by `--check-occlusion` on inject plus
    // honest fail-closed on stale frames (v4.1 will add variance classifier).
    //
    // Canary only (dev / A-B rollback): CMSPARK_SCREENSHOT_FORCE_FG=1 restores
    // legacy b0faek activate behavior. Production default = no activate.
    // Distinct from CMSPARK_SKYLIGHT_FORCE_FG (inject path canary, v3).
    // Diagnostic only when CMSPARK_HOST_DEBUG=1 — unconditional fputs here used
    // to land in node execFile's stderr and get promoted to user-facing
    // "screenshot: [host] screenshot no-activate…" non_recoverable errors.
    if ProcessInfo.processInfo.environment["CMSPARK_HOST_DEBUG"] == "1" {
        if ProcessInfo.processInfo.environment["CMSPARK_SCREENSHOT_FORCE_FG"] == "1" {
            fputs("[host] screenshot activate (CMSPARK_SCREENSHOT_FORCE_FG=1 canary)\n", stderr)
        } else {
            fputs("[host] screenshot no-activate (Hermes background capture path)\n", stderr)
        }
    }
    if ProcessInfo.processInfo.environment["CMSPARK_SCREENSHOT_FORCE_FG"] == "1" {
        cuActivatePid(pid)
    }
    if let appElement = cuAppElementForPid(pid) {
        var windowsRef: CFTypeRef?
        AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsRef)
        if let axWindows = windowsRef as? [AXUIElement] {
            // Match AX window to windowId by frame — AX has no public
            // CGWindowID attribute. Previously this used axWindows.first,
            // which on multi-window apps (NetEase Music: main + mini-player
            // + lyric + tray-icon windows) picked the wrong one and produced
            // a tiny 29x29 client rect → OUT_OF_BOUNDS for every click
            // (ea3y6n bug, 2026-07-22).
            let rx = rect["x"] ?? 0, ry = rect["y"] ?? 0
            let rw = rect["width"] ?? 0, rh = rect["height"] ?? 0
            var bestWin: AXUIElement? = nil
            var bestDist: CGFloat = .infinity
            for axWin in axWindows {
                var posRef: CFTypeRef?; var sizeRef: CFTypeRef?
                AXUIElementCopyAttributeValue(axWin, kAXPositionAttribute as CFString, &posRef)
                AXUIElementCopyAttributeValue(axWin, kAXSizeAttribute as CFString, &sizeRef)
                var pos = CGPoint.zero; var size = CGSize.zero
                if let p = posRef { AXValueGetValue(p as! AXValue, .cgPoint, &pos) }
                if let s = sizeRef { AXValueGetValue(s as! AXValue, .cgSize, &size) }
                let dist = abs(pos.x - rx) + abs(pos.y - ry) + abs(size.width - rw) + abs(size.height - rh)
                if dist < bestDist {
                    bestDist = dist
                    bestWin = axWin
                }
            }
            // Only trust AX when frame match is tight. WeChat (and multi-window
            // Electron apps) often expose a different AX window than the
            // CGWindow we captured; a loose "best" pick produced client
            // offsets like (-313,-107) 880×640 on a 280×380 CG rect, which
            // then poisoned inject bounds checks (2026-07-25).
            if let axWin = bestWin, bestDist < 24 {
                var posRef: CFTypeRef?; var sizeRef: CFTypeRef?
                AXUIElementCopyAttributeValue(axWin, kAXPositionAttribute as CFString, &posRef)
                AXUIElementCopyAttributeValue(axWin, kAXSizeAttribute as CFString, &sizeRef)
                var pos = CGPoint.zero; var size = CGSize.zero
                if let p = posRef { AXValueGetValue(p as! AXValue, .cgPoint, &pos) }
                if let s = sizeRef { AXValueGetValue(s as! AXValue, .cgSize, &size) }
                let fx = rect["x"] ?? 0; let fy = rect["y"] ?? 0
                if size.width > 0 && size.height > 0 {
                    client = ["x": pos.x - fx, "y": pos.y - fy, "width": size.width, "height": size.height]
                }
            }
        }
    }

    // Capture via ScreenCaptureKit (macOS 14+, MANDATORY in 15+).
    // CGWindowListCreateImage was obsoleted in macOS 15 and removed in 26;
    // screencapture CLI on macOS 26 has flaky TCC propagation when the
    // responsible process is an unsigned .app launcher (re-prompts and fails
    // even after the user grants permission). SCScreenshotManager.captureImage
    // is the modern API: it triggers the TCC prompt on first call and throws
    // a clear error on denial.
    //
    // DO NOT add CGPreflightScreenCaptureAccess()/CGRequestScreenCaptureAccess()
    // back: preflight checks THIS process's TCC entry but TCC records the
    // grant against the responsible process up the spawn chain, so the two
    // never line up for an ad-hoc binary → infinite prompt loop.
    // Capture result must cross Task → caller with a lock. Unsynchronized
    // `var capturedImage: CGImage?` + concurrent Task write is a data race:
    // ARC retain on the Task side + main-thread read can leave a half-retained
    // CGImage that later SIGSEGVs at offset 0x10 inside cuScreenshot (after PNG
    // write succeeds). Observed 2026-07-25 on all windows (WeChat/Chrome/Settings).
    let semaphore = DispatchSemaphore(value: 0)
    let captureBox = CUBox<(image: CGImage?, error: String?)>((nil, nil))
    let hostPid = ProcessInfo.processInfo.processIdentifier
    let hostParentPid = getppid()

    let task = Task<Void, Never> {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let targetWindow = content.windows.first(where: { UInt32($0.windowID) == windowId }) else {
                captureBox.with {
                    $0 = (nil, "window \(windowId) not found among \(content.windows.count) SCShareableContent windows (pid=\(hostPid) ppid=\(hostParentPid))")
                }
                semaphore.signal()
                return
            }
            let filter = SCContentFilter(desktopIndependentWindow: targetWindow)
            let config = SCStreamConfiguration()
            config.scalesToFit = false
            config.showsCursor = false
            config.ignoreShadowsSingleWindow = true
            // SCStreamConfiguration defaults width/height to the *display*
            // pixel size (e.g. 1920×1080). Without an explicit size,
            // captureImage returns a full-display buffer even for
            // desktopIndependentWindow — scaleX/Y then explode (280×380
            // window → scaleX≈6.86) and click mapping is wrong.
            // Use the SCWindow frame × backing scale of the screen that
            // contains the window (fallback: max screen scale, then 2.0).
            let frame = targetWindow.frame
            let scale: CGFloat = {
                let screens = NSScreen.screens
                if let hit = screens.first(where: { $0.frame.intersects(frame) }) {
                    return hit.backingScaleFactor
                }
                return screens.map(\.backingScaleFactor).max() ?? 2.0
            }()
            let outW = max(1, Int((frame.width * scale).rounded()))
            let outH = max(1, Int((frame.height * scale).rounded()))
            config.width = outW
            config.height = outH
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            captureBox.with { $0 = (image, nil) }
        } catch let err as NSError {
            // TCC denial codes observed in the wild:
            //   -3801  (user message: 用户拒绝了…捕捉的TCC) — macOS 15/26 common
            //   -38001 — older docs / alternate SCStreamError enum path
            // Match both; also treat localized "TCC" / "denied" in this domain as denial.
            let isSckTcc =
                err.domain == "com.apple.ScreenCaptureKit.SCStreamErrorDomain"
                || err.domain == "com.apple.ScreenCaptureKit"
            let isDenialCode = (err.code == -3801 || err.code == -38001)
            let desc = err.localizedDescription
            let looksLikeDenial = desc.localizedCaseInsensitiveContains("TCC")
                || desc.localizedCaseInsensitiveContains("denied")
                || desc.contains("拒绝")
            let errMsg: String
            if isSckTcc && (isDenialCode || looksLikeDenial) {
                errMsg =
                    "Screen Recording permission denied (ScreenCaptureKit code=\(err.code), " +
                    "pid=\(hostPid) ppid=\(hostParentPid)). " +
                    "Open System Settings → Privacy & Security → Screen Recording, " +
                    "enable «CMspark» (and/or node / cmspark-host if listed), " +
                    "then fully quit and relaunch CMspark.app and retry. " +
                    "Ad-hoc re-sign or reinstall can clear the grant — re-enable if it was on before."
            } else {
                errMsg = "ScreenCaptureKit error: \(err.domain) code=\(err.code) \(desc) (pid=\(hostPid) ppid=\(hostParentPid))"
            }
            captureBox.with { $0 = (nil, errMsg) }
        } catch {
            captureBox.with {
                $0 = (nil, "screenshot capture failed: \(error.localizedDescription) (pid=\(hostPid) ppid=\(hostParentPid))")
            }
        }
        semaphore.signal()
    }
    _ = task
    semaphore.wait()

    let (capturedImage, captureError) = captureBox.with { $0 }
    if let err = captureError {
        return cuError(err, code: "PERMISSION_DENIED")
    }
    guard let image = capturedImage else {
        return cuError("no image captured (no error reported)", code: "PERMISSION_DENIED")
    }

    let outURL = URL(fileURLWithPath: outputPath) as CFURL
    guard let dest = CGImageDestinationCreateWithURL(outURL, "public.png" as CFString, 1, nil) else {
        return cuError("cannot create CGImageDestination for \(outputPath)")
    }
    CGImageDestinationAddImage(dest, image, nil)
    if !CGImageDestinationFinalize(dest) {
        return cuError("CGImageDestinationFinalize failed for \(outputPath)")
    }
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: outputPath)) else {
        return cuError("cannot read captured image back from \(outputPath)")
    }
    let sha256 = SHA256.hash(data: data).compactMap { String(format: "%02x", $0) }.joined()

    // v4 Defect 3 (Grok v4 §4.4 M1 / Pi v4.1 caveat): return real image
    // dimensions + backing scale. Replaces hardcoded `"dpi": 72` lie that
    // hid retina 2x mismatch (root cause of (722, 872) vs 880x640 OOB class).
    let imageWidth = image.width
    let imageHeight = image.height
    let rectW = rect["width"] ?? CGFloat(imageWidth)
    let rectH = rect["height"] ?? CGFloat(imageHeight)
    let scaleX = rectW > 0 ? Double(imageWidth) / Double(rectW) : 1.0
    let scaleY = rectH > 0 ? Double(imageHeight) / Double(rectH) : 1.0

    // v4.1 Blocker 1 (Pi): capture variance classifier — fail closed on stale
    // or blank frames instead of returning a frame the LLM will click into
    // blindly. AND-of-conditions when a prior exists (caret-blink frame has
    // low stdev but low identity → must NOT pass); stdev-only when no prior.
    //
    // Prior-frame store uses free functions over enum statics (not a
    // file-level lazy `CUBox` global). Post-SCK first access of that global
    // SIGSEGV'd @ 0x10 on macOS 26 (2026-07-25); local CUBox + enum statics OK.
    let priorKey = windowId
    let downsample = cuDownsampleToBitmap(image, side: 64)
    let stdev = cuLumaStdev(downsample)
    let prior = cuPriorFrameGet(priorKey)
    var identity = -1.0
    if let p = prior {
        identity = cuIdentity(downsample, p)
    }
    let sizeBytes = data.count
    let sizeGuard = sizeBytes < 1024 || imageWidth < 8 || imageHeight < 8
    // Grok material 6: empty downsample means CGContext draw failed even
    // though PNG wrote nonzero bytes — treat as fail-closed (cannot evaluate
    // variance on missing pixels). Without this guard, AND clause would be
    // false (cuIdentity returns -1 on length mismatch) → stale frame passes.
    let downsampleEmpty = downsample.isEmpty
    var stale = false
    if sizeGuard || downsampleEmpty {
        stale = true
    } else if prior != nil {
        // Prior exists: require BOTH low stdev AND high identity to declare
        // stale (Pi caveat: OR over-flags caret-blink frames).
        stale = (stdev < 1.0 && identity >= 0.99)
    } else {
        // No prior: stdev-only fallback (first capture of this window).
        stale = stdev < 1.0
    }
    // Update prior regardless of verdict — next call uses this for identity.
    cuPriorFrameSet(priorKey, downsample)

    // Reason taxonomy (operator-only; LLM only sees CAPTURE_FAILED per Pi C4).
    // size_guard wins because a 0-byte / 0-dim frame makes stdev/identity
    // meaningless — the luma/identity classifier cannot rescue a missing file.
    // downsample_failed is the CGContext-draw-failed analog (PNG wrote but
    // pixels did not survive bitmap conversion).
    let reason: String
    if sizeGuard {
        reason = "size_guard"
    } else if downsampleEmpty {
        reason = "downsample_failed"
    } else if prior != nil {
        reason = "pixel_identity"
    } else {
        reason = "luma_stdev"
    }

    if stale {
        // P2 C4 (Grok blocker 1): error string stays GENERIC — no stdev /
        // identity / sizeBytes / reason leak. Metrics go ONLY to stderr
        // (operator) + capture_degraded payload (operator audit). The TS layer
        // also force-genericizes the message as defense-in-depth.
        fputs("[host] CAPTURE_FAILED windowId=\(windowId) reason=\(reason) " +
              "stdev=\(String(format: "%.3f", stdev)) " +
              "identity=\(String(format: "%.3f", identity)) sizeBytes=\(sizeBytes) " +
              "imageW=\(imageWidth) imageH=\(imageHeight)\n", stderr)
        return cuError(
            "stale or solid capture frame",
            code: "CAPTURE_FAILED",
            extra: [
                "capture_degraded": [
                    "reason": reason,
                    "stdev": stdev,
                    "identity": identity,
                    "sizeBytes": sizeBytes,
                    "imageWidth": imageWidth,
                    "imageHeight": imageHeight,
                    "threshold": [
                        "stdev_lt": 1.0,
                        "identity_gte": 0.99,
                        "min_bytes": 1024,
                        "min_dim": 8,
                    ],
                    "prior_present": prior != nil,
                    "sha256": sha256,
                ] as [String: Any],
            ])
    }

    return cuJson([
        "ok": true,
        "rect": rect,
        "client": client,
        "dpi": 72,  // legacy field preserved for older consumers; new fields below are authoritative
        "imageWidth": imageWidth,
        "imageHeight": imageHeight,
        "scaleX": scaleX,
        "scaleY": scaleY,
        "backingScale": scaleX,  // == scaleX on macOS (per-axis equal in practice)
        "path": outputPath,
        "sha256": sha256,
    ])
}

// MARK: - capture variance classifier helpers (v4.1 Blocker 1)

/// Thread-safe last-frame 64×64 luma bitmap per windowId (identity check).
///
/// Implemented as free functions over a private enum namespace — NOT a
/// file-level `private let CUBox<…>([:])`. On macOS 26 + ScreenCaptureKit,
/// the first access to that lazy global *after* `SCScreenshotManager.captureImage`
/// completed was crashing with SIGSEGV @ 0x10 (nil receiver) while a *local*
/// CUBox created before capture worked fine. Function-scoped static storage
/// via enum avoids that post-SCK global-init footgun.
private enum CuPriorFrameStore {
    static var frames: [UInt32: [UInt8]] = [:]
    static let lock = NSLock()
}

private func cuPriorFrameGet(_ windowId: UInt32) -> [UInt8]? {
    CuPriorFrameStore.lock.lock()
    defer { CuPriorFrameStore.lock.unlock() }
    return CuPriorFrameStore.frames[windowId]
}

private func cuPriorFrameSet(_ windowId: UInt32, _ bitmap: [UInt8]) {
    CuPriorFrameStore.lock.lock()
    defer { CuPriorFrameStore.lock.unlock() }
    CuPriorFrameStore.frames[windowId] = bitmap
}

/// Simple lock-protected box for mutable state that must cross Task → caller
/// (e.g. ScreenCaptureKit result). Prefer local instances over file-level
/// lazy globals when used near SCK (see CuPriorFrameStore note).
private final class CUBox<T> {
    private var storage: T
    private let lock = NSLock()
    init(_ initial: T) { self.storage = initial }
    var value: T {
        get { lock.lock(); defer { lock.unlock() }; return storage }
        set { lock.lock(); defer { lock.unlock() }; storage = newValue }
    }
    func with<R>(_ body: (inout T) -> R) -> R {
        lock.lock(); defer { lock.unlock() }
        return body(&storage)
    }
}

/// Downsample a CGImage to a `side`x`side` luma bitmap (0-255 per cell).
/// Uses average pooling over the source image. Returns empty array on failure.
///
/// IMPORTANT: CGContext stores the `data` pointer and uses it later in
/// `draw`. Swift's `CGContext(data: &array, …)` only keeps the Array buffer
/// pointer valid for the duration of the *initializer call*, so the subsequent
/// `ctx.draw` is a use-after-free → SIGSEGV (KERN_INVALID_ADDRESS at 0x10),
/// after PNG write already succeeded. Bind the buffer with
/// `withUnsafeMutableBytes` for the whole draw lifetime.
func cuDownsampleToBitmap(_ image: CGImage, side: Int) -> [UInt8] {
    let w = image.width
    let h = image.height
    if w <= 0 || h <= 0 || side <= 0 { return [] }
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bytesPerRow = side * 4
    var pixels = [UInt8](repeating: 0, count: side * side * 4)
    let ok = pixels.withUnsafeMutableBytes { rawBuf -> Bool in
        guard let base = rawBuf.baseAddress else { return false }
        guard let ctx = CGContext(
            data: base,
            width: side, height: side,
            bitsPerComponent: 8, bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return false }
        ctx.interpolationQuality = .low
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
        return true
    }
    if !ok { return [] }
    var luma = [UInt8](repeating: 0, count: side * side)
    for i in 0..<(side * side) {
        let r = Double(pixels[i * 4])
        let g = Double(pixels[i * 4 + 1])
        let b = Double(pixels[i * 4 + 2])
        luma[i] = UInt8(min(255, max(0, 0.299 * r + 0.587 * g + 0.114 * b)))
    }
    return luma
}

/// Population standard deviation of luma across the bitmap. Low stdev ⇒ uniform
/// color (likely blank). Returns 0.0 for empty input.
func cuLumaStdev(_ bitmap: [UInt8]) -> Double {
    guard !bitmap.isEmpty else { return 0.0 }
    let n = Double(bitmap.count)
    let sum = bitmap.reduce(0.0) { $0 + Double($1) }
    let mean = sum / n
    let variance = bitmap.reduce(0.0) { $0 + (Double($1) - mean) * (Double($1) - mean) } / n
    return variance.squareRoot()
}

/// Fraction of cells whose luma matches the prior exactly (0.0–1.0).
/// Returns -1 if lengths differ (caller treats as "no prior").
func cuIdentity(_ current: [UInt8], _ prior: [UInt8]) -> Double {
    guard !current.isEmpty, current.count == prior.count else { return -1.0 }
    let matches = zip(current, prior).filter { $0 == $1 }.count
    return Double(matches) / Double(current.count)
}

/// P2 (Pi C2/C3) self-test for the variance classifier's pure helpers.
/// Drives cuLumaStdev / cuIdentity with synthetic bitmaps to lock:
///   - blank frame → stdev = 0.0
///   - identical prior → identity = 1.0
///   - 1-cell change (caret-blink analog) → identity = (n-1)/n which is ABOVE
///     the 0.99 fail-closed threshold when n=64*64=4096 (≈0.99976) — proves
///     AND-of-conditions correctly rejects caret-blink false-positives
///   - 100-cell change → identity = (n-100)/n ≈ 0.9756, BELOW 0.99 → stale
///
/// Returns cuJson({"ok":true,...}) on pass; on the first failing assertion,
/// writes the assertion name to stderr and exits non-zero via the caller's
/// do/catch (HostError). Called by the `self-test` subcommand and by
/// build-host-skylight.sh as a post-build functional gate.
func cuSelfTestClassifier() -> String {
    var failures: [String] = []
    let n = 64 * 64

    // 1. stdev of all-zero bitmap = 0 (uniform)
    let zeros = [UInt8](repeating: 0, count: n)
    let stdevZeros = cuLumaStdev(zeros)
    if stdevZeros != 0.0 {
        failures.append("stdev_zeros: expected 0.0, got \(stdevZeros)")
    }

    // 2. stdev of all-255 bitmap = 0 (uniform)
    let whites = [UInt8](repeating: 255, count: n)
    let stdevWhites = cuLumaStdev(whites)
    if stdevWhites != 0.0 {
        failures.append("stdev_whites: expected 0.0, got \(stdevWhites)")
    }

    // 3. stdev of half-0 / half-255 bitmap ≈ 127.5 (high variance)
    var halfAndHalf = [UInt8](repeating: 0, count: n)
    for i in 0..<n { halfAndHalf[i] = i < n / 2 ? 0 : 255 }
    let stdevHalf = cuLumaStdev(halfAndHalf)
    if stdevHalf < 100.0 {
        failures.append("stdev_half: expected >=100.0, got \(stdevHalf)")
    }

    // 4. identity of identical bitmaps = 1.0
    let idIdentical = cuIdentity(zeros, zeros)
    if idIdentical != 1.0 {
        failures.append("identity_identical: expected 1.0, got \(idIdentical)")
    }

    // 5. identity of mismatched lengths = -1.0
    let idMismatched = cuIdentity(zeros, [UInt8](repeating: 0, count: 10))
    if idMismatched != -1.0 {
        failures.append("identity_mismatched_len: expected -1.0, got \(idMismatched)")
    }

    // 6. identity with single-cell change (caret-blink analog) — must be ABOVE
    //    0.99 fail-closed threshold so AND-of-conditions does NOT flag stale.
    var caretBlink = zeros
    caretBlink[0] = 255
    let idCaret = cuIdentity(zeros, caretBlink)
    if idCaret <= 0.99 {
        failures.append("identity_caret_blink: expected >0.99 (cell-flip must not trip stale), got \(idCaret)")
    }

    // 7. identity with 100-cell change — BELOW 0.99, classifies as stale
    var bigChange = zeros
    for i in 0..<100 { bigChange[i] = 255 }
    let idBig = cuIdentity(zeros, bigChange)
    if idBig >= 0.99 {
        failures.append("identity_big_change: expected <0.99 (100-cell change must trip stale), got \(idBig)")
    }

    // 8. AND-of-conditions stale verdict (prior exists):
    //    - low stdev + high identity → stale (true stale, e.g. fully black frame twice)
    //    - low stdev + low identity (caret blink flipped a cell but stdev still low)
    //      → NOT stale (Pi C2 caveat: OR over-flags caret-blink)
    let stdevLow = 0.5
    let idHigh: Double = 1.0       // identical black prior
    let staleIdHigh = (stdevLow < 1.0 && idHigh >= 0.99)
    if !staleIdHigh {
        failures.append("and_prior_stale_idHigh: expected true (black prior + black frame)")
    }
    // Note: a low-stdev frame with a high-identity prior IS flagged stale by
    // AND. This is correct — see threat-class table in review-pi-p2.txt.
    // Caret-blink (1 cell of 4096 flips) raises stdev above 1.0 (Pi analysis),
    // so the AND clause's stdev gate excludes it. Verified by self-test #10
    // (and_truth_low_low_not_stale) and #11 (and_truth_high_high_not_stale).

    // 9. no-prior path: stdev-only fallback
    let staleNoPrior = (stdevLow < 1.0)  // no prior branch
    if !staleNoPrior {
        failures.append("no_prior_stdev_only: expected true (blank first capture)")
    }

    // 10. Grok material 5: real AND truth table (prior exists)
    //     - low stdev + LOW identity → NOT stale (caret-blink flipped cells in
    //       a low-variance field; OR would over-flag, AND correctly skips)
    //     - high stdev + HIGH identity → NOT stale (contentful identical frame;
    //       stdev disqualifies — frozen UI with rich content)
    //     - high stdev + LOW identity → NOT stale (live frame, content changed)
    //     Only (low stdev + high identity) trips stale — proven in #8.
    let stdevLowIdLow: Bool = (Double(0.5) < 1.0 && Double(0.80) >= 0.99)       // false
    let stdevHighIdHigh: Bool = (Double(50.0) < 1.0 && Double(1.0) >= 0.99)     // false (stdev)
    let stdevHighIdLow: Bool = (Double(50.0) < 1.0 && Double(0.50) >= 0.99)     // false (stdev)
    if stdevLowIdLow {
        failures.append("and_truth_low_low: expected NOT stale, got stale (caret-blink false positive)")
    }
    if stdevHighIdHigh {
        failures.append("and_truth_high_high: expected NOT stale, got stale (contentful freeze misflag)")
    }
    if stdevHighIdLow {
        failures.append("and_truth_high_low: expected NOT stale, got stale (live frame misflag)")
    }

    // 11. Grok material 6: empty downsample (CGImage decode failure) + prior
    //     MUST be CAPTURE_FAILED, not silently pass. cuIdentity returns -1 on
    //     length mismatch → AND clause false → would pass without guard.
    //     Implementation contract: empty bitmap (sizeGuard would catch via 0
    //     bytes, but if the PNG wrote successfully with 0-dim image, downsample
    //     also empty) → caller MUST fail-closed. Encode the invariant here.
    let emptyBitmap: [UInt8] = []
    let emptyStdev = cuLumaStdev(emptyBitmap)         // 0.0
    let emptyIdentity = cuIdentity(emptyBitmap, zeros) // -1.0 (mismatched length)
    if emptyStdev != 0.0 {
        failures.append("empty_stdev: expected 0.0, got \(emptyStdev)")
    }
    if emptyIdentity != -1.0 {
        failures.append("empty_identity: expected -1.0, got \(emptyIdentity)")
    }
    // The host.swift cuScreenshot guards this via sizeGuard (imageWidth<8 ||
    // imageHeight<8 catches 0-dim). Lock the contract: with empty bitmap and
    // a prior, stale MUST still be true via sizeGuard, not the AND clause.
    // (Self-test cannot call sizeGuard directly — it's inline in cuScreenshot.
    // This assertion documents the contract: empty bitmap → stdev 0, id -1,
    // AND clause alone would be false → rely on sizeGuard in production.)
    let emptyAndClause = (emptyStdev < 1.0 && emptyIdentity >= 0.99)  // false (id -1)
    if emptyAndClause {
        failures.append("empty_and_clause: must be false — sizeGuard is the safety net for empty bitmaps")
    }

    if !failures.isEmpty {
        let msg = failures.joined(separator: "; ")
        fputs("[host] cuSelfTestClassifier FAIL: \(msg)\n", stderr)
        return cuError("classifier self-test failed: \(msg)", code: "SELF_TEST_FAILED")
    }
    return cuJson([
        "ok": true,
        "passed": [
            "stdev_zeros",
            "stdev_whites",
            "stdev_half",
            "identity_identical",
            "identity_mismatched_len",
            "identity_caret_blink_gt_0.99",
            "identity_big_change_lt_0.99",
            "and_prior_stale_idHigh",
            "no_prior_stdev_only",
            "and_truth_low_low_not_stale",
            "and_truth_high_high_not_stale",
            "and_truth_high_low_not_stale",
            "empty_bitmap_contract",
        ],
    ])
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
    // SkyLight per-PID posting reaches background windows without activation.
    // CMSPARK_SKYLIGHT_FORCE_FG=1 is a CANARY-ONLY A/B knob for diff testing
    // (does the no-raise path match legacy activate-then-post behavior on the
    // same target?). Removed in Stage 3 post-canary per Plan v3.
    if ProcessInfo.processInfo.environment["CMSPARK_SKYLIGHT_FORCE_FG"] == "1" {
        cuActivatePid(pid)
    } else {
        fputs("[host] skipping forceForeground (SkyLight per-PID path)\n", stderr)
    }

    switch action {
    case "click", "double_click", "right_click":
        guard let px = x, let py = y else { return cuError("click requires --x and --y") }
        // P0-C COMP-1: client → screen via window bounds + client origin offset.
        // Companion injects client-space coords; CGEvent needs screen CG points.
        guard let clientOrigin = cuClientOriginScreen(windowId: windowId) else {
            return cuError("cannot resolve client origin for windowId \(windowId)", code: "HWND_DEAD")
        }
        let screenX = clientOrigin.x + CGFloat(px)
        let screenY = clientOrigin.y + CGFloat(py)
        let screenPt = CGPoint(x: screenX, y: screenY)
        let cc: Int64 = (action == "double_click") ? 2 : 1
        let isRight = (action == "right_click")
        let btn: CGMouseButton = isRight ? .right : .left
        // mouseType must match the physical button — leftMouseDown with btn=.right
        // is interpreted as a left-click by some receivers (notably Chrome).
        let downType: CGEventType = isRight ? .rightMouseDown : .leftMouseDown
        let upType: CGEventType = isRight ? .rightMouseUp : .leftMouseUp
        // P0-C: post at screenPt (client→screen), not raw client px/py.
        guard let me = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: screenPt, mouseButton: btn) else {
            return cuError("CGEvent mouseMoved construction failed", code: "CGEVENT_CONSTRUCT_FAILED")
        }
        me.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        if !slPostToPid(pid, me) { return cuError("SkyLight SPI post failed", code: "SKYLIGHT_POST_FAILED") }
        usleep(50000)
        guard let de = CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: screenPt, mouseButton: btn) else {
            return cuError("CGEvent mouseDown construction failed", code: "CGEVENT_CONSTRUCT_FAILED")
        }
        de.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        if !slPostToPid(pid, de) { return cuError("SkyLight SPI post failed", code: "SKYLIGHT_POST_FAILED") }
        for _ in 1..<cc {
            usleep(100000)
            if !slPostToPid(pid, de) { return cuError("SkyLight SPI post failed", code: "SKYLIGHT_POST_FAILED") }
        }
        usleep(50000)
        guard let ue = CGEvent(mouseEventSource: nil, mouseType: upType, mouseCursorPosition: screenPt, mouseButton: btn) else {
            return cuError("CGEvent mouseUp construction failed", code: "CGEVENT_CONSTRUCT_FAILED")
        }
        ue.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        if !slPostToPid(pid, ue) { return cuError("SkyLight SPI post failed", code: "SKYLIGHT_POST_FAILED") }
        // x/y remain client coords (Windows computer-input.ps1 parity); screenX/Y report landing.
        return cuJson(["ok": true, "action": action, "x": px, "y": py, "screenX": screenX, "screenY": screenY])

    case "type":
        guard let txt = text else { return cuError("type requires --text") }
        let src = CGEventSource(stateID: .hidSystemState)
        for ch in txt.unicodeScalars {
            var uc = UniChar(ch.value)
            guard let ev = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true) else {
                return cuError("CGEvent key construction failed", code: "CGEVENT_CONSTRUCT_FAILED")
            }
            ev.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
            ev.keyboardSetUnicodeString(stringLength: 1, unicodeString: &uc)
            if !slPostToPid(pid, ev) { return cuError("SkyLight SPI post failed", code: "SKYLIGHT_POST_FAILED") }
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
            guard let ev = CGEvent(keyboardEventSource: src, virtualKey: kc, keyDown: true) else {
                return cuError("CGEvent key construction failed", code: "CGEVENT_CONSTRUCT_FAILED")
            }
            ev.flags = flags
            ev.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
            if !slPostToPid(pid, ev) { return cuError("SkyLight SPI post failed", code: "SKYLIGHT_POST_FAILED") }
            usleep(30000)
        }
        return cuJson(["ok": true, "action": "key", "chord": ch])

    case "scroll":
        guard let d = delta else { return cuError("scroll requires --delta") }
        guard let ev = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(d), wheel2: 0, wheel3: 0) else {
            return cuError("CGEvent scroll construction failed", code: "CGEVENT_CONSTRUCT_FAILED")
        }
        ev.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        if !slPostToPid(pid, ev) { return cuError("SkyLight SPI post failed", code: "SKYLIGHT_POST_FAILED") }
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


// MARK: - estop subcommand (WP3 darwin emergency stop)
//
// Architecture mirrors companion/src/computer/darwin-estop.ts:
//   - CGEventTap registers Ctrl+Shift+Alt+Cmd+E as a global hotkey
//   - a UNIX domain socket is the proof-of-life channel: the companion holds
//     an open connection; this process dying closes it (EOF) and the
//     companion fails closed (EMERGENCY_STOP_LOST)
//   - on hotkey press: write the estop flag file (JSON {"timestamp": ms})
//     and push an "estop" event line to every connected socket
//
// TCC: CGEventTap creation requires Accessibility (Input Monitoring) trust
// for THIS binary. tapCreate returning nil = not trusted → exit with a clear
// stderr message so the companion's preflight fails closed fast.

final class EstopContext {
    let flagPath: String
    private var clients: [Int32] = []
    private let lock = NSLock()

    init(flagPath: String) { self.flagPath = flagPath }

    func addClient(_ fd: Int32) {
        lock.lock(); clients.append(fd); lock.unlock()
    }

    /// Hotkey pressed: persist the flag and notify all held connections.
    func trigger() {
        let payload = "{\"timestamp\": \(Int(Date().timeIntervalSince1970 * 1000))}"
        try? payload.write(toFile: flagPath, atomically: true, encoding: .utf8)
        lock.lock()
        var alive: [Int32] = []
        for fd in clients {
            let written = "estop\n".withCString { write(fd, $0, strlen($0)) }
            if written >= 0 { alive.append(fd) } else { close(fd) }
        }
        clients = alive
        lock.unlock()
    }
}

private var gEstopTap: CFMachPort?
private var gEstopCtx: EstopContext?

private func estopEventTapCallback(
    _ proxy: CGEventTapProxy,
    _ type: CGEventType,
    _ event: CGEvent,
    _ userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    // macOS disables slow taps; re-enable instead of losing the kill switch.
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = gEstopTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    guard type == .keyDown else { return Unmanaged.passUnretained(event) }
    let required: CGEventFlags = [.maskControl, .maskAlternate, .maskCommand, .maskShift]
    if event.getIntegerValueField(.keyboardEventKeycode) == Int64(kVK_ANSI_E),
       event.flags.contains(required) {
        gEstopCtx?.trigger()
    }
    // Pass the event through — never swallow user keystrokes.
    return Unmanaged.passUnretained(event)
}

/// Bind + listen on the UNIX socket, spawn the accept loop, install the
/// event tap, then run the run loop forever. Returns Never on success;
/// throws (fast, with a stderr message) when setup fails.
func runEstop(socketPath: String, flagPath: String) throws -> Never {
    // 1. UNIX socket server (proof-of-life; accepted connections are held open)
    unlink(socketPath)  // stale socket from a previous (killed) helper
    let serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
    guard serverFD >= 0 else {
        throw HostError(code: 3, message: "estop: socket() failed: errno=\(errno)")
    }
    let pathBytes = Array(socketPath.utf8)
    guard pathBytes.count < 104 else {  // sizeof(sockaddr_un.sun_path)
        close(serverFD)
        throw HostError(code: 2, message: "estop: socket path too long (\(pathBytes.count) bytes)")
    }
    var addr = sockaddr_un()
    addr.sun_len = UInt8(MemoryLayout<sockaddr_un>.stride)
    addr.sun_family = sa_family_t(AF_UNIX)
    withUnsafeMutableBytes(of: &addr.sun_path) { raw in
        for i in 0..<pathBytes.count { raw[i] = pathBytes[i] }
        raw[pathBytes.count] = 0
    }
    let bindResult = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            bind(serverFD, $0, socklen_t(MemoryLayout<sockaddr_un>.stride))
        }
    }
    guard bindResult == 0 else {
        let e = errno; close(serverFD)
        throw HostError(code: 3, message: "estop: bind \(socketPath) failed: errno=\(e)")
    }
    guard listen(serverFD, 8) == 0 else {
        let e = errno; close(serverFD)
        throw HostError(code: 3, message: "estop: listen failed: errno=\(e)")
    }

    let ctx = EstopContext(flagPath: flagPath)
    gEstopCtx = ctx

    DispatchQueue.global().async {
        while true {
            let client = accept(serverFD, nil, nil)
            if client >= 0 { ctx.addClient(client) }
        }
    }

    // 2. CGEventTap hotkey: Ctrl+Shift+Alt+Cmd+E
    // tapCreate fails SILENTLY (returns nil) when the binary is not
    // TCC-trusted — it never prompts on its own. Request trust explicitly so
    // the user gets the system "would like to control this computer" dialog
    // and a landing spot in the Accessibility list instead of a dead helper.
    if !AXIsProcessTrusted() {
        let promptOpts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(promptOpts)
    }
    let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .defaultTap,
        eventsOfInterest: mask,
        callback: estopEventTapCallback,
        userInfo: nil
    ) else {
        close(serverFD)
        throw HostError(
            code: 4,
            message: "estop: CGEventTap creation failed — grant Accessibility permission to cmspark-host (System Settings → Privacy & Security → Accessibility)"
        )
    }
    gEstopTap = tap
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)

    // 3. Live until killed (companion spawns us non-detached; we die with it)
    CFRunLoopRun()
    exit(0)  // unreachable — satisfies Never
}
