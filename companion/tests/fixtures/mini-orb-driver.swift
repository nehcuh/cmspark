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
    app.sendEvent(event(.leftMouseDown, 22, 22))
    app.sendEvent(event(.leftMouseUp, 22, 22))
    let before = panel.frame.origin
    app.sendEvent(event(.leftMouseDown, 22, 22))
    app.sendEvent(event(.leftMouseDragged, -24, 42))
    app.sendEvent(event(.leftMouseUp, 22, 22))
    let after = panel.frame.origin
    precondition(after != before)
    visible(false); precondition(!panel.isVisible)
    visible(true); precondition(hypot(after.x-panel.frame.minX, after.y-panel.frame.minY) < 2)
    func held() -> NSWindow {
      app.sendEvent(event(.leftMouseDown, 23, 23))
      RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.54))
      guard let fan = app.windows.first(where: { $0.title == "CMspark Mini 操作" && $0.isVisible }) else {
        fatalError("Holding the orb did not open the action fan")
      }
      precondition(fan.frame.contains(panel.frame))
      return fan
    }
    let sx: CGFloat = panel.frame.midX < panel.screen!.visibleFrame.midX ? 1 : -1
    let sy: CGFloat = panel.frame.midY < panel.screen!.visibleFrame.midY ? 1 : -1
    func slide(_ x: CGFloat, _ y: CGFloat) {
      app.sendEvent(event(.leftMouseDragged, 23 + x*sx, 23 + y*sy))
    }
    func release(_ x: CGFloat, _ y: CGFloat) {
      app.sendEvent(event(.leftMouseUp, 23 + x*sx, 23 + y*sy))
    }
    let fan = held()
    slide(96,64)
    slide(210,12)
    precondition(panel.isVisible && fan.isVisible)
    release(210,12)
    precondition(!fan.isVisible && !panel.isVisible)
    visible(true)
    for (x,y,capture) in [(105,2,false),(64,119,false),(28,178,false),(234,65,true),(216,122,true),(160,180,true)] {
      let open = held()
      if capture { slide(96,64) }
      slide(CGFloat(x),CGFloat(y))
      release(CGFloat(x),CGFloat(y))
      precondition(!open.isVisible && panel.isVisible != capture)
      visible(true)
    }
    let returned = held()
    slide(96,64)
    slide(0,0)
    release(0,0)
    precondition(!returned.isVisible && panel.isVisible)
    let escaped = held()
    escaped.sendEvent(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0,
      windowNumber: escaped.windowNumber, context: nil, characters: "\u{1b}", charactersIgnoringModifiers: "\u{1b}",
      isARepeat: false, keyCode: 53)!)
    release(64,119)
    precondition(!escaped.isVisible && panel.isVisible)
    precondition(panel.frame.origin == after)

    // Use AppKit's menu tracking hook. The OS menu is populated by the real button.
    var action: String? = "chat"
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
    button.rightMouseDown(with: event(.rightMouseDown, 22, 22))
    action = nil
    button.rightMouseDown(with: event(.rightMouseDown, 22, 22))
    precondition(visits == 2 && panel.isVisible)
    NotificationCenter.default.removeObserver(tracking)
    timeout.invalidate()
    delegate.shutdown()
    precondition(!panel.isVisible)
    print("PASS macOS Mini click, drag/restore, long press, native menu actions, cancel and quit")
  }
}
