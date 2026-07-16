import Foundation

// cmspark-host: minimal macOS binary that loads a precompiled .scpt and runs
// it in-process via NSAppleScript. The binary is the TCC-attribution anchor:
// the Automation permission dialog should name "cmspark-host", not osascript
// nor any parent process. See docs/decisions/computer-use-round2-synthesis.md.
//
// Phase 0 scope: only `read-mail` subcommand. AppleScript produces JSON string
// directly (jsonEscape in read-mail.applescript); Swift just prints it.

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

func runReadMail() throws -> String {
    guard let scptURL = findScript("read-mail") else {
        throw HostError(
            code: 3,
            message: "read-mail.scpt not found next to cmspark-host executable"
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

let argv = CommandLine.arguments
guard argv.count >= 2 else {
    FileHandle.standardError.write(
        "usage: cmspark-host <subcommand>\n  read-mail  — read top-1 Mail inbox message\n"
            .data(using: .utf8)!
    )
    exit(2)
}

let subcommand = argv[1]
do {
    let out: String
    switch subcommand {
    case "read-mail":
        out = try runReadMail()
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
