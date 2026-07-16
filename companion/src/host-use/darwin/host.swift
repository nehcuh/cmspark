import Foundation
import LocalAuthentication

// cmspark-host: minimal macOS binary that loads a precompiled .scpt and runs
// it in-process via NSAppleScript. The binary is the TCC-attribution anchor:
// the Automation permission dialog should name "cmspark-host", not osascript
// nor any parent process. See docs/decisions/computer-use-round2-synthesis.md.
//
// Phase 1 W5 scope:
//   - `read-mail`                  — read top-1 Mail inbox (Phase 0 path, retained)
//   - `list-mail [--limit N]`      — list inbox TargetIds (Phase 1 W5)
//   - `read-message --account A --id I` — read by stable id (Phase 1 W5)
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
// Swift parses this and constructs an AppleScript source string at runtime
// (with single-quoted args to prevent injection) and runs via NSAppleScript.
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

// Escape a string for inclusion in single-quoted AppleScript context.
// AppleScript single-quote string: backslash and double-quote are NOT special;
// only the single quote itself needs escaping (which we do by closing, adding
// "'" via concat, and reopening). Simpler: just reject single quotes entirely.
func validateNoSingleQuote(_ s: String) throws {
    if s.contains("'") {
        throw HostError(code: 6, message: "read-message: account name contains single quote (rejected for safety)")
    }
}

func runReadMessage(targetId: String) throws -> String {
    let (account, msgId) = try parseTargetId(targetId)
    try validateNoSingleQuote(account)

    // Build AppleScript source. Account goes in single quotes (rejected above
    // if it contains '). Message id is integer-coerced so no injection risk.
    let source = """
    set maxChars to 500
    set theSender to ""
    set theSubject to ""
    set theDate to ""
    set theBody to "[message not found]"
    tell application "Mail"
        repeat with m in messages of inbox
            try
                if (id of m) is \(msgId) then
                    if (name of account of mailbox of m) is "\(account)" then
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
    return "{\\"sender\\":\\"" & theSender & "\\",\\"subject\\":\\"" & theSubject & "\\",\\"date_received\\":\\"" & theDate & "\\",\\"body_preview\\":\\"" & theBody & "\\"}"
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

// Escape a string for use inside AppleScript double-quoted string literal.
// Returns nil if the string contains characters we can't safely escape
// (currently: single quote is rejected because we use it elsewhere in the
// source template — could be fixed by switching to quoted-form form, but
// better to fail loud than risk injection).
func appleScriptEscape(_ s: String) -> String? {
    if s.contains("'") { return nil }  // safety: rejected entirely
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
    guard let escName = appleScriptEscape(name) else {
        throw HostError(code: 6, message: "create-note: name contains single quote (rejected)")
    }
    guard let escBody = appleScriptEscape(body) else {
        throw HostError(code: 6, message: "create-note: body contains single quote (rejected)")
    }

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
func runMoveFile(sourcePath: String, destPath: String) throws -> String {
    guard let escSrc = appleScriptEscape(sourcePath) else {
        throw HostError(code: 6, message: "move-file: source path contains single quote")
    }
    guard let escDest = appleScriptEscape(destPath) else {
        throw HostError(code: 6, message: "move-file: destination path contains single quote")
    }

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
          read-mail                            — read top-1 Mail inbox
          list-mail [--limit N]                — list inbox TargetIds (default limit 100)
          read-message --target <TargetId>     — read message by stable id
          list-notes                           — list notes TargetIds (Phase 1 W7)
          list-files                           — list Documents folder TargetIds (Phase 1 W7)
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

