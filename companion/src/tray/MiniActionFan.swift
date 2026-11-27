import AppKit

// The orb keeps the original mouse sequence. This transparent panel only draws
// the targets and takes Escape while the user is holding the button.
final class MiniActionFan: NSPanel {
  private let canvas: MiniFanView
  var onCancel: (() -> Void)?

  init(orb: NSWindow, screen: NSScreen) {
    let work = screen.visibleFrame
    let anchor = NSPoint(x: orb.frame.midX, y: orb.frame.midY)
    let sx: CGFloat = anchor.x < work.midX ? 1 : -1
    let sy: CGFloat = anchor.y < work.midY ? 1 : -1
    let far = NSPoint(x: anchor.x + sx * 284, y: anchor.y + sy * 205)
    let frame = NSRect(x: min(anchor.x, far.x) - 24, y: min(anchor.y, far.y) - 24,
                       width: abs(far.x - anchor.x) + 48, height: abs(far.y - anchor.y) + 48).intersection(work)
    canvas = MiniFanView(frame: NSRect(origin: .zero, size: frame.size),
                         anchor: NSPoint(x: anchor.x - frame.minX, y: anchor.y - frame.minY), sx: sx, sy: sy)
    super.init(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    title = "CMspark Mini 操作"
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    ignoresMouseEvents = true
    hidesOnDeactivate = false
    isReleasedWhenClosed = false
    level = orb.level
    collectionBehavior = orb.collectionBehavior
    contentView = canvas
  }

  override var canBecomeKey: Bool { true }

  override func sendEvent(_ event: NSEvent) {
    if event.type == .keyDown && event.keyCode == 53 { onCancel?(); return }
    super.sendEvent(event)
  }

  func aim(at screenPoint: NSPoint) -> String? {
    canvas.aim(at: convertPoint(fromScreen: screenPoint))
  }
}

final class MiniFanView: NSView {
  private struct Item {
    let id: String, label: String
    let center: NSPoint
    let chip: NSRect
    let slice: NSBezierPath
    let child: Bool
  }
  private let anchor: NSPoint
  private var items: [Item] = []
  private var branchOpen = false
  private var hot: String?
  private let mint = NSColor(srgbRed: 0.52, green: 0.93, blue: 0.75, alpha: 1)
  private let graphite = NSColor(srgbRed: 0.10, green: 0.14, blue: 0.16, alpha: 0.98)

  init(frame: NSRect, anchor: NSPoint, sx: CGFloat, sy: CGFloat) {
    self.anchor = anchor
    super.init(frame: frame)
    // Mirror the two levels into the open quadrant of the orb's display.
    func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
      NSPoint(x: max(36, min(frame.width - 36, anchor.x + x * sx)),
              y: max(15, min(frame.height - 15, anchor.y + y * sy)))
    }
    let shot = point(96, 64)
    func add(_ id: String, _ label: String, _ center: NSPoint, child: Bool = false) {
      let origin = child ? shot : anchor
      let angle = atan2(center.y - origin.y, center.x - origin.x) * 180 / .pi
      let inner: CGFloat = child ? 35 : 26
      let outer = hypot(center.x - origin.x, center.y - origin.y) + 12
      let spread: CGFloat = child ? 10 : 9
      let slice = NSBezierPath()
      slice.appendArc(withCenter: origin, radius: outer, startAngle: angle-spread, endAngle: angle+spread)
      slice.appendArc(withCenter: origin, radius: inner, startAngle: angle+spread, endAngle: angle-spread, clockwise: true)
      slice.close()
      let chip = NSRect(x: center.x-36, y: center.y-14, width: 72, height: 28)
      items.append(Item(id: id, label: label, center: center, chip: chip, slice: slice, child: child))
    }
    add("chat", "快速对话", point(105, 2))
    add("shot", sx > 0 ? "截图  ›" : "‹  截图", shot)
    add("search", "资料搜索", point(64, 119))
    add("meeting", "会议记录", point(28, 178))
    add("todo", "抽取待办", point(210, 12), child: true)
    add("ask", "询问图片", point(234, 65), child: true)
    add("ocr", "识别文字", point(216, 122), child: true)
    add("capture", "仅截图", point(160, 180), child: true)
  }

  required init?(coder: NSCoder) { fatalError("MiniFanView is created programmatically") }

  private var visibleItems: [Item] { items.filter { !$0.child || branchOpen } }

  func aim(at p: NSPoint) -> String? {
    let center = hypot(p.x-anchor.x, p.y-anchor.y) <= 25
    let visible = visibleItems.reversed()
    let hit = center ? nil : visible.first { $0.chip.contains(p) } ?? visible.first { $0.slice.contains(p) }
    let showChildren = hit?.id == "shot" || (branchOpen && !center && (hit == nil || hit?.child == true))
    if hit?.id != hot || showChildren != branchOpen {
      hot = hit?.id
      branchOpen = showChildren
      needsDisplay = true
    }
    return hot == "shot" ? nil : hot
  }

  override func draw(_ dirtyRect: NSRect) {
    for item in visibleItems {
      let selected = item.id == hot || (item.id == "shot" && branchOpen)
      (selected ? mint.withAlphaComponent(0.86) : graphite.withAlphaComponent(0.89)).setFill()
      item.slice.fill()
      NSColor.white.withAlphaComponent(0.20).setStroke()
      item.slice.lineWidth = 1
      item.slice.stroke()
    }
    for item in visibleItems {
      let selected = item.id == hot || (item.id == "shot" && branchOpen)
      let chip = NSBezierPath(roundedRect: item.chip, xRadius: 9, yRadius: 9)
      (selected ? mint : graphite).setFill()
      chip.fill()
      NSColor.white.withAlphaComponent(0.35).setStroke()
      chip.stroke()
      let style: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 12, weight: .semibold),
        .foregroundColor: selected ? graphite : NSColor.white
      ]
      let label = item.label as NSString
      let size = label.size(withAttributes: style)
      label.draw(at: NSPoint(x: item.center.x-size.width/2, y: item.center.y-size.height/2), withAttributes: style)
    }
  }
}
