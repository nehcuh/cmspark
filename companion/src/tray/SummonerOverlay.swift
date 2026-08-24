// Summoner overlay — extracted from Tray.swift (god-file nit).
// Same swiftc module as Tray.swift (jsonLine, emitCompanionUiRect, RecentThread).

import AppKit
import Foundation
import AVFoundation

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

