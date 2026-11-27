import AppKit
import Foundation

@main
enum MiniNativeTest {
  static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.finishLaunching()
    let delegate = TrayDelegate()
    let menu = buildMenu(target: delegate, action: #selector(TrayDelegate.menuAction(_:)))
    let toggle = menu.item(withTitle: "显示 Mini 桌面小球")!
    precondition(toggle.state == .off)
    menu.performActionForItem(at: menu.index(of: toggle))
    func visible(_ value: Bool) { handleCommand("mini", json: ["visible": value], delegate: delegate) }
    visible(true)
    let panel = app.windows.first { $0.title == "CMspark Mini" } as! NSPanel
    let button = panel.contentView as! NSButton
    if CommandLine.arguments.contains("--restored-position") {
      precondition(panel.isVisible)
      delegate.shutdown()
      return
    }
    precondition(panel.isVisible && panel.level == .floating && panel.collectionBehavior.contains(.canJoinAllSpaces))
    precondition(panel.styleMask.contains(.nonactivatingPanel))
    precondition(buildMenu(target: delegate, action: #selector(TrayDelegate.menuAction(_:))).item(withTitle: toggle.title)?.state == .on)
    func event(_ type: NSEvent.EventType, _ x: CGFloat, _ y: CGFloat) -> NSEvent {
      NSEvent.mouseEvent(with: type, location: NSPoint(x: x, y: y), modifierFlags: [],
        timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: panel.windowNumber, context: nil,
        eventNumber: 0, clickCount: 1, pressure: 1)!
    }
    button.mouseDown(with: event(.leftMouseDown, 22, 22))
    button.mouseUp(with: event(.leftMouseUp, 22, 22))
    let before = panel.frame.origin
    button.mouseDown(with: event(.leftMouseDown, 22, 22))
    button.mouseDragged(with: event(.leftMouseDragged, -24, 42))
    button.mouseUp(with: event(.leftMouseUp, 22, 22))
    let after = panel.frame.origin
    precondition(after != before)
    visible(false); precondition(!panel.isVisible)
    visible(true); precondition(hypot(after.x-panel.frame.minX, after.y-panel.frame.minY) < 2)
    // Use AppKit's menu tracking hook. The OS menu is populated by the real button.
    var action: String? = "todo"
    var visits = 0
    let tracking = NotificationCenter.default.addObserver(forName: NSMenu.didBeginTrackingNotification,
      object: nil, queue: nil) { notification in
        guard let menu = notification.object as? NSMenu,
              menu.items.first?.representedObject as? String == "chat" else { return }
        precondition(Set(menu.items.compactMap { $0.representedObject as? String }) ==
                     Set(["chat", "search", "meeting", "todo", "ask", "ocr", "capture"]))
        visits += 1
        let timer = Timer(timeInterval: 0.04, repeats: false) { _ in
          menu.cancelTracking()
          if let action, let index = menu.items.firstIndex(where: { $0.representedObject as? String == action }) {
            menu.performActionForItem(at: index)
          }
        }
        RunLoop.main.add(timer, forMode: .common)
      }
    let timeout = Timer(timeInterval: 5, repeats: false) { _ in fatalError("Mini menu tracking timed out") }
    RunLoop.main.add(timeout, forMode: .common)
    button.mouseDown(with: event(.leftMouseDown, 22, 22))
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.8))
    precondition(visits == 1 && !panel.isVisible)
    visible(true)
    for id in ["search", "meeting", "ask", "ocr", "capture"] {
      action = id
      button.rightMouseDown(with: event(.rightMouseDown, 22, 22))
      precondition(panel.isVisible == (id == "search" || id == "meeting"))
      visible(true)
    }
    action = nil
    button.rightMouseDown(with: event(.rightMouseDown, 22, 22))
    precondition(visits == 7 && panel.isVisible)
    NotificationCenter.default.removeObserver(tracking)
    timeout.invalidate()
    delegate.shutdown()
    precondition(!panel.isVisible)
    print("PASS macOS Mini click, drag/restore, long press, native menu actions, cancel and quit")
  }
}
