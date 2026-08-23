// CMspark Swift Tray — Native NSStatusBar for macOS (Apple Silicon)
//
// Hierarchical menu with submenus for status details, quick actions,
// and recent threads. Communication via line-delimited JSON on stdin/stdout.
//
// Protocol (stdin ← Node.js):
//   {"cmd":"update","status":"running|stopped|unknown","wsConnected":true,"pid":12345}
//   {"cmd":"update-autostart","enabled":true}
//   {"cmd":"update-quick-actions","actions":[{"id":"read-page","title":"📖 读取当前页面"},...]}
//   {"cmd":"update-recent-threads","threads":[{"id":"abc","title":"数据分析报告..."},...]}
//   {"cmd":"quit"}
//
// Protocol (stdout → Node.js):
//   {"type":"ready","pid":12345}
//   {"type":"click","action":"start|stop|restart|status|logs|chrome|settings|autostart|quit"}
//   {"type":"click","action":"quick-action","id":"read-page"}
//   {"type":"click","action":"recent-thread","id":"abc"}
//   {"type":"summoner.ready|closed|submit|search|attach_chrome|continue|composing|hotkey.chosen"}
//   {"type":"exit","code":0}
//
// Summoner stdin (Companion → Swift):
//   {"cmd":"summoner.open|hydrate|token|done|error|close|hotkey.prompt|hotkey.set", ...}

import AppKit
import Foundation
import Carbon
import AVFoundation

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

/// Quartz-top-left screen rect so S23 matches host.swift kCGWindowBounds.
func emitCompanionUiRect(_ surface: String, window: NSWindow?) {
  guard let window, window.isVisible else {
    jsonLine(["type": "companion.ui.rect", "surface": surface, "hidden": true])
    return
  }
  let f = window.frame
  let screenH = (NSScreen.main ?? NSScreen.screens.first)?.frame.height ?? f.maxY
  let yTop = screenH - f.maxY
  jsonLine([
    "type": "companion.ui.rect",
    "surface": surface,
    "x": f.origin.x,
    "y": yTop,
    "width": f.size.width,
    "height": f.size.height,
  ])
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

enum CompanionStatus: String {
  case running = "running"
  case stopped = "stopped"
  case unknown = "unknown"
}

struct QuickAction {
  let id: String
  let title: String
}

struct RecentThread {
  let id: String
  let title: String
}

var currentStatus: CompanionStatus = .unknown
var wsConnected: Bool = false
var currentPid: Int? = nil
var autoStartEnabled: Bool = false
var quickActions: [QuickAction] = []
var recentThreads: [RecentThread] = []

// ---------------------------------------------------------------------------
// Icon generation (programmatic — no asset files needed)
// ---------------------------------------------------------------------------

func makeStatusIcon(_ status: CompanionStatus, ws: Bool, size: NSSize = NSSize(width: 18, height: 18)) -> NSImage {
  let image = NSImage(size: size)
  image.lockFocus()

  let fullRect = NSRect(origin: .zero, size: size)
  let outer = NSBezierPath(ovalIn: fullRect.insetBy(dx: 2, dy: 2))

  // Alpha-only fill — macOS tints for dark/light mode
  let fillAlpha: CGFloat
  switch status {
  case .running:  fillAlpha = 0.85
  case .stopped:  fillAlpha = 0.45
  case .unknown:  fillAlpha = 0.6
  }

  NSColor.white.withAlphaComponent(fillAlpha).setFill()
  outer.fill()

  NSColor.white.withAlphaComponent(0.3).setStroke()
  outer.lineWidth = 0.5
  outer.stroke()

  // Inner dot when running + WS connected
  if status == .running && ws {
    let dotSize = NSSize(width: 6, height: 6)
    let dotOrigin = NSPoint(
      x: (size.width - dotSize.width) / 2,
      y: (size.height - dotSize.height) / 2
    )
    let dot = NSBezierPath(ovalIn: NSRect(origin: dotOrigin, size: dotSize))
    NSColor.white.withAlphaComponent(0.95).setFill()
    dot.fill()
  }

  image.unlockFocus()
  image.isTemplate = true
  return image
}

// ---------------------------------------------------------------------------
// Menu tag constants
// ---------------------------------------------------------------------------

enum MenuTag: Int {
  case header = -1
  case start = 100
  case stop = 101
  case restart = 102
  case statusRefresh = 199
  case logs = 200
  case chrome = 201
  case settings = 202
  case pairing = 203
  case summoner = 204
  case summonerHotkey = 205
  case autostart = 300
  case quit = 999
  // Dynamic ranges
  case quickActionBase = 5000
  case recentThreadBase = 6000
}

// ---------------------------------------------------------------------------
// Menu construction
// ---------------------------------------------------------------------------

func buildMenu(target: AnyObject?, action: Selector?) -> NSMenu {
  let menu = NSMenu()
  let running = currentStatus == .running

  // -- Header (non-interactive status display) --
  let statusEmoji: String
  switch currentStatus {
  case .running:  statusEmoji = "🟢"
  case .stopped:  statusEmoji = "🔴"
  case .unknown:  statusEmoji = "🟡"
  }
  let header = NSMenuItem(title: "\(statusEmoji) CMspark Agent", action: nil, keyEquivalent: "")
  header.tag = MenuTag.header.rawValue
  header.isEnabled = false
  menu.addItem(header)

  menu.addItem(NSMenuItem.separator())

  // -- Start / Stop / Restart --
  let startItem = NSMenuItem(title: "▶ 启动 Companion", action: action, keyEquivalent: "s")
  startItem.target = target
  startItem.tag = MenuTag.start.rawValue
  startItem.isEnabled = !running
  menu.addItem(startItem)

  let stopItem = NSMenuItem(title: "⏹ 停止 Companion", action: action, keyEquivalent: "x")
  stopItem.target = target
  stopItem.tag = MenuTag.stop.rawValue
  stopItem.isEnabled = running
  menu.addItem(stopItem)

  let restartItem = NSMenuItem(title: "🔄 重启 Companion", action: action, keyEquivalent: "r")
  restartItem.target = target
  restartItem.tag = MenuTag.restart.rawValue
  restartItem.isEnabled = running
  menu.addItem(restartItem)

  menu.addItem(NSMenuItem.separator())

  // -- Status Details submenu --
  let statusMenuItem = NSMenuItem(title: "📊 状态详情", action: nil, keyEquivalent: "")
  let statusMenu = NSMenu()

  let compLabel = running ? "运行中" : "已停止"
  statusMenu.addItem(makeInfoItem("Companion: \(compLabel)"))

  let wsIcon = running ? (wsConnected ? "🟢" : "🟡") : "🔴"
  let wsLabel = wsConnected ? "已连接" : "未连接"
  statusMenu.addItem(makeInfoItem("WebSocket: \(wsIcon) \(wsLabel) :23401"))

  let pidStr = currentPid.map(String.init) ?? "—"
  statusMenu.addItem(makeInfoItem("PID: \(pidStr)"))

  statusMenu.addItem(makeInfoItem("数据目录: ~/.cmspark-agent"))

  let now = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
  statusMenu.addItem(makeInfoItem("最后检测: \(now)"))

  statusMenu.addItem(NSMenuItem.separator())

  let refreshItem = NSMenuItem(title: "🔄 刷新状态", action: action, keyEquivalent: "")
  refreshItem.target = target
  refreshItem.tag = MenuTag.statusRefresh.rawValue
  statusMenu.addItem(refreshItem)

  statusMenuItem.submenu = statusMenu
  menu.addItem(statusMenuItem)

  // -- Quick Actions submenu --
  if !quickActions.isEmpty {
    let qaMenuItem = NSMenuItem(title: "⚡ 快速操作", action: nil, keyEquivalent: "")
    let qaMenu = NSMenu()
    for (i, qa) in quickActions.enumerated() {
      let item = NSMenuItem(title: qa.title, action: action, keyEquivalent: "")
      item.target = target
      item.tag = MenuTag.quickActionBase.rawValue + i
      item.representedObject = qa.id
      qaMenu.addItem(item)
    }
    qaMenuItem.submenu = qaMenu
    menu.addItem(qaMenuItem)
  }

  // -- Recent Threads submenu --
  if !recentThreads.isEmpty {
    let rtMenuItem = NSMenuItem(title: "💬 最近对话", action: nil, keyEquivalent: "")
    let rtMenu = NSMenu()
    for (i, thread) in recentThreads.enumerated() {
      let item = NSMenuItem(title: "📌 \(thread.title)", action: action, keyEquivalent: "")
      item.target = target
      item.tag = MenuTag.recentThreadBase.rawValue + i
      item.representedObject = thread.id
      rtMenu.addItem(item)
    }
    rtMenuItem.submenu = rtMenu
    menu.addItem(rtMenuItem)
  }

  menu.addItem(NSMenuItem.separator())

  // -- Utility items --
  let logsItem = NSMenuItem(title: "📂 打开日志目录", action: action, keyEquivalent: "l")
  logsItem.target = target
  logsItem.tag = MenuTag.logs.rawValue
  menu.addItem(logsItem)

  let pairingItem = NSMenuItem(title: "🔑 显示配对码", action: action, keyEquivalent: "p")
  pairingItem.target = target
  pairingItem.tag = MenuTag.pairing.rawValue
  menu.addItem(pairingItem)

  let summonerItem = NSMenuItem(title: "召唤器（实验）…", action: action, keyEquivalent: "")
  summonerItem.target = target
  summonerItem.tag = MenuTag.summoner.rawValue
  menu.addItem(summonerItem)

  let summonerHotkeyItem = NSMenuItem(title: "召唤器快捷键…", action: action, keyEquivalent: "")
  summonerHotkeyItem.target = target
  summonerHotkeyItem.tag = MenuTag.summonerHotkey.rawValue
  menu.addItem(summonerHotkeyItem)

  let chromeItem = NSMenuItem(title: "🌐 打开 Chrome", action: action, keyEquivalent: "c")
  chromeItem.target = target
  chromeItem.tag = MenuTag.chrome.rawValue
  menu.addItem(chromeItem)

  let settingsItem = NSMenuItem(title: "⚙️ 设置", action: action, keyEquivalent: ",")
  settingsItem.target = target
  settingsItem.tag = MenuTag.settings.rawValue
  menu.addItem(settingsItem)

  menu.addItem(NSMenuItem.separator())

  // -- Auto-start (checkbox) --
  let autoItem = NSMenuItem(title: "开机自启", action: action, keyEquivalent: "a")
  autoItem.target = target
  autoItem.tag = MenuTag.autostart.rawValue
  autoItem.state = autoStartEnabled ? .on : .off
  menu.addItem(autoItem)

  menu.addItem(NSMenuItem.separator())

  // -- Quit --
  // Quit tears down Companion daemon as well (menu-bar-agent stopCompanion force)
  let quitItem = NSMenuItem(title: "❌ 退出（停止服务）", action: action, keyEquivalent: "q")
  quitItem.target = target
  quitItem.tag = MenuTag.quit.rawValue
  menu.addItem(quitItem)

  return menu
}

private func makeInfoItem(_ title: String) -> NSMenuItem {
  let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
  item.isEnabled = false
  return item
}

// ---------------------------------------------------------------------------
// Tray delegate
// ---------------------------------------------------------------------------

class TrayDelegate: NSObject {
  var statusItem: NSStatusItem?

  func setup() {
    let bar = NSStatusBar.system
    statusItem = bar.statusItem(withLength: NSStatusItem.squareLength)

    guard let button = statusItem?.button else { return }
    button.image = makeStatusIcon(currentStatus, ws: wsConnected)
    button.toolTip = tooltipForStatus(currentStatus)

    // Explicitly handle both left and right mouse clicks so the menu pops up
    // reliably on either button (macOS default only shows the menu on left-click).
    button.target = self
    button.action = #selector(showMenu)
    button.sendAction(on: [.leftMouseUp, .rightMouseUp])
  }

  @objc func showMenu() {
    guard let button = statusItem?.button else { return }
    let menu = buildMenu(target: self, action: #selector(menuAction(_:)))
    statusItem?.menu = menu
    // Position the menu just below the status item button.
    let origin = NSPoint(x: button.bounds.minX, y: button.bounds.maxY + 4)
    menu.popUp(positioning: nil, at: origin, in: button)
  }

  func rebuildMenu() {
    // Menu is rebuilt fresh each time showMenu() is invoked, so no need to
    // regenerate it here; just make sure the current menu is assigned.
  }

  func updateAppearance() {
    guard let button = statusItem?.button else { return }
    button.image = makeStatusIcon(currentStatus, ws: wsConnected)
    button.toolTip = tooltipForStatus(currentStatus)
  }

  @objc func menuAction(_ sender: NSMenuItem) {
    let tag = sender.tag

    if tag == MenuTag.start.rawValue {
      jsonLine(["type": "click", "action": "start"])
    } else if tag == MenuTag.stop.rawValue {
      jsonLine(["type": "click", "action": "stop"])
    } else if tag == MenuTag.restart.rawValue {
      jsonLine(["type": "click", "action": "restart"])
    } else if tag == MenuTag.statusRefresh.rawValue {
      jsonLine(["type": "click", "action": "status"])
    } else if tag == MenuTag.logs.rawValue {
      jsonLine(["type": "click", "action": "logs"])
    } else if tag == MenuTag.chrome.rawValue {
      jsonLine(["type": "click", "action": "chrome"])
    } else if tag == MenuTag.pairing.rawValue {
      jsonLine(["type": "click", "action": "show-pairing"])
    } else if tag == MenuTag.summoner.rawValue {
      // Overlay opens locally; stdout summoner.ready lets Node hydrate. Not a confirm surface.
      summonerController.open(threadId: "")
    } else if tag == MenuTag.summonerHotkey.rawValue {
      summonerController.open(threadId: "")
      summonerController.showHotkeyPicker()
    } else if tag == MenuTag.settings.rawValue {
      jsonLine(["type": "click", "action": "settings"])
    } else if tag == MenuTag.autostart.rawValue {
      jsonLine(["type": "click", "action": "autostart"])
    } else if tag == MenuTag.quit.rawValue {
      jsonLine(["type": "click", "action": "quit"])
      shutdown()
      NSApplication.shared.terminate(nil)
      return
    } else if tag >= MenuTag.quickActionBase.rawValue && tag < MenuTag.recentThreadBase.rawValue {
      if let id = sender.representedObject as? String {
        jsonLine(["type": "click", "action": "quick-action", "id": id])
      }
    } else if tag >= MenuTag.recentThreadBase.rawValue {
      if let id = sender.representedObject as? String {
        jsonLine(["type": "click", "action": "recent-thread", "id": id])
      }
    }
  }

  func shutdown() {
    // no-op; kept for compatibility
  }
}

private func tooltipForStatus(_ status: CompanionStatus) -> String {
  switch status {
  case .running:  return "CMspark Agent — 运行中"
  case .stopped:  return "CMspark Agent — 已停止"
  case .unknown:  return "CMspark Agent — 检测中..."
  }
}

// ---------------------------------------------------------------------------
// Stdin command reader
// ---------------------------------------------------------------------------

func startStdinReader(delegate: TrayDelegate) {
  let fh = FileHandle.standardInput
  var buffer = Data()

  // IMPORTANT: In readabilityHandler, empty `availableData` means EOF (pipe closed).
  // Do NOT call `availableData` a second time after draining a line — a second empty
  // read is normal between messages and must NOT clear the handler. The previous
  // `if buffer.isEmpty && handle.availableData.isEmpty { handler = nil }` pattern
  // silently disabled stdin after the first complete command (e.g. "update"), so
  // later "show-pairing-window" / "show-confirm" never arrived and UI appeared dead.
  fh.readabilityHandler = { handle in
    let chunk = handle.availableData
    if chunk.isEmpty {
      // EOF from parent (Node tray launcher exited)
      fh.readabilityHandler = nil
      return
    }
    buffer.append(chunk)

    while let newlineRange = buffer.range(of: Data([0x0A])) {
      let lineData = buffer.subdata(in: 0..<newlineRange.lowerBound)
      buffer = buffer.subdata(in: newlineRange.upperBound..<buffer.endIndex)

      guard let line = String(data: lineData, encoding: .utf8)?
              .trimmingCharacters(in: .whitespacesAndNewlines),
            !line.isEmpty,
            let jsonData = line.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
            let cmd = json["cmd"] as? String else {
        continue
      }

      DispatchQueue.main.async {
        handleCommand(cmd, json: json, delegate: delegate)
      }
    }
  }
}

func handleCommand(_ cmd: String, json: [String: Any], delegate: TrayDelegate) {
  switch cmd {
  case "update":
    if let statusStr = json["status"] as? String,
       let status = CompanionStatus(rawValue: statusStr) {
      currentStatus = status
    }
    if let ws = json["wsConnected"] as? Bool {
      wsConnected = ws
    }
    if let pid = json["pid"] as? Int {
      currentPid = pid
    }
    delegate.updateAppearance()

  case "update-autostart":
    if let enabled = json["enabled"] as? Bool {
      autoStartEnabled = enabled
      delegate.rebuildMenu()
    }

  case "update-quick-actions":
    if let actions = json["actions"] as? [[String: String]] {
      quickActions = actions.compactMap { raw in
        guard let id = raw["id"], let title = raw["title"] else { return nil }
        return QuickAction(id: id, title: title)
      }
      delegate.rebuildMenu()
    }

  case "update-recent-threads":
    if let threads = json["threads"] as? [[String: String]] {
      recentThreads = threads.compactMap { raw in
        guard let id = raw["id"], let title = raw["title"] else { return nil }
        return RecentThread(id: id, title: title)
      }
      delegate.rebuildMenu()
      summonerController.noteThreadsChanged()
    }

  case "show-pairing-window":
    // Launcher pushes the freshly-read WS secret here so it can be shown in a native
    // selectable window — users pair without ever touching the command line.
    let secret = (json["secret"] as? String) ?? ""
    let paired = (json["paired"] as? Bool) ?? false
    if !secret.isEmpty {
      pairingController.show(secret: secret, paired: paired)
    }

  case "show-confirm":
    // P0a Tray confirmation — companion pushes security.confirmation.request here as
    // a parallel channel alongside the WS Side Panel. Tray is a separate process;
    // clicking Allow here does NOT make Chrome frontmost, so target app stays
    // foreground for subsequent CGEvent injection. See capability-token-round1-synthesis
    // §"迁移重排" P0a + tcc_cdhash_vs_activate memory.
    let id = (json["id"] as? String) ?? ""
    let toolName = (json["tool_name"] as? String) ?? "unknown"
    let riskLevel = (json["risk_level"] as? String) ?? "medium"
    let summary = (json["summary"] as? String) ?? ""
    let criticalApis = (json["critical_apis"] as? [String]) ?? []
    let timeoutMs = (json["timeout_ms"] as? Int) ?? 45000
    if !id.isEmpty {
      confirmController.show(
        id: id, toolName: toolName, riskLevel: riskLevel,
        summary: summary, criticalApis: criticalApis, timeoutMs: timeoutMs
      )
    }

  case "cancel-confirm":
    // Companion resolved the confirmation via another channel (WS Side Panel approve,
    // timeout, disconnect). Close the dialog without sending a response back — the
    // origin already has its answer.
    let id = (json["id"] as? String) ?? ""
    if !id.isEmpty { confirmController.cancel(id: id) }

  // --- P3a Native HUD spike protocol (same binary as tray; lazy NSWindow) ---
  case "hud.open":
    let threadId = (json["thread_id"] as? String) ?? ""
    hudController.open(threadId: threadId)

  case "hud.hydrate":
    hudController.applyHydrate(json)

  case "hud.confirm.request":
    // Elevated confirm card on HUD — do NOT use ConfirmController tray popover.
    hudController.showConfirm(json)

  case "hud.confirm.cancel", "hud.confirm.resolved":
    let id = (json["id"] as? String) ?? ""
    hudController.clearConfirm(id: id)

  case "shell.standby":
    let message = (json["message"] as? String) ?? ""
    hudController.enterStandby(message: message)

  case "hud.ping":
    let nonce = (json["nonce"] as? String) ?? ""
    jsonLine(["type": "hud.pong", "nonce": nonce])

  case "hud.close":
    hudController.hide(reason: "cmd")

  // --- Summoner overlay (Task 9). Third lazy window. Zero Allow/Deny chrome. ---
  case "summoner.open":
    let threadId = (json["thread_id"] as? String) ?? ""
    summonerController.open(threadId: threadId)

  case "summoner.hydrate":
    summonerController.applyHydrate(json)

  case "summoner.token":
    let text = (json["text"] as? String) ?? ""
    summonerController.appendToken(text)

  case "summoner.done":
    summonerController.markDone()

  case "summoner.error":
    let message = (json["message"] as? String) ?? ""
    let code = json["error_code"] as? String
    summonerController.applyError(message: message, errorCode: code)

  case "summoner.close":
    summonerController.hide()

  case "summoner.hotkey.prompt":
    summonerController.showHotkeyPicker()

  case "summoner.hotkey.set":
    let combo = (json["combo"] as? String) ?? ""
    _ = registerSummonerHotKey(combo: combo)
    summonerController.noteHotkeyConfigured()

  case "summoner.dictate":
    let text = (json["text"] as? String) ?? ""
    summonerController.applyDictate(text)

  case "summoner.settings":
    summonerController.applySettings(json)

  case "summoner.tool":
    let name = (json["name"] as? String) ?? "工具"
    summonerController.appendTool(name)

  case "summoner.mcp":
    let names = (json["names"] as? [String]) ?? []
    summonerController.applyMcp(names)

  case "summoner.hits":
    summonerController.applyHits(json)

  case "quit":
    delegate.shutdown()
    jsonLine(["type": "exit", "code": 0])
    NSApplication.shared.terminate(nil)

  default:
    break
  }
}

// ---------------------------------------------------------------------------
// Pairing window — native window surfacing the WS shared secret so users can pair
// the Chrome extension without the command line. Shown on demand (menu item) and
// auto-pushed by the launcher on first run / while unpaired.
// ---------------------------------------------------------------------------

class PairingController: NSObject, NSWindowDelegate {
  // One reusable window for the process lifetime (isReleasedWhenClosed = false). For a
  // long-lived tray app this is cheaper than rebuilding the view tree on each show and
  // avoids flicker; re-show just refreshes the secret text + hint. No retain cycle:
  // the window's buttons target `self`, but the controller (not the window) owns the
  // strong reference chain, and both die together when the process exits.
  private var window: NSWindow?
  private var secretField: NSTextView?
  private var hintField: NSTextField?
  private var secret: String = ""

  func show(secret: String, paired: Bool) {
    if window == nil { window = makeWindow() }
    guard let window = window else { return }
    self.secret = secret
    secretField?.string = secret
    hintField?.stringValue = paired
      ? "（扩展曾配对过；如需在另一台设备上配对，可再次复制这串码。）"
      : "（尚未配对：复制下面这串码，粘贴进 Chrome 扩展即可完成配对。）"
    // Menu-bar apps run as .accessory; on macOS 14+ activate(ignoringOtherApps:)
    // is a no-op and a plain NSWindow often stays invisible behind the frontmost app.
    // Temporarily promote to .regular, float the window onto the active Space, then
    // restore .accessory when the window closes (windowWillClose).
    NSApp.setActivationPolicy(.regular)
    if #available(macOS 14.0, *) {
      NSApp.activate()
    } else {
      NSApp.activate(ignoringOtherApps: true)
    }
    window.level = .floating
    window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary, .transient]
    window.center()
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
    emitCompanionUiRect("pairing", window: window)
  }

  func windowWillClose(_ notification: Notification) {
    emitCompanionUiRect("pairing", window: nil)
    // Drop floating level and return to menu-bar agent policy so we don't steal
    // Dock space after the user dismisses the pairing window.
    if let window = notification.object as? NSWindow {
      window.level = .normal
    }
    NSApp.setActivationPolicy(.accessory)
  }

  private func makeWindow() -> NSWindow? {
    let contentRect = NSRect(x: 0, y: 0, width: 480, height: 320)
    let style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable]
    let win = NSWindow(contentRect: contentRect, styleMask: style, backing: .buffered, defer: false)
    win.title = "🔑 CMspark 配对码"
    win.isReleasedWhenClosed = false
    win.delegate = self
    win.minSize = NSSize(width: 420, height: 260)

    let stack = NSStackView()
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 12
    stack.edgeInsets = NSEdgeInsets(top: 18, left: 18, bottom: 18, right: 18)
    stack.translatesAutoresizingMaskIntoConstraints = false

    let label = NSTextField(wrappingLabelWithString:
      "把这串配对码粘贴到 Chrome 扩展 → 设置 → 连接 →「WS 配对密钥」，然后点「配对」。")
    label.font = .systemFont(ofSize: 13)
    label.isSelectable = false
    label.isEditable = false
    label.isBezeled = false
    label.drawsBackground = false
    label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    stack.addArrangedSubview(label)

    // Selectable, monospaced, scrollable secret display.
    let scrollView = NSScrollView()
    scrollView.hasVerticalScroller = true
    scrollView.borderType = .bezelBorder
    scrollView.heightAnchor.constraint(greaterThanOrEqualToConstant: 80).isActive = true
    let tv = NSTextView()
    tv.isEditable = false
    tv.isSelectable = true
    tv.isRichText = false
    tv.drawsBackground = true
    tv.backgroundColor = .textBackgroundColor
    tv.textColor = .textColor
    tv.font = NSFont(name: "Menlo", size: 13) ?? .monospacedSystemFont(ofSize: 13, weight: .regular)
    tv.autoresizingMask = [.width]
    tv.textContainer?.widthTracksTextView = true
    tv.textContainer?.lineBreakMode = .byCharWrapping
    scrollView.documentView = tv
    secretField = tv
    stack.addArrangedSubview(scrollView)

    let hint = NSTextField(labelWithString: "")
    hint.font = .systemFont(ofSize: 11)
    hint.textColor = .secondaryLabelColor
    hint.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    hintField = hint
    stack.addArrangedSubview(hint)

    let buttons = NSStackView()
    buttons.orientation = .horizontal
    buttons.spacing = 10
    let copyBtn = NSButton(title: "📋 复制到剪贴板", target: self, action: #selector(copySecret))
    let chromeBtn = NSButton(title: "🧩 复制并打开 Chrome", target: self, action: #selector(copyAndOpenChrome))
    let closeBtn = NSButton(title: "关闭", target: self, action: #selector(closeWindow))
    closeBtn.keyEquivalent = "\u{1b}" // Esc
    buttons.addArrangedSubview(copyBtn)
    buttons.addArrangedSubview(chromeBtn)
    buttons.addArrangedSubview(closeBtn)
    stack.addArrangedSubview(buttons)

    win.contentView = stack
    if let cv = win.contentView {
      NSLayoutConstraint.activate([
        stack.topAnchor.constraint(equalTo: cv.topAnchor),
        stack.bottomAnchor.constraint(equalTo: cv.bottomAnchor),
        stack.leadingAnchor.constraint(equalTo: cv.leadingAnchor),
        stack.trailingAnchor.constraint(equalTo: cv.trailingAnchor),
      ])
    }
    return win
  }

  @objc func copySecret() {
    let pb = NSPasteboard.general
    pb.clearContents()
    pb.setString(secret, forType: .string)
  }

  @objc func copyAndOpenChrome() {
    copySecret()
    // Reuse the existing "open Chrome side panel" click path (handled by the launcher).
    jsonLine(["type": "click", "action": "chrome"])
  }

  @objc func closeWindow() {
    window?.close()
  }
}

// Lazily initialized on first show (always on the main thread, from handleCommand).
let pairingController = PairingController()

// ---------------------------------------------------------------------------
// Confirm dialog — P0a Tray native confirmation. Separate channel from the WS
// Side Panel: companion dispatches the same security.confirmation.request to
// both; whichever resolves first wins (SecurityConfirmationManager's pending
// map is keyed by confirmationId, first responder claims it). Tray clicks do
// NOT bring Chrome to front, so target app stays foreground for CGEvent inject.
// ---------------------------------------------------------------------------

class ConfirmController: NSObject {
  // One reusable window. Pending state tracked by id so a late cancel from
  // companion (user approved via Side Panel) can close the dialog without
  // emitting a stale response.
  private var window: NSWindow?
  private var pendingId: String?
  private var summaryField: NSTextField?
  private var countdownField: NSTextField?
  private var timeoutTimer: Timer?
  private var timeoutAt: Date = Date()
  private var tickTimer: Timer?

  func show(id: String, toolName: String, riskLevel: String, summary: String,
            criticalApis: [String], timeoutMs: Int) {
    // C-P0-5 (2026-07-24 diagnosis): cleanup BEFORE building new state.
    // Previously, pendingId was reassigned at the top and timers were invalidated
    // only AFTER window setup. If makeWindow() returned nil → guard early-return,
    // we'd be left with pendingId = NEW id but OLD timers still scheduled —
    // their closures capture `self` weakly and call timeoutExpired() which reads
    // pendingId at fire time (the new id) → premature deny of the new request.
    // Order now: auto-deny prior (preserve existing emitResponse semantics),
    // teardown ALL state, then build fresh.
    if let prev = pendingId {
      emitResponse(id: prev, approved: false)
    }
    cleanup()

    pendingId = id

    if window == nil { window = makeWindow() }
    guard let window = window else {
      // makeWindow failed — pendingId is set but no UI/timers. Emit deny so
      // caller isn't blocked on a confirmation that will never render; reset.
      emitResponse(id: id, approved: false)
      cleanup()
      return
    }

    // Risk-level badge copy (severity conveyed via emoji + Chinese label; system
    // colors are not directly applicable to NSWindow title without private API).
    let badgeText: String
    switch riskLevel {
    case "critical", "high":
      badgeText = criticalApis.contains("computer.coordinate_injection")
        ? "⛔ 高风险 · 不可逆操作"
        : "⚠️ 高风险"
    case "medium":
      badgeText = "⚠️ 中风险"
    default:
      badgeText = "ℹ️ 低风险"
    }

    // Window title shows tool + risk badge so user sees what's asking without scrolling.
    window.title = "🔐 CMspark · \(toolName) · \(badgeText)"

    // Title bar color tint is not directly settable without private API; use the
    // accessory label's color to convey risk severity.
    // Strip ASCII control chars (0x00-0x1F) and DEL (0x7F) at the Swift boundary
    // — companion truncates to 800 chars but does NOT sanitize. Defense in depth
    // against prompt injection via tool summary (e.g. embedded newlines used to
    // mislead visual layout of the dialog).
    var safeSummary = summary.isEmpty
      ? "（companion 未提供动作摘要 — 谨慎允许。）"
      : summary
    safeSummary = safeSummary.unicodeScalars.filter {
      $0.value != 0x7F && !($0.value >= 0 && $0.value < 0x20)
    }.map { String($0) }.joined()
    summaryField?.stringValue = String(safeSummary.prefix(2000))

    // Countdown setup.
    timeoutAt = Date().addingTimeInterval(Double(timeoutMs) / 1000.0)
    updateCountdown()
    // cleanup() above already invalidated prior timers — just schedule fresh.
    tickTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
      self?.updateCountdown()
    }
    timeoutTimer = Timer.scheduledTimer(withTimeInterval: Double(timeoutMs) / 1000.0,
                                        repeats: false) { [weak self] _ in
      self?.timeoutExpired()
    }

    // CRITICAL: do NOT call NSApp.activate here. The whole point of P0a Tray is
    // that this dialog appears WITHOUT stealing foreground from the target app
    // (e.g. TextEdit) the agent is about to click on. The window is an
    // NSPanel(.nonactivatingPanel) so it can become key for button clicks
    // without promoting our .accessory app to active. The user clicks Allow /
    // Deny via mouse — clicks on a nonactivating panel reach the button target
    // without activating the owning app. Target stays frontmost → CGEvent inject
    // after approval lands on the right window.
    window.center()
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
    emitCompanionUiRect("tray", window: window)
  }

  /// Companion resolved the confirmation elsewhere (Side Panel / disconnect).
  /// Close the dialog silently — do NOT emit a response (origin already has it).
  func cancel(id: String) {
    guard id == pendingId else { return }
    cleanup()
    window?.close()
    emitCompanionUiRect("tray", window: nil)
  }

  private func updateCountdown() {
    let remainingMs = max(0, Int(timeoutAt.timeIntervalSinceNow * 1000))
    let displaySecs = max(1, remainingMs / 1000)
    countdownField?.stringValue = "⏱ \(displaySecs)s 后自动拒绝"
  }

  private func timeoutExpired() {
    if let id = pendingId {
      emitResponse(id: id, approved: false)
    }
    cleanup()
    window?.close()
  }

  private func cleanup() {
    timeoutTimer?.invalidate()
    tickTimer?.invalidate()
    timeoutTimer = nil
    tickTimer = nil
    pendingId = nil
  }

  private func emitResponse(id: String, approved: Bool) {
    jsonLine(["type": "confirm-response", "id": id, "approved": approved])
  }

  @objc func allowClicked() {
    guard let id = pendingId else { return }
    emitResponse(id: id, approved: true)
    cleanup()
    window?.close()
  }

  @objc func denyClicked() {
    guard let id = pendingId else { return }
    emitResponse(id: id, approved: false)
    cleanup()
    window?.close()
  }

  /// Window will-close hook — user hit Esc or close button. Treat as deny.
  /// guard pendingId so we don't double-emit (Allow/Deny already cleaned up).
  @objc func windowWillClose(_ notification: Notification) {
    if let id = pendingId {
      emitResponse(id: id, approved: false)
      cleanup()
    }
  }

  private func makeWindow() -> NSWindow? {
    let contentRect = NSRect(x: 0, y: 0, width: 520, height: 240)
    // .nonactivatingPanel: panel can become key (so it receives button clicks /
    // Esc/Return key equivalents) WITHOUT activating the tray app, which would
    // steal frontmost from the target app the agent is about to act on. This
    // is the entire reason P0a Tray exists (vs. just using the WS Side Panel).
    let style: NSWindow.StyleMask = [.titled, .closable, .nonactivatingPanel]
    // NSPanel is the subclass that honors nonactivatingPanel.
    let panel = NSPanel(contentRect: contentRect, styleMask: style, backing: .buffered, defer: false)
    panel.isReleasedWhenClosed = false
    // becomesKeyOnlyIfNeeded = false means the panel becomes key immediately on
    // makeKeyAndOrderFront (so Esc/Return key equivalents work). It does NOT
    // control whether the owner activates — that is what .nonactivatingPanel
    // does. Target app stays frontmost either way.
    panel.becomesKeyOnlyIfNeeded = false
    panel.hidesOnDeactivate = false  // survive app deactivation (we ARE non-activating)
    // .floating keeps the confirm above normal document windows of other apps
    // even after orderFrontRegardless (e.g., target app windows raising later).
    panel.level = .floating
    panel.minSize = NSSize(width: 480, height: 200)
    panel.delegate = self  // windowWillClose for Esc / close-button = deny

    let stack = NSStackView()
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 10
    stack.edgeInsets = NSEdgeInsets(top: 16, left: 20, bottom: 16, right: 20)
    stack.translatesAutoresizingMaskIntoConstraints = false

    // Summary (wraps; user content so sanitize: strip control chars, cap length).
    let summary = NSTextField(wrappingLabelWithString: "")
    summary.font = .systemFont(ofSize: 13)
    summary.isSelectable = true
    summary.isEditable = false
    summary.isBezeled = false
    summary.drawsBackground = false
    summary.maximumNumberOfLines = 6
    summary.cell?.truncatesLastVisibleLine = true
    summary.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    summaryField = summary
    stack.addArrangedSubview(summary)

    // Countdown row.
    let countdown = NSTextField(labelWithString: "")
    countdown.font = .systemFont(ofSize: 11)
    countdown.textColor = .secondaryLabelColor
    countdownField = countdown
    stack.addArrangedSubview(countdown)

    // Buttons row (Allow on right, Deny on left per macOS HIG).
    let buttons = NSStackView()
    buttons.orientation = .horizontal
    buttons.spacing = 10
    let denyBtn = NSButton(title: "拒绝", target: self, action: #selector(denyClicked))
    denyBtn.keyEquivalent = "\u{1b}"  // Esc
    denyBtn.controlSize = .large
    let allowBtn = NSButton(title: "允许", target: self, action: #selector(allowClicked))
    allowBtn.keyEquivalent = "\r"  // Return
    allowBtn.controlSize = .large
    allowBtn.bezelStyle = .push
    buttons.addArrangedSubview(NSView())  // spacer
    buttons.addArrangedSubview(denyBtn)
    buttons.addArrangedSubview(allowBtn)
    buttons.distribution = .fill
    buttons.heightAnchor.constraint(greaterThanOrEqualToConstant: 32).isActive = true
    stack.addArrangedSubview(buttons)

    panel.contentView = stack
    if let cv = panel.contentView {
      NSLayoutConstraint.activate([
        stack.topAnchor.constraint(equalTo: cv.topAnchor),
        stack.bottomAnchor.constraint(equalTo: cv.bottomAnchor),
        stack.leadingAnchor.constraint(equalTo: cv.leadingAnchor),
        stack.trailingAnchor.constraint(equalTo: cv.trailingAnchor),
      ])
    }
    return panel
  }
}

extension ConfirmController: NSWindowDelegate {
  // Required to make windowWillClose(@objc) visible as NSWindowDelegate method.
}

// Lazily initialized on first show (main thread, from handleCommand).
let confirmController = ConfirmController()

// ---------------------------------------------------------------------------
// HudController — P3a spike native wide L2 surface (same process as tray).
// Lazy NSWindow; close ≠ quit (N4). Heartbeat only while window visible (N3).
// ---------------------------------------------------------------------------

class HudController: NSObject {
  private var window: NSWindow?
  private var threadId: String = ""
  private var standbyMessage: String = ""
  private var isStandby: Bool = false
  private var pendingConfirmId: String?
  private var taskRunning: Bool = false

  private var titleField: NSTextField?
  private var statusField: NSTextField?
  private var confirmCard: NSStackView?
  private var confirmToolField: NSTextField?
  private var confirmSummaryField: NSTextField?
  private var taskField: NSTextField?
  private var abortButton: NSButton?
  private var confirmAllowButton: NSButton?
  private var confirmDenyButton: NSButton?

  private var heartbeatTimer: Timer?

  func open(threadId: String) {
    self.threadId = threadId
    self.isStandby = false
    self.standbyMessage = ""
    if window == nil { window = makeWindow() }
    guard let window = window else { return }
    titleField?.stringValue = "CMspark 确认台 (spike) · \(threadId.isEmpty ? "—" : threadId)"
    refreshStatusLine()
    // HUD may activate for focus (unlike tray ConfirmController which must not steal FG).
    NSApp.activate(ignoringOtherApps: true)
    window.center()
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
    startHeartbeat()
    jsonLine(["type": "hud.ready"])
    emitCompanionUiRect("hud", window: window)
  }

  func applyHydrate(_ json: [String: Any]) {
    if let tid = json["thread_id"] as? String, !tid.isEmpty {
      threadId = tid
    }
    let shell = (json["shell"] as? String) ?? "hud"
    let connection = (json["connection"] as? String) ?? "unknown"
    if shell == "standby" {
      isStandby = true
    } else {
      isStandby = false
      standbyMessage = ""
    }

    // dual_track empty arrays must be a no-op (do not crash)
    if let dual = json["dual_track"] as? [String: Any] {
      _ = dual["conclusions"] as? [Any]
      _ = dual["steps"] as? [Any]
    }

    if let task = json["task"] as? [String: Any] {
      let goal = (task["goal"] as? String) ?? ""
      let status = (task["status"] as? String) ?? "idle"
      taskRunning = (status == "running")
      taskField?.stringValue = goal.isEmpty
        ? "任务: \(status)"
        : "任务: \(status) — \(goal)"
    } else {
      taskRunning = false
      taskField?.stringValue = "无任务"
    }

    if let pending = json["pending_confirmations"] as? [[String: Any]], let first = pending.first {
      showConfirm(first)
    }

    titleField?.stringValue =
      "CMspark 确认台 (spike) · \(connection) · \(threadId.isEmpty ? "—" : threadId)"
    refreshStatusLine()
    abortButton?.isEnabled = taskRunning
    applyConfirmVisibility()
  }

  func showConfirm(_ json: [String: Any]) {
    let id = (json["id"] as? String) ?? (json["confirmation_id"] as? String) ?? ""
    guard !id.isEmpty else { return }
    pendingConfirmId = id
    isStandby = false
    let tool = (json["tool_name"] as? String) ?? "unknown"
    let risk = (json["risk_level"] as? String) ?? ""
    var summary = (json["summary"] as? String) ?? ""
    summary = summary.unicodeScalars.filter {
      $0.value != 0x7F && !($0.value >= 0 && $0.value < 0x20)
    }.map { String($0) }.joined()
    confirmToolField?.stringValue = risk.isEmpty ? tool : "\(tool) · \(risk)"
    confirmSummaryField?.stringValue = String(summary.prefix(2000))
    applyConfirmVisibility()
    if window?.isVisible != true {
      open(threadId: threadId)
    }
  }

  func clearConfirm(id: String) {
    if !id.isEmpty && pendingConfirmId != nil && pendingConfirmId != id { return }
    pendingConfirmId = nil
    confirmToolField?.stringValue = ""
    confirmSummaryField?.stringValue = ""
    applyConfirmVisibility()
  }

  func enterStandby(message: String) {
    isStandby = true
    standbyMessage = message
    // N2: hide elevated confirm UI; keep status line
    pendingConfirmId = nil
    applyConfirmVisibility()
    refreshStatusLine()
  }

  func hide(reason: String) {
    stopHeartbeat()
    window?.orderOut(nil)
    jsonLine(["type": "hud.closed", "reason": reason])
    emitCompanionUiRect("hud", window: nil)
    // N4: do not terminate NSApplication
  }

  private func refreshStatusLine() {
    if isStandby {
      statusField?.stringValue = standbyMessage.isEmpty
        ? "任务进行中 — 宽确认台待机"
        : standbyMessage
    } else {
      statusField?.stringValue = "thread: \(threadId.isEmpty ? "—" : threadId) · active shell: hud"
    }
  }

  private func applyConfirmVisibility() {
    let show = pendingConfirmId != nil && !isStandby
    confirmCard?.isHidden = !show
    confirmAllowButton?.isEnabled = show
    confirmDenyButton?.isEnabled = show
  }

  private func startHeartbeat() {
    stopHeartbeat()
    // N3/C-N5: only while HUD window is visible
    heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
      guard let self = self, let win = self.window, win.isVisible else { return }
      let ts = Int(Date().timeIntervalSince1970 * 1000)
      jsonLine(["type": "hud.heartbeat", "ts": ts])
    }
  }

  private func stopHeartbeat() {
    heartbeatTimer?.invalidate()
    heartbeatTimer = nil
  }

  @objc func allowClicked() {
    guard let id = pendingConfirmId else { return }
    jsonLine(["type": "hud.confirm.response", "id": id, "approved": true])
    pendingConfirmId = nil
    applyConfirmVisibility()
  }

  @objc func denyClicked() {
    guard let id = pendingConfirmId else { return }
    jsonLine(["type": "hud.confirm.response", "id": id, "approved": false])
    pendingConfirmId = nil
    applyConfirmVisibility()
  }

  @objc func abortClicked() {
    var payload: [String: Any] = ["type": "hud.abort"]
    if !threadId.isEmpty { payload["thread_id"] = threadId }
    payload["task_id"] = "spike"
    jsonLine(payload)
  }

  @objc func collapseClicked() {
    hide(reason: "user")
  }

  @objc func windowWillClose(_ notification: Notification) {
    // User red-dot / Cmd+W — close ≠ stop (N4)
    stopHeartbeat()
    jsonLine(["type": "hud.closed", "reason": "user"])
  }

  private func makeWindow() -> NSWindow? {
    let contentRect = NSRect(x: 0, y: 0, width: 560, height: 360)
    let style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable]
    let win = NSWindow(contentRect: contentRect, styleMask: style, backing: .buffered, defer: false)
    win.title = "CMspark 确认台 (spike)"
    win.isReleasedWhenClosed = false
    win.minSize = NSSize(width: 480, height: 280)
    win.delegate = self

    let stack = NSStackView()
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 10
    stack.edgeInsets = NSEdgeInsets(top: 16, left: 18, bottom: 16, right: 18)
    stack.translatesAutoresizingMaskIntoConstraints = false

    let title = NSTextField(labelWithString: "CMspark 确认台 (spike)")
    title.font = .boldSystemFont(ofSize: 14)
    titleField = title
    stack.addArrangedSubview(title)

    let status = NSTextField(wrappingLabelWithString: "")
    status.font = .systemFont(ofSize: 12)
    status.textColor = .secondaryLabelColor
    statusField = status
    stack.addArrangedSubview(status)

    // Confirm card
    let card = NSStackView()
    card.orientation = .vertical
    card.alignment = .leading
    card.spacing = 8
    card.edgeInsets = NSEdgeInsets(top: 10, left: 10, bottom: 10, right: 10)
    card.wantsLayer = true
    card.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
    card.layer?.cornerRadius = 6

    let tool = NSTextField(labelWithString: "")
    tool.font = .systemFont(ofSize: 13, weight: .medium)
    confirmToolField = tool
    card.addArrangedSubview(tool)

    let summary = NSTextField(wrappingLabelWithString: "")
    summary.font = .systemFont(ofSize: 12)
    summary.maximumNumberOfLines = 8
    confirmSummaryField = summary
    card.addArrangedSubview(summary)

    let confButtons = NSStackView()
    confButtons.orientation = .horizontal
    confButtons.spacing = 10
    let deny = NSButton(title: "拒绝", target: self, action: #selector(denyClicked))
    let allow = NSButton(title: "允许", target: self, action: #selector(allowClicked))
    allow.keyEquivalent = "\r"
    deny.keyEquivalent = "\u{1b}"
    confButtons.addArrangedSubview(NSView())
    confButtons.addArrangedSubview(deny)
    confButtons.addArrangedSubview(allow)
    confirmAllowButton = allow
    confirmDenyButton = deny
    card.addArrangedSubview(confButtons)

    confirmCard = card
    card.isHidden = true
    stack.addArrangedSubview(card)

    let task = NSTextField(labelWithString: "无任务")
    task.font = .systemFont(ofSize: 12)
    taskField = task
    stack.addArrangedSubview(task)

    let actions = NSStackView()
    actions.orientation = .horizontal
    actions.spacing = 10
    let abort = NSButton(title: "急停", target: self, action: #selector(abortClicked))
    abort.isEnabled = false
    abortButton = abort
    let collapse = NSButton(title: "收起", target: self, action: #selector(collapseClicked))
    actions.addArrangedSubview(abort)
    actions.addArrangedSubview(collapse)
    actions.addArrangedSubview(NSView())
    stack.addArrangedSubview(actions)

    win.contentView = stack
    if let cv = win.contentView {
      NSLayoutConstraint.activate([
        stack.topAnchor.constraint(equalTo: cv.topAnchor),
        stack.bottomAnchor.constraint(equalTo: cv.bottomAnchor),
        stack.leadingAnchor.constraint(equalTo: cv.leadingAnchor),
        stack.trailingAnchor.constraint(equalTo: cv.trailingAnchor),
      ])
    }
    return win
  }
}

extension HudController: NSWindowDelegate {
  // windowWillClose is @objc on HudController
}

// Lazy singleton (main thread, from handleCommand).
let hudController = HudController()

// ---------------------------------------------------------------------------
// Summoner hotkey (S11) — opt-in RegisterEventHotKey, no stolen defaults.
// Candidates never include Cmd+Space, ⌥Space / Alt+Space, ⌃⇧Space.
// ---------------------------------------------------------------------------

struct SummonerHotKeyCandidate {
  let combo: String
  let label: String
  let keyCode: UInt32
  let mods: UInt32
}

let summonerHotKeyCandidates: [SummonerHotKeyCandidate] = [
  SummonerHotKeyCandidate(combo: "ctrl+alt+space", label: "⌃⌥Space", keyCode: 0x31, mods: UInt32(controlKey | optionKey)),
  SummonerHotKeyCandidate(combo: "ctrl+alt+cmd+space", label: "⌃⌥⌘Space", keyCode: 0x31, mods: UInt32(controlKey | optionKey | cmdKey)),
  SummonerHotKeyCandidate(combo: "ctrl+alt+c", label: "⌃⌥C", keyCode: 0x08, mods: UInt32(controlKey | optionKey)),
  SummonerHotKeyCandidate(combo: "ctrl+alt+k", label: "⌃⌥K", keyCode: 0x28, mods: UInt32(controlKey | optionKey)),
  SummonerHotKeyCandidate(combo: "ctrl+alt+s", label: "⌃⌥S", keyCode: 0x01, mods: UInt32(controlKey | optionKey)),
  SummonerHotKeyCandidate(combo: "ctrl+alt+cmd+period", label: "⌃⌥⌘.", keyCode: 0x2F, mods: UInt32(controlKey | optionKey | cmdKey)),
]

struct SummonerHotKeyStolen {
  let combo: String
  let label: String
  let occupiedBy: String
}

let summonerHotKeyStolen: [SummonerHotKeyStolen] = [
  SummonerHotKeyStolen(combo: "cmd+space", label: "⌘Space / Cmd+Space", occupiedBy: "Spotlight"),
  SummonerHotKeyStolen(combo: "alt+space", label: "⌥Space / Alt+Space", occupiedBy: "Raycast / uTools"),
  SummonerHotKeyStolen(combo: "ctrl+shift+space", label: "⌃⇧Space", occupiedBy: "输入法"),
]

let summonerHotKeyStolenCopy =
  "已占用（不可选）：⌘Space Spotlight · ⌥Space / Alt+Space Raycast/uTools · ⌃⇧Space 输入法"

let kSummonerHotKeySignature: OSType = 0x434D5355 // 'CMSU'
let kSummonerHotKeyId: UInt32 = 1
var summonerHotKeyRef: EventHotKeyRef?
var summonerHotKeyHandlerRef: EventHandlerRef?

func summonerCarbonHotKeyHandler(
  _ nextHandler: EventHandlerCallRef?,
  _ event: EventRef?,
  _ userData: UnsafeMutableRawPointer?
) -> OSStatus {
  DispatchQueue.main.async {
    handleSummonerHotKeyPressed()
  }
  return noErr
}

func installSummonerHotKeyMonitor() {
  var spec = EventTypeSpec(
    eventClass: OSType(kEventClassKeyboard),
    eventKind: UInt32(kEventHotKeyPressed)
  )
  InstallEventHandler(
    GetApplicationEventTarget(),
    summonerCarbonHotKeyHandler,
    1,
    &spec,
    nil,
    &summonerHotKeyHandlerRef
  )
}

func unregisterSummonerHotKey() {
  if let ref = summonerHotKeyRef {
    UnregisterEventHotKey(ref)
    summonerHotKeyRef = nil
  }
}

/// Best-effort Carbon registration. False = combo persisted but not armed.
@discardableResult
func registerSummonerHotKey(combo: String) -> Bool {
  unregisterSummonerHotKey()
  guard let cand = summonerHotKeyCandidates.first(where: { $0.combo == combo }) else {
    return false
  }
  let hotKeyID = EventHotKeyID(signature: kSummonerHotKeySignature, id: kSummonerHotKeyId)
  let status = RegisterEventHotKey(
    cand.keyCode,
    cand.mods,
    hotKeyID,
    GetApplicationEventTarget(),
    0,
    &summonerHotKeyRef
  )
  return status == noErr
}

func handleSummonerHotKeyPressed() {
  // IME composing in the overlay: ignore hotkey (and Return-to-send lives in NSTextViewDelegate).
  if summonerController.composingNow {
    jsonLine(["type": "summoner.composing", "on": true])
    return
  }
  summonerController.openFromHotKey()
}

// ---------------------------------------------------------------------------
// SummonerController — P0 capture overlay (same process as tray; third window).
// Lazy NSPanel (.nonactivatingPanel + .floating). Close ≠ chat.abort.
// Look: two-phase capture + 看山 white tokens. Transcript is plaintext 你: / 助手: lines, not bubbles.
// Overlay is capture-only — not an L2 gate surface.
// ---------------------------------------------------------------------------

enum SummonerTokens {
  static let paper = NSColor.white
  static let muted = NSColor(calibratedRed: 244/255, green: 244/255, blue: 245/255, alpha: 1)
  static let text = NSColor(calibratedRed: 23/255, green: 23/255, blue: 23/255, alpha: 1)
  static let secondary = NSColor(calibratedRed: 115/255, green: 115/255, blue: 115/255, alpha: 1)
  static let faint = NSColor(calibratedRed: 163/255, green: 163/255, blue: 163/255, alpha: 1)
  static let indigo = NSColor(calibratedRed: 79/255, green: 70/255, blue: 229/255, alpha: 1)
  static let indigoSoft = NSColor(calibratedRed: 238/255, green: 242/255, blue: 255/255, alpha: 1)
  static let okBg = NSColor(calibratedRed: 236/255, green: 253/255, blue: 245/255, alpha: 1)
  static let okFg = NSColor(calibratedRed: 4/255, green: 120/255, blue: 87/255, alpha: 1)
  static let okBorder = NSColor(calibratedRed: 167/255, green: 243/255, blue: 208/255, alpha: 1)
  static let warnBg = NSColor(calibratedRed: 255/255, green: 251/255, blue: 235/255, alpha: 1)
  static let warnFg = NSColor(calibratedRed: 146/255, green: 64/255, blue: 14/255, alpha: 1)
  static let warnBorder = NSColor(calibratedRed: 253/255, green: 230/255, blue: 138/255, alpha: 1)
}

private let summonerWindowTitle = "CMspark 召唤器（实验）"
private let summonerTalkPlaceholder = "说点什么，按回车发送…"
private let summonerTalkHint = "回车发送到当前线程，输入 # 搜标题"
private let summonerCtaCopy = "我们不能替你打开侧栏。可激活 Google Chrome，然后点工具栏 CMspark（没有就拼图 🧩 钉上）。"
private let summonerDetachedInfo = "浏览器未连接 · 网页操作请点工具栏图标（不能替你打开侧栏）"

private func wavFromPcmS16le(_ pcm: Data, sampleRate: Int, channels: Int) -> Data {
  var d = Data()
  func ascii(_ s: String) { d.append(contentsOf: s.utf8) }
  func u16(_ v: UInt16) {
    var x = v.littleEndian
    withUnsafeBytes(of: &x) { d.append(contentsOf: $0) }
  }
  func u32(_ v: UInt32) {
    var x = v.littleEndian
    withUnsafeBytes(of: &x) { d.append(contentsOf: $0) }
  }
  ascii("RIFF")
  u32(UInt32(36 + pcm.count))
  ascii("WAVE")
  ascii("fmt ")
  u32(16)
  u16(1)
  u16(UInt16(channels))
  u32(UInt32(sampleRate))
  u32(UInt32(sampleRate * channels * 2))
  u16(UInt16(channels * 2))
  u16(16)
  ascii("data")
  u32(UInt32(pcm.count))
  d.append(pcm)
  return d
}

final class SummonerMicCapture {
  private let engine = AVAudioEngine()
  private var chunks: [Data] = []
  private var running = false

  var isRunning: Bool { running }

  func start(onDenied: @escaping () -> Void) {
    if running { return }
    chunks = []
    let proceed = { [weak self] in
      guard let self else { return }
      do {
        try self.startEngine()
      } catch {
        onDenied()
      }
    }
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
      proceed()
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .audio) { ok in
        DispatchQueue.main.async {
          if ok { proceed() } else { onDenied() }
        }
      }
    default:
      onDenied()
    }
  }

  func stop() -> Data {
    guard running else { return Data() }
    running = false
    engine.inputNode.removeTap(onBus: 0)
    if engine.isRunning { engine.stop() }
    let pcm = chunks.reduce(Data(), +)
    chunks = []
    return wavFromPcmS16le(pcm, sampleRate: 16000, channels: 1)
  }

  private func startEngine() throws {
    let input = engine.inputNode
    let hw = input.outputFormat(forBus: 0)
    guard let dst = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: 16000,
      channels: 1,
      interleaved: true
    ) else {
      throw NSError(domain: "summoner.mic", code: 1)
    }
    input.removeTap(onBus: 0)
    let ratio = dst.sampleRate / hw.sampleRate
    input.installTap(onBus: 0, bufferSize: 1024, format: hw) { [weak self] buffer, _ in
      guard let converter = AVAudioConverter(from: hw, to: dst) else { return }
      let outFrames = AVAudioFrameCount(max(Double(buffer.frameLength) * ratio, 1))
      guard let out = AVAudioPCMBuffer(pcmFormat: dst, frameCapacity: outFrames) else { return }
      var err: NSError?
      var got = false
      converter.convert(to: out, error: &err) { _, status in
        if got {
          status.pointee = .noDataNow
          return nil
        }
        got = true
        status.pointee = .haveData
        return buffer
      }
      guard err == nil, let ch = out.int16ChannelData else { return }
      let n = Int(out.frameLength) * MemoryLayout<Int16>.size
      self?.chunks.append(Data(bytes: ch[0], count: n))
    }
    engine.prepare()
    try engine.start()
    running = true
  }
}

class SummonerController: NSObject, NSWindowDelegate, NSTextViewDelegate {
  private var window: NSPanel?
  private var isOpen = false
  private var threadId: String = ""
  private var browserAttached = false
  private var browserKnown = false
  private var sawBrowserUnavailable = false
  private var lines: [String] = []
  private var streamingAssistant = false
  private var lastComposing = false
  private var hits: [RecentThread] = []
  private var selectedHit = 0
  private var searchTimer: Timer?
  private var streamRenderTimer: Timer?
  private var hotkeyConfigured = false

  private var badgeField: NSTextField?
  private var hintField: NSTextField?
  private var placeholderField: NSTextField?
  private var fieldBox: NSView?
  private var composer: NSTextView?
  private var hitsStack: NSStackView?
  private var logBox: NSView?
  private var logView: NSTextView?
  private var logScroll: NSScrollView?
  private var logHeightConstraint: NSLayoutConstraint?
  private var ctaBox: NSView?
  private var ctaLabel: NSTextField?
  private var attachButton: NSButton?
  private var footRow: NSStackView?
  private var sendButton: NSButton?
  private var continueButton: NSButton?
  private var sideNote: NSTextField?
  private var pickerBox: NSView?
  private var lastThreadField: NSTextField?
  private var mcpField: NSTextField?
  private var micButton: NSButton?
  private var settingsBox: NSView?
  private var settingsIdleButtons: [NSButton] = []
  private var settingsChromeButtons: [NSButton] = []
  private var silentAttachButton: NSButton?
  private var resumeIdleMinutes = 10
  private var chromeForeground = false
  private let micCapture = SummonerMicCapture()
  private var micDown = false
  private var micStartedAt: TimeInterval = 0

  var overlayVisible: Bool { isOpen && window?.isVisible == true }
  var composingNow: Bool { composer?.hasMarkedText() == true }

  func open(threadId: String) {
    self.threadId = threadId
    if threadId.isEmpty {
      lines = []
      streamingAssistant = false
      sawBrowserUnavailable = false
    }
    if window == nil { window = makeWindow() }
    guard let window = window else { return }
    isOpen = true
    applyPhase()
    NSApp.activate(ignoringOtherApps: true)
    window.center()
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
    window.makeFirstResponder(composer)
    jsonLine(["type": "summoner.ready"])
    emitCompanionUiRect("overlay", window: window)
  }

  func hide() {
    searchTimer?.invalidate()
    searchTimer = nil
    window?.orderOut(nil)
    emitCompanionUiRect("overlay", window: nil)
    emitClosedIfOpen()
  }

  func applyHydrate(_ json: [String: Any]) {
    guard isOpen else { return }
    if let tid = json["thread_id"] as? String {
      threadId = tid
    }
    if let rawLines = json["lines"] as? [String] {
      lines = Array(rawLines.suffix(20))
    }
    let browser = (json["browser"] as? String) ?? "detached"
    browserAttached = (browser == "attached")
    browserKnown = true
    streamingAssistant = false
    applyPhase()
    if window?.isVisible == true {
      window?.makeFirstResponder(composer)
    }
  }

  func appendToken(_ text: String) {
    if text.isEmpty { return }
    // chat.token.content is a full snapshot, not a delta.
    let rendered = "助手: " + text
    let first = !(streamingAssistant && (lines.last?.hasPrefix("助手:") == true))
    if !first {
      lines[lines.count - 1] = rendered
    } else {
      lines.append(rendered)
      streamingAssistant = true
    }
    capLines()
    if first {
      refreshLog()
    } else {
      scheduleStreamRender()
    }
  }

  func markDone() {
    streamRenderTimer?.invalidate()
    streamRenderTimer = nil
    streamingAssistant = false
    refreshLog()
  }

  private func scheduleStreamRender() {
    if streamRenderTimer != nil { return }
    streamRenderTimer = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: false) { [weak self] _ in
      self?.streamRenderTimer = nil
      self?.refreshLog()
    }
  }

  func appendTool(_ name: String) {
    let label = name.isEmpty ? "工具" : name
    streamRenderTimer?.invalidate()
    streamRenderTimer = nil
    streamingAssistant = false
    lines.append("[工具] \(label)")
    capLines()
    refreshLog()
  }

  func applyMcp(_ names: [String]) {
    if names.isEmpty {
      mcpField?.stringValue = "MCP 未连接 · 去侧栏配置后这里可直接调用"
    } else {
      mcpField?.stringValue = "MCP · " + names.joined(separator: "、")
    }
    mcpField?.isHidden = true
    relayout()
  }

  func applyError(message: String, errorCode: String?) {
    streamRenderTimer?.invalidate()
    streamRenderTimer = nil
    streamingAssistant = false
    let code = errorCode ?? ""
    if code == "BROWSER_UNAVAILABLE" {
      sawBrowserUnavailable = true
      browserAttached = false
      browserKnown = true
      lines.append("系统: BROWSER_UNAVAILABLE")
    } else {
      let shown = message.isEmpty ? (code.isEmpty ? "出错了" : code) : message
      lines.append("系统: \(shown)")
    }
    capLines()
    applyPhase()
  }

  func noteThreadsChanged() {
    if isOpen {
      updateLastThreadLabel()
      if isSearchQuery(composerText) {
        refreshHits()
      }
    }
  }

  func showHotkeyPicker() {
    if window == nil { window = makeWindow() }
    pickerBox?.isHidden = false
    relayout()
  }

  func toggleHotkeyPicker() {
    if window == nil { window = makeWindow() }
    let hidden = pickerBox?.isHidden ?? true
    pickerBox?.isHidden = !hidden
    relayout()
  }

  func noteHotkeyConfigured() {
    hotkeyConfigured = true
    pickerBox?.isHidden = true
    relayout()
  }

  func openFromHotKey() {
    if overlayVisible {
      hide()
      return
    }
    open(threadId: threadId)
  }

  @objc func hotkeyCandidateClicked(_ sender: NSButton) {
    let combo = sender.identifier?.rawValue ?? ""
    chooseHotkey(combo)
  }

  @objc func hotkeyEntryClicked(_ sender: NSButton) {
    toggleHotkeyPicker()
  }

  private func chooseHotkey(_ combo: String) {
    guard summonerHotKeyCandidates.contains(where: { $0.combo == combo }) else { return }
    if summonerHotKeyStolen.contains(where: { $0.combo == combo }) { return }
    _ = registerSummonerHotKey(combo: combo)
    jsonLine(["type": "summoner.hotkey.chosen", "combo": combo])
    noteHotkeyConfigured()
  }

  @objc func windowWillClose(_ notification: Notification) {
    emitClosedIfOpen()
  }

  func windowDidMove(_ notification: Notification) {
    if isOpen { emitCompanionUiRect("overlay", window: window) }
  }

  func windowDidResize(_ notification: Notification) {
    if isOpen { emitCompanionUiRect("overlay", window: window) }
  }

  private func emitClosedIfOpen() {
    guard isOpen else { return }
    isOpen = false
    // Close releases the overlay; do not abort the running chat.
    jsonLine(["type": "summoner.closed"])
  }

  private func capLines() {
    if lines.count > 20 {
      lines = Array(lines.suffix(20))
    }
  }

  private var composerText: String {
    composer?.string ?? ""
  }

  private func isSearchQuery(_ text: String) -> Bool {
    return text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("#")
  }

  private func searchNeedle(_ text: String) -> String {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard t.hasPrefix("#") else { return "" }
    return String(t.dropFirst()).trimmingCharacters(in: .whitespacesAndNewlines)
  }

  func textDidChange(_ notification: Notification) {
    updatePlaceholder()
    let on = composer?.hasMarkedText() ?? false
    if on != lastComposing {
      lastComposing = on
      jsonLine(["type": "summoner.composing", "on": on])
    }
    if isSearchQuery(composerText) {
      refreshHits()
      searchTimer?.invalidate()
      searchTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: false) { [weak self] _ in
        self?.emitSearch()
      }
    } else {
      hits = []
      selectedHit = 0
      hitsStack?.isHidden = true
      relayout()
    }
  }

  func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
    if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
      hide()
      return true
    }
    if isSearchQuery(composerText) {
      if commandSelector == #selector(NSResponder.moveUp(_:)) {
        moveHit(-1)
        return true
      }
      if commandSelector == #selector(NSResponder.moveDown(_:)) {
        moveHit(1)
        return true
      }
      if commandSelector == #selector(NSResponder.insertNewline(_:)) {
        if textView.hasMarkedText() { return false }
        if !hits.isEmpty {
          let i = min(max(0, selectedHit), hits.count - 1)
          selectThread(hits[i])
        }
        return true
      }
      return false
    }
    if commandSelector == #selector(NSResponder.insertNewline(_:)) {
      if textView.hasMarkedText() { return false }
      submitComposer()
      return true
    }
    return false
  }

  private func emitSearch() {
    guard isOpen else { return }
    jsonLine(["type": "summoner.search", "query": searchNeedle(composerText)])
  }

  private func moveHit(_ delta: Int) {
    guard !hits.isEmpty else { return }
    selectedHit = min(max(0, selectedHit + delta), hits.count - 1)
    refreshHits(filterAgain: false)
  }

  private func selectThread(_ thread: RecentThread) {
    threadId = thread.id
    hits = []
    selectedHit = 0
    composer?.string = ""
    updatePlaceholder()
    applyPhase()
    window?.makeFirstResponder(composer)
    jsonLine(["type": "summoner.select", "thread_id": thread.id])
  }

  func applyHits(_ json: [String: Any]) {
    let raw = json["hits"] as? [[String: Any]] ?? []
    hits = raw.compactMap { row in
      guard let id = row["id"] as? String, let title = row["title"] as? String, !id.isEmpty else { return nil }
      let when = row["when"] as? String ?? ""
      let day = when.count >= 10 ? String(when.prefix(10)) : when
      let label = day.isEmpty ? title : "\(title)  \(day)"
      return RecentThread(id: id, title: label)
    }
    selectedHit = 0
    refreshHits(filterAgain: false)
    relayout()
  }

  private func submitComposer() {
    let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    if composer?.hasMarkedText() == true { return }
    lines.append("你: \(text)")
    capLines()
    refreshLog()
    composer?.string = ""
    updatePlaceholder()
    jsonLine(["type": "summoner.submit", "thread_id": threadId, "text": text])
  }

  func applyDictate(_ text: String) {
    guard !text.isEmpty else { return }
    composer?.string = text
    updatePlaceholder()
    window?.makeFirstResponder(composer)
  }

  @objc func micHoldChanged(_ sender: NSButton) {
    let down = (NSEvent.pressedMouseButtons & (1 << 0)) != 0
    if down {
      if micCapture.isRunning {
        finishMicCapture()
        return
      }
      micDown = true
      micStartedAt = ProcessInfo.processInfo.systemUptime
      setMicRecording(true)
      jsonLine(["type": "summoner.mic.start"])
      micCapture.start {
        self.micDown = false
        self.setMicRecording(false)
        self.applyError(message: "麦克风不可用", errorCode: "mic_denied")
      }
      return
    }
    if !micDown { return }
    micDown = false
    let held = ProcessInfo.processInfo.systemUptime - micStartedAt
    if held < 0.35 && micCapture.isRunning {
      return
    }
    finishMicCapture()
  }

  private func finishMicCapture() {
    setMicRecording(false)
    let wav = micCapture.stop()
    if wav.isEmpty {
      jsonLine(["type": "summoner.mic.end"])
    } else {
      jsonLine(["type": "summoner.mic.wav", "data": wav.base64EncodedString()])
    }
  }

  private func setMicRecording(_ on: Bool) {
    micButton?.contentTintColor = on ? NSColor.systemRed : SummonerTokens.text
  }

  @objc func newThreadClicked() {
    threadId = ""
    lines = []
    streamingAssistant = false
    sawBrowserUnavailable = false
    composer?.string = ""
    updatePlaceholder()
    applyPhase()
    jsonLine(["type": "summoner.new_thread"])
  }

  @objc func sendClicked() { submitComposer() }

  @objc func attachClicked() {
    jsonLine(["type": "summoner.attach_chrome"])
  }

  @objc func attachForegroundClicked() {
    jsonLine(["type": "summoner.attach_chrome", "foreground": true])
  }

  @objc func settingsClicked() {
    settingsBox?.isHidden.toggle()
    relayout()
  }

  func applySettings(_ json: [String: Any]) {
    if let minutes = json["resume_idle_minutes"] as? Int {
      resumeIdleMinutes = minutes
    }
    if let flag = json["chrome_foreground"] as? Bool {
      chromeForeground = flag
    }
    refreshSettingsButtons()
  }

  private func emitSettings() {
    jsonLine([
      "type": "summoner.settings.set",
      "resume_idle_minutes": resumeIdleMinutes,
      "chrome_foreground": chromeForeground,
    ])
  }

  private func refreshSettingsButtons() {
    for btn in settingsIdleButtons {
      let on = btn.tag == resumeIdleMinutes
      btn.font = .systemFont(ofSize: 11, weight: on ? .semibold : .regular)
      btn.contentTintColor = on ? SummonerTokens.indigo : SummonerTokens.secondary
    }
    for btn in settingsChromeButtons {
      let on = (btn.tag == 1) == chromeForeground
      btn.font = .systemFont(ofSize: 11, weight: on ? .semibold : .regular)
      btn.contentTintColor = on ? SummonerTokens.indigo : SummonerTokens.secondary
    }
  }

  @objc func resumePolicyClicked(_ sender: NSButton) {
    resumeIdleMinutes = sender.tag
    emitSettings()
    refreshSettingsButtons()
  }

  @objc func chromePolicyClicked(_ sender: NSButton) {
    chromeForeground = sender.tag == 1
    emitSettings()
    refreshSettingsButtons()
  }

  @objc func continueClicked() {
    jsonLine(["type": "summoner.continue"])
  }

  @objc func hitClicked(_ sender: NSButton) {
    let idx = sender.tag
    guard idx >= 0, idx < hits.count else { return }
    selectThread(hits[idx])
  }

  private func refreshHits(filterAgain: Bool = true) {
    if filterAgain {
      if !isSearchQuery(composerText) || searchNeedle(composerText).isEmpty {
        hits = []
      }
      if selectedHit >= hits.count { selectedHit = 0 }
    }
    guard let stack = hitsStack else { return }
    while let v = stack.arrangedSubviews.first {
      stack.removeArrangedSubview(v)
      v.removeFromSuperview()
    }
    for (i, t) in hits.prefix(6).enumerated() {
      let row = NSButton(title: t.title, target: self, action: #selector(hitClicked(_:)))
      row.tag = i
      row.bezelStyle = .inline
      row.isBordered = false
      row.alignment = .left
      row.font = .systemFont(ofSize: 13, weight: .semibold)
      row.contentTintColor = SummonerTokens.text
      row.wantsLayer = true
      row.layer?.cornerRadius = 10
      if i == selectedHit {
        row.layer?.backgroundColor = SummonerTokens.indigoSoft.cgColor
      }
      row.heightAnchor.constraint(equalToConstant: 32).isActive = true
      stack.addArrangedSubview(row)
    }
    stack.isHidden = hits.isEmpty
    relayout()
  }

  private func refreshLog() {
    guard let tv = logView else { return }
    let out = NSMutableAttributedString()
    for (i, line) in lines.enumerated() {
      let streaming = streamingAssistant && i == lines.count - 1 && line.hasPrefix("助手:")
      if streaming {
        out.append(plainAttrs(line))
      } else {
        out.append(attributedLine(line))
      }
      if i < lines.count - 1 {
        out.append(plainAttrs("\n\n"))
      }
    }
    tv.textStorage?.setAttributedString(out)
    logBox?.isHidden = lines.isEmpty
    maybeGrowLogHeight(resizeWindow: true)
    scrollLogToEnd()
  }

  private func patchStreamingLine(_ body: String) {
    guard let tv = logView else { return }
    tv.string = lines.joined(separator: "\n")
    logBox?.isHidden = lines.isEmpty
    tv.scrollToEndOfDocument(nil)
  }

  private func maybeGrowLogHeight(resizeWindow: Bool) {
    guard let tv = logView, let container = tv.textContainer, let lm = tv.layoutManager else { return }
    lm.ensureLayout(for: container)
    let used = lm.usedRect(for: container).height + 24
    let estimated = max(used, CGFloat(max(1, lines.count)) * 20 + 16)
    let target = min(360, max(180, estimated))
    let current = logHeightConstraint?.constant ?? 0
    if abs(current - target) >= 8 {
      logHeightConstraint?.constant = target
      if resizeWindow { relayout() }
    }
  }

  private func scrollLogToEnd() {
    guard let tv = logView else { return }
    tv.scrollToEndOfDocument(nil)
  }

  private func plainAttrs(_ text: String) -> NSAttributedString {
    let font = NSFont.systemFont(ofSize: 13)
    return NSAttributedString(string: text, attributes: [
      .font: font,
      .foregroundColor: SummonerTokens.text,
    ])
  }

  private func attributedLine(_ line: String) -> NSAttributedString {
    let font = NSFont.systemFont(ofSize: 13)
    if line.hasPrefix("系统") || line.hasPrefix("[工具]") {
      return NSAttributedString(string: line, attributes: [
        .font: font,
        .foregroundColor: SummonerTokens.secondary,
      ])
    }
    let prefix: String
    if line.hasPrefix("你: ") {
      prefix = "你: "
    } else if line.hasPrefix("助手: ") {
      prefix = "助手: "
    } else {
      prefix = ""
    }
    let body = prefix.isEmpty ? line : String(line.dropFirst(prefix.count))
    let headColor = prefix == "你: " ? SummonerTokens.secondary : SummonerTokens.text
    let out = NSMutableAttributedString(string: prefix, attributes: [
      .font: font,
      .foregroundColor: headColor,
    ])
    // CommonMark collapses a single \n to a space. Chat needs visible breaks.
    let mdSource = body.replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\n", with: "  \n")
    let opts = AttributedString.MarkdownParsingOptions(
      interpretedSyntax: .full
    )
    if let parsed = try? AttributedString(markdown: mdSource, options: opts) {
      let md = NSMutableAttributedString(parsed)
      if md.length > 0 {
        md.addAttribute(.foregroundColor, value: SummonerTokens.text, range: NSRange(location: 0, length: md.length))
      }
      out.append(md)
      return out
    }
    out.append(NSAttributedString(string: body, attributes: [
      .font: font,
      .foregroundColor: SummonerTokens.text,
    ]))
    return out
  }

  private func lastThreadCaption() -> String? {
    let title: String?
    if !threadId.isEmpty {
      title = recentThreads.first(where: { $0.id == threadId })?.title
    } else {
      title = recentThreads.first?.title
    }
    guard let title, !title.isEmpty else { return nil }
    return "继续 · \(title)"
  }

  private func updateLastThreadLabel() {
    let cap = lastThreadCaption()
    lastThreadField?.stringValue = cap ?? ""
    lastThreadField?.isHidden = cap == nil
  }

  private func updatePlaceholder() {
    let empty = composerText.isEmpty
    placeholderField?.isHidden = !empty
    placeholderField?.stringValue = summonerTalkPlaceholder
    if let box = fieldBox {
      let focused = (window?.firstResponder === composer)
      box.layer?.backgroundColor = focused ? SummonerTokens.paper.cgColor : SummonerTokens.muted.cgColor
      box.layer?.borderColor = focused
        ? SummonerTokens.indigo.withAlphaComponent(0.45).cgColor
        : NSColor(white: 0.09, alpha: 0.10).cgColor
    }
  }

  private func applyPhase() {
    let searching = isSearchQuery(composerText)
    let hasTranscript = !lines.isEmpty || !threadId.isEmpty
    let detached = browserKnown && !browserAttached

    if !browserKnown {
      badgeField?.stringValue = "检测浏览器…"
    } else {
      badgeField?.stringValue = browserAttached ? "浏览器已连接" : "浏览器未连接"
    }
    if let badge = badgeField {
      badge.wantsLayer = true
      badge.layer?.cornerRadius = 999
      badge.layer?.masksToBounds = true
      if !browserKnown {
        badge.backgroundColor = SummonerTokens.muted
        badge.textColor = SummonerTokens.secondary
        badge.layer?.borderColor = NSColor(white: 0.09, alpha: 0.10).cgColor
      } else if browserAttached {
        badge.backgroundColor = SummonerTokens.okBg
        badge.textColor = SummonerTokens.okFg
        badge.layer?.borderColor = SummonerTokens.okBorder.cgColor
      } else {
        badge.backgroundColor = SummonerTokens.warnBg
        badge.textColor = SummonerTokens.warnFg
        badge.layer?.borderColor = SummonerTokens.warnBorder.cgColor
      }
    }

    hintField?.stringValue = searching ? "只搜标题，不搜正文" : summonerTalkHint

    if searching {
      refreshHits()
    } else {
      hits = []
      hitsStack?.isHidden = true
    }
    logBox?.isHidden = !hasTranscript
    refreshLog()
    ctaBox?.isHidden = true
    attachButton?.isHidden = true
    silentAttachButton?.isHidden = true
    footRow?.isHidden = searching
    sendButton?.isHidden = false
    continueButton?.isHidden = !(hasTranscript && browserAttached && sawBrowserUnavailable)
    if detached {
      sideNote?.stringValue = summonerDetachedInfo
      sideNote?.isHidden = searching
    } else {
      sideNote?.stringValue = "完整格式在侧栏"
      sideNote?.isHidden = searching || !hasTranscript
    }
    micButton?.isHidden = true
    updateLastThreadLabel()
    updatePlaceholder()
    relayout()
  }

  private func relayout() {
    guard let window = window else { return }
    var h: CGFloat = 108
    if pickerBox?.isHidden == false { h += 310 }
    if settingsBox?.isHidden == false { h += 118 }
    if lastThreadField?.isHidden == false { h += 18 }
    if mcpField?.isHidden == false { h += 18 }
    if hitsStack?.isHidden == false { h += 8 + CGFloat(min(hits.count, 6)) * 36 }
    if logBox?.isHidden == false { h += (logHeightConstraint?.constant ?? 220) + 8 }
    if ctaBox?.isHidden == false { h += 36 }
    if footRow?.isHidden == false { h += 48 }
    if sideNote?.isHidden == false { h += 22 }
    window.setContentSize(NSSize(width: 420, height: max(140, h)))
    if isOpen { emitCompanionUiRect("overlay", window: window) }
  }

  private func makeWindow() -> NSPanel? {
    let contentRect = NSRect(x: 0, y: 0, width: 420, height: 180)
    let style: NSWindow.StyleMask = [.titled, .closable, .nonactivatingPanel]
    let panel = NSPanel(contentRect: contentRect, styleMask: style, backing: .buffered, defer: false)
    panel.title = summonerWindowTitle
    panel.isReleasedWhenClosed = false
    panel.becomesKeyOnlyIfNeeded = false
    panel.hidesOnDeactivate = false
    panel.level = .floating
    panel.minSize = NSSize(width: 420, height: 140)
    panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary, .transient]
    panel.delegate = self
    panel.appearance = NSAppearance(named: .aqua)
    panel.backgroundColor = SummonerTokens.paper

    let stack = NSStackView()
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 8
    stack.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 12, right: 12)
    stack.translatesAutoresizingMaskIntoConstraints = false

    let header = NSStackView()
    header.orientation = .horizontal
    header.alignment = .centerY
    header.spacing = 8
    let badge = NSTextField(labelWithString: "检测浏览器…")
    badge.font = .systemFont(ofSize: 11)
    badge.alignment = .center
    badge.drawsBackground = true
    badge.wantsLayer = true
    badge.layer?.cornerRadius = 999
    badge.layer?.borderWidth = 1
    badge.layer?.masksToBounds = true
    badge.translatesAutoresizingMaskIntoConstraints = false
    let badgeWrap = NSView()
    badgeWrap.translatesAutoresizingMaskIntoConstraints = false
    badgeWrap.addSubview(badge)
    NSLayoutConstraint.activate([
      badge.leadingAnchor.constraint(equalTo: badgeWrap.leadingAnchor, constant: 8),
      badge.trailingAnchor.constraint(equalTo: badgeWrap.trailingAnchor, constant: -8),
      badge.topAnchor.constraint(equalTo: badgeWrap.topAnchor, constant: 3),
      badge.bottomAnchor.constraint(equalTo: badgeWrap.bottomAnchor, constant: -3),
      badgeWrap.heightAnchor.constraint(equalToConstant: 22),
    ])
    badgeField = badge
    let newChat = NSButton(title: "新对话", target: self, action: #selector(newThreadClicked))
    newChat.bezelStyle = .inline
    newChat.isBordered = false
    newChat.font = .systemFont(ofSize: 11, weight: .semibold)
    newChat.contentTintColor = SummonerTokens.indigo
    newChat.toolTip = "开始一段新对话"
    newChat.keyEquivalent = ""
    let hotkeyBtn = NSButton(title: "快捷键", target: self, action: #selector(hotkeyEntryClicked(_:)))
    hotkeyBtn.bezelStyle = .inline
    hotkeyBtn.isBordered = false
    hotkeyBtn.font = .systemFont(ofSize: 11, weight: .medium)
    hotkeyBtn.contentTintColor = SummonerTokens.secondary
    hotkeyBtn.toolTip = "设置召唤器快捷键"
    hotkeyBtn.keyEquivalent = ""
    header.addArrangedSubview(badgeWrap)
    header.addArrangedSubview(NSView())
    header.addArrangedSubview(hotkeyBtn)
    header.addArrangedSubview(newChat)
    header.translatesAutoresizingMaskIntoConstraints = false
    header.widthAnchor.constraint(equalToConstant: 396).isActive = true
    stack.addArrangedSubview(header)

    let pickerBox = NSView()
    pickerBox.translatesAutoresizingMaskIntoConstraints = false
    pickerBox.wantsLayer = true
    pickerBox.layer?.backgroundColor = SummonerTokens.indigoSoft.cgColor
    pickerBox.layer?.cornerRadius = 12
    pickerBox.widthAnchor.constraint(equalToConstant: 396).isActive = true
    pickerBox.isHidden = true
    self.pickerBox = pickerBox
    let pickerStack = NSStackView()
    pickerStack.orientation = .vertical
    pickerStack.alignment = .leading
    pickerStack.spacing = 6
    pickerStack.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
    pickerStack.translatesAutoresizingMaskIntoConstraints = false
    let pickerTitle = NSTextField(labelWithString: "选一个召唤热键")
    pickerTitle.font = .systemFont(ofSize: 13, weight: .semibold)
    pickerTitle.textColor = SummonerTokens.text
    pickerStack.addArrangedSubview(pickerTitle)
    let pickerHint = NSTextField(wrappingLabelWithString: "选完即关。菜单也可打开召唤器，不必等热键。")
    pickerHint.font = .systemFont(ofSize: 11)
    pickerHint.textColor = SummonerTokens.secondary
    pickerHint.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    pickerStack.addArrangedSubview(pickerHint)
    let stolen = NSTextField(wrappingLabelWithString: summonerHotKeyStolenCopy)
    stolen.font = .systemFont(ofSize: 11)
    stolen.textColor = SummonerTokens.warnFg
    stolen.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    pickerStack.addArrangedSubview(stolen)
    for occ in summonerHotKeyStolen {
      let row = NSTextField(labelWithString: "\(occ.label) · 已被 \(occ.occupiedBy) 占用")
      row.font = .systemFont(ofSize: 11)
      row.textColor = SummonerTokens.faint
      row.isSelectable = false
      pickerStack.addArrangedSubview(row)
    }
    for cand in summonerHotKeyCandidates {
      let btn = makePlainButton(title: cand.label, action: #selector(hotkeyCandidateClicked(_:)))
      btn.identifier = NSUserInterfaceItemIdentifier(cand.combo)
      btn.widthAnchor.constraint(equalToConstant: 372).isActive = true
      pickerStack.addArrangedSubview(btn)
    }
    pickerBox.addSubview(pickerStack)
    NSLayoutConstraint.activate([
      pickerStack.topAnchor.constraint(equalTo: pickerBox.topAnchor),
      pickerStack.bottomAnchor.constraint(equalTo: pickerBox.bottomAnchor),
      pickerStack.leadingAnchor.constraint(equalTo: pickerBox.leadingAnchor),
      pickerStack.trailingAnchor.constraint(equalTo: pickerBox.trailingAnchor),
    ])
    stack.addArrangedSubview(pickerBox)

    let settingsBox = NSView()
    settingsBox.translatesAutoresizingMaskIntoConstraints = false
    settingsBox.wantsLayer = true
    settingsBox.layer?.backgroundColor = SummonerTokens.muted.cgColor
    settingsBox.layer?.cornerRadius = 12
    settingsBox.widthAnchor.constraint(equalToConstant: 396).isActive = true
    settingsBox.isHidden = true
    self.settingsBox = settingsBox
    let settingsStack = NSStackView()
    settingsStack.orientation = .vertical
    settingsStack.alignment = .leading
    settingsStack.spacing = 6
    settingsStack.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
    settingsStack.translatesAutoresizingMaskIntoConstraints = false
    let idleTitle = NSTextField(labelWithString: "再打开 · 超时后新对话")
    idleTitle.font = .systemFont(ofSize: 12, weight: .semibold)
    idleTitle.textColor = SummonerTokens.text
    settingsStack.addArrangedSubview(idleTitle)
    let idleHint = NSTextField(wrappingLabelWithString: "输入 # 搜历史标题即可继续旧对话。")
    idleHint.font = .systemFont(ofSize: 11)
    idleHint.textColor = SummonerTokens.secondary
    idleHint.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    settingsStack.addArrangedSubview(idleHint)
    let idleRow = NSStackView()
    idleRow.orientation = .horizontal
    idleRow.spacing = 6
    let idleSpecs: [(String, Int)] = [("始终新开", 0), ("10分钟", 10), ("30分钟", 30), ("始终继续", -1)]
    for spec in idleSpecs {
      let btn = NSButton(title: spec.0, target: self, action: #selector(resumePolicyClicked(_:)))
      btn.tag = spec.1
      btn.bezelStyle = .inline
      btn.isBordered = false
      btn.font = .systemFont(ofSize: 11, weight: .medium)
      btn.keyEquivalent = ""
      idleRow.addArrangedSubview(btn)
      settingsIdleButtons.append(btn)
    }
    settingsStack.addArrangedSubview(idleRow)
    let chromeTitle = NSTextField(labelWithString: "需要 Chrome 时")
    chromeTitle.font = .systemFont(ofSize: 12, weight: .semibold)
    chromeTitle.textColor = SummonerTokens.text
    settingsStack.addArrangedSubview(chromeTitle)
    let chromeRow = NSStackView()
    chromeRow.orientation = .horizontal
    chromeRow.spacing = 6
    let chromeSpecs: [(String, Int)] = [("后台静默", 0), ("前台激活", 1)]
    for spec in chromeSpecs {
      let btn = NSButton(title: spec.0, target: self, action: #selector(chromePolicyClicked(_:)))
      btn.tag = spec.1
      btn.bezelStyle = .inline
      btn.isBordered = false
      btn.font = .systemFont(ofSize: 11, weight: .medium)
      btn.keyEquivalent = ""
      chromeRow.addArrangedSubview(btn)
      settingsChromeButtons.append(btn)
    }
    settingsStack.addArrangedSubview(chromeRow)
    settingsBox.addSubview(settingsStack)
    NSLayoutConstraint.activate([
      settingsStack.topAnchor.constraint(equalTo: settingsBox.topAnchor),
      settingsStack.bottomAnchor.constraint(equalTo: settingsBox.bottomAnchor),
      settingsStack.leadingAnchor.constraint(equalTo: settingsBox.leadingAnchor),
      settingsStack.trailingAnchor.constraint(equalTo: settingsBox.trailingAnchor),
    ])
    stack.addArrangedSubview(settingsBox)

    let fieldBox = NSView()
    fieldBox.translatesAutoresizingMaskIntoConstraints = false
    fieldBox.wantsLayer = true
    fieldBox.layer?.backgroundColor = SummonerTokens.muted.cgColor
    fieldBox.layer?.cornerRadius = 16
    fieldBox.layer?.borderWidth = 1
    fieldBox.layer?.borderColor = NSColor(white: 0.09, alpha: 0.10).cgColor
    fieldBox.heightAnchor.constraint(equalToConstant: 40).isActive = true
    fieldBox.widthAnchor.constraint(equalToConstant: 396).isActive = true
    self.fieldBox = fieldBox

    let scroll = NSScrollView()
    scroll.translatesAutoresizingMaskIntoConstraints = false
    scroll.hasVerticalScroller = false
    scroll.hasHorizontalScroller = false
    scroll.borderType = .noBorder
    scroll.drawsBackground = false
    let tv = NSTextView()
    tv.isRichText = false
    tv.font = .systemFont(ofSize: 15)
    tv.textColor = SummonerTokens.text
    tv.backgroundColor = .clear
    tv.drawsBackground = false
    tv.isAutomaticQuoteSubstitutionEnabled = false
    tv.isAutomaticDashSubstitutionEnabled = false
    tv.isAutomaticTextReplacementEnabled = false
    tv.allowsUndo = true
    tv.textContainerInset = NSSize(width: 0, height: 4)
    tv.isHorizontallyResizable = false
    tv.isVerticallyResizable = true
    tv.autoresizingMask = [.width]
    tv.textContainer?.widthTracksTextView = true
    tv.textContainer?.lineFragmentPadding = 0
    tv.delegate = self
    scroll.documentView = tv
    composer = tv
    fieldBox.addSubview(scroll)

    let placeholder = NSTextField(labelWithString: summonerTalkPlaceholder)
    placeholder.font = .systemFont(ofSize: 15)
    placeholder.textColor = SummonerTokens.faint
    placeholder.translatesAutoresizingMaskIntoConstraints = false
    placeholderField = placeholder
    fieldBox.addSubview(placeholder)

    let mic = NSButton(title: "🎙", target: self, action: #selector(micHoldChanged(_:)))
    mic.bezelStyle = .inline
    mic.isBordered = false
    mic.font = .systemFont(ofSize: 14)
    mic.toolTip = "听写暂未开放"
    mic.keyEquivalent = ""
    mic.sendAction(on: [.leftMouseDown, .leftMouseUp])
    mic.translatesAutoresizingMaskIntoConstraints = false
    micButton = mic
    fieldBox.addSubview(mic)

    NSLayoutConstraint.activate([
      mic.trailingAnchor.constraint(equalTo: fieldBox.trailingAnchor, constant: -8),
      mic.centerYAnchor.constraint(equalTo: fieldBox.centerYAnchor),
      mic.widthAnchor.constraint(equalToConstant: 28),
      mic.heightAnchor.constraint(equalToConstant: 28),
      scroll.leadingAnchor.constraint(equalTo: fieldBox.leadingAnchor, constant: 12),
      scroll.trailingAnchor.constraint(equalTo: mic.leadingAnchor, constant: -6),
      scroll.topAnchor.constraint(equalTo: fieldBox.topAnchor, constant: 6),
      scroll.bottomAnchor.constraint(equalTo: fieldBox.bottomAnchor, constant: -6),
      placeholder.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
      placeholder.centerYAnchor.constraint(equalTo: fieldBox.centerYAnchor),
    ])
    stack.addArrangedSubview(fieldBox)

    let hint = NSTextField(labelWithString: summonerTalkHint)
    hint.font = .systemFont(ofSize: 11)
    hint.textColor = SummonerTokens.faint
    hint.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    hintField = hint
    stack.addArrangedSubview(hint)

    let lastThread = NSTextField(labelWithString: "")
    lastThread.font = .systemFont(ofSize: 12, weight: .medium)
    lastThread.textColor = SummonerTokens.secondary
    lastThread.isHidden = true
    lastThreadField = lastThread
    stack.addArrangedSubview(lastThread)

    let mcp = NSTextField(labelWithString: "MCP 未连接 · 去侧栏配置后这里可直接调用")
    mcp.font = .systemFont(ofSize: 11)
    mcp.textColor = SummonerTokens.faint
    mcp.isHidden = true
    mcpField = mcp
    stack.addArrangedSubview(mcp)

    let hits = NSStackView()
    hits.orientation = .vertical
    hits.alignment = .leading
    hits.spacing = 4
    hits.translatesAutoresizingMaskIntoConstraints = false
    hits.widthAnchor.constraint(equalToConstant: 396).isActive = true
    hits.isHidden = true
    hitsStack = hits
    stack.addArrangedSubview(hits)

    let logBox = NSView()
    logBox.translatesAutoresizingMaskIntoConstraints = false
    logBox.wantsLayer = true
    logBox.layer?.backgroundColor = SummonerTokens.muted.cgColor
    logBox.layer?.cornerRadius = 12
    let logH = logBox.heightAnchor.constraint(equalToConstant: 220)
    logH.isActive = true
    logHeightConstraint = logH
    logBox.widthAnchor.constraint(equalToConstant: 396).isActive = true
    logBox.isHidden = true
    self.logBox = logBox
    let logScroll = NSTextView.scrollableTextView()
    logScroll.translatesAutoresizingMaskIntoConstraints = false
    logScroll.hasVerticalScroller = true
    logScroll.borderType = .noBorder
    logScroll.drawsBackground = false
    logScroll.autohidesScrollers = true
    let logView = logScroll.documentView as! NSTextView
    logView.isEditable = false
    logView.isSelectable = true
    logView.isRichText = true
    logView.drawsBackground = false
    logView.font = .systemFont(ofSize: 13)
    logView.textColor = SummonerTokens.text
    logView.textContainerInset = NSSize(width: 8, height: 8)
    logView.isVerticallyResizable = true
    logView.textContainer?.widthTracksTextView = true
    logView.textContainer?.lineFragmentPadding = 4
    self.logView = logView
    self.logScroll = logScroll
    logBox.addSubview(logScroll)
    NSLayoutConstraint.activate([
      logScroll.topAnchor.constraint(equalTo: logBox.topAnchor),
      logScroll.bottomAnchor.constraint(equalTo: logBox.bottomAnchor),
      logScroll.leadingAnchor.constraint(equalTo: logBox.leadingAnchor),
      logScroll.trailingAnchor.constraint(equalTo: logBox.trailingAnchor),
    ])
    stack.addArrangedSubview(logBox)

    let ctaBox = NSView()
    ctaBox.translatesAutoresizingMaskIntoConstraints = false
    ctaBox.wantsLayer = true
    ctaBox.layer?.backgroundColor = SummonerTokens.warnBg.cgColor
    ctaBox.layer?.borderColor = SummonerTokens.warnBorder.cgColor
    ctaBox.layer?.borderWidth = 1
    ctaBox.layer?.cornerRadius = 12
    ctaBox.widthAnchor.constraint(equalToConstant: 396).isActive = true
    ctaBox.isHidden = true
    self.ctaBox = ctaBox
    let ctaStack = NSStackView()
    ctaStack.orientation = .vertical
    ctaStack.alignment = .leading
    ctaStack.spacing = 8
    ctaStack.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
    ctaStack.translatesAutoresizingMaskIntoConstraints = false
    let cta = NSTextField(wrappingLabelWithString: summonerCtaCopy)
    cta.font = .systemFont(ofSize: 12.5)
    cta.textColor = SummonerTokens.warnFg
    cta.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    ctaLabel = cta
    ctaStack.addArrangedSubview(cta)
    let silent = makeIndigoButton(title: "后台使用 Chrome", action: #selector(attachClicked))
    silent.widthAnchor.constraint(equalToConstant: 372).isActive = true
    silentAttachButton = silent
    ctaStack.addArrangedSubview(silent)
    let attach = makePlainButton(title: "激活 Google Chrome", action: #selector(attachForegroundClicked))
    attach.widthAnchor.constraint(equalToConstant: 372).isActive = true
    attachButton = attach
    ctaStack.addArrangedSubview(attach)
    ctaBox.addSubview(ctaStack)
    NSLayoutConstraint.activate([
      ctaStack.topAnchor.constraint(equalTo: ctaBox.topAnchor),
      ctaStack.bottomAnchor.constraint(equalTo: ctaBox.bottomAnchor),
      ctaStack.leadingAnchor.constraint(equalTo: ctaBox.leadingAnchor),
      ctaStack.trailingAnchor.constraint(equalTo: ctaBox.trailingAnchor),
    ])
    stack.addArrangedSubview(ctaBox)

    let foot = NSStackView()
    foot.orientation = .horizontal
    foot.spacing = 8
    foot.distribution = .fillEqually
    foot.translatesAutoresizingMaskIntoConstraints = false
    foot.widthAnchor.constraint(equalToConstant: 396).isActive = true
    foot.heightAnchor.constraint(equalToConstant: 36).isActive = true
    let send = makePlainButton(title: "发送", action: #selector(sendClicked))
    let cont = makeIndigoButton(title: "已连接，继续对话", action: #selector(continueClicked))
    sendButton = send
    continueButton = cont
    foot.addArrangedSubview(send)
    foot.addArrangedSubview(cont)
    foot.isHidden = false
    send.isHidden = false
    footRow = foot
    stack.addArrangedSubview(foot)

    let side = NSTextField(labelWithString: "完整格式在侧栏")
    side.font = .systemFont(ofSize: 11)
    side.textColor = SummonerTokens.faint
    side.alignment = .center
    side.isHidden = true
    sideNote = side
    side.translatesAutoresizingMaskIntoConstraints = false
    side.widthAnchor.constraint(equalToConstant: 396).isActive = true
    stack.addArrangedSubview(side)

    guard let cv = panel.contentView else { return panel }
    cv.wantsLayer = true
    cv.layer?.backgroundColor = SummonerTokens.paper.cgColor
    cv.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: cv.topAnchor),
      stack.bottomAnchor.constraint(equalTo: cv.bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: cv.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: cv.trailingAnchor),
    ])
    return panel
  }

  private func makeIndigoButton(title: String, action: Selector) -> NSButton {
    let btn = NSButton(title: title, target: self, action: action)
    btn.bezelStyle = .rounded
    btn.controlSize = .large
    if #available(macOS 11.0, *) {
      btn.bezelColor = SummonerTokens.indigo
      btn.contentTintColor = .white
    }
    // Never bind Return — IME composing Return must not fire a button.
    btn.keyEquivalent = ""
    return btn
  }

  private func makePlainButton(title: String, action: Selector) -> NSButton {
    let btn = NSButton(title: title, target: self, action: action)
    btn.bezelStyle = .rounded
    btn.controlSize = .large
    btn.keyEquivalent = ""
    return btn
  }
}

let summonerController = SummonerController()

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let delegate = TrayDelegate()
delegate.setup()
installSummonerHotKeyMonitor()
startStdinReader(delegate: delegate)

// Notify parent that tray is ready
jsonLine(["type": "ready", "pid": ProcessInfo.processInfo.processIdentifier])

app.run()

// Post-run cleanup (unreachable in normal flow, but defensive)
delegate.shutdown()
jsonLine(["type": "exit", "code": 0])
