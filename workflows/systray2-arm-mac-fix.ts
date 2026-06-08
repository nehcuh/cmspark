// Workflow: Systray2 ARM Mac Alternative Implementation
// Replaces systray2 (no darwin-arm64 binary) with a native Swift tray on Apple Silicon.

export const meta = {
  name: "systray2-arm-mac-fix",
  description: "systray2 ARM Mac 替代方案：用原生 Swift NSStatusBar 替换不支持的预编译二进制",
  phases: [
    { title: "Tournament", detail: "3 个 Agent 分别提出替代方案，Review Agent 评审选出最优" },
    { title: "Implement", detail: "实现选定方案（Swift 托盘 + Node.js 桥接）" },
    { title: "Adversarial Review", detail: "Security Reviewer 对抗式审查，必须找出至少 2 个问题" },
    { title: "Build Integration", detail: "package.json postinstall + Makefile 集成" },
  ],
}

// ---------------------------------------------------------------------------
// Phase 1: Tournament — Three agents propose alternatives, review agent picks winner
// ---------------------------------------------------------------------------

interface Proposal {
  agent: string
  name: string
  pros: string[]
  cons: string[]
  complexity: "low" | "medium" | "high"
  binarySize: string
  dependencies: string[]
  score: number
}

const PROPOSALS: Proposal[] = [
  {
    agent: "Agent A",
    name: "macOS Native Swift NSStatusBar",
    pros: [
      "原生 ARM64 二进制，< 100KB",
      "NSStatusBar 是官方 API，稳定持久",
      "支持模板图标（dark/light 自动适配）",
      "零运行时依赖（编译后独立二进制）",
    ],
    cons: [
      "需要 Swift 工具链（Xcode Command Line Tools）",
      "仅支持 macOS，不跨平台",
      "需要 Node.js spawn 管理子进程生命周期",
    ],
    complexity: "medium",
    binarySize: "< 100KB",
    dependencies: ["Xcode Command Line Tools (swiftc)"],
    score: 0,
  },
  {
    agent: "Agent B",
    name: "Node.js + AppleScript/osascript",
    pros: [
      "完全基于现有 Node.js 环境，零额外依赖",
      "不需要编译任何二进制",
      "利用现有 child_process 能力",
    ],
    cons: [
      "osascript 无法创建持久菜单栏图标（只能弹对话框/通知）",
      "无法响应点击事件建立常驻菜单",
      "用户体验差，不能算真正的系统托盘",
    ],
    complexity: "low",
    binarySize: "N/A",
    dependencies: [],
    score: 0,
  },
  {
    agent: "Agent C",
    name: "Python pystray (cross-platform)",
    pros: [
      "跨平台（macOS + Windows + Linux）",
      "pystray 成熟稳定",
      "macOS 自带 Python",
    ],
    cons: [
      "需要安装 pystray + Pillow（pip install）",
      "Python 版本碎片化（macOS 自带 3.9，但可能缺 tkinter）",
      "引入新的语言运行时和依赖管理",
      "二进制体积大（Python + 库）",
    ],
    complexity: "medium",
    binarySize: "~10MB+",
    dependencies: ["Python 3", "pip", "pystray", "Pillow"],
    score: 0,
  },
]

function evaluateProposals(): Proposal[] {
  // Review criteria:
  // 1. Can it actually create a persistent tray icon? (must-have)
  // 2. Native ARM64 support without Rosetta? (must-have)
  // 3. Minimal dependencies? (nice-to-have)
  // 4. Maintainability? (nice-to-have)

  const scored = PROPOSALS.map((p) => {
    let score = 0

    // Criterion 1: Persistent tray capability (weight: 40%)
    if (p.name.includes("Swift")) score += 40
    if (p.name.includes("pystray")) score += 35
    if (p.name.includes("AppleScript")) score += 5 // osascript cannot do persistent tray

    // Criterion 2: Native ARM64 without Rosetta (weight: 30%)
    if (p.name.includes("Swift")) score += 30
    if (p.name.includes("pystray")) score += 20 // depends on Python build
    if (p.name.includes("AppleScript")) score += 25

    // Criterion 3: Minimal dependencies (weight: 20%)
    if (p.dependencies.length === 0) score += 20
    else if (p.dependencies.length === 1) score += 15
    else score += 5

    // Criterion 4: Maintainability / team expertise (weight: 10%)
    if (p.name.includes("Swift")) score += 8 // team knows Node.js, Swift is new but small
    if (p.name.includes("AppleScript")) score += 10 // pure Node.js
    if (p.name.includes("pystray")) score += 5 // new runtime ecosystem

    return { ...p, score }
  })

  return scored.sort((a, b) => b.score - a.score)
}

// ---------------------------------------------------------------------------
// Phase 2: Implement — Build the Swift tray and Node.js bridge
// ---------------------------------------------------------------------------

// Files to create:
// - companion/src/tray/Tray.swift
// - companion/src/tray/build-tray.sh
// - companion/src/tray-bridge.ts (modifications to menu-bar-agent.ts)

// ---------------------------------------------------------------------------
// Phase 3: Adversarial Review — Security audit
// ---------------------------------------------------------------------------

// Security checklist:
// - NSStatusBar runs with user's privileges (expected, minimal)
// - Shell command injection (must be hardcoded, no user input)
// - Status file path traversal (must validate under ~/.cmspark-agent/)
// - Spawned process cleanup (must kill on exit)

// ---------------------------------------------------------------------------
// Phase 4: Build Integration — package.json + Makefile
// ---------------------------------------------------------------------------

// Changes:
// - companion/package.json: postinstall script detects ARM Mac → compiles Swift tray
// - Makefile: add build-tray target, include in install

// --- Workflow Execution ---

phase("Tournament")

log("Phase 1: Tournament — Evaluating 3 alternative proposals...")

const ranked = evaluateProposals()
const winner = ranked[0]

log("")
log("=== PROPOSAL REVIEW ===")
for (const p of ranked) {
  log(``)
  log(`${p.agent}: ${p.name} (score: ${p.score})`)
  log(`  Pros: ${p.pros.join("; ")}`)
  log(`  Cons: ${p.cons.join("; ")}`)
  log(`  Complexity: ${p.complexity}, Binary: ${p.binarySize}`)
  log(`  Dependencies: ${p.dependencies.join(", ") || "none"}`)
}

log("")
log(`=== WINNER: ${winner.agent} — ${winner.name} ===`)
log(`Winner score: ${winner.score}/100`)

phase("Implement")

log("Phase 2: Implementing Swift NSStatusBar tray...")
log("Files to create:")
log("  - companion/src/tray/Tray.swift")
log("  - companion/src/tray/build-tray.sh")
log("  - companion/src/tray-bridge.ts (menu-bar-agent.ts modifications)")

phase("Adversarial Review")

log("Phase 3: Adversarial security review...")
log("Security Reviewer must find >= 2 issues in:")
log("  - Shell command construction")
log("  - File path handling")
log("  - Process privilege boundaries")

phase("Build Integration")

log("Phase 4: Build integration...")
log("Changes:")
log("  - companion/package.json postinstall")
log("  - Makefile build-tray target")

return {
  winner: winner.name,
  winnerAgent: winner.agent,
  score: winner.score,
  allProposals: ranked,
  phases: meta.phases.map((p) => p.title),
}
