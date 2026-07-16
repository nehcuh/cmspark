import Foundation

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

// MARK: - Entry point

let argv = CommandLine.arguments
guard argv.count >= 2 else {
    let usage = """
        usage: cmspark-host <subcommand> [options]
          read-mail                            — read top-1 Mail inbox
          list-mail [--limit N]                — list inbox TargetIds (default limit 100)
          read-message --target <TargetId>     — read message by stable id

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
    case "read-message":
        guard let target = argValue("--target") else {
            FileHandle.standardError.write("read-message: --target <TargetId> required\n".data(using: .utf8)!)
            exit(2)
        }
        out = try runReadMessage(targetId: target)
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

