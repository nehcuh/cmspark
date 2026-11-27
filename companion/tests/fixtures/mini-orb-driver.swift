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
    func fan() -> NSWindow? { app.windows.first { $0.title == "CMspark Mini 操作" && $0.isVisible } }
    func clickOrb() -> NSWindow {
      app.sendEvent(event(.leftMouseDown, 23, 23))
      app.sendEvent(event(.leftMouseUp, 23, 23))
      guard let open = fan() else { fatalError("Click did not open menu") }
      return open
    }
    func keyEscape(_ window: NSWindow) {
      window.sendEvent(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0,
        windowNumber: window.windowNumber, context: nil, characters: "\u{1b}", charactersIgnoringModifiers: "\u{1b}",
        isARepeat: false, keyCode: 53)!)
    }
    keyEscape(clickOrb())
    app.sendEvent(event(.leftMouseDown, 23, 23))
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.55))
    precondition(fan() == nil)
    app.sendEvent(event(.leftMouseUp, 23, 23))
    precondition(fan() == nil)
    let before = panel.frame.origin
    app.sendEvent(event(.leftMouseDown, 22, 22))
    app.sendEvent(event(.leftMouseDragged, -24, 42))
    app.sendEvent(event(.leftMouseUp, 22, 22))
    let after = panel.frame.origin
    precondition(after != before && fan() == nil)
    visible(false); precondition(!panel.isVisible)
    visible(true); precondition(hypot(after.x-panel.frame.minX, after.y-panel.frame.minY) < 2)
    let sx: CGFloat = panel.frame.midX < panel.screen!.visibleFrame.midX ? 1 : -1
    let sy: CGFloat = panel.frame.midY < panel.screen!.visibleFrame.midY ? 1 : -1
    func click(_ window: NSWindow, _ x: CGFloat, _ y: CGFloat) {
      let point = window.convertPoint(fromScreen: NSPoint(x:panel.frame.midX+x*sx, y:panel.frame.midY+y*sy))
      for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
        window.sendEvent(NSEvent.mouseEvent(with:type, location:point, modifierFlags:[], timestamp:0,
          windowNumber:window.windowNumber, context:nil, eventNumber:0, clickCount:1, pressure:1)!)
      }
    }
    for (x,y,capture) in [(210,12,true),(105,2,false),(64,119,false),(28,178,false),(234,65,true),(216,122,true),(160,180,true)] {
      let open = clickOrb()
      if capture { click(open,96,64); precondition(open.isVisible) }
      click(open,CGFloat(x),CGFloat(y))
      precondition(!open.isVisible && panel.isVisible != capture)
      visible(true)
    }
    let returned = clickOrb()
    click(returned,0,0)
    precondition(!returned.isVisible && panel.isVisible)
    precondition(panel.frame.origin == after)

    // Use AppKit's menu tracking hook. The OS menu is populated by the real button.
    var action: String? = "chat"
    var visits = 0
    var delayed = false
    let tracking = NotificationCenter.default.addObserver(forName: NSMenu.didBeginTrackingNotification,
      object: nil, queue: nil) { notification in
        guard let menu = notification.object as? NSMenu else { return }
        if delayed, menu.items.first?.title == "框选后 3 秒" {
          let actions = menu.items[0].submenu!
          let timer = Timer(timeInterval: 0.04, repeats: false) { _ in
            menu.cancelTracking()
            actions.performActionForItem(at: actions.items.firstIndex { $0.representedObject as? String == "capture:3" }!)
          }
          RunLoop.main.add(timer, forMode: .common)
          return
        }
        guard menu.items.first?.representedObject as? String == "chat" else { return }
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
    delayed = true
    func openPicker() -> NSWindow {
      let open = clickOrb()
      click(open,96,64)
      click(open,254,180)
      guard let picker = app.windows.first(where: { $0.isVisible && $0.title == "CMspark Mini 选区" }) else { fatalError("missing delayed region picker") }
      precondition(!panel.isVisible && !open.isVisible)
      return picker
    }
    keyEscape(openPicker())
    precondition(panel.isVisible)
    let picker = openPicker()
    let v = picker.contentView!
    for (type,p) in [(NSEvent.EventType.leftMouseDown, NSPoint(x: 32,y: 32)),(.leftMouseDragged,NSPoint(x: 83,y: 67)),(.leftMouseUp,NSPoint(x: 83,y: 67))] {
      let e = NSEvent.mouseEvent(with:type,location:p,modifierFlags:[],timestamp:0,windowNumber:picker.windowNumber,
        context:nil,eventNumber:0,clickCount:1,pressure:1)!
      if type == .leftMouseDown { v.mouseDown(with:e) } else if type == .leftMouseUp { v.mouseUp(with:e) } else { v.mouseDragged(with:e) }
    }
    precondition(!picker.isVisible && !panel.isVisible)
    visible(true)
    NotificationCenter.default.removeObserver(tracking)
    timeout.invalidate()
    delegate.shutdown()
    precondition(!panel.isVisible)
    print("PASS macOS Mini click, drag/restore, long press, native menu actions, cancel and quit")
  }
}
