// Summoner overlay — extracted from Tray.swift (god-file nit).
// Same swiftc module as Tray.swift (jsonLine, emitCompanionUiRect, RecentThread).

import AppKit
import Foundation
import AVFoundation

// ---------------------------------------------------------------------------
// SummonerController — P0 capture overlay (same process as tray; third window).
// Lazy NSPanel (.nonactivatingPanel + .floating). Close ≠ chat.abort.
// Look: one-bar HUD that expands into icon-rail + one list + transcript. Composer stays at the bottom.
// Overlay is capture-only — not an L2 gate surface.
// ---------------------------------------------------------------------------

/// Borderless NSPanel cannot become key unless overridden (NSWindow default:
/// no title bar → canBecomeKey == false). Without this, the HUD composer
/// never focuses, NSOpenPanel.begin is silent, and mic TCC/engine fail.
final class SummonerPanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

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
private let summonerTalkHint = "回车发送/纠偏 · Shift+Enter 排队 · # 搜标题"
private let summonerExpandHint = "回车发送 · Shift+Enter 排队 · # 搜标题 · ⌃ 收起"
private let summonerHudWidth: CGFloat = 720
private let summonerWorkbenchHeight: CGFloat = 428
private let summonerCtaCopy = "可激活 Google Chrome，然后点工具栏 CMspark（没有就拼图 🧩 钉上）。"
private let summonerDetachedInfo = "浏览器未连接 · 网页操作请点工具栏图标"
private let summonerFileMaxBytes = 6 * 1024 * 1024
private let summonerHudInnerWidth: CGFloat = 696

private func mimeTypeForAttach(url: URL) -> String {
  switch url.pathExtension.lowercased() {
  case "txt", "md", "csv", "log": return "text/plain"
  case "json": return "application/json"
  case "pdf": return "application/pdf"
  case "png": return "image/png"
  case "jpg", "jpeg": return "image/jpeg"
  case "gif": return "image/gif"
  case "webp": return "image/webp"
  case "html", "htm": return "text/html"
  default: return "application/octet-stream"
  }
}

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
  private var micButton: NSButton?
  private var clipButton: NSButton?
  private var plusButton: NSButton?
  private var expandButton: NSButton?
  private var workbenchBox: NSView?
  private var threadListStack: NSStackView?
  private var listHeadField: NSTextField?
  private var expanded = false
  private var railSection = 0
  private var threadRows: [RecentThread] = []
  private var packRows: [[String: Any]] = []
  private var mcpRows: [[String: Any]] = []
  private var skillRows: [[String: Any]] = []
  private var knowledgeRows: [[String: Any]] = []
  private var workbenchHeightConstraint: NSLayoutConstraint?
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
    expanded = false
    railSection = 0
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
    expanded = false
    railSection = 0
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
    sawBrowserUnavailable = false
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
    _ = names
  }

  func applyMcpServers(_ json: [String: Any]) {
    mcpRows = json["servers"] as? [[String: Any]] ?? []
    if railSection == 4 { refreshMcpList() }
  }

  func applySkills(_ json: [String: Any]) {
    skillRows = json["skills"] as? [[String: Any]] ?? []
    if railSection == 3 { refreshSkillList() }
  }

  func applyKnowledge(_ json: [String: Any]) {
    knowledgeRows = json["docs"] as? [[String: Any]] ?? []
    if railSection == 2 { refreshKnowledgeList() }
  }

  func applyThreads(_ json: [String: Any]) {
    let raw = json["threads"] as? [[String: Any]] ?? []
    threadRows = raw.compactMap { row in
      guard let id = row["id"] as? String, let title = row["title"] as? String, !id.isEmpty else { return nil }
      return RecentThread(id: id, title: title)
    }
    if railSection == 0 { refreshThreadList() }
  }

  private func refreshThreadList() {
    guard let stack = threadListStack else { return }
    stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    if threadRows.isEmpty {
      let empty = NSTextField(wrappingLabelWithString: "还没有对话")
      empty.font = .systemFont(ofSize: 13)
      empty.textColor = SummonerTokens.faint
      empty.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
      stack.addArrangedSubview(empty)
      return
    }
    for row in threadRows.prefix(12) {
      stack.addArrangedSubview(makeThreadRow(row))
    }
  }

  private func makeThreadRow(_ row: RecentThread) -> NSView {
    let wrap = NSStackView()
    wrap.orientation = .horizontal
    wrap.alignment = .centerY
    wrap.spacing = 0
    wrap.translatesAutoresizingMaskIntoConstraints = false
    wrap.widthAnchor.constraint(equalToConstant: 200).isActive = true
    wrap.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    wrap.identifier = NSUserInterfaceItemIdentifier(row.id)
    if row.id == threadId {
      wrap.wantsLayer = true
      wrap.layer?.backgroundColor = SummonerTokens.indigo.withAlphaComponent(0.12).cgColor
      wrap.layer?.cornerRadius = 8
    }

    let btn = NSButton(title: row.title, target: self, action: #selector(threadRowClicked(_:)))
    btn.bezelStyle = .inline
    btn.isBordered = false
    btn.font = .systemFont(ofSize: 13, weight: row.id == threadId ? .medium : .regular)
    btn.alignment = .left
    btn.identifier = NSUserInterfaceItemIdentifier(row.id)
    btn.toolTip = row.title
    btn.contentTintColor = row.id == threadId ? SummonerTokens.indigo : SummonerTokens.text
    btn.keyEquivalent = ""
    btn.sendAction(on: [.leftMouseUp, .rightMouseDown])
    btn.setContentHuggingPriority(.defaultLow, for: .horizontal)
    btn.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    btn.translatesAutoresizingMaskIntoConstraints = false
    btn.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true

    let more = NSButton(title: "⋯", target: self, action: #selector(threadMoreClicked(_:)))
    more.bezelStyle = .inline
    more.isBordered = false
    more.font = .systemFont(ofSize: 14)
    more.toolTip = "对话管理"
    more.identifier = NSUserInterfaceItemIdentifier(row.id)
    more.contentTintColor = SummonerTokens.faint
    more.keyEquivalent = ""
    more.translatesAutoresizingMaskIntoConstraints = false
    more.widthAnchor.constraint(equalToConstant: 28).isActive = true
    more.heightAnchor.constraint(equalToConstant: 44).isActive = true

    wrap.addArrangedSubview(btn)
    wrap.addArrangedSubview(more)
    return wrap
  }

  private func threadTitle(id: String) -> String {
    threadRows.first(where: { $0.id == id })?.title ?? id
  }

  private func popThreadMenu(id: String, view: NSView) {
    guard !id.isEmpty else { return }
    let menu = NSMenu()
    let rename = NSMenuItem(title: "重命名", action: #selector(threadRenameClicked(_:)), keyEquivalent: "")
    rename.target = self
    rename.representedObject = id
    let trash = NSMenuItem(title: "移到回收站", action: #selector(threadTrashClicked(_:)), keyEquivalent: "")
    trash.target = self
    trash.representedObject = id
    menu.addItem(rename)
    menu.addItem(trash)
    menu.popUp(positioning: nil, at: NSPoint(x: view.bounds.maxX - 8, y: 0), in: view)
  }

  private func promptRename(id: String) {
    NSApp.activate(ignoringOtherApps: true)
    window?.makeKeyAndOrderFront(nil)
    let alert = NSAlert()
    alert.messageText = "重命名"
    alert.informativeText = "给这条对话一个名字"
    alert.addButton(withTitle: "重命名")
    alert.addButton(withTitle: "取消")
    let field = NSTextField(string: threadTitle(id: id))
    field.frame = NSRect(x: 0, y: 0, width: 240, height: 24)
    alert.accessoryView = field
    alert.window.initialFirstResponder = field
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    let alias = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !alias.isEmpty else { return }
    jsonLine(["type": "summoner.thread.rename", "thread_id": id, "alias": alias])
  }

  private func promptTrash(id: String) {
    NSApp.activate(ignoringOtherApps: true)
    window?.makeKeyAndOrderFront(nil)
    let alert = NSAlert()
    alert.messageText = "移到回收站"
    alert.informativeText = "「\(threadTitle(id: id))」会离开当前列表。"
    alert.addButton(withTitle: "移到回收站")
    alert.addButton(withTitle: "取消")
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    jsonLine(["type": "summoner.thread.trash", "thread_id": id])
  }

  @objc func threadRowClicked(_ sender: NSButton) {
    let id = sender.identifier?.rawValue ?? ""
    guard !id.isEmpty else { return }
    if NSApp.currentEvent?.type == .rightMouseDown {
      popThreadMenu(id: id, view: sender)
      return
    }
    selectThread(RecentThread(id: id, title: sender.title))
  }

  @objc func threadMoreClicked(_ sender: NSButton) {
    let id = sender.identifier?.rawValue ?? ""
    popThreadMenu(id: id, view: sender)
  }

  @objc func threadRenameClicked(_ sender: NSMenuItem) {
    let id = sender.representedObject as? String ?? ""
    guard !id.isEmpty else { return }
    promptRename(id: id)
  }

  @objc func threadTrashClicked(_ sender: NSMenuItem) {
    let id = sender.representedObject as? String ?? ""
    guard !id.isEmpty else { return }
    promptTrash(id: id)
  }

  @objc func toggleExpandClicked() {
    expanded.toggle()
    applyPhase()
  }

  @objc func railSectionClicked(_ sender: NSButton) {
    railSection = sender.tag
    tintRailButtons()
    refreshCurrentList()
  }

  private func refreshCurrentList() {
    switch railSection {
    case 1:
      listHeadField?.stringValue = "场景"
      refreshPackList()
    case 2:
      listHeadField?.stringValue = "知识"
      refreshKnowledgeList()
    case 3:
      listHeadField?.stringValue = "技能"
      refreshSkillList()
    case 4:
      listHeadField?.stringValue = "MCP"
      refreshMcpList()
    default:
      listHeadField?.stringValue = "对话"
      refreshThreadList()
    }
  }

  private func clearListStack() {
    threadListStack?.arrangedSubviews.forEach { $0.removeFromSuperview() }
  }

  private func addListEmpty(_ text: String) {
    let empty = NSTextField(wrappingLabelWithString: text)
    empty.font = .systemFont(ofSize: 13)
    empty.textColor = SummonerTokens.faint
    empty.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    threadListStack?.addArrangedSubview(empty)
  }

  private func addPlainRow(id: String, title: String, dimmed: Bool, action: Selector) {
    guard let stack = threadListStack else { return }
    let btn = NSButton(title: title, target: self, action: action)
    btn.bezelStyle = .inline
    btn.isBordered = false
    btn.font = .systemFont(ofSize: 13)
    btn.alignment = .left
    btn.identifier = NSUserInterfaceItemIdentifier(id)
    btn.toolTip = title
    btn.contentTintColor = dimmed ? SummonerTokens.faint : SummonerTokens.text
    btn.keyEquivalent = ""
    btn.translatesAutoresizingMaskIntoConstraints = false
    btn.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    stack.addArrangedSubview(btn)
  }

  private func refreshPackList() {
    clearListStack()
    let rows = packRows.filter { ($0["id"] as? String)?.isEmpty == false }
    if rows.isEmpty {
      addListEmpty("还没有场景包")
      return
    }
    for row in rows.prefix(12) {
      let id = row["id"] as? String ?? ""
      let name = row["name"] as? String ?? id
      let ok = row["overlay_eligible"] as? Bool ?? false
      addPlainRow(id: id, title: ok ? name : "\(name) · 不可套", dimmed: !ok, action: #selector(packRowClicked(_:)))
    }
  }

  private func refreshMcpList() {
    clearListStack()
    addPlainRow(id: "__add__", title: "＋ 添加 MCP", dimmed: false, action: #selector(mcpAddClicked(_:)))
    if mcpRows.isEmpty {
      addListEmpty("还没有 MCP 服务器")
      return
    }
    for row in mcpRows.prefix(12) {
      let name = row["name"] as? String ?? ""
      let enabled = row["enabled"] as? Bool ?? false
      addPlainRow(
        id: name,
        title: enabled ? "● \(name)" : "○ \(name)",
        dimmed: !enabled,
        action: #selector(mcpRowClicked(_:)),
      )
    }
  }

  private func refreshSkillList() {
    clearListStack()
    if skillRows.isEmpty {
      addListEmpty("还没有技能")
      return
    }
    for row in skillRows.prefix(12) {
      let name = row["name"] as? String ?? ""
      let title = row["title"] as? String ?? name
      let on = row["on"] as? Bool ?? false
      addPlainRow(
        id: name,
        title: on ? "● \(title)" : title,
        dimmed: false,
        action: #selector(skillRowClicked(_:)),
      )
    }
  }

  private func refreshKnowledgeList() {
    clearListStack()
    addPlainRow(id: "__import__", title: "＋ 导入知识", dimmed: false, action: #selector(knowledgeImportClicked(_:)))
    if knowledgeRows.isEmpty {
      addListEmpty("还没有知识文档")
      return
    }
    for row in knowledgeRows.prefix(12) {
      let id = row["id"] as? String ?? ""
      let title = row["title"] as? String ?? id
      let attached = row["attached"] as? Bool ?? false
      addPlainRow(
        id: id,
        title: attached ? "● \(title)" : title,
        dimmed: false,
        action: #selector(knowledgeRowClicked(_:)),
      )
    }
  }

  private func tintRailButtons() {
    guard let wb = workbenchBox as? NSStackView, let rail = wb.arrangedSubviews.first as? NSStackView else { return }
    for (i, view) in rail.arrangedSubviews.enumerated() {
      (view as? NSButton)?.contentTintColor = i == railSection ? SummonerTokens.indigo : SummonerTokens.secondary
    }
  }

  func applyPacks(_ json: [String: Any]) {
    packRows = json["packs"] as? [[String: Any]] ?? []
    if railSection == 1 { refreshPackList() }
  }

  @objc func packRowClicked(_ sender: NSButton) {
    let id = sender.identifier?.rawValue ?? ""
    guard !id.isEmpty else { return }
    let eligible = packRows.contains { ($0["id"] as? String) == id && ($0["overlay_eligible"] as? Bool) == true }
    if !eligible {
      applyError(message: "这个场景不能在召唤器套用", errorCode: "pack_not_overlay_eligible")
      return
    }
    jsonLine(["type": "summoner.pack.apply", "pack_id": id])
  }

  @objc func mcpRowClicked(_ sender: NSButton) {
    let name = sender.identifier?.rawValue ?? ""
    guard !name.isEmpty, name != "__add__" else { return }
    let enabled = mcpRows.first { ($0["name"] as? String) == name }.flatMap { $0["enabled"] as? Bool } ?? false
    jsonLine(["type": "summoner.mcp.toggle", "name": name, "enabled": !enabled])
  }

  @objc func mcpAddClicked(_ sender: NSButton) {
    NSApp.activate(ignoringOtherApps: true)
    window?.makeKeyAndOrderFront(nil)
    let alert = NSAlert()
    alert.messageText = "添加 MCP"
    alert.informativeText = "名字和启动命令（stdio）"
    alert.addButton(withTitle: "添加")
    alert.addButton(withTitle: "取消")
    let box = NSStackView()
    box.orientation = .vertical
    box.spacing = 6
    box.frame = NSRect(x: 0, y: 0, width: 260, height: 56)
    let nameField = NSTextField(string: "")
    nameField.placeholderString = "名字"
    let cmdField = NSTextField(string: "")
    cmdField.placeholderString = "命令"
    box.addArrangedSubview(nameField)
    box.addArrangedSubview(cmdField)
    alert.accessoryView = box
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    let name = nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    let command = cmdField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty, !command.isEmpty else { return }
    jsonLine(["type": "summoner.mcp.add", "name": name, "command": command])
  }

  @objc func skillRowClicked(_ sender: NSButton) {
    let name = sender.identifier?.rawValue ?? ""
    guard !name.isEmpty else { return }
    let on = skillRows.first { ($0["name"] as? String) == name }.flatMap { $0["on"] as? Bool } ?? false
    jsonLine(["type": "summoner.skill.toggle", "name": name, "on": !on])
  }

  @objc func knowledgeRowClicked(_ sender: NSButton) {
    let id = sender.identifier?.rawValue ?? ""
    guard !id.isEmpty, id != "__import__" else { return }
    jsonLine(["type": "summoner.knowledge.attach", "id": id])
  }

  @objc func knowledgeImportClicked(_ sender: NSButton) {
    NSApp.activate(ignoringOtherApps: true)
    window?.makeKeyAndOrderFront(nil)
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = false
    panel.canChooseDirectories = false
    panel.canChooseFiles = true
    guard panel.runModal() == .OK, let url = panel.url else { return }
    let alert = NSAlert()
    alert.messageText = "导入知识"
    alert.informativeText = "把「\(url.lastPathComponent)」加进知识库。"
    alert.addButton(withTitle: "导入")
    alert.addButton(withTitle: "取消")
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    guard let data = try? Data(contentsOf: url), data.count <= summonerFileMaxBytes else {
      applyError(message: "文件太大或无法读取（不超过 6MB）", errorCode: "upload_failed")
      return
    }
    jsonLine([
      "type": "summoner.knowledge.import",
      "name": url.lastPathComponent,
      "mime": mimeTypeForAttach(url: url),
      "content": String(data: data, encoding: .utf8) ?? data.base64EncodedString(),
    ])
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
      let enqueue = NSEvent.modifierFlags.contains(.shift)
      submitComposer(enqueue: enqueue)
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

  private func submitComposer(enqueue: Bool = false) {
    let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    if composer?.hasMarkedText() == true { return }
    if !enqueue {
      lines.append("你: \(text)")
      capLines()
      refreshLog()
    }
    composer?.string = ""
    updatePlaceholder()
    var payload: [String: Any] = ["type": "summoner.submit", "thread_id": threadId, "text": text]
    if enqueue { payload["enqueue"] = true }
    jsonLine(payload)
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
      NSApp.activate(ignoringOtherApps: true)
      window?.makeKeyAndOrderFront(nil)
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

  @objc func attachFilesClicked() {
    NSApp.activate(ignoringOtherApps: true)
    window?.makeKeyAndOrderFront(nil)
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = true
    panel.canChooseDirectories = false
    panel.canChooseFiles = true
    // runModal: begin() on a non-key/borderless HUD is often silent.
    guard panel.runModal() == .OK else { return }
    var files: [[String: String]] = []
    var skipped = false
    for url in panel.urls.prefix(8) {
      guard let data = try? Data(contentsOf: url) else {
        skipped = true
        continue
      }
      if data.count > summonerFileMaxBytes {
        skipped = true
        continue
      }
      files.append([
        "name": url.lastPathComponent,
        "type": mimeTypeForAttach(url: url),
        "content": data.base64EncodedString(),
      ])
    }
    if panel.urls.count > 8 { skipped = true }
    guard !files.isEmpty else {
      applyError(message: "附件太大或无法读取（单文件不超过 6MB）", errorCode: "upload_failed")
      return
    }
    if skipped {
      applyError(message: "部分附件已跳过（单文件不超过 6MB，最多 8 个）", errorCode: "upload_failed")
    }
    jsonLine(["type": "summoner.files", "thread_id": threadId, "files": files])
    let names = files.compactMap { $0["name"] }.joined(separator: "、")
    lines.append("你: 📎 \(names)")
    capLines()
    applyPhase()
  }

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
    logBox?.isHidden = expanded ? false : lines.isEmpty
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
    if expanded {
      logHeightConstraint?.constant = summonerWorkbenchHeight
      return
    }
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

  private func chatParagraphStyle() -> NSParagraphStyle {
    let p = NSMutableParagraphStyle()
    p.lineBreakMode = .byWordWrapping
    p.lineSpacing = 2
    p.paragraphSpacing = 6
    return p
  }

  private func plainAttrs(_ text: String, color: NSColor = SummonerTokens.text) -> NSAttributedString {
    let font = NSFont.systemFont(ofSize: 13)
    return NSAttributedString(string: text, attributes: [
      .font: font,
      .foregroundColor: color,
      .paragraphStyle: chatParagraphStyle(),
    ])
  }

  private func attributedLine(_ line: String) -> NSAttributedString {
    let font = NSFont.systemFont(ofSize: 13)
    if line.hasPrefix("系统") || line.hasPrefix("[工具]") {
      return plainAttrs(line, color: SummonerTokens.secondary)
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
      .paragraphStyle: chatParagraphStyle(),
    ])
    // Foundation CommonMark turns a single \n into a space. Parse each visual
    // line as inline markdown so chat breaks stay visible.
    let chunks = body.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    let opts = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
    for (i, chunk) in chunks.enumerated() {
      if i > 0 {
        out.append(plainAttrs("\n"))
      }
      if let parsed = try? AttributedString(markdown: chunk, options: opts) {
        let md = NSMutableAttributedString(parsed)
        if md.length > 0 {
          md.addAttributes([
            .foregroundColor: SummonerTokens.text,
            .paragraphStyle: chatParagraphStyle(),
          ], range: NSRange(location: 0, length: md.length))
        }
        out.append(md)
      } else {
        out.append(plainAttrs(chunk))
      }
    }
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

    hintField?.stringValue = searching
      ? "只搜标题，不搜正文"
      : (expanded ? summonerExpandHint : summonerTalkHint)

    if searching {
      refreshHits()
    } else {
      hits = []
      hitsStack?.isHidden = true
    }
    workbenchBox?.isHidden = !expanded || searching
    logBox?.isHidden = false
    refreshLog()
    if railSection == 0 {
      listHeadField?.stringValue = "对话"
      refreshThreadList()
    }
    ctaBox?.isHidden = true
    attachButton?.isHidden = true
    silentAttachButton?.isHidden = true
    sendButton?.isHidden = true
    continueButton?.isHidden = true
    footRow?.isHidden = true
    lastThreadField?.isHidden = true
    if detached {
      sideNote?.stringValue = summonerDetachedInfo
      sideNote?.isHidden = searching || expanded
    } else {
      sideNote?.isHidden = true
    }
    expandButton?.toolTip = expanded ? "收起工作台" : "展开工作台"
    expandButton?.title = expanded ? "⌃" : "⌄"
    micButton?.isHidden = searching
    clipButton?.isHidden = searching
    plusButton?.isHidden = searching
    expandButton?.isHidden = searching
    updateLastThreadLabel()
    updatePlaceholder()
    relayout()
  }

  private func relayout() {
    guard let window = window else { return }
    var h: CGFloat = 72
    if pickerBox?.isHidden == false { h += 310 }
    if settingsBox?.isHidden == false { h += 118 }
    if expanded && (workbenchBox?.isHidden == false) { h += summonerWorkbenchHeight }
    if lastThreadField?.isHidden == false { h += 18 }
    if hitsStack?.isHidden == false { h += 8 + CGFloat(min(hits.count, 6)) * 36 }
    if ctaBox?.isHidden == false { h += 36 }
    if footRow?.isHidden == false { h += 48 }
    if sideNote?.isHidden == false { h += 22 }
    window.setContentSize(NSSize(width: summonerHudWidth, height: max(72, h)))
    if isOpen { emitCompanionUiRect("overlay", window: window) }
  }

  private func makeWindow() -> NSPanel? {
    let contentRect = NSRect(x: 0, y: 0, width: summonerHudWidth, height: 72)
    let style: NSWindow.StyleMask = [.borderless, .fullSizeContentView, .nonactivatingPanel]
    let panel = SummonerPanel(contentRect: contentRect, styleMask: style, backing: .buffered, defer: false)
    panel.title = summonerWindowTitle
    panel.titleVisibility = .hidden
    panel.titlebarAppearsTransparent = true
    panel.isMovableByWindowBackground = true
    panel.isReleasedWhenClosed = false
    panel.becomesKeyOnlyIfNeeded = false
    panel.hidesOnDeactivate = false
    panel.hasShadow = true
    panel.isOpaque = true
    panel.level = .floating
    panel.minSize = NSSize(width: summonerHudWidth, height: 72)
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

    let pickerBox = NSView()
    pickerBox.translatesAutoresizingMaskIntoConstraints = false
    pickerBox.wantsLayer = true
    pickerBox.layer?.backgroundColor = SummonerTokens.indigoSoft.cgColor
    pickerBox.layer?.cornerRadius = 12
    pickerBox.widthAnchor.constraint(equalToConstant: summonerHudInnerWidth).isActive = true
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
    settingsBox.widthAnchor.constraint(equalToConstant: summonerHudInnerWidth).isActive = true
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

    let workbench = NSStackView()
    workbench.orientation = .horizontal
    workbench.alignment = .top
    workbench.spacing = 0
    workbench.translatesAutoresizingMaskIntoConstraints = false
    workbench.widthAnchor.constraint(equalToConstant: summonerHudInnerWidth).isActive = true
    let wbH = workbench.heightAnchor.constraint(equalToConstant: summonerWorkbenchHeight)
    wbH.isActive = true
    workbenchHeightConstraint = wbH
    workbench.isHidden = true
    workbenchBox = workbench
    stack.addArrangedSubview(workbench)

    let fieldBox = NSView()
    fieldBox.translatesAutoresizingMaskIntoConstraints = false
    fieldBox.wantsLayer = true
    fieldBox.layer?.backgroundColor = SummonerTokens.muted.cgColor
    fieldBox.layer?.cornerRadius = 16
    fieldBox.layer?.borderWidth = 1
    fieldBox.layer?.borderColor = NSColor(white: 0.09, alpha: 0.10).cgColor
    fieldBox.heightAnchor.constraint(equalToConstant: 48).isActive = true
    fieldBox.widthAnchor.constraint(equalToConstant: summonerHudInnerWidth).isActive = true
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

    let plus = NSButton(title: "+", target: self, action: #selector(newThreadClicked))
    plus.bezelStyle = .inline
    plus.isBordered = false
    plus.font = .systemFont(ofSize: 16, weight: .medium)
    plus.toolTip = "新对话"
    plus.keyEquivalent = ""
    plus.translatesAutoresizingMaskIntoConstraints = false
    plus.contentTintColor = SummonerTokens.secondary
    plusButton = plus
    fieldBox.addSubview(plus)

    let mic = NSButton(title: "🎙", target: self, action: #selector(micHoldChanged(_:)))
    mic.bezelStyle = .inline
    mic.isBordered = false
    mic.font = .systemFont(ofSize: 14)
    mic.toolTip = "按住听写"
    mic.keyEquivalent = ""
    mic.sendAction(on: [.leftMouseDown, .leftMouseUp])
    mic.translatesAutoresizingMaskIntoConstraints = false
    micButton = mic
    fieldBox.addSubview(mic)

    let clip = NSButton(title: "📎", target: self, action: #selector(attachFilesClicked))
    clip.bezelStyle = .inline
    clip.isBordered = false
    clip.font = .systemFont(ofSize: 14)
    clip.toolTip = "添加附件"
    clip.keyEquivalent = ""
    clip.translatesAutoresizingMaskIntoConstraints = false
    clipButton = clip
    fieldBox.addSubview(clip)

    let expand = NSButton(title: "⌄", target: self, action: #selector(toggleExpandClicked))
    expand.bezelStyle = .inline
    expand.isBordered = false
    expand.font = .systemFont(ofSize: 14)
    expand.toolTip = "展开工作台"
    expand.keyEquivalent = ""
    expand.translatesAutoresizingMaskIntoConstraints = false
    expandButton = expand
    fieldBox.addSubview(expand)

    NSLayoutConstraint.activate([
      plus.leadingAnchor.constraint(equalTo: fieldBox.leadingAnchor, constant: 6),
      plus.centerYAnchor.constraint(equalTo: fieldBox.centerYAnchor),
      plus.widthAnchor.constraint(equalToConstant: 44),
      plus.heightAnchor.constraint(equalToConstant: 44),
      expand.trailingAnchor.constraint(equalTo: fieldBox.trailingAnchor, constant: -6),
      expand.centerYAnchor.constraint(equalTo: fieldBox.centerYAnchor),
      expand.widthAnchor.constraint(equalToConstant: 44),
      expand.heightAnchor.constraint(equalToConstant: 44),
      mic.trailingAnchor.constraint(equalTo: expand.leadingAnchor, constant: -2),
      mic.centerYAnchor.constraint(equalTo: fieldBox.centerYAnchor),
      mic.widthAnchor.constraint(equalToConstant: 44),
      mic.heightAnchor.constraint(equalToConstant: 44),
      clip.trailingAnchor.constraint(equalTo: mic.leadingAnchor, constant: -2),
      clip.centerYAnchor.constraint(equalTo: fieldBox.centerYAnchor),
      clip.widthAnchor.constraint(equalToConstant: 44),
      clip.heightAnchor.constraint(equalToConstant: 44),
      scroll.leadingAnchor.constraint(equalTo: plus.trailingAnchor, constant: 4),
      scroll.trailingAnchor.constraint(equalTo: clip.leadingAnchor, constant: -6),
      scroll.topAnchor.constraint(equalTo: fieldBox.topAnchor, constant: 6),
      scroll.bottomAnchor.constraint(equalTo: fieldBox.bottomAnchor, constant: -6),
      placeholder.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
      placeholder.centerYAnchor.constraint(equalTo: fieldBox.centerYAnchor),
    ])

    let hint = NSTextField(labelWithString: summonerTalkHint)
    hint.font = .systemFont(ofSize: 11)
    hint.textColor = SummonerTokens.faint
    hint.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    hintField = hint

    let lastThread = NSTextField(labelWithString: "")
    lastThread.font = .systemFont(ofSize: 12, weight: .medium)
    lastThread.textColor = SummonerTokens.secondary
    lastThread.isHidden = true
    lastThreadField = lastThread
    stack.addArrangedSubview(lastThread)

    let hits = NSStackView()
    hits.orientation = .vertical
    hits.alignment = .leading
    hits.spacing = 4
    hits.translatesAutoresizingMaskIntoConstraints = false
    hits.widthAnchor.constraint(equalToConstant: summonerHudInnerWidth).isActive = true
    hits.isHidden = true
    hitsStack = hits
    stack.addArrangedSubview(hits)
    stack.addArrangedSubview(fieldBox)
    stack.addArrangedSubview(hint)

    let logBox = NSView()
    logBox.translatesAutoresizingMaskIntoConstraints = false
    logBox.wantsLayer = true
    logBox.layer?.backgroundColor = SummonerTokens.paper.cgColor
    logBox.layer?.cornerRadius = 0
    let logH = logBox.heightAnchor.constraint(equalToConstant: summonerWorkbenchHeight)
    logH.isActive = true
    logHeightConstraint = logH
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
    logView.isHorizontallyResizable = false
    logView.textContainer?.widthTracksTextView = true
    logView.textContainer?.lineBreakMode = .byWordWrapping
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

    let railCol = NSStackView()
    railCol.orientation = .vertical
    railCol.alignment = .centerX
    railCol.spacing = 4
    railCol.edgeInsets = NSEdgeInsets(top: 10, left: 4, bottom: 10, right: 4)
    railCol.translatesAutoresizingMaskIntoConstraints = false
    railCol.widthAnchor.constraint(equalToConstant: 52).isActive = true
    railCol.wantsLayer = true
    railCol.layer?.backgroundColor = SummonerTokens.muted.cgColor
    let railSpecs: [(String, String, Int)] = [
      ("text.alignleft", "对话", 0),
      ("square.grid.2x2", "场景", 1),
      ("book", "知识", 2),
      ("chevron.left.forwardslash.chevron.right", "技能", 3),
      ("app.connected.to.app.below.fill", "MCP", 4),
    ]
    for spec in railSpecs {
      let img = NSImage(systemSymbolName: spec.0, accessibilityDescription: spec.1)
      let btn = NSButton(image: img ?? NSImage(), target: self, action: #selector(railSectionClicked(_:)))
      btn.bezelStyle = .regularSquare
      btn.isBordered = false
      btn.imagePosition = .imageOnly
      btn.toolTip = spec.1
      btn.tag = spec.2
      btn.keyEquivalent = ""
      btn.contentTintColor = spec.2 == 0 ? SummonerTokens.indigo : SummonerTokens.secondary
      btn.translatesAutoresizingMaskIntoConstraints = false
      btn.widthAnchor.constraint(equalToConstant: 44).isActive = true
      btn.heightAnchor.constraint(equalToConstant: 44).isActive = true
      railCol.addArrangedSubview(btn)
    }
    let listCol = NSStackView()
    listCol.orientation = .vertical
    listCol.alignment = .leading
    listCol.spacing = 4
    listCol.edgeInsets = NSEdgeInsets(top: 8, left: 8, bottom: 8, right: 8)
    listCol.translatesAutoresizingMaskIntoConstraints = false
    listCol.widthAnchor.constraint(equalToConstant: 216).isActive = true
    let listHead = NSTextField(labelWithString: "对话")
    listHead.font = .systemFont(ofSize: 11, weight: .semibold)
    listHead.textColor = SummonerTokens.faint
    listHeadField = listHead
    listCol.addArrangedSubview(listHead)
    let tStack = NSStackView()
    tStack.orientation = .vertical
    tStack.alignment = .leading
    tStack.spacing = 2
    tStack.translatesAutoresizingMaskIntoConstraints = false
    tStack.widthAnchor.constraint(equalToConstant: 200).isActive = true
    threadListStack = tStack
    listCol.addArrangedSubview(tStack)
    logBox.setContentHuggingPriority(.defaultLow, for: .horizontal)
    logBox.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    workbench.addArrangedSubview(railCol)
    workbench.addArrangedSubview(listCol)
    workbench.addArrangedSubview(logBox)

    let ctaBox = NSView()
    ctaBox.translatesAutoresizingMaskIntoConstraints = false
    ctaBox.wantsLayer = true
    ctaBox.layer?.backgroundColor = SummonerTokens.warnBg.cgColor
    ctaBox.layer?.borderColor = SummonerTokens.warnBorder.cgColor
    ctaBox.layer?.borderWidth = 1
    ctaBox.layer?.cornerRadius = 12
    ctaBox.widthAnchor.constraint(equalToConstant: summonerHudInnerWidth).isActive = true
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
    foot.widthAnchor.constraint(equalToConstant: summonerHudInnerWidth).isActive = true
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
    side.widthAnchor.constraint(equalToConstant: summonerHudInnerWidth).isActive = true
    stack.addArrangedSubview(side)

    guard let cv = panel.contentView else { return panel }
    cv.wantsLayer = true
    cv.layer?.cornerRadius = 16
    cv.layer?.masksToBounds = true
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

