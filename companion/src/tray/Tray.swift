// CMspark Swift Tray — Native NSStatusBar for macOS (Apple Silicon)
//
// Hierarchical menu with submenus for status details, quick actions,
// and recent threads. Communication via line-delimited JSON on stdin/stdout.
//
// Protocol (stdin ← Node.js):
//   {"cmd":"update","status":"running|stopped|unknown","wsConnected":true,"pid":12345}
//   {"cmd":"mini","visible":true}
//   {"cmd":"update-autostart","enabled":true}
//   {"cmd":"update-quick-actions","actions":[{"id":"read-page","title":"📖 读取当前页面"},...]}
//   {"cmd":"update-recent-threads","threads":[{"id":"abc","title":"数据分析报告..."},...]}
//   {"cmd":"quit"}
//
// Protocol (stdout → Node.js):
//   {"type":"ready","pid":12345}
//   {"type":"click","action":"start|stop|restart|status|logs|chrome|settings|autostart|quit"}
//   {"type":"click","action":"quick-action","id":"read-page"}
//   {"type":"click","action":"mini-action","id":"chat|search|meeting|todo|ask|ocr|capture"}
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
import WebKit

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
  let primaryTop = NSScreen.screens.first?.frame.maxY ?? f.maxY
  let yTop = primaryTop - f.maxY
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

// Same 24-unit geometry as scripts/lib/brand-icon.mjs, drawn at native backing scale.
func makeStatusIcon(_ status: CompanionStatus, size: NSSize = NSSize(width: 18, height: 18), tint: NSColor? = nil) -> NSImage {
  let color: NSColor
  switch status {
  case .running: color = NSColor(srgbRed: 22/255, green: 132/255, blue: 93/255, alpha: 1)
  case .stopped: color = NSColor(srgbRed: 213/255, green: 67/255, blue: 67/255, alpha: 1)
  case .unknown: color = NSColor(srgbRed: 182/255, green: 124/255, blue: 24/255, alpha: 1)
  }
  let image = NSImage(size: size, flipped: false) { rect in
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    let transform = NSAffineTransform()
    transform.translateX(by: rect.minX, yBy: rect.minY)
    transform.scaleX(by: rect.width / 24, yBy: rect.height / 24)
    transform.concat()
    // A hollow center distinguishes stopped even without red/green perception.
    if status == .stopped {
      let clip = NSBezierPath(rect: NSRect(x: 0, y: 0, width: 24, height: 24))
      clip.appendOval(in: NSRect(x: 10.1, y: 10.1, width: 3.8, height: 3.8))
      clip.windingRule = .evenOdd; clip.addClip()
    }
    (tint ?? color).setStroke(); (tint ?? color).setFill()
    for point in [NSPoint(x: 5, y: 5), NSPoint(x: 5, y: 19), NSPoint(x: 20, y: 12)] {
      let line = NSBezierPath(); line.move(to: point); line.line(to: NSPoint(x: 12, y: 12))
      line.lineWidth = 2.3; line.lineCapStyle = .round; line.stroke()
      NSBezierPath(ovalIn: NSRect(x: point.x-2.3, y: point.y-2.3, width: 4.6, height: 4.6)).fill()
    }
    let spark = NSBezierPath()
    spark.move(to: NSPoint(x: 12, y: 7.5)); spark.line(to: NSPoint(x: 16.5, y: 12))
    spark.line(to: NSPoint(x: 12, y: 16.5)); spark.line(to: NSPoint(x: 7.5, y: 12)); spark.close(); spark.fill()
    return true
  }
  image.isTemplate = false // Preserve explicit run/stop colors in both menu-bar appearances.
  return image
}

// ---------------------------------------------------------------------------
// Desktop Mini
// ---------------------------------------------------------------------------

private struct MiniOrbPosition: Codable {
  let display: UInt32
  let x, y: Double

  static let file: URL = {
    let root = ProcessInfo.processInfo.environment["CMSPARK_DATA_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
      ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".cmspark-agent")
    return root.appendingPathComponent("mini-macos-position.json")
  }()
}

private final class MiniOrbButton: NSButton {
  var openMenu: (() -> Void)?
  var openFan: (() -> MiniActionFan?)?
  var held: (() -> Void)?
  var closedFan: (() -> Void)?
  private var fan: MiniActionFan?
  var visibleMenu: NSWindow? { fan }
  var moved: ((NSPoint, NSPoint) -> Void)?
  var finishedMove: (() -> Void)?
  private var press: Timer?
  private var startPointer: NSPoint?
  private var startOrigin = NSPoint.zero
  private var dragging = false

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func mouseDown(with event: NSEvent) {
    guard let window else { return }
    if fan != nil { cancelGesture(); return }
    cancelGesture()
    startPointer = window.convertPoint(toScreen: event.locationInWindow)
    startOrigin = window.frame.origin
    let timer = Timer(timeInterval: 0.45, repeats: false) { [weak self] _ in
      guard let self else { return }
      self.cancelGesture()
      self.held?()
    }
    press = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  override func mouseDragged(with event: NSEvent) {
    guard let startPointer, let window else { return }
    let point = window.convertPoint(toScreen: event.locationInWindow)
    let dx = point.x - startPointer.x, dy = point.y - startPointer.y
    if !dragging && hypot(dx, dy) < 4 { return }
    dragging = true
    press?.invalidate()
    moved?(NSPoint(x: startOrigin.x + dx, y: startOrigin.y + dy), point)
  }

  override func mouseUp(with event: NSEvent) {
    guard startPointer != nil else { return }
    let didDrag = dragging
    cancelGesture()
    if didDrag { finishedMove?() }
    else { showFan() }
  }

  @objc func showFan() { if fan == nil { fan = openFan?() } }

  override func rightMouseDown(with event: NSEvent) { cancelGesture(); openMenu?() }
  override func accessibilityPerformShowMenu() -> Bool { openMenu?(); return true }

  func cancelGesture() {
    if let fan {
      self.fan = nil
      fan.orderOut(nil)
      fan.close()
      closedFan?()
    }
    press?.invalidate()
    press = nil
    startPointer = nil
    dragging = false
  }
}

private final class DesktopMini: NSObject {
  private(set) var enabled = false
  private let size = NSSize(width: 46, height: 46)
  private var panel: NSPanel?
  private var button: MiniOrbButton?
  private var activeMenu: NSMenu?
  private var regionPicker: MiniRegionSelection?
  private var position: MiniOrbPosition?

  override init() {
    super.init()
    if let data = try? Data(contentsOf: MiniOrbPosition.file) {
      position = try? JSONDecoder().decode(MiniOrbPosition.self, from: data)
    }
    NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)
  }

  func setVisible(_ visible: Bool) {
    enabled = visible
    if visible {
      if panel == nil { makePanel() }
      restorePosition()
      panel?.orderFrontRegardless()
      emitCompanionUiRect("mini", window: panel)
    } else {
      hidePanel()
    }
  }

  private func hidePanel() {
    activeMenu?.cancelTracking()
    regionPicker?.close()
    regionPicker = nil
    button?.cancelGesture()
    if panel?.isVisible == true {
      panel?.orderOut(nil)
      emitCompanionUiRect("mini", window: nil)
    }
  }

  private func makePanel() {
    let frame = NSRect(origin: .zero, size: size)
    let orb = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel],
                      backing: .buffered, defer: false)
    orb.title = "CMspark Mini"
    orb.isOpaque = false
    orb.backgroundColor = .clear
    orb.hasShadow = true
    orb.level = .floating
    orb.hidesOnDeactivate = false
    orb.isReleasedWhenClosed = false
    orb.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]

    let control = MiniOrbButton(frame: frame)
    control.isBordered = false
    control.title = ""
    control.image = makeStatusIcon(.running, size: NSSize(width: 26, height: 26),
                                   tint: NSColor(srgbRed: 0.3, green: 0.88, blue: 0.67, alpha: 1))
    control.imagePosition = .imageOnly
    control.imageScaling = .scaleNone
    control.wantsLayer = true
    control.layer?.backgroundColor = NSColor(srgbRed: 0.09, green: 0.12, blue: 0.16, alpha: 1).cgColor
    control.layer?.cornerRadius = size.height / 2
    control.toolTip = "CMspark Mini · 单击展开操作菜单，长按打开快速对话，拖动移动"
    control.setAccessibilityLabel("CMspark Mini")
    control.setAccessibilityHelp(control.toolTip)
    control.target = control
    control.action = #selector(MiniOrbButton.showFan)
    control.held = { [weak self] in self?.openChat() }
    control.openMenu = { [weak self] in self?.showActions() }
    control.openFan = { [weak self, weak orb, weak control] in
      guard let self, let orb, let screen = orb.screen, self.enabled else { return nil }
      let fan = MiniActionFan(orb: orb, screen: screen)
      fan.onCancel = { [weak control] in control?.cancelGesture() }
      fan.onChoose = { [weak control, weak self] action in
        control?.cancelGesture()
        if action == "delay" { self?.showActions(delaysOnly: true) }
        else { self?.emitAction(action) }
      }
      fan.makeKeyAndOrderFront(nil)
      emitCompanionUiRect("mini", window: fan)
      return fan
    }
    control.closedFan = { [weak self] in self?.publishVisibleRect() }
    control.moved = { [weak self] origin, pointer in self?.move(to: origin, pointer: pointer) }
    control.finishedMove = { [weak self] in self?.savePosition() }
    orb.contentView = control
    panel = orb
    button = control
  }

  private func displayID(_ screen: NSScreen) -> UInt32 {
    (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
  }

  private func restorePosition() {
    guard let screen = NSScreen.screens.first(where: { displayID($0) == position?.display }) ?? NSScreen.main else { return }
    let work = screen.visibleFrame
    let x = position?.x ?? 0.98, y = position?.y ?? 0.28
    panel?.setFrameOrigin(NSPoint(x: work.minX + min(1, max(0, x)) * max(0, work.width - size.width),
                                  y: work.minY + min(1, max(0, y)) * max(0, work.height - size.height)))
  }

  private func move(to origin: NSPoint, pointer: NSPoint) {
    guard let screen = NSScreen.screens.first(where: { $0.frame.contains(pointer) }) ?? panel?.screen else { return }
    let work = screen.visibleFrame
    panel?.setFrameOrigin(NSPoint(x: max(work.minX, min(origin.x, work.maxX - size.width)),
                                  y: max(work.minY, min(origin.y, work.maxY - size.height))))
    emitCompanionUiRect("mini", window: panel)
  }

  private func savePosition() {
    guard let panel, let screen = panel.screen else { return }
    let work = screen.visibleFrame
    let saved = MiniOrbPosition(display: displayID(screen),
      x: (panel.frame.minX - work.minX) / max(1, work.width - size.width),
      y: (panel.frame.minY - work.minY) / max(1, work.height - size.height))
    position = saved
    do {
      try FileManager.default.createDirectory(at: MiniOrbPosition.file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONEncoder().encode(saved).write(to: MiniOrbPosition.file, options: .atomic)
    } catch { NSLog("CMspark Mini position could not be saved: %@", error.localizedDescription) }
  }

  func publishVisibleRect() {
    if panel?.isVisible == true { emitCompanionUiRect("mini", window: button?.visibleMenu ?? panel) }
  }

  @objc private func screensChanged() {
    if let picker = regionPicker {
      picker.close(); regionPicker = nil
      if enabled { setVisible(true) }
    }
    guard panel?.isVisible == true else { return }
    button?.cancelGesture()
    restorePosition()
    emitCompanionUiRect("mini", window: panel)
  }

  @objc private func openChat() { emitAction("chat") }
  @objc private func selectAction(_ item: NSMenuItem) {
    if let id = item.representedObject as? String { emitAction(id) }
  }

  private func emitAction(_ id: String) {
    guard enabled else { return }
    let parts = id.split(separator: ":")
    if let name = parts.first, ["todo", "ask", "ocr", "capture"].contains(String(name)) {
      hidePanel()
      if parts.count == 2, let seconds = Int(parts[1]), [3, 5, 10].contains(seconds) {
        let picker = MiniRegionSelection()
        regionPicker = picker
        picker.show(seconds: seconds) { [weak self] rect in
          guard let self else { return }
          self.regionPicker?.close()
          self.regionPicker = nil
          guard self.enabled else { return }
          guard let rect else { self.setVisible(true); return }
          jsonLine(["type": "click", "action": "mini-action", "id": id + ":" + rect])
        }
        return
      }
    }
    jsonLine(["type": "click", "action": "mini-action", "id": id])
  }

  private func showActions(delaysOnly: Bool = false) {
    guard let button, panel?.isVisible == true else { return }
    let menu = NSMenu()
    func append(_ parent: NSMenu, _ title: String, _ id: String) {
      let item = NSMenuItem(title: title, action: #selector(selectAction(_:)), keyEquivalent: "")
      item.representedObject = id
      item.target = self
      parent.addItem(item)
    }
    let captures = [("截图录待办…", "todo"), ("询问图片…", "ask"), ("识别截图文字…", "ocr"), ("仅截图…", "capture")]
    let delays = delaysOnly ? menu : NSMenu()
    if !delaysOnly {
      append(menu, "快速对话", "chat")
      append(menu, "搜索资料", "search")
      append(menu, "会议记录", "meeting")
      menu.addItem(.separator())
      for (title, id) in captures { append(menu, title, id) }
      menu.addItem(withTitle: "延时截图", action: nil, keyEquivalent: "").submenu = delays
    }
    for seconds in [3, 5, 10] {
      let choices = NSMenu()
      delays.addItem(withTitle: "框选后 \(seconds) 秒", action: nil, keyEquivalent: "").submenu = choices
      for (title, id) in captures { append(choices, title, "\(id):\(seconds)") }
    }
    activeMenu = menu
    menu.popUp(positioning: nil, at: NSPoint(x: button.bounds.midX, y: button.bounds.minY - 4), in: button)
    activeMenu = nil
  }
}

private let desktopMini = DesktopMini()

/// The Mini owns the meeting window so reopening it keeps the microphone and document alive.
private final class MiniMeetingWindow: NSObject, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
  private var window: NSWindow?
  private var page: WKWebView?
  private var address: URL?
  private var closing = false

  func show(port: Int) {
    guard (1...65535).contains(port), let url = URL(string: "http://127.0.0.1:\(port)/#meeting") else { return }
    if window == nil {
      let config = WKWebViewConfiguration()
      config.websiteDataStore = .nonPersistent()
      let view = WKWebView(frame: .zero, configuration: config)
      view.navigationDelegate = self
      view.uiDelegate = self
      let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 620),
                           styleMask: [.titled, .closable, .miniaturizable, .resizable],
                           backing: .buffered, defer: false)
      panel.title = "CMspark · 会议记录"
      panel.minSize = NSSize(width: 360, height: 360)
      panel.isReleasedWhenClosed = false
      panel.delegate = self
      panel.contentView = view
      panel.center()
      window = panel
      page = view
    }
    if address != url {
      address = url
      page?.load(URLRequest(url: url))
    } else {
      page?.evaluateJavaScript("document.getElementById('meetingOpen')?.click()")
    }
    window?.deminiaturize(nil)
    window?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    let url = action.request.url
    let allowed = url?.scheme == "http" && url?.host == "127.0.0.1" && url?.port == address?.port && url?.path == "/"
    decisionHandler(allowed && action.targetFrame?.isMainFrame == true ? .allow : .cancel)
  }

  @available(macOS 12.0, *)
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
               initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
               decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    let local = origin.protocol == "http" && origin.host == "127.0.0.1" && origin.port == address?.port
    decisionHandler(local && frame.isMainFrame && type == .microphone ? .prompt : .deny)
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    guard frame.isMainFrame, let window else { completionHandler(nil); return }
    let picker = NSOpenPanel()
    picker.beginSheetModal(for: window) { response in completionHandler(response == .OK ? picker.urls : nil) }
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    guard !closing, let page else { return false }
    closing = true
    page.callAsyncJavaScript("return await window.finishMiniMeeting?.()", arguments: [:], in: nil, in: .page) { result in
      self.closing = false
      if case .success(let value) = result, (value as? Bool) == false { return }
      sender.close()
      self.page = nil
      self.window = nil
      self.address = nil
    }
    return false
  }
}

private let miniMeetingWindow = MiniMeetingWindow()


// MARK: - Menu tags

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
  case desktop = 206
  case miniToggle = 207
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

  let summonerItem = NSMenuItem(title: "快速对话", action: action, keyEquivalent: "")
  summonerItem.target = target
  summonerItem.tag = MenuTag.summoner.rawValue
  menu.addItem(summonerItem)

  let desktopItem = NSMenuItem(title: "只读工作台…", action: action, keyEquivalent: "")
  desktopItem.target = target
  desktopItem.tag = MenuTag.desktop.rawValue
  menu.addItem(desktopItem)

  let miniItem = NSMenuItem(title: "显示 Mini 桌面小球", action: action, keyEquivalent: "")
  miniItem.target = target
  miniItem.tag = MenuTag.miniToggle.rawValue
  miniItem.state = desktopMini.enabled ? .on : .off
  menu.addItem(miniItem)

  let hotkeys = NSMenu()
  for candidate in summonerHotKeyCandidates {
    let item = NSMenuItem(title: candidate.label, action: action, keyEquivalent: "")
    item.target = target
    item.tag = MenuTag.summonerHotkey.rawValue
    item.representedObject = candidate.combo
    item.state = activeWorkbenchHotkey == candidate.combo ? .on : .off
    hotkeys.addItem(item)
  }
  let shortcutItem = NSMenuItem(title: "工作台快捷键", action: nil, keyEquivalent: "")
  shortcutItem.submenu = hotkeys
  menu.addItem(shortcutItem)

  menu.addItem(NSMenuItem.separator())

  // -- Start / Stop / Restart --
  let startItem = NSMenuItem(title: "启动 Companion", action: action, keyEquivalent: "s")
  startItem.target = target
  startItem.tag = MenuTag.start.rawValue
  startItem.isEnabled = !running
  menu.addItem(startItem)

  let stopItem = NSMenuItem(title: "停止 Companion", action: action, keyEquivalent: "x")
  stopItem.target = target
  stopItem.tag = MenuTag.stop.rawValue
  stopItem.isEnabled = running
  menu.addItem(stopItem)

  let restartItem = NSMenuItem(title: "重启 Companion", action: action, keyEquivalent: "r")
  restartItem.target = target
  restartItem.tag = MenuTag.restart.rawValue
  restartItem.isEnabled = running
  menu.addItem(restartItem)

  menu.addItem(NSMenuItem.separator())

  // -- Status Details submenu --
  let statusMenuItem = NSMenuItem(title: "状态详情", action: nil, keyEquivalent: "")
  let statusMenu = NSMenu()

  let compLabel = currentStatus == .unknown ? "状态未知" : (running ? "运行中" : "已停止")
  statusMenu.addItem(makeInfoItem("Companion: \(compLabel)"))

  let wsLabel = wsConnected ? "已连接" : "未连接"
  statusMenu.addItem(makeInfoItem("WebSocket: \(wsLabel) :23401"))

  let pidStr = currentPid.map(String.init) ?? "—"
  statusMenu.addItem(makeInfoItem("PID: \(pidStr)"))

  statusMenu.addItem(makeInfoItem("数据目录: ~/.cmspark-agent"))

  let now = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
  statusMenu.addItem(makeInfoItem("最后检测: \(now)"))

  statusMenu.addItem(NSMenuItem.separator())

  let refreshItem = NSMenuItem(title: "刷新状态", action: action, keyEquivalent: "")
  refreshItem.target = target
  refreshItem.tag = MenuTag.statusRefresh.rawValue
  statusMenu.addItem(refreshItem)

  statusMenuItem.submenu = statusMenu
  menu.addItem(statusMenuItem)

  // -- Quick Actions submenu --
  if !quickActions.isEmpty {
    let qaMenuItem = NSMenuItem(title: "快速操作", action: nil, keyEquivalent: "")
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
    let rtMenuItem = NSMenuItem(title: "最近对话", action: nil, keyEquivalent: "")
    let rtMenu = NSMenu()
    for (i, thread) in recentThreads.enumerated() {
      let item = NSMenuItem(title: thread.title, action: action, keyEquivalent: "")
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
  let logsItem = NSMenuItem(title: "打开日志目录", action: action, keyEquivalent: "l")
  logsItem.target = target
  logsItem.tag = MenuTag.logs.rawValue
  menu.addItem(logsItem)

  let pairingItem = NSMenuItem(title: "显示配对码", action: action, keyEquivalent: "p")
  pairingItem.target = target
  pairingItem.tag = MenuTag.pairing.rawValue
  menu.addItem(pairingItem)

  let chromeItem = NSMenuItem(title: "打开 Chrome", action: action, keyEquivalent: "c")
  chromeItem.target = target
  chromeItem.tag = MenuTag.chrome.rawValue
  menu.addItem(chromeItem)

  let settingsItem = NSMenuItem(title: "设置…", action: action, keyEquivalent: ",")
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
  let quitItem = NSMenuItem(title: "退出（停止服务）", action: action, keyEquivalent: "q")
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
    button.image = makeStatusIcon(currentStatus)
    button.title = ""
    button.toolTip = tooltipForStatus(currentStatus)
    button.setAccessibilityLabel(tooltipForStatus(currentStatus))

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
    button.image = makeStatusIcon(currentStatus)
    button.title = ""
    button.toolTip = tooltipForStatus(currentStatus)
    button.setAccessibilityLabel(tooltipForStatus(currentStatus))
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
      // Same Capture card as Side Panel 「弹出对话框」 (Node openSummonerWebShell).
      jsonLine(["type": "click", "action": "summoner"])
    } else if tag == MenuTag.desktop.rawValue {
      jsonLine(["type": "click", "action": "desktop"])
    } else if tag == MenuTag.summonerHotkey.rawValue {
      guard let combo = sender.representedObject as? String else { return }
      if registerSummonerHotKey(combo: combo) {
        jsonLine(["type": "summoner.hotkey.chosen", "combo": combo])
        rebuildMenu()
      } else {
        let alert = NSAlert()
        alert.messageText = "此快捷键无法注册"
        alert.informativeText = "请从工作台快捷键菜单选择其他组合。"
        alert.runModal()
      }
    } else if tag == MenuTag.settings.rawValue {
      jsonLine(["type": "click", "action": "settings"])
    } else if tag == MenuTag.miniToggle.rawValue {
      jsonLine(["type": "click", "action": "mini-toggle"])
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
    desktopMini.setVisible(false)
  }
}

private func tooltipForStatus(_ status: CompanionStatus) -> String {
  switch status {
  case .running:  return "CMspark — 运行中"
  case .stopped:  return "CMspark — 已停止"
  case .unknown:  return "CMspark — 状态未知"
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
      DispatchQueue.main.async {
        delegate.shutdown()
        NSApplication.shared.terminate(nil)
      }
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
      if ws && !wsConnected { desktopMini.publishVisibleRect() }
      wsConnected = ws
    }
    if let pid = json["pid"] as? Int {
      currentPid = pid
    }
    delegate.updateAppearance()

  case "mini":
    if let visible = json["visible"] as? Bool {
      desktopMini.setVisible(visible)
      delegate.rebuildMenu()
    }

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
  case "mini.meeting.open":
    if let port = json["port"] as? Int { miniMeetingWindow.show(port: port) }

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
    if registerSummonerHotKey(combo: combo) {
      summonerController.noteHotkeyConfigured()
      delegate.rebuildMenu()
    }

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

  case "summoner.threads":
    summonerController.applyThreads(json)

  case "summoner.packs":
    summonerController.applyPacks(json)

  case "summoner.mcp.servers":
    summonerController.applyMcpServers(json)

  case "summoner.skills":
    summonerController.applySkills(json)

  case "summoner.knowledge":
    summonerController.applyKnowledge(json)

  case "summoner.thread.search.results":
    summonerController.applyThreadSearchResults(json)

  case "summoner.knowledge.search.results":
    summonerController.applyKnowledgeSearchResults(json)

  case "summoner.peek.result":
    summonerController.applyPeekResult(json)

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
  private var toolField: NSTextField?
  private var riskChip: NSTextField?
  private var riskChipBox: NSView?
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

    // Risk chip (#396) — mirrors tokens.ts riskColor/riskLabel: never color-only,
    // text label + semantic surface. Warning family for low/medium, danger for
    // high+ (coordinate_injection keeps the 不可逆操作 suffix).
    let chipText: String
    let chipFg: NSColor, chipBg: NSColor, chipBorder: NSColor
    switch riskLevel {
    case "critical", "high":
      chipText = criticalApis.contains("computer.coordinate_injection")
        ? "高风险 · 不可逆操作"
        : "高风险"
      chipFg = SummonerTokens.danger
      chipBg = SummonerTokens.dangerBg
      chipBorder = SummonerTokens.dangerBorder
    case "medium":
      chipText = "中风险"
      chipFg = SummonerTokens.warnFg
      chipBg = SummonerTokens.warnBg
      chipBorder = SummonerTokens.warnBorder
    default:
      chipText = "低风险"
      chipFg = SummonerTokens.warnFg
      chipBg = SummonerTokens.warnBg
      chipBorder = SummonerTokens.warnBorder
    }

    // Header row carries tool + risk chip; window title stays plain text.
    window.title = "CMspark · 确认操作"
    toolField?.stringValue = toolName
    riskChip?.stringValue = chipText
    riskChip?.textColor = chipFg
    riskChipBox?.layer?.backgroundColor = chipBg.cgColor
    riskChipBox?.layer?.borderColor = chipBorder.cgColor

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
    countdownField?.stringValue = "\(displaySecs)s 后自动拒绝"
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
    let contentRect = NSRect(x: 0, y: 0, width: 520, height: 268)
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
    panel.minSize = NSSize(width: 480, height: 224)
    panel.delegate = self  // windowWillClose for Esc / close-button = deny

    let stack = NSStackView()
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 10
    stack.edgeInsets = NSEdgeInsets(top: 16, left: 20, bottom: 16, right: 20)
    stack.translatesAutoresizingMaskIntoConstraints = false

    // Header row: tool name (title tier) + risk chip (caption tier, color+label).
    let header = NSStackView()
    header.orientation = .horizontal
    header.alignment = .centerY
    header.spacing = 10
    let tool = NSTextField(labelWithString: "")
    tool.font = .systemFont(ofSize: SummonerTokens.fontTitle, weight: .semibold)
    tool.textColor = SummonerTokens.text
    tool.setContentHuggingPriority(.defaultLow, for: .horizontal)
    tool.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    toolField = tool
    header.addArrangedSubview(tool)
    let chip = NSTextField(labelWithString: "")
    chip.font = .systemFont(ofSize: SummonerTokens.fontCaption, weight: .semibold)
    chip.alignment = .center
    riskChip = chip
    let chipBox = NSView()
    chipBox.wantsLayer = true
    chipBox.layer?.cornerRadius = SummonerTokens.radiusSm
    chipBox.layer?.borderWidth = 1
    chipBox.layer?.masksToBounds = true
    chipBox.translatesAutoresizingMaskIntoConstraints = false
    chipBox.addSubview(chip)
    NSLayoutConstraint.activate([
      chip.topAnchor.constraint(equalTo: chipBox.topAnchor, constant: 3),
      chip.bottomAnchor.constraint(equalTo: chipBox.bottomAnchor, constant: -3),
      chip.leadingAnchor.constraint(equalTo: chipBox.leadingAnchor, constant: 8),
      chip.trailingAnchor.constraint(equalTo: chipBox.trailingAnchor, constant: -8),
    ])
    riskChipBox = chipBox
    header.addArrangedSubview(NSView())  // spacer pushes chip right
    header.addArrangedSubview(chipBox)
    stack.addArrangedSubview(header)

    // Summary (wraps; user content so sanitize: strip control chars, cap length).
    let summary = NSTextField(wrappingLabelWithString: "")
    summary.font = .systemFont(ofSize: SummonerTokens.fontBody)
    summary.textColor = SummonerTokens.text
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
    countdown.font = .systemFont(ofSize: SummonerTokens.fontCaption)
    countdown.textColor = SummonerTokens.secondary
    countdownField = countdown
    stack.addArrangedSubview(countdown)

    // Buttons row (Allow on right, Deny on left per macOS HIG). #396 hierarchy
    // mirrors MinimalConfirm: 允许 = primary (success fill, white ink),
    // 拒绝 = secondary (quiet chrome). Actions / key equivalents unchanged.
    let buttons = NSStackView()
    buttons.orientation = .horizontal
    buttons.spacing = 10
    let denyBtn = NSButton(title: "拒绝", target: self, action: #selector(denyClicked))
    denyBtn.keyEquivalent = "\u{1b}"  // Esc
    denyBtn.controlSize = .large
    denyBtn.bezelStyle = .rounded
    let allowBtn = NSButton(title: "允许", target: self, action: #selector(allowClicked))
    allowBtn.keyEquivalent = "\r"  // Return
    allowBtn.controlSize = .large
    allowBtn.bezelStyle = .rounded
    allowBtn.bezelColor = SummonerTokens.success
    allowBtn.contentTintColor = .white
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
var activeWorkbenchHotkey: String?
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
    activeWorkbenchHotkey = nil
  }
}

/// Best-effort Carbon registration. False = combo persisted but not armed.
@discardableResult
func registerSummonerHotKey(combo: String) -> Bool {
  if activeWorkbenchHotkey == combo { return true }
  guard let cand = summonerHotKeyCandidates.first(where: { $0.combo == combo }) else {
    return false
  }
  let hotKeyID = EventHotKeyID(signature: kSummonerHotKeySignature, id: kSummonerHotKeyId)
  var newRef: EventHotKeyRef?
  let status = RegisterEventHotKey(
    cand.keyCode,
    cand.mods,
    hotKeyID,
    GetApplicationEventTarget(),
    0,
    &newRef
  )
  guard status == noErr else { return false }
  unregisterSummonerHotKey()
  summonerHotKeyRef = newRef
  activeWorkbenchHotkey = combo
  return true
}

func handleSummonerHotKeyPressed() {
  if summonerController.composingNow {
    jsonLine(["type": "summoner.composing", "on": true])
    return
  }
  // Existing configured hotkey opens/focuses the same read-only native workbench as its tray menu.
  jsonLine(["type": "click", "action": "summoner-toggle"])
}


// Summoner overlay lives in SummonerOverlay.swift (same swiftc module).


// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

@main
enum TrayMain {
  static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)

    let delegate = TrayDelegate()
    delegate.setup()
    installSummonerHotKeyMonitor()
    startStdinReader(delegate: delegate)

    jsonLine(["type": "ready", "pid": ProcessInfo.processInfo.processIdentifier])
    app.run()
    delegate.shutdown()
    jsonLine(["type": "exit", "code": 0])
  }
}
