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
//   {"type":"exit","code":0}

import AppKit
import Foundation

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
  let quitItem = NSMenuItem(title: "❌ 退出", action: action, keyEquivalent: "q")
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

  fh.readabilityHandler = { handle in
    buffer.append(handle.availableData)

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

    // Detect EOF
    if buffer.isEmpty && handle.availableData.isEmpty {
      fh.readabilityHandler = nil
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

class PairingController: NSObject {
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
    // .accessory apps must explicitly steal focus for a window to come to front.
    NSApp.activate(ignoringOtherApps: true)
    window.center()
    window.makeKeyAndOrderFront(nil)
    // On macOS 14+ the deprecated activate(ignoringOtherApps:) no longer reliably
    // brings an accessory app's window to front (the window is created + isVisible,
    // but often stays behind / never becomes key), so a freshly-launched or
    // background-only-descended tray shows nothing when "显示配对码" is clicked.
    // orderFrontRegardless() forces ordering to the front even when activation is
    // suppressed — the documented primitive for exactly this case.
    window.orderFrontRegardless()
  }

  private func makeWindow() -> NSWindow? {
    let contentRect = NSRect(x: 0, y: 0, width: 480, height: 320)
    let style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable]
    let win = NSWindow(contentRect: contentRect, styleMask: style, backing: .buffered, defer: false)
    win.title = "🔑 CMspark 配对码"
    win.isReleasedWhenClosed = false
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
  }

  /// Companion resolved the confirmation elsewhere (Side Panel / disconnect).
  /// Close the dialog silently — do NOT emit a response (origin already has it).
  func cancel(id: String) {
    guard id == pendingId else { return }
    cleanup()
    window?.close()
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
// Entry point
// ---------------------------------------------------------------------------

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let delegate = TrayDelegate()
delegate.setup()
startStdinReader(delegate: delegate)

// Notify parent that tray is ready
jsonLine(["type": "ready", "pid": ProcessInfo.processInfo.processIdentifier])

app.run()

// Post-run cleanup (unreachable in normal flow, but defensive)
delegate.shutdown()
jsonLine(["type": "exit", "code": 0])
