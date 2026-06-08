// CMspark Swift Tray — Native NSStatusBar for macOS (Apple Silicon)
//
// Protocol (line-delimited JSON on stdin/stdout):
//   → stdout: {"type":"click","action":"start|stop|status|logs|chrome|autostart|quit"}
//   → stdout: {"type":"exit","code":0}
//   ← stdin:  {"cmd":"update","status":"running|stopped|unknown"}
//   ← stdin:  {"cmd":"update-autostart","enabled":true|false}
//   ← stdin:  {"cmd":"quit"}

import AppKit
import Foundation

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

let STATUS_FILE_NAME = ".menu-bar-status.json"
let CONFIG_DIR = FileManager.default.homeDirectoryForCurrentUser
  .appendingPathComponent(".cmspark-agent")
  .path

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

enum CompanionStatus: String {
  case running = "running"
  case stopped = "stopped"
  case unknown = "unknown"
}

var currentStatus: CompanionStatus = .unknown
var autoStartEnabled: Bool = false

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

func jsonLine(_ dict: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: dict),
     let str = String(data: data, encoding: .utf8) {
    print(str, terminator: "\n")
    fflush(stdout)
  }
}

// ---------------------------------------------------------------------------
// Icon generation (programmatic — no asset files needed)
// ---------------------------------------------------------------------------

func makeStatusIcon(_ status: CompanionStatus, size: NSSize = NSSize(width: 18, height: 18)) -> NSImage {
  let image = NSImage(size: size)
  image.lockFocus()

  let rect = NSRect(origin: .zero, size: size)
  let path = NSBezierPath(ovalIn: rect.insetBy(dx: 2, dy: 2))

  let color: NSColor
  switch status {
  case .running:
    color = NSColor.systemGreen
  case .stopped:
    color = NSColor.systemRed
  case .unknown:
    color = NSColor.systemYellow
  }

  color.setFill()
  path.fill()

  // White border for visibility in both dark/light mode
  NSColor.white.withAlphaComponent(0.3).setStroke()
  path.lineWidth = 0.5
  path.stroke()

  image.unlockFocus()
  image.isTemplate = false
  return image
}

// ---------------------------------------------------------------------------
// Status file reading
// ---------------------------------------------------------------------------

func readStatusFile() -> CompanionStatus {
  let path = (CONFIG_DIR as NSString).appendingPathComponent(STATUS_FILE_NAME)
  guard let data = FileManager.default.contents(atPath: path),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let statusStr = json["companionStatus"] as? String else {
    return .unknown
  }
  return CompanionStatus(rawValue: statusStr) ?? .unknown
}

// ---------------------------------------------------------------------------
// Menu construction
// ---------------------------------------------------------------------------

func buildMenu(target: AnyObject?, action: Selector?) -> NSMenu {
  let menu = NSMenu()

  let running = currentStatus == .running

  let startItem = NSMenuItem(title: "启动 Companion", action: action, keyEquivalent: "")
  startItem.target = target
  startItem.tag = 0
  startItem.isEnabled = !running
  menu.addItem(startItem)

  let stopItem = NSMenuItem(title: "停止 Companion", action: action, keyEquivalent: "")
  stopItem.target = target
  stopItem.tag = 1
  stopItem.isEnabled = running
  menu.addItem(stopItem)

  menu.addItem(NSMenuItem.separator())

  let statusItem = NSMenuItem(title: "查看状态", action: action, keyEquivalent: "")
  statusItem.target = target
  statusItem.tag = 2
  menu.addItem(statusItem)

  let logsItem = NSMenuItem(title: "打开日志目录", action: action, keyEquivalent: "")
  logsItem.target = target
  logsItem.tag = 3
  menu.addItem(logsItem)

  let chromeItem = NSMenuItem(title: "打开 Chrome Side Panel", action: action, keyEquivalent: "")
  chromeItem.target = target
  chromeItem.tag = 4
  menu.addItem(chromeItem)

  menu.addItem(NSMenuItem.separator())

  let autoStartItem = NSMenuItem(
    title: "开机自启: \(autoStartEnabled ? "开" : "关")",
    action: action,
    keyEquivalent: ""
  )
  autoStartItem.target = target
  autoStartItem.tag = 5
  menu.addItem(autoStartItem)

  menu.addItem(NSMenuItem.separator())

  let quitItem = NSMenuItem(title: "退出", action: action, keyEquivalent: "q")
  quitItem.target = target
  quitItem.tag = 6
  menu.addItem(quitItem)

  return menu
}

func updateMenuItemEnabled(_ menu: NSMenu, tag: Int, enabled: Bool) {
  if let item = menu.item(withTag: tag) {
    item.isEnabled = enabled
  }
}

// ---------------------------------------------------------------------------
// Tray delegate
// ---------------------------------------------------------------------------

class TrayDelegate: NSObject {
  var statusItem: NSStatusItem?
  var timer: Timer?

  func setup() {
    let bar = NSStatusBar.system
    statusItem = bar.statusItem(withLength: NSStatusItem.squareLength)

    guard let button = statusItem?.button else { return }
    button.image = makeStatusIcon(currentStatus)
    button.toolTip = "CMspark Agent - 检测中..."

    let menu = buildMenu(target: self, action: #selector(menuClicked(_:)))
    statusItem?.menu = menu

    // Poll status file every 2 seconds
    timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
      let newStatus = readStatusFile()
      if newStatus != currentStatus {
        currentStatus = newStatus
        DispatchQueue.main.async {
          self.updateTrayAppearance()
        }
      }
    }

    updateTrayAppearance()
  }

  func updateTrayAppearance() {
    guard let button = statusItem?.button else { return }
    button.image = makeStatusIcon(currentStatus)

    let tooltip: String
    switch currentStatus {
    case .running:
      tooltip = "CMspark Agent - 运行中"
    case .stopped:
      tooltip = "CMspark Agent - 已停止"
    case .unknown:
      tooltip = "CMspark Agent - 检测中..."
    }
    button.toolTip = tooltip

    // Rebuild menu to reflect new state
    if let menu = statusItem?.menu {
      let running = currentStatus == .running
      updateMenuItemEnabled(menu, tag: 0, enabled: !running)
      updateMenuItemEnabled(menu, tag: 1, enabled: running)
    }
  }

  func updateAutoStart(_ enabled: Bool) {
    autoStartEnabled = enabled
    DispatchQueue.main.async {
      self.statusItem?.menu = buildMenu(target: self, action: #selector(self.menuClicked(_:)))
    }
  }

  @objc func menuClicked(_ sender: NSMenuItem) {
    let actions = ["start", "stop", "status", "logs", "chrome", "autostart", "quit"]
    guard sender.tag >= 0 && sender.tag < actions.count else { return }
    let action = actions[sender.tag]
    jsonLine(["type": "click", "action": action])

    if action == "quit" {
      NSApplication.shared.terminate(nil)
    }
  }

  func shutdown() {
    timer?.invalidate()
    timer = nil
  }
}

// ---------------------------------------------------------------------------
// Stdin command reader
// ---------------------------------------------------------------------------

func startStdinReader(delegate: TrayDelegate) {
  let fh = FileHandle.standardInput
  fh.readabilityHandler = { handle in
    let data = handle.availableData
    guard !data.isEmpty else {
      // EOF reached — remove handler to prevent busy-loop
      fh.readabilityHandler = nil
      return
    }
    guard let line = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
          !line.isEmpty,
          let json = try? JSONSerialization.jsonObject(with: line.data(using: .utf8)!) as? [String: Any],
          let cmd = json["cmd"] as? String else {
      return
    }

    DispatchQueue.main.async {
      switch cmd {
      case "update":
        if let statusStr = json["status"] as? String,
           let status = CompanionStatus(rawValue: statusStr) {
          currentStatus = status
          delegate.updateTrayAppearance()
        }

      case "update-autostart":
        if let enabled = json["enabled"] as? Bool {
          delegate.updateAutoStart(enabled)
        }

      case "quit":
        delegate.shutdown()
        NSApplication.shared.terminate(nil)

      default:
        break
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let delegate = TrayDelegate()
delegate.setup()
startStdinReader(delegate: delegate)

// Notify parent process that tray is ready
jsonLine(["type": "ready"])

// Initial status read
 currentStatus = readStatusFile()
delegate.updateTrayAppearance()

// Run the app
app.run()

// Notify exit
delegate.shutdown()
jsonLine(["type": "exit", "code": 0])
