// A private test app. User selection exercises the shipping helper without sharing another app.
import AppKit
import Foundation

let bundle = "dev.cmspark.tests.OwnedChat900"
let fixtureTitle = "CMspark #900 — select this blue chat"
let system = NSApplication.shared
system.setActivationPolicy(.accessory)
let screens = NSScreen.screens
let session = CGSessionCopyCurrentDictionary() as? [String: Any]
guard #available(macOS 15.2, *), screens.count >= 2,
      session?["CGSSessionScreenIsLocked"] as? Bool != true else {
    fputs("SKIP: requires an unlocked macOS 15.2+ desktop and two extended displays.\n", stderr)
    exit(77)
}

@MainActor func makeWindow(_ title: String, color: NSColor) -> NSWindow {
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 350, height: 230),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.title = title
    window.backgroundColor = color
    return window
}
@MainActor func position(_ w: NSWindow, on screen: NSScreen) {
    let frame = screen.visibleFrame
    w.setFrameOrigin(NSPoint(x: frame.midX - w.frame.width/2, y: frame.midY - w.frame.height/2))
    w.orderFrontRegardless()
}
let (target, cover) = MainActor.assumeIsolated {
    let target = makeWindow(fixtureTitle, color: .blue)
    let cover = makeWindow("CMspark #900 — foreground editor", color: .red)
    position(target, on: screens[1])
    position(cover, on: screens[0])
    return (target, cover)
}
let helper = Process(), commands = Pipe(), responses = Pipe()
helper.executableURL = URL(fileURLWithPath: CommandLine.arguments[1])
helper.arguments = ["activity-window-picker", "--bundle-id", bundle]
helper.standardInput = commands
helper.standardOutput = responses
func finish(_ status: Int32, _ reason: String) -> Never {
    if helper.isRunning { helper.terminate() }
    fputs(reason + "\n", stderr)
    exit(status)
}
try helper.run()
fputs("In the system window picker select the blue CMspark #900 chat. Keep both fixture windows unobstructed.\n", stderr)
DispatchQueue.global().asyncAfter(deadline: .now() + 100) { finish(1, "Timed out waiting for fixture or user selection.") }

// Read one whole helper record at a time; retain only synthetic pixels from this app.
func nextReply() -> [String: Any] {
    var data = Data()
    while true {
        let chunk = responses.fileHandleForReading.availableData
        guard !chunk.isEmpty, data.count + chunk.count < 12 * 1024 * 1024 else { finish(1, "Invalid helper response.") }
        data.append(chunk)
        if data.last == 10 { break }
    }
    guard let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { finish(1, "Invalid JSON.") }
    return result
}
func check(_ expected: String) -> [String: Any] {
    Thread.sleep(forTimeInterval: 0.6)
    commands.fileHandleForWriting.write(Data("capture\n".utf8))
    let result = nextReply(), status = result["status"] as? String ?? "unknown"
    guard status == expected else { finish(1, "Expected \(expected), got \(status).") }
    if status == "frame" {
        guard let text = result["image"] as? String, let png = Data(base64Encoded: text),
              let bitmap = NSBitmapImageRep(data: png),
              let color = bitmap.colorAt(x: bitmap.pixelsWide/2, y: bitmap.pixelsHigh/2)?.usingColorSpace(.deviceRGB),
              color.blueComponent > 0.7, color.redComponent < 0.3 else { finish(1, "Captured the wrong window content.") }
    }
    return result
}
DispatchQueue.global().async {
    let selected = nextReply()
    guard selected["status"] as? String == "selected",
          selected["app_id"] as? String == bundle, selected["title"] as? String == fixtureTitle else { finish(1, "The blue fixture window was not selected.") }
    DispatchQueue.main.sync { cover.makeKeyAndOrderFront(nil) }
    let first = check("frame")
    DispatchQueue.main.sync { position(cover, on: screens[1]) }
    _ = check("occluded")
    DispatchQueue.main.sync { position(target, on: screens[0]) }
    let moved = check("frame")
    guard let firstDisplay = first["display"] as? String, let nextDisplay = moved["display"] as? String,
          firstDisplay != nextDisplay else { finish(1, "Display did not change.") }
    DispatchQueue.main.sync { target.miniaturize(nil) }
    _ = check("notVisible")
    DispatchQueue.main.sync { target.close() }
    _ = check("closed")
    finish(0, "PASS: selected window, second display, occlusion, move, minimization and closure.")
}
system.run()
