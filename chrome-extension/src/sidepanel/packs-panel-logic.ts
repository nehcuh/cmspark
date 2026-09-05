// #369: 「场景与专家」面板纯逻辑 — 分段 / 专家卡动作 / 空态与 CTA 文案。
// 抽成纯函数以便 node:test 断言（UI 不挂 React）。

/** 面板分段：场景 = kind≠expert；专家 = kind=expert 的 pack。 */
export type PackSegment = "scene" | "expert"

export type SegmentPackLike = {
  id: string
  kind?: "mission" | "expert"
  origin?: "builtin" | "installed" | "user"
  editable?: boolean
  disabled?: boolean
}

export function isExpertPack(p: Pick<SegmentPackLike, "kind">): boolean {
  return p.kind === "expert"
}

export function segmentPacks<T extends Pick<SegmentPackLike, "kind">>(
  packs: T[],
): { scenes: T[]; experts: T[] } {
  const scenes: T[] = []
  const experts: T[] = []
  for (const p of packs) {
    if (isExpertPack(p)) experts.push(p)
    else scenes.push(p)
  }
  return { scenes, experts }
}

export function isUserPack(p: Pick<SegmentPackLike, "origin" | "editable">): boolean {
  return p.editable === true || p.origin === "user"
}

/**
 * 专家卡动作集。纪律：
 * - builtin/installed 只读 — 永远不出 编辑/删除（可 查看 只读、另存为我的）。
 * - 停用后不出 派出/套用（propose/spawn 已被 companion 拒绝，UI 不误导）；
 *   只读编辑器仍可打开（view）。
 */
export type ExpertCardAction =
  | "team" // 主 CTA：派到当前任务（组队）— #371 未落地，UI 渲染为 disabled+即将推出
  | "apply" // 次 CTA：套到本对话
  | "view" // 只读查看（明文 prompt）
  | "edit"
  | "clone" // 另存为我的
  | "disable"
  | "enable"
  | "delete"

export function expertCardActions(p: SegmentPackLike): ExpertCardAction[] {
  const user = isUserPack(p)
  if (p.disabled === true) {
    // 停用：编辑器只读可打开；用户专家可 启用/删除；builtin 仅可查看
    return user ? ["view", "enable", "delete"] : ["view"]
  }
  if (!user) {
    return ["team", "apply", "view", "clone"]
  }
  return ["team", "apply", "view", "edit", "disable", "delete"]
}

// --- 文案 SoT（测试断言锚点） ---

export const PANEL_TITLE = "场景与专家"

/** 空态（#356 教训：空态必须给下一步，不留死屏）。 */
export const EXPERT_EMPTY_COPY =
  "还没有可调度的专家。专家是带角色 prompt 与收窄工具面的角色模板：" +
  "点「+ 新建专家」从零创建，或在任一模板上「另存为我的」定制。"

export const EXPERT_SEGMENT_HINT =
  "专家可被派到任务（组队，即将推出）或套用到本对话；工具面展示的是 HARD_DENY 后计算出的有效面，不是愿望清单。"

/** 主 CTA = 组队/派到当前任务；#371 未落地 — 诚实做法：渲染但禁用，明示即将推出。 */
export const EXPERT_PRIMARY_CTA_LABEL = "派到当前任务（组队）"
export const EXPERT_PRIMARY_CTA_DISABLED_HINT =
  "组队派出即将推出（#371 落地后开放）；现在可用「套到本对话」让专家接管当前对话"
/** 次 CTA = 套到本对话（与主 CTA 文案明确区分，防心智分叉误点）。 */
export const EXPERT_SECONDARY_CTA_LABEL = "套到本对话"

/** 有效工具面行前缀：明示是计算结果。 */
export const EXPERT_EFFECTIVE_TOOLS_PREFIX = "有效工具面（本对话 ∩ 允许，剔除高危禁项）"

export function formatEffectiveToolsLine(tools: string[], max = 8): string {
  if (tools.length === 0) return `${EXPERT_EFFECTIVE_TOOLS_PREFIX}：（空 — 收窄后无可用工具，请检查允许列表）`
  const shown = tools.slice(0, max).join("、")
  const more = tools.length > max ? ` 等 ${tools.length} 个` : ""
  return `${EXPERT_EFFECTIVE_TOOLS_PREFIX}：${shown}${more}`
}

export function formatUsageLine(count: number, lastAt: string | null): string | null {
  if (count <= 0) return null
  const day = lastAt ? lastAt.slice(0, 10) : null
  return `已被派出 ${count} 次${day ? `（最近 ${day}）` : ""}`
}
