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

  // ⌘1-9 快选 / ⌘↵ 在面板打开（spec §5c）走 key-equivalent 层——composer 的
  // doCommandBy 收不到带 ⌘ 的组合键。
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    if summonerController.handleKeyEquivalent(event) { return true }
    return super.performKeyEquivalent(with: event)
  }
}

// Manual mirror of chrome-extension/src/sidepanel/ui/tokens.ts (#396) — keep the
// mapping comments in lock-step when either side changes. Never Material
// #4CAF50/#FF9800/#F44336 (tokens.ts connectionColor ban).
enum SummonerTokens {
  static let paper = NSColor.white                                    // tokens.bg #ffffff
  static let muted = NSColor(calibratedRed: 244/255, green: 244/255, blue: 245/255, alpha: 1)      // tokens.bgMuted #f4f4f5
  static let text = NSColor(calibratedRed: 23/255, green: 23/255, blue: 23/255, alpha: 1)          // tokens.text #171717
  static let secondary = NSColor(calibratedRed: 115/255, green: 115/255, blue: 115/255, alpha: 1) // tokens.textSecondary #737373
  static let faint = NSColor(calibratedRed: 163/255, green: 163/255, blue: 163/255, alpha: 1)      // tokens.textMuted #a3a3a3
  static let border = NSColor(calibratedRed: 23/255, green: 23/255, blue: 23/255, alpha: 0.10)     // tokens.border
  static let borderStrong = NSColor(calibratedRed: 23/255, green: 23/255, blue: 23/255, alpha: 0.14) // tokens.borderStrong
  static let indigo = NSColor(calibratedRed: 79/255, green: 70/255, blue: 229/255, alpha: 1)       // tokens.accent #4f46e5
  static let indigoSoft = NSColor(calibratedRed: 238/255, green: 242/255, blue: 255/255, alpha: 1) // tokens.accentSoft #eef2ff
  static let okBg = NSColor(calibratedRed: 236/255, green: 253/255, blue: 245/255, alpha: 1)       // tokens.successSoft #ecfdf5
  static let okFg = NSColor(calibratedRed: 4/255, green: 120/255, blue: 87/255, alpha: 1)          // HUD pick: emerald-700 ink on successSoft (no tokens.ts pair)
  static let okBorder = NSColor(calibratedRed: 167/255, green: 243/255, blue: 208/255, alpha: 1)   // emerald-200 hairline on okBg
  static let success = NSColor(calibratedRed: 5/255, green: 150/255, blue: 105/255, alpha: 1)      // tokens.success #059669 — primary button fill
  static let warning = NSColor(calibratedRed: 217/255, green: 119/255, blue: 6/255, alpha: 1)      // tokens.warning #d97706 — riskColor low/medium
  static let warnBg = NSColor(calibratedRed: 255/255, green: 251/255, blue: 235/255, alpha: 1)     // tokens.warningSoft #fffbeb
  static let warnFg = NSColor(calibratedRed: 146/255, green: 64/255, blue: 14/255, alpha: 1)       // tokens.warningText #92400e
  static let warnBorder = NSColor(calibratedRed: 253/255, green: 230/255, blue: 138/255, alpha: 1) // tokens.warningBorder #fde68a
  static let danger = NSColor(calibratedRed: 220/255, green: 38/255, blue: 38/255, alpha: 1)       // tokens.danger #dc2626 — riskColor high+
  static let dangerBg = NSColor(calibratedRed: 254/255, green: 242/255, blue: 242/255, alpha: 1)    // tokens.dangerSoft #fef2f2
  static let dangerBorder = NSColor(calibratedRed: 220/255, green: 38/255, blue: 38/255, alpha: 0.28) // tokens.dangerBorder

  // Type scale — "Chrome stays 11 / 12 / 13 / 15" (tokens.ts header canon);
  // no per-surface 13/11 roulette.
  static let fontTitle: CGFloat = 15   // titles / tool names
  static let fontBody: CGFloat = 13    // body copy / summaries
  static let fontCaption: CGFloat = 11 // captions / meta / countdown

  static let radiusSm: CGFloat = 6     // tokens.radiusSm — chips & buttons

  // #433 P0 palette type ramp (spec §5a): 行主文 14/500 · 次文 12/400·60%。
  // 60% 不透明落在既有 faint token（#a3a3a3 ≈ text 64% on paper）——同族不新造色。
  static let rowTitleFont = NSFont.systemFont(ofSize: 14, weight: .medium)
  static let rowMetaFont = NSFont.systemFont(ofSize: 12, weight: .regular)
  static let sectionFont = NSFont.systemFont(ofSize: 12, weight: .semibold)
}

// ---------------------------------------------------------------------------
// #433 P0 command palette — three-tier result model (spec §2):
//   1. verbs (frecency)  2. threads + knowledge hits  3. fallback (问 AI / 在面板打开)
// Swift-side matching only (word-startswith / contains / pinyin initials);
// the wire stays exactly the existing stdin `summoner.*` family.
// ---------------------------------------------------------------------------

struct SummonerSearchHit {
  let id: String
  let title: String
  let snippet: String
  let score: Double
}

struct PaletteRow {
  enum Kind {
    case sectionHeader
    case verb
    case thread
    case knowledge
    case fallbackChat
    case fallbackPanel
    case peekPreview
    case citeThread
  }

  let kind: Kind
  let id: String
  let title: String
  let subtitle: String?
  let symbol: String
  let enabled: Bool
  let snippet: String?

  var selectable: Bool { kind != .sectionHeader && kind != .peekPreview }

  init(kind: Kind, id: String, title: String, subtitle: String?, symbol: String, enabled: Bool, snippet: String? = nil) {
    self.kind = kind
    self.id = id
    self.title = title
    self.subtitle = subtitle
    self.symbol = symbol
    self.enabled = enabled
    self.snippet = snippet
  }
}

/// frequency × recency 衰减（spec §5c）。score = count · e^(−Δh/72)。
final class SummonerFrecency {
  private struct Entry {
    var count: Int = 0
    var last: TimeInterval = 0
  }

  private var entries: [String: Entry] = [:]
  private let defaultsKey = "summoner.frecency.v1"

  init() {
    if let raw = UserDefaults.standard.dictionary(forKey: defaultsKey) {
      for (id, value) in raw {
        if let dict = value as? [String: Any],
           let count = dict["c"] as? Int,
           let last = dict["t"] as? Double {
          entries[id] = Entry(count: count, last: last)
        }
      }
    }
  }

  func touch(_ id: String) {
    guard !id.isEmpty else { return }
    var e = entries[id] ?? Entry()
    e.count += 1
    e.last = Date().timeIntervalSince1970
    entries[id] = e
    persist()
  }

  func score(_ id: String) -> Double {
    guard let e = entries[id] else { return 0 }
    let ageHours = max(0, Date().timeIntervalSince1970 - e.last) / 3600
    return Double(e.count) * exp(-ageHours / 72)
  }

  /// Ranked ids, best first. `order` is the recency fallback order (index 0 newest).
  func ranked(ids: [String]) -> [String] {
    ids.enumerated().map { (idx, id) -> (String, Double, Int) in
      let s = score(id)
      return (id, s, idx)
    }
    .sorted { a, b in
      if a.1 != b.1 { return a.1 > b.1 }
      return a.2 < b.2
    }
    .map { $0.0 }
  }

  private func persist() {
    let raw: [String: [String: Any]] = Dictionary(uniqueKeysWithValues: entries.map { id, e in
      (id, ["c": e.count, "t": e.last] as [String: Any])
    })
    UserDefaults.standard.set(raw, forKey: defaultsKey)
  }
}

/// Pinyin initial index for CJK titles/aliases (spec §5c：拼音首字母仅 alias/title)。
/// CFStringTransform(kCFStringTransformMandarinLatin + StripDiacritics) is offline.
enum PinyinInitials {
  private static var cache: [String: String] = [:]

  static func initials(for text: String) -> String {
    if let hit = cache[text] { return hit }
    let mutable = NSMutableString(string: text)
    CFStringTransform(mutable, nil, kCFStringTransformMandarinLatin, false)
    CFStringTransform(mutable, nil, kCFStringTransformStripDiacritics, false)
    let latin = mutable as String
    var out = ""
    for word in latin.split(whereSeparator: { $0.isWhitespace || $0.isNewline }) {
      if let first = word.first { out.append(first.lowercased()) }
    }
    let value = out
    if cache.count > 512 { cache.removeAll(keepingCapacity: true) }
    cache[text] = value
    return value
  }
}

/// word-startswith 加权（词首 1.0 / 包含 0.5）+ 拼音首字母（1.0）。
struct PaletteMatcher {
  /// 0 = no match. `pinyin` is the precomputed initials of the haystack.
  static func score(query: String, fields: [String], pinyins: [String]) -> Double {
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !q.isEmpty else { return 0 }
    var best: Double = 0
    for field in fields {
      let f = field.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
      // CJK 字符是 isLetter——连写标题成为单 token，hasPrefix 即词首语义。
      let tokens = f.split(whereSeparator: { $0.isWhitespace || (!$0.isLetter && !$0.isNumber) }).map(String.init)
      for (ti, token) in tokens.enumerated() {
        if token.lowercased().hasPrefix(q) {
          // 词首命中；首词再加成（标题开头权重最高）。
          best = max(best, ti == 0 ? 1.0 : 0.9)
        } else if token.lowercased().contains(q) {
          best = max(best, 0.5)
        }
      }
    }
    for py in pinyins {
      if py.hasPrefix(q) { best = max(best, 1.0) }
    }
    return best
  }
}

/// NSTableView-backed palette list (spec §5e-4: NSStackView → NSTableView 行复用).
/// Selection is drawn by the row view (accentSoft fill + 2px leading accent bar,
/// spec §5a) — the table's own highlight is off.
final class PaletteTableController: NSObject, NSTableViewDataSource, NSTableViewDelegate {
  let scrollView: NSScrollView
  let tableView: NSTableView
  private(set) var rows: [PaletteRow] = []
  private(set) var selected: Int = -1
  var onActivate: ((PaletteRow) -> Void)?
  var onSelectionChange: ((PaletteRow?) -> Void)?

  private let headerIdentifier = NSUserInterfaceItemIdentifier("pal.header")
  private let rowIdentifier = NSUserInterfaceItemIdentifier("pal.row")

  override init() {
    let table = NSTableView()
    let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("pal"))
    column.resizingMask = .autoresizingMask
    table.addTableColumn(column)
    table.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle
    table.headerView = nil
    // 行距 6 用行内 inset 实现（rowHeight 44 = 38 卡片 + 上下 3）——
    // interrowSpacing 是 11+ API，本仓 swiftc 无 deployment target（默认 10.13）。
    table.rowHeight = summonerRowPitch
    table.backgroundColor = .clear
    table.usesAlternatingRowBackgroundColors = false
    table.selectionHighlightStyle = .none
    table.floatsGroupRows = false

    let scroll = NSScrollView()
    scroll.translatesAutoresizingMaskIntoConstraints = false
    scroll.hasVerticalScroller = true
    scroll.hasHorizontalScroller = false
    scroll.autohidesScrollers = true
    scroll.borderType = .noBorder
    scroll.drawsBackground = false
    scroll.documentView = table
    scroll.contentView.automaticallyAdjustsContentInsets = false
    scroll.contentView.contentInsets = NSEdgeInsets(top: 2, left: 0, bottom: 2, right: 0)

    self.tableView = table
    self.scrollView = scroll
    super.init()
    table.dataSource = self
    table.delegate = self
  }

  // MARK: data

  func update(rows next: [PaletteRow], keepingSelectionOf previousId: String?) {
    rows = next
    var idx = -1
    if let prev = previousId, prev.isEmpty == false {
      idx = rows.firstIndex { $0.selectable && $0.enabled && $0.id == prev } ?? -1
    }
    if idx < 0 {
      idx = rows.firstIndex { $0.selectable && $0.enabled } ?? -1
    }
    selected = idx
    tableView.reloadData()
    if idx >= 0 { tableView.scrollRowToVisible(idx) }
  }

  var selectedRow: PaletteRow? {
    guard selected >= 0, selected < rows.count else { return nil }
    return rows[selected]
  }

  func move(_ delta: Int) {
    guard !rows.isEmpty else { return }
    var idx = selected
    while idx >= 0, idx < rows.count {
      idx += delta
      if idx < 0 || idx >= rows.count { return }
      if rows[idx].selectable, rows[idx].enabled { break }
    }
    guard idx >= 0, idx < rows.count else { return }
    selected = idx
    reconfigureVisibleRows()
    tableView.scrollRowToVisible(idx)
    onSelectionChange?(rows[idx])
  }

  /// ⌘1-9 快选：第 n 个可选行。
  func activateQuickPick(_ n: Int) -> Bool {
    var seen = 0
    for (i, row) in rows.enumerated() where row.selectable && row.enabled {
      seen += 1
      if seen == n {
        selected = i
        reconfigureVisibleRows()
        onActivate?(row)
        return true
      }
    }
    return false
  }

  func activate() -> PaletteRow? {
    guard let row = selectedRow, row.selectable, row.enabled else { return nil }
    onActivate?(row)
    return row
  }

  func activateRow(at index: Int) {
    guard index >= 0, index < rows.count else { return }
    let row = rows[index]
    guard row.selectable, row.enabled else { return }
    selected = index
    reconfigureVisibleRows()
    onActivate?(row)
  }

  private func reconfigureVisibleRows() {
    tableView.reloadData()
    if selected >= 0 { tableView.scrollRowToVisible(selected) }
  }

  /// 列表自然高度（行 44 含 6 间距 + 头 24），供外层决定窗口高度；8 可见行封顶由外层做。
  func contentHeight() -> CGFloat {
    guard !rows.isEmpty else { return 0 }
    var total: CGFloat = 0
    for row in rows {
      if row.kind == .sectionHeader { total += 24 }
      else if row.kind == .peekPreview { total += 120 }
      else { total += summonerRowPitch }
    }
    return total
  }

  // MARK: NSTableViewDataSource

  func numberOfRows(in tableView: NSTableView) -> Int { rows.count }

  // MARK: NSTableViewDelegate

  func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
    if rows[row].kind == .sectionHeader { return 24 }
    if rows[row].kind == .peekPreview { return 120 }
    return summonerRowPitch
  }

  func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
    let item = rows[row]
    if item.kind == .sectionHeader {
      let view = tableView.makeView(withIdentifier: headerIdentifier, owner: self) as? NSTextField
        ?? makeHeaderField()
      view.identifier = headerIdentifier
      view.stringValue = item.title
      return view
    }
    let view = tableView.makeView(withIdentifier: rowIdentifier, owner: self) as? PaletteRowView
      ?? PaletteRowView()
    view.identifier = rowIdentifier
    view.configure(row: item, selected: row == selected) { [weak self] in
      self?.activateRow(at: row)
    }
    return view
  }

  private func makeHeaderField() -> NSTextField {
    let label = NSTextField(labelWithString: "")
    label.font = SummonerTokens.sectionFont
    label.textColor = SummonerTokens.faint
    label.setContentHuggingPriority(.defaultLow, for: .horizontal)
    label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    return label
  }
}

/// 单行视图：图标 20 + 标题 14/500 + 次文 12/400；选中 = accentSoft 满行 + 左 2px accent 条。
final class PaletteRowView: NSView {
  private let fill = CALayer()
  private let bar = CALayer()
  private let icon = NSImageView()
  private let title = NSTextField(labelWithString: "")
  private let meta = NSTextField(labelWithString: "")
  private var onClick: (() -> Void)?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    translatesAutoresizingMaskIntoConstraints = true // NSTableView manages row frames

    layer?.masksToBounds = true
    layer?.cornerRadius = summonerRowRadius
    fill.backgroundColor = SummonerTokens.indigoSoft.cgColor
    fill.cornerRadius = summonerRowRadius
    fill.isHidden = true
    layer?.addSublayer(fill)
    bar.backgroundColor = SummonerTokens.indigo.cgColor
    bar.cornerRadius = 1
    bar.isHidden = true
    layer?.addSublayer(bar)

    icon.imageScaling = .scaleProportionallyDown
    icon.setContentHuggingPriority(.required, for: .horizontal)
    title.font = SummonerTokens.rowTitleFont
    title.textColor = SummonerTokens.text
    title.lineBreakMode = .byTruncatingMiddle
    title.setContentHuggingPriority(.defaultLow, for: .horizontal)
    title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    meta.font = SummonerTokens.rowMetaFont
    meta.textColor = SummonerTokens.faint
    meta.lineBreakMode = .byTruncatingTail
    meta.setContentHuggingPriority(.defaultLow, for: .horizontal)
    meta.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    meta.alignment = .right

    addSubview(icon)
    addSubview(title)
    addSubview(meta)
  }

  required init?(coder: NSCoder) { fatalError("unsupported") }

  func configure(row: PaletteRow, selected: Bool, click: @escaping () -> Void) {
    onClick = click
    let symbol = NSImage(systemSymbolName: row.symbol, accessibilityDescription: row.title)
    icon.image = symbol
    icon.contentTintColor = row.kind == .verb || row.kind == .fallbackChat || row.kind == .fallbackPanel || row.kind == .citeThread
      ? SummonerTokens.indigo
      : SummonerTokens.secondary
    if !row.enabled { icon.contentTintColor = SummonerTokens.faint }
    title.stringValue = row.title
    title.textColor = row.enabled ? SummonerTokens.text : SummonerTokens.faint
    meta.stringValue = row.subtitle ?? ""
    fill.isHidden = !selected
    bar.isHidden = !selected
    alphaValue = row.enabled ? 1 : 0.55
    needsLayout = true
  }

  override func layout() {
    super.layout()
    let pad: CGFloat = 12
    let iconGap: CGFloat = 8
    let inset = (bounds.height - summonerRowBodyHeight) / 2 // 行距 6 的上半
    icon.frame = NSRect(x: pad, y: bounds.midY - summonerIconSize / 2, width: summonerIconSize, height: summonerIconSize)
    let textX = pad + summonerIconSize + iconGap
    let metaW = meta.stringValue.isEmpty ? 0 : meta.intrinsicContentSize.width + 8
    title.frame = NSRect(
      x: textX,
      y: bounds.midY - title.intrinsicContentSize.height / 2,
      width: max(16, bounds.width - textX - metaW - pad),
      height: max(title.intrinsicContentSize.height, 16)
    )
    if metaW > 0 {
      meta.frame = NSRect(
        x: bounds.width - pad - meta.intrinsicContentSize.width,
        y: bounds.midY - meta.intrinsicContentSize.height / 2,
        width: meta.intrinsicContentSize.width + 4,
        height: max(meta.intrinsicContentSize.height, 14)
      )
    }
    let card = bounds.insetBy(dx: 0, dy: inset)
    fill.frame = card
    bar.frame = NSRect(x: 0, y: card.minY + 4, width: 2, height: card.height - 8)
  }

  override func mouseDown(with event: NSEvent) {
    // 不抢 first responder（composer 保持焦点，键盘模型不中断）。
    onClick?()
  }
}

private let summonerWindowTitle = "CMspark 召唤器（实验）"
private let summonerTalkPlaceholder = "搜命令、历史、知识，或直接说任务…"
private let summonerTalkHint = "输入即过滤 · ↵ 执行 · Shift+Enter 排队 · ⌘↵ 在面板打开"
private let summonerExpandHint = "回车发送 · Shift+Enter 排队 · ⌃ 收起"
private let summonerHudWidth: CGFloat = 720
// #433 P0 palette geometry (spec §5a): 收起 56 / 展开上限 428 / 行 44（含 6 行间距）。
private let summonerHudCollapsedHeight: CGFloat = 56
private let summonerHudExpandedMax: CGFloat = 428
private let summonerRowPitch: CGFloat = 44
private let summonerRowSpacing: CGFloat = 6
private let summonerRowBodyHeight: CGFloat = 38
private let summonerWindowRadius: CGFloat = 12
private let summonerRowRadius: CGFloat = 6
private let summonerIconSize: CGFloat = 20
private let summonerWorkbenchHeight: CGFloat = 428
private let summonerChevronExpand = "展开对话"
private let summonerChevronCollapse = "收起对话"
private let summonerCtaCopy = "可以继续聊。要操作网页，请打开侧栏。"
private let summonerCdpNeeded = "操作网页请打开侧栏（扩展已配对的 Chrome）。"
private let summonerRenterChromeDown = "编程助手要看页面，请打开侧栏。"
private let summonerAttachPrimary = "打开浏览器"
private let summonerAttachSecondary = "打开并前置浏览器"
private let summonerConfirmNeed = "需要确认才能继续。"
private let summonerOpenConfirm = "打开确认台"
private let summonerCruiseChipFallback = "每次确认"
private let summonerCruiseChipTip = "点此打开浏览器；档位在侧栏设置调整"
private let summonerAttachFootnote = "我们不能替你打开侧栏。要盯着页面，请点工具栏的 CMspark。"
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
  private var confirmPending = false
  // Action-level rejections that do NOT end the current turn — a pending confirm
  // survives these. Mirrors the known non-terminal set in
  // companion/src/summoner/client.ts plus local/relay action codes. Any other
  // error reaching applyError is a terminal chat.error (the turn ends with no
  // token/done frame), where a stale confirm CTA must clear.
  private static let nonTerminalErrorCodes: Set<String> = [
    "run_active", "queue_full", "steer_queue_full", "idle_enqueue",
    "empty_steer", "empty_enqueue", "no_active_run", "enqueued",
    "OVERLAY_STANDBY", "BROWSER_UNAVAILABLE",
    "pack_not_overlay_eligible", "pack_trust_cookie_present", "pack_run_active",
    "pack_no_thread", "pack_applied",
    "upload_failed", "submit_failed", "mic_denied",
  ]
  private var lines: [String] = []
  private var streamingAssistant = false
  private var lastComposing = false
  // #433 P0 palette state（spec §2/§5d）。hitsStack/selectedHit 已被 NSTableView 面板取代。
  private enum PaletteScope {
    case all
    case knowledge
  }
  private var paletteOpen = false
  private var paletteScope: PaletteScope = .all
  private let frecency = SummonerFrecency()
  private var paletteContainer: NSView?
  private var paletteHeightConstraint: NSLayoutConstraint?
  private var paletteTable: PaletteTableController?
  private var contentWrap: NSView?
  private var searchTimer: Timer?
  private var streamRenderTimer: Timer?
  private var hotkeyConfigured = false

  private var badgeField: NSTextField?
  private var cruiseChipButton: NSButton?
  private var hintField: NSTextField?
  private var placeholderField: NSTextField?
  private var fieldBox: NSView?
  private var composer: NSTextView?
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
  private var listScrollView: NSScrollView?
  private var listHeadField: NSTextField?
  private var expanded = false
  private var railSection = 0
  private var threadRows: [RecentThread] = []
  private var packRows: [[String: Any]] = []
  private var mcpRows: [[String: Any]] = []
  private var skillRows: [[String: Any]] = []
  private var knowledgeRows: [[String: Any]] = []
  private var threadSearchHits: [SummonerSearchHit] = []
  private var knowledgeSearchHits: [SummonerSearchHit] = []
  private var peekThreadId: String? = nil
  private var peekMarkdown: String = ""
  private var peekTruncated: Bool = false
  private var peekRedactedHits: Int = 0
  private var searchingThreads: Bool = false
  private var searchingKnowledge: Bool = false
  private var searchGeneration: Int = 0
  private var lastSearchQuery: String = ""
  private var pendingPeekThreadId: String? = nil
  private var hashSearchTimer: Timer?
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
    if threadId.isEmpty {
      lines = []
      streamingAssistant = false
      sawBrowserUnavailable = false
      // Fresh thread: any stale confirm CTA from a previous thread clears.
      confirmPending = false
    } else if threadId != self.threadId {
      // Switching to a different existing thread: the pending confirm belongs to
      // the previous thread's run, so its CTA must not carry over. Same-thread
      // reopen (and hide()) keep confirmPending on purpose — the same run is
      // still waiting on that confirm.
      confirmPending = false
    }
    self.threadId = threadId
    if window == nil { window = makeWindow() }
    guard let window = window else { return }
    expanded = false
    railSection = 0
    paletteOpen = true
    paletteScope = .all
    isOpen = true
    applyPhase()
    // CRITICAL: do NOT call NSApp.activate here. Capture bar is
    // .nonactivatingPanel — steal front app = 慢 / 淡不掉 (#229).
    // picker/settings 是一次性浮层：重新召唤时复位，避免与面板叠高顶穿预算
    //（对抗评审 MAJOR：picker 复现态污染）。
    pickerBox?.isHidden = true
    settingsBox?.isHidden = true
    placeWindow(window)
    // 预热零闪烁（spec §5b）：窗口常驻但 alpha 0；先 orderFront 再淡入，
    // 首帧已在屏上，不出现空白/位移。
    window.alphaValue = 0
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
    animateOpen(window)
    window.makeFirstResponder(composer)
    jsonLine(["type": "summoner.ready"])
    emitCompanionUiRect("overlay", window: window)
  }

  /// spec §5a：鼠标所在屏 visibleFrame 上 1/3 水平居中。
  private func placeWindow(_ window: NSPanel) {
    let mouse = NSEvent.mouseLocation
    let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    guard let vf = screen?.visibleFrame, vf.height > 200 else {
      window.center()
      return
    }
    let size = window.frame.size
    let x = vf.midX - size.width / 2
    // 上 1/3 区带的垂直中心（窗口越大越贴近 1/3 线，clamp 在屏内）。
    let y = vf.maxY - vf.height / 3 - size.height / 2
    let clampedY = max(vf.minY, min(y, vf.maxY - size.height))
    window.setFrameOrigin(NSPoint(x: x, y: clampedY))
  }

  /// 出现 150ms fade + scale 0.98→1，cubic-bezier(0.2,0,0,1)（spec §5b）。
  private func animateOpen(_ window: NSPanel) {
    if let wrap = contentWrap, let layer = wrap.layer {
      layer.anchorPoint = CGPoint(x: 0.5, y: 0.5)
      layer.position = CGPoint(x: wrap.bounds.midX, y: wrap.bounds.midY)
      layer.transform = CATransform3DMakeScale(0.98, 0.98, 1)
    }
    NSAnimationContext.runAnimationGroup({ ctx in
      ctx.duration = 0.15
      ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0, 0, 1)
      window.animator().alphaValue = 1
      if let layer = contentWrap?.layer {
        layer.removeAnimation(forKey: "summoner.open.scale")
        let basic = CABasicAnimation(keyPath: "transform")
        basic.fromValue = NSValue(caTransform3D: CATransform3DMakeScale(0.98, 0.98, 1))
        basic.toValue = NSValue(caTransform3D: CATransform3DIdentity)
        basic.duration = 0.15
        basic.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0, 0, 1)
        layer.add(basic, forKey: "summoner.open.scale")
        layer.transform = CATransform3DIdentity
      }
    }, completionHandler: nil)
  }

  func hide() {
    searchTimer?.invalidate()
    searchTimer = nil
    expanded = false
    railSection = 0
    guard let window = window else { return }
    // 消失 120ms fade → orderOut（spec §5b）。完成回调里 guard isOpen，
    // 防止 fade 途中 re-open 被迟到的 orderOut 打掉。
    NSAnimationContext.runAnimationGroup({ ctx in
      ctx.duration = 0.12
      ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
      window.animator().alphaValue = 0
    }, completionHandler: { [weak self] in
      guard let self, !self.isOpen else { return }
      window.orderOut(nil)
      emitCompanionUiRect("overlay", window: nil)
      self.emitClosedIfOpen()
    })
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
    if browserAttached {
      // Attached hydrate = live companion channel again; the confirm console is
      // reachable through the normal path, so the confirm CTA mode ends.
      confirmPending = false
    }
    // #324: display-only chip. Companion derived the string; never decode three bools.
    if let raw = json["cruise_label"] as? String {
      let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty {
        let cap = trimmed.count <= 40 ? trimmed : String(trimmed.prefix(40))
        cruiseChipButton?.title = cap
        cruiseChipButton?.setAccessibilityTitle(cap)
      }
    }
    streamingAssistant = false
    sawBrowserUnavailable = false
    applyPhase()
    if window?.isVisible == true {
      window?.makeFirstResponder(composer)
    }
  }

  func appendToken(_ text: String) {
    if text.isEmpty { return }
    if confirmPending {
      // Assistant streaming resumed — the pending confirm was resolved.
      confirmPending = false
      applyPhase()
    }
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
    if confirmPending {
      // Chat reached done — the pending confirm was settled one way or another.
      confirmPending = false
      applyPhase()
    }
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
    if paletteOpen { refreshPalette() }
  }

  func applyThreads(_ json: [String: Any]) {
    let raw = json["threads"] as? [[String: Any]] ?? []
    threadRows = raw.compactMap { row in
      guard let id = row["id"] as? String, let title = row["title"] as? String, !id.isEmpty else { return nil }
      return RecentThread(id: id, title: title)
    }
    if railSection == 0 { refreshThreadList() }
    if paletteOpen { refreshPalette() }
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
      layoutListDocument()
      return
    }
    for row in threadRows.prefix(64) { // SUMMONER_RAIL_LIST_CAP
      stack.addArrangedSubview(makeThreadRow(row))
    }
    layoutListDocument()
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

  private func layoutListDocument() {
    guard let stack = threadListStack, let scroll = listScrollView else { return }
    stack.layoutSubtreeIfNeeded()
    let width = max(scroll.contentSize.width, 200)
    let height = max(stack.fittingSize.height, 1)
    stack.frame = NSRect(x: 0, y: 0, width: width, height: height)
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
      layoutListDocument()
      return
    }
    for row in rows.prefix(64) { // SUMMONER_RAIL_LIST_CAP
      let id = row["id"] as? String ?? ""
      let name = row["name"] as? String ?? id
      let ok = row["overlay_eligible"] as? Bool ?? false
      addPlainRow(id: id, title: ok ? name : "\(name) · 不可套", dimmed: !ok, action: #selector(packRowClicked(_:)))
    }
    layoutListDocument()
  }

  private func refreshMcpList() {
    clearListStack()
    addPlainRow(id: "__add__", title: "＋ 添加 MCP", dimmed: false, action: #selector(mcpAddClicked(_:)))
    threadListStack?.arrangedSubviews.last?.isHidden = true // freeze CONFIGURE chrome
    if mcpRows.isEmpty {
      addListEmpty("还没有 MCP 服务器")
      layoutListDocument()
      return
    }
    for row in mcpRows.prefix(64) { // SUMMONER_RAIL_LIST_CAP
      let name = row["name"] as? String ?? ""
      let enabled = row["enabled"] as? Bool ?? false
      addPlainRow(
        id: name,
        title: enabled ? "● \(name)" : "○ \(name)",
        dimmed: !enabled,
        action: #selector(mcpRowClicked(_:)),
      )
    }
    layoutListDocument()
  }

  private func refreshSkillList() {
    clearListStack()
    if skillRows.isEmpty {
      addListEmpty("还没有技能")
      layoutListDocument()
      return
    }
    for row in skillRows.prefix(64) { // SUMMONER_RAIL_LIST_CAP
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
    layoutListDocument()
  }

  private func refreshKnowledgeList() {
    clearListStack()
    addPlainRow(id: "__import__", title: "＋ 导入知识", dimmed: false, action: #selector(knowledgeImportClicked(_:)))
    threadListStack?.arrangedSubviews.last?.isHidden = true // freeze CONFIGURE chrome
    if knowledgeRows.isEmpty {
      addListEmpty("还没有知识文档")
      layoutListDocument()
      return
    }
    for row in knowledgeRows.prefix(64) { // SUMMONER_RAIL_LIST_CAP
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
    layoutListDocument()
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
    // no-op: summoner.mcp.toggle is not dispatched from Capture (#245 A3)
  }

  @objc func mcpAddClicked(_ sender: NSButton) {
    // no-op: summoner.mcp.add is not dispatched from Capture (#245 A3)
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
    guard let text = String(data: data, encoding: .utf8), !text.isEmpty else {
      applyError(message: "只支持文本知识（md/txt）", errorCode: "upload_failed")
      return
    }
    jsonLine([
      "type": "summoner.knowledge.import",
      "name": url.lastPathComponent,
      "mime": mimeTypeForAttach(url: url),
      "content": text,
    ])
  }

  func applyError(message: String, errorCode: String?) {
    streamRenderTimer?.invalidate()
    streamRenderTimer = nil
    streamingAssistant = false
    let code = errorCode ?? ""
    if code == "MCP_CONFIRM_PENDING" {
      confirmPending = true
      lines.append("系统: \(summonerConfirmNeed)")
      capLines()
      applyPhase()
      return
    }
    if confirmPending && !Self.nonTerminalErrorCodes.contains(code) {
      // Terminal chat.error: the turn ends here with no token/done frame, so the
      // confirm CTA would stick on 「需要确认」 forever — clear it. Trade-off: a
      // codeless action-level failure (e.g. skill toggle error) also clears the
      // CTA early; acceptable, the confirm console stays reachable in the panel.
      confirmPending = false
    }
    if code == "BROWSER_UNAVAILABLE" {
      sawBrowserUnavailable = true
      browserAttached = false
      browserKnown = true
      let renter = message.localizedCaseInsensitiveContains("mcp")
        || message.localizedCaseInsensitiveContains("outbound")
        || message.localizedCaseInsensitiveContains("grant")
        || message.contains("编程")
      lines.append("系统: \(renter ? summonerRenterChromeDown : summonerCdpNeeded)")
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
      if paletteOpen {
        refreshPalette()
      }
    }
  }

  func showHotkeyPicker() {
    if window == nil { window = makeWindow() }
    paletteOpen = false // picker 与面板互斥：56+310+面板会顶穿窗口预算。
    pickerBox?.isHidden = false
    applyPhase()
  }

  func toggleHotkeyPicker() {
    if window == nil { window = makeWindow() }
    let hidden = pickerBox?.isHidden ?? true
    if !hidden { paletteOpen = false }
    pickerBox?.isHidden = !hidden
    applyPhase()
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
    // 输入即过滤（spec §5d）：收起态下打字自动展开面板。
    let q = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
    if !q.isEmpty, !paletteOpen, !expanded {
      setPalette(open: true)
    }
    // Clear peek on every keystroke (stale preview for prev selection).
    peekMarkdown = ""
    peekThreadId = nil
    peekTruncated = false
    peekRedactedHits = 0
    refreshPalette()
    // Debounce 150ms for server-side search (P1 data layer).
    searchTimer?.invalidate()
    searchTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: false) { [weak self] _ in
      self?.emitP1Search()
    }
    if isSearchQuery(composerText) {
      // `#` 前缀保留既有 node 侧检索回路（单命中自动 hydrate）。NIT-2: 恢复 150ms 防抖。
      hashSearchTimer?.invalidate()
      hashSearchTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: false) { [weak self] _ in
        self?.emitSearch()
      }
    } else {
      hashSearchTimer?.invalidate()
      hashSearchTimer = nil
    }
  }

  func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
    if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
      // Esc 逐级返回（spec §5c）：清 query → 收起面板（56）→ 关窗。
      let q = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
      if !q.isEmpty {
        composer?.string = ""
        updatePlaceholder()
        refreshPalette()
        return true
      }
      if paletteOpen, !expanded {
        setPalette(open: false)
        return true
      }
      hide()
      return true
    }
    if commandSelector == #selector(NSResponder.moveUp(_:)) {
      if paletteOpen, !expanded {
        paletteTable?.move(-1)
        return true
      }
      return false
    }
    if commandSelector == #selector(NSResponder.moveDown(_:)) {
      if !expanded {
        if !paletteOpen {
          setPalette(open: true)
          return true
        }
        paletteTable?.move(1)
        return true
      }
      return false
    }
    if commandSelector == #selector(NSResponder.insertNewline(_:)) {
      // CJK IME 确认回车不提交（spec §5e-3）：有 marked text 时交给输入法。
      if textView.hasMarkedText() { return false }
      // Shift+Enter 排队永远直发（对抗评审 MAJOR：面板常开后 enqueue 曾不可达）。
      if NSEvent.modifierFlags.contains(.shift) {
        submitComposer(enqueue: true)
        return true
      }
      if paletteOpen, !expanded, let row = paletteTable?.activate() {
        activatePaletteRow(row)
        return true
      }
      submitComposer(enqueue: false)
      return true
    }
    return false
  }

  /// ⌘1-9 快选 / ⌘↵ 在面板打开（spec §5c）。走 SummonerPanel.performKeyEquivalent。
  func handleKeyEquivalent(_ event: NSEvent) -> Bool {
    guard isOpen else { return false }
    // Caps Lock 在 deviceIndependentFlagsMask 里，== .command 会误判。只取修饰键交集。
    let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard mods.intersection([.command, .shift, .option, .control]) == .command, !expanded else { return false }
    if event.keyCode == 36, paletteOpen { // ⌘↵
      emitUiCommand("focus_panel")
      return true
    }
    if let c = event.charactersIgnoringModifiers, c.count == 1,
       let ascii = c.first?.asciiValue, ascii >= 49, ascii <= 57, paletteOpen {
      // ⌘1-9：ascii '1'...'9'（wholeNumberValue 是 10.15+ API，默认 target 10.13）。
      let d = Int(ascii - 48)
      return paletteTable?.activateQuickPick(d) ?? false
    }
    return false
  }

  private func emitSearch() {
    guard isOpen else { return }
    jsonLine(["type": "summoner.search", "query": searchNeedle(composerText)])
  }

  private func emitP1Search() {
    guard isOpen else { return }
    let q = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !q.isEmpty else {
      // Clear stale results when query is empty.
      searchGeneration += 1
      lastSearchQuery = ""
      threadSearchHits = []
      knowledgeSearchHits = []
      refreshPalette()
      return
    }
    // NIT-3: skip P1 search for `#` prefix — node search handles it.
    if q.hasPrefix("#") { return }
    searchGeneration += 1
    lastSearchQuery = q
    searchingThreads = true
    searchingKnowledge = true
    jsonLine(["type": "summoner.thread.search", "query": q])
    jsonLine(["type": "summoner.knowledge.search", "query": q])
  }

  private func selectThread(_ thread: RecentThread) {
    threadId = thread.id
    frecency.touch(thread.id)
    composer?.string = ""
    updatePlaceholder()
    setPalette(open: false)
    applyPhase()
    window?.makeFirstResponder(composer)
    jsonLine(["type": "summoner.select", "thread_id": thread.id])
  }

  func applyHits(_ json: [String: Any]) {
    // `#` 显式检索的 node 侧回包：并进本地 threadRows（标题含日期尾缀），
    // 面板统一由 refreshPalette 渲染。node 单命中自动 hydrate 的既有行为不变。
    let raw = json["hits"] as? [[String: Any]] ?? []
    let incoming = raw.compactMap { row -> RecentThread? in
      guard let id = row["id"] as? String, !id.isEmpty else { return nil }
      let title = row["title"] as? String ?? id
      let when = row["when"] as? String ?? ""
      let day = when.count >= 10 ? String(when.prefix(10)) : when
      let label = day.isEmpty ? title : "\(title)  \(day)"
      return RecentThread(id: id, title: label)
    }
    guard !incoming.isEmpty else { return }
    let incomingIds = Set(incoming.map { $0.id })
    threadRows = incoming + threadRows.filter { !incomingIds.contains($0.id) }
    refreshPalette()
  }

  func applyThreadSearchResults(_ json: [String: Any]) {
    // MAJOR-1: discard stale results if query has changed since request was sent.
    let q = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard q == lastSearchQuery, !q.isEmpty else { return }
    let raw = json["hits"] as? [[String: Any]] ?? []
    threadSearchHits = raw.compactMap { row in
      guard let id = row["id"] as? String, !id.isEmpty,
            let title = row["title"] as? String else { return nil }
      return SummonerSearchHit(
        id: id, title: title,
        snippet: row["snippet"] as? String ?? "",
        score: row["score"] as? Double ?? 0
      )
    }
    searchingThreads = false
    refreshPalette()
  }

  func applyKnowledgeSearchResults(_ json: [String: Any]) {
    // MAJOR-1: discard stale results if query has changed since request was sent.
    let q = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard q == lastSearchQuery, !q.isEmpty else { return }
    let raw = json["hits"] as? [[String: Any]] ?? []
    knowledgeSearchHits = raw.compactMap { row in
      guard let id = row["id"] as? String, !id.isEmpty,
            let title = row["title"] as? String else { return nil }
      return SummonerSearchHit(
        id: id, title: title,
        snippet: row["snippet"] as? String ?? "",
        score: row["score"] as? Double ?? 0
      )
    }
    searchingKnowledge = false
    refreshPalette()
  }

  func applyPeekResult(_ json: [String: Any]) {
    let threadId = json["thread_id"] as? String ?? ""
    guard !threadId.isEmpty else { return }
    // MAJOR-1: discard peek result if selection has changed since request.
    guard threadId == pendingPeekThreadId else { return }
    peekThreadId = threadId
    peekMarkdown = json["markdown"] as? String ?? ""
    peekTruncated = json["truncated"] as? Bool ?? false
    peekRedactedHits = json["redacted_hits"] as? Int ?? 0
    // Show peek preview in palette.
    refreshPalette()
  }

  @objc func citeThreadClicked() {
    guard let id = peekThreadId, !id.isEmpty else { return }
    let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
    var payload: [String: Any] = ["type": "summoner.cite_thread", "thread_id": id]
    if !text.isEmpty { payload["text"] = text }
    jsonLine(payload)
    peekMarkdown = ""
    peekThreadId = nil
    peekTruncated = false
    peekRedactedHits = 0
    setPalette(open: false)
    hide()
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
    // 程序化 set 不走 delegate——手动驱动面板过滤（输入即过滤同样适用于听写）。
    if !expanded, !paletteOpen { paletteOpen = true }
    refreshPalette()
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

  /// #433 P2: companion → ext whitelist verb (spec §3b). Overlay never L2.
  private func emitUiCommand(_ action: String) {
    jsonLine(["type": "summoner.ui_command", "action": action])
  }

  @objc func openConfirmCenterClicked() {
    emitUiCommand("open_confirm_center")
  }

  /// #324 read-only cruise chip — same inbound as 「打开确认台」(no new stdin type).
  @objc func cruiseChipClicked() {
    jsonLine(["type": "summoner.attach_chrome", "foreground": true])
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

  @objc func armTaskClicked() {
    guard !threadId.isEmpty else { return }
    jsonLine(["type": "summoner.arm_task", "thread_id": threadId])
  }

  // MARK: - #433 P0 command palette（spec §2 三段式 / §5c 匹配 / §5d 状态）

  private func setPalette(open: Bool) {
    paletteOpen = open
    if !open {
      paletteScope = .all
    }
    applyPhase()
  }

  private var paletteQuery: String {
    let t = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.hasPrefix("#") {
      return String(t.dropFirst()).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return t
  }

  private func refreshPalette() {
    guard paletteOpen, !expanded else {
      paletteContainer?.isHidden = true
      return
    }
    guard let pal = paletteTable else { return }
    let previous = pal.selectedRow?.id
    let rows = buildPaletteRows(query: paletteQuery)
    pal.update(rows: rows, keepingSelectionOf: previous)
    paletteContainer?.isHidden = false
    // 高度预算（spec §5a 428 封顶）：64（56 bar + 间距）+ palette ≤ 428 → 钳 364。
    // 不钳的话 stack intrinsic 会把 setContentSize 顶穿（window 被 autolayout 拉高）。
    let paletteMax = summonerHudExpandedMax - summonerHudCollapsedHeight - 8
    paletteHeightConstraint?.constant = min(pal.contentHeight(), paletteMax)
    relayout()
  }

  /// 动词层（spec §2 / §3b）：P2 接 ui.command 白名单，overlay 不新增确认 UI。
  /// 新对话 → summoner.new_thread；打开侧栏/确认台/终端 → summoner.ui_command；
  /// 搜知识 → 本地 scope 切换。
  private func verbDefinitions() -> [(id: String, title: String, subtitle: String, symbol: String)] {
    [
      ("new_thread", "新对话", "开一条新会话", "plus.circle"),
      ("arm_task", "后台任务", "让当前对话在后台自动续跑", "arrow.trianglehead.clockwise"),
      ("search_knowledge", "搜知识", "只在知识文档里找", "magnifyingglass"),
      ("open_panel", "打开侧栏", "唤起 Chrome 扩展面板", "macwindow.on.rectangle"),
      ("open_confirm", "打开确认台", "查看待确认操作", "checkmark.shield"),
      ("open_terminal", "打开终端 tab", "打开内嵌终端", "terminal"),
    ]
  }

  private func buildPaletteRows(query: String) -> [PaletteRow] {
    var rows: [PaletteRow] = []
    let verbs = verbDefinitions()
    let q = query.lowercased()

    func sectionHeader(_ title: String) -> PaletteRow {
      PaletteRow(kind: .sectionHeader, id: "hdr.\(title)", title: title, subtitle: nil, symbol: "", enabled: true)
    }

    if q.isEmpty {
      if paletteScope == .knowledge {
        rows.append(sectionHeader("知识"))
        let ranked = knowledgeRows
          .sorted { frecency.score("kb:\($0["id"] as? String ?? "")") > frecency.score("kb:\($1["id"] as? String ?? "")") }
        if ranked.isEmpty {
          rows.append(PaletteRow(kind: .knowledge, id: "__empty__", title: "还没有知识文档（侧栏可导入）", subtitle: nil, symbol: "doc", enabled: false))
        } else {
          for row in ranked.prefix(8) {
            rows.append(knowledgePaletteRow(row))
          }
        }
        return rows
      }
      rows.append(sectionHeader("动词"))
      // spec §2 verbs(frecency)：按使用分排序，平分保持票面顺序（新对话→…→终端）。
      let sortedVerbs = verbs.enumerated()
        .sorted { a, b in
          let sa = frecency.score("verb:\(a.element.id)")
          let sb = frecency.score("verb:\(b.element.id)")
          if sa != sb { return sa > sb }
          return a.offset < b.offset
        }
        .map { $0.element }
      for v in sortedVerbs {
        rows.append(PaletteRow(kind: .verb, id: v.id, title: v.title, subtitle: v.subtitle, symbol: v.symbol,
                               enabled: true))
      }
      let rankedIds = frecency.ranked(ids: threadRows.map { $0.id })
      let recent = rankedIds.compactMap { id -> RecentThread? in
        threadRows.first { $0.id == id }
      }
      if !recent.isEmpty {
        rows.append(sectionHeader("最近"))
        for t in recent.prefix(6) {
          rows.append(PaletteRow(kind: .thread, id: t.id, title: t.title, subtitle: "对话", symbol: "bubble.left", enabled: true))
        }
      }
      return rows
    }

    // 有 query：三段混排（动词 → 数据 → 兜底），匹配用 §5c 加权。
    let isHashQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("#")
    var matchedVerbs = 0
    for v in verbs {
      let score = PaletteMatcher.score(query: q, fields: [v.title, v.subtitle], pinyins: [PinyinInitials.initials(for: v.title)])
      if score > 0 {
        rows.append(PaletteRow(kind: .verb, id: v.id, title: v.title, subtitle: v.subtitle, symbol: v.symbol,
                               enabled: true))
        matchedVerbs += 1
      }
    }
    if matchedVerbs > 0 { rows.insert(sectionHeader("动作"), at: 0) }

    if !isHashQuery {
      // P1 server-side search results with snippets.
      if paletteScope != .knowledge {
        let ranked = threadSearchHits.sorted { $0.score > $1.score }
        if !ranked.isEmpty {
          rows.append(sectionHeader("对话"))
          for hit in ranked.prefix(8) {
            rows.append(PaletteRow(kind: .thread, id: hit.id, title: hit.title, subtitle: hit.snippet.isEmpty ? "对话" : hit.snippet, symbol: "bubble.left", enabled: true, snippet: hit.snippet))
          }
        }
      }
      if paletteScope == .knowledge || paletteScope == .all {
        let ranked = knowledgeSearchHits.sorted { $0.score > $1.score }
        if !ranked.isEmpty {
          rows.append(sectionHeader("知识"))
          for hit in ranked.prefix(8) {
            rows.append(PaletteRow(kind: .knowledge, id: hit.id, title: hit.title, subtitle: hit.snippet.isEmpty ? "知识" : hit.snippet, symbol: "doc.text", enabled: true, snippet: hit.snippet))
          }
        }
      }
    }

    // NIT-1: dedup server hits from local fallback (server priority).
    let serverThreadIds = Set(threadSearchHits.map { $0.id })
    let serverKnowledgeIds = Set(knowledgeSearchHits.map { $0.id })

    // Local fallback: also show local matches (backward compat + `#` prefix circuit).
    var scored: [(PaletteRow, Double)] = []
    if paletteScope != .knowledge {
      for t in threadRows.prefix(200) {
        guard !serverThreadIds.contains(t.id) else { continue }
        let s = PaletteMatcher.score(query: q, fields: [t.title], pinyins: [PinyinInitials.initials(for: t.title)])
        if s > 0 {
          scored.append((PaletteRow(kind: .thread, id: t.id, title: t.title, subtitle: "对话", symbol: "bubble.left", enabled: true),
                         s + frecency.score(t.id)))
        }
      }
    }
    for row in knowledgeRows.prefix(200) {
      let id = row["id"] as? String ?? ""
      let title = row["title"] as? String ?? id
      guard !id.isEmpty else { continue }
      guard !serverKnowledgeIds.contains(id) else { continue }
      let s = PaletteMatcher.score(query: q, fields: [title], pinyins: [PinyinInitials.initials(for: title)])
      if s > 0 {
        scored.append((knowledgePaletteRow(row), s + frecency.score("kb:\(id)")))
      }
    }
    if !scored.isEmpty {
      scored.sort { $0.1 > $1.1 }
      var out = rows
      out.append(sectionHeader(paletteScope == .knowledge ? "知识" : "结果"))
      out.append(contentsOf: scored.prefix(10).map { $0.0 })
      rows = out
    }

    // P1 peek preview: show when a thread peek result is available.
    if let peekId = peekThreadId, !peekMarkdown.isEmpty {
      rows.append(sectionHeader("预览"))
      let firstLine = peekMarkdown.components(separatedBy: "\n").first ?? ""
      let suffix = peekTruncated ? " · 截断" : ""
      let sub = peekRedactedHits > 0 ? "脱敏 \(peekRedactedHits) 处\(suffix)" : "蒸馏预览\(suffix)"
      rows.append(PaletteRow(kind: .peekPreview, id: peekId, title: firstLine, subtitle: sub, symbol: "eye", enabled: true))
      rows.append(PaletteRow(kind: .citeThread, id: "cite.\(peekId)", title: "引用进新任务", subtitle: "把此对话作为上下文带入新任务", symbol: "arrow.turn.down.right", enabled: true))
    }

    if rows.filter({ $0.selectable && $0.enabled }).isEmpty {
      // 零命中：兜底层（spec §2）——「问 AI」选中态保住 chat-first。
      rows.append(sectionHeader("没有匹配"))
      rows.append(PaletteRow(kind: .fallbackChat, id: "fallback.chat", title: "问 AI：\(query)", subtitle: "直接发这条消息", symbol: "sparkles", enabled: true))
      rows.append(PaletteRow(kind: .fallbackPanel, id: "fallback.panel", title: "在面板打开", subtitle: "去侧栏继续", symbol: "arrow.up.forward.app", enabled: true))
    }
    return rows
  }

  private func knowledgePaletteRow(_ row: [String: Any]) -> PaletteRow {
    let id = row["id"] as? String ?? ""
    let title = row["title"] as? String ?? id
    let attached = row["attached"] as? Bool ?? false
    return PaletteRow(kind: .knowledge, id: id, title: title, subtitle: attached ? "知识 · 已挂" : "知识",
                      symbol: "doc.text", enabled: true)
  }

  private func activatePaletteRow(_ row: PaletteRow) {
    switch row.kind {
    case .verb:
      frecency.touch("verb:\(row.id)")
      switch row.id {
      case "new_thread":
        newThreadClicked()
        setPalette(open: false)
      case "arm_task":
        armTaskClicked()
        setPalette(open: false)
      case "search_knowledge":
        paletteScope = (paletteScope == .knowledge) ? .all : .knowledge
        refreshPalette()
      case "open_panel":
        emitUiCommand("focus_panel")
        setPalette(open: false)
      case "open_confirm":
        emitUiCommand("open_confirm_center")
        setPalette(open: false)
      case "open_terminal":
        emitUiCommand("open_terminal_tab")
        setPalette(open: false)
      default:
        break
      }
    case .thread:
      if let t = threadRows.first(where: { $0.id == row.id }) {
        selectThread(t)
      }
    case .knowledge:
      frecency.touch("kb:\(row.id)")
      jsonLine(["type": "summoner.knowledge.attach", "id": row.id])
      setPalette(open: false)
    case .fallbackChat:
      let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
      if text.hasPrefix("#") {
        composer?.string = String(text.dropFirst()).trimmingCharacters(in: .whitespacesAndNewlines)
      }
      setPalette(open: false)
      submitComposer()
    case .fallbackPanel:
      emitUiCommand("focus_panel")
    case .sectionHeader:
      break
    case .peekPreview:
      break // peek preview is read-only; cite action is via .citeThread row.
    case .citeThread:
      citeThreadClicked()
    }
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
    logBox?.isHidden = expanded ? false : (paletteOpen || lines.isEmpty)
    maybeGrowLogHeight(resizeWindow: true)
    scrollLogToEnd()
  }

  private func patchStreamingLine(_ body: String) {
    guard let tv = logView else { return }
    tv.string = lines.joined(separator: "\n")
    logBox?.isHidden = expanded ? false : (paletteOpen || lines.isEmpty)
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
    let detached = browserKnown && !browserAttached
    let paletteVisible = paletteOpen && !expanded

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

    hintField?.stringValue = expanded ? summonerExpandHint : summonerTalkHint
    // hint 行只在展开态出现：收起 56 / 面板 428 的硬预算里没有它的行高（spec §5a）。
    hintField?.isHidden = !expanded
    // 巡航 chip（#324）同样让位：收起/面板态不常驻，展开态里与设置同区。
    cruiseChipButton?.isHidden = !expanded

    workbenchBox?.isHidden = !expanded
    // 面板展开时 log 让位（非 expanded 态高度被 428 上限约束）。
    if !paletteVisible {
      refreshLog()
    } else {
      logBox?.isHidden = true
    }
    refreshPalette()
    if railSection == 0 {
      listHeadField?.stringValue = "对话"
      refreshThreadList()
    }
    let showCta = detached || confirmPending
    ctaBox?.isHidden = !showCta
    attachButton?.isHidden = !showCta
    silentAttachButton?.isHidden = confirmPending ? true : !detached
    sendButton?.isHidden = true
    continueButton?.isHidden = true
    footRow?.isHidden = true
    lastThreadField?.isHidden = true
    if confirmPending {
      ctaLabel?.stringValue = summonerConfirmNeed
      attachButton?.title = summonerOpenConfirm
      attachButton?.toolTip = summonerOpenConfirm
      attachButton?.action = #selector(openConfirmCenterClicked)
    } else if detached {
      ctaLabel?.stringValue = sawBrowserUnavailable ? summonerCdpNeeded : summonerCtaCopy
      attachButton?.title = summonerAttachSecondary
      attachButton?.toolTip = summonerAttachSecondary
      attachButton?.action = #selector(attachForegroundClicked)
      sideNote?.isHidden = true
    } else {
      attachButton?.action = #selector(attachForegroundClicked)
      sideNote?.isHidden = true
    }
    setExpandChrome(expanded: expanded)
    expandButton?.title = expanded ? "⌃" : "⌄"
    updateLastThreadLabel()
    updatePlaceholder()
    relayout()
  }

  private func setExpandChrome(expanded: Bool) {
    let copy = expanded ? summonerChevronCollapse : summonerChevronExpand
    expandButton?.toolTip = copy
    expandButton?.setAccessibilityLabel(copy)
    expandButton?.setAccessibilityTitle(copy)
  }

  private func relayout() {
    guard let window = window else { return }
    // 收起 56（spec §5a）：stack insets 6+6 + fieldBox 44。
    var h: CGFloat = summonerHudCollapsedHeight
    if cruiseChipButton?.isHidden == false { h += 28 }
    if pickerBox?.isHidden == false { h += 310 }
    if settingsBox?.isHidden == false { h += 118 }
    if expanded && (workbenchBox?.isHidden == false) { h += summonerWorkbenchHeight }
    if lastThreadField?.isHidden == false { h += 18 }
    if paletteContainer?.isHidden == false {
      h += 8 + (paletteHeightConstraint?.constant ?? 0)
    }
    if logBox?.isHidden == false { h += logHeightConstraint?.constant ?? 0 }
    if ctaBox?.isHidden == false { h += 118 }
    if footRow?.isHidden == false { h += 48 }
    if sideNote?.isHidden == false { h += 22 }
    if hintField?.isHidden == false { h += 20 }
    // 428 封顶只约束命令面板态（spec §5a 展开上限）；workbench 展开态维持旧高度模型。
    if !expanded { h = min(h, summonerHudExpandedMax) }
    window.setContentSize(NSSize(width: summonerHudWidth, height: max(summonerHudCollapsedHeight, h)))
    if isOpen { emitCompanionUiRect("overlay", window: window) }
  }

  private func makeWindow() -> NSPanel? {
    let contentRect = NSRect(x: 0, y: 0, width: summonerHudWidth, height: summonerHudCollapsedHeight)
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
    // spec §5a「窗口 backgroundColor=.clear」：非透明窗会在 12px 圆角外露方角，
    // 纸色底 + 圆角由 contentWrap 层绘制（对抗评审 MAJOR）。
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.level = .floating
    panel.minSize = NSSize(width: summonerHudWidth, height: summonerHudCollapsedHeight)
    // canJoinAllSpaces（spec §5e）：召唤器跨 Space 常驻；fullScreenAuxiliary 允许
    // 全屏 app 之上出现；transient 维持 Mission Control 不收纳。
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
    panel.delegate = self
    panel.appearance = NSAppearance(named: .aqua)
    panel.alphaValue = 0 // 预热零闪烁（spec §5b）：orderFront 前不落第一帧。

    let stack = NSStackView()
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 8
    stack.edgeInsets = NSEdgeInsets(top: 6, left: 12, bottom: 6, right: 12)
    stack.translatesAutoresizingMaskIntoConstraints = false

    let cruise = NSButton(title: summonerCruiseChipFallback, target: self, action: #selector(cruiseChipClicked))
    cruise.bezelStyle = .inline
    cruise.isBordered = false
    cruise.font = .systemFont(ofSize: 11, weight: .semibold)
    cruise.contentTintColor = SummonerTokens.indigo
    cruise.toolTip = summonerCruiseChipTip
    cruise.setAccessibilityLabel(summonerCruiseChipTip)
    cruise.setAccessibilityTitle(summonerCruiseChipFallback)
    cruise.keyEquivalent = ""
    cruise.translatesAutoresizingMaskIntoConstraints = false
    cruise.widthAnchor.constraint(lessThanOrEqualToConstant: summonerHudInnerWidth).isActive = true
    cruiseChipButton = cruise
    stack.addArrangedSubview(cruise)

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
    fieldBox.layer?.cornerRadius = 12
    fieldBox.layer?.borderWidth = 1
    fieldBox.layer?.borderColor = NSColor(white: 0.09, alpha: 0.10).cgColor
    fieldBox.heightAnchor.constraint(equalToConstant: summonerHudCollapsedHeight - 12).isActive = true // 44（spec §5a）
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
    expand.toolTip = summonerChevronExpand
    expand.setAccessibilityLabel(summonerChevronExpand)
    expand.setAccessibilityTitle(summonerChevronExpand)
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
      scroll.topAnchor.constraint(equalTo: fieldBox.topAnchor, constant: 4),
      scroll.bottomAnchor.constraint(equalTo: fieldBox.bottomAnchor, constant: -4),
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

    // 命令面板列表（NSTableView 虚拟化，spec §5e-4）——占位在 composer 之上。
    let pal = PaletteTableController()
    pal.onActivate = { [weak self] row in
      self?.activatePaletteRow(row)
    }
    pal.onSelectionChange = { [weak self] row in
      // P1: when a thread row is selected via arrow keys, request peek preview.
      if let row = row, row.kind == .thread, !row.id.isEmpty {
        self?.pendingPeekThreadId = row.id
        jsonLine(["type": "summoner.peek", "thread_id": row.id])
      } else {
        self?.pendingPeekThreadId = nil
        self?.peekMarkdown = ""
        self?.peekThreadId = nil
        self?.peekTruncated = false
        self?.peekRedactedHits = 0
      }
    }
    paletteTable = pal
    let paletteBox = NSView()
    paletteBox.translatesAutoresizingMaskIntoConstraints = false
    paletteBox.widthAnchor.constraint(equalToConstant: summonerHudInnerWidth).isActive = true
    paletteBox.isHidden = true
    paletteBox.addSubview(pal.scrollView)
    let palH = paletteBox.heightAnchor.constraint(equalToConstant: 0)
    palH.isActive = true
    paletteHeightConstraint = palH
    paletteContainer = paletteBox
    NSLayoutConstraint.activate([
      pal.scrollView.topAnchor.constraint(equalTo: paletteBox.topAnchor),
      pal.scrollView.bottomAnchor.constraint(equalTo: paletteBox.bottomAnchor),
      pal.scrollView.leadingAnchor.constraint(equalTo: paletteBox.leadingAnchor),
      pal.scrollView.trailingAnchor.constraint(equalTo: paletteBox.trailingAnchor),
    ])
    stack.addArrangedSubview(paletteBox)
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
      btn.isHidden = spec.2 == 4 // freeze MCP rail icon; keep sixth rail + stdin
      railCol.addArrangedSubview(btn)
    }
    let listCol = NSStackView()
    listCol.orientation = .vertical
    listCol.alignment = .leading
    listCol.distribution = .fill
    listCol.spacing = 4
    listCol.edgeInsets = NSEdgeInsets(top: 8, left: 8, bottom: 8, right: 8)
    listCol.translatesAutoresizingMaskIntoConstraints = false
    listCol.widthAnchor.constraint(equalToConstant: 216).isActive = true
    let listHead = NSTextField(labelWithString: "对话")
    listHead.font = .systemFont(ofSize: 11, weight: .semibold)
    listHead.textColor = SummonerTokens.faint
    listHead.setContentHuggingPriority(.required, for: .vertical)
    listHeadField = listHead
    listCol.addArrangedSubview(listHead)
    let tStack = NSStackView()
    tStack.orientation = .vertical
    tStack.alignment = .leading
    tStack.spacing = 2
    tStack.translatesAutoresizingMaskIntoConstraints = true
    tStack.autoresizingMask = [.width]
    threadListStack = tStack
    let listScroll = NSScrollView()
    listScroll.translatesAutoresizingMaskIntoConstraints = false
    listScroll.hasVerticalScroller = true
    listScroll.hasHorizontalScroller = false
    listScroll.autohidesScrollers = true
    listScroll.borderType = .noBorder
    listScroll.drawsBackground = false
    listScroll.documentView = tStack
    listScroll.setContentHuggingPriority(.defaultLow, for: .vertical)
    listScroll.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
    listScrollView = listScroll
    listCol.addArrangedSubview(listScroll)
    logBox.setContentHuggingPriority(.defaultLow, for: .horizontal)
    logBox.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    workbench.addArrangedSubview(railCol)
    workbench.addArrangedSubview(listCol)
    workbench.addArrangedSubview(logBox)
    NSLayoutConstraint.activate([
      railCol.heightAnchor.constraint(equalTo: workbench.heightAnchor),
      listCol.heightAnchor.constraint(equalTo: workbench.heightAnchor),
      logBox.heightAnchor.constraint(equalTo: workbench.heightAnchor),
    ])

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
    let silent = makeIndigoButton(title: summonerAttachPrimary, action: #selector(attachClicked))
    silent.widthAnchor.constraint(equalToConstant: 372).isActive = true
    silent.toolTip = summonerAttachPrimary
    silent.setAccessibilityLabel(summonerAttachPrimary)
    silent.setAccessibilityTitle(summonerAttachPrimary)
    silentAttachButton = silent
    ctaStack.addArrangedSubview(silent)
    let attach = makePlainButton(title: summonerAttachSecondary, action: #selector(attachForegroundClicked))
    attach.widthAnchor.constraint(equalToConstant: 372).isActive = true
    attach.toolTip = summonerAttachSecondary
    attach.setAccessibilityLabel(summonerAttachSecondary)
    attach.setAccessibilityTitle(summonerAttachSecondary)
    attachButton = attach
    ctaStack.addArrangedSubview(attach)
    let ctaFoot = NSTextField(wrappingLabelWithString: summonerAttachFootnote)
    ctaFoot.font = .systemFont(ofSize: 11)
    ctaFoot.textColor = SummonerTokens.faint
    ctaFoot.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    ctaStack.addArrangedSubview(ctaFoot)
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
    // scale 动画 wrapper（spec §5b 0.98→1）：整树挂在 wrap 上；wrap 同时承担
    // 纸色底 + 12px 圆角（窗口本身 clear）。
    let wrap = NSView()
    wrap.translatesAutoresizingMaskIntoConstraints = false
    wrap.wantsLayer = true
    wrap.layer?.backgroundColor = SummonerTokens.paper.cgColor
    wrap.layer?.cornerRadius = summonerWindowRadius
    wrap.layer?.masksToBounds = true
    contentWrap = wrap
    cv.addSubview(wrap)
    wrap.addSubview(stack)
    NSLayoutConstraint.activate([
      wrap.topAnchor.constraint(equalTo: cv.topAnchor),
      wrap.bottomAnchor.constraint(equalTo: cv.bottomAnchor),
      wrap.leadingAnchor.constraint(equalTo: cv.leadingAnchor),
      wrap.trailingAnchor.constraint(equalTo: cv.trailingAnchor),
      stack.topAnchor.constraint(equalTo: wrap.topAnchor),
      stack.bottomAnchor.constraint(equalTo: wrap.bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: wrap.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: wrap.trailingAnchor),
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

