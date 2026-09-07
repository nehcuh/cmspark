// #419 — outbound grant profiles for the Settings UI. Values must stay in
// lock-step with companion/src/outbound-mcp/outbound-grants.ts
// (OUTBOUND_GRANT_PROFILES). This module is intentionally pure (no React) so
// it can be unit-tested with node:test.

export const OUTBOUND_L1_DEFAULT_PROFILE = "outbound_l1_default"
export const OUTBOUND_L1_INTERACT_PROFILE = "outbound_l1_interact"
export const OUTBOUND_CONTEXT_PROFILE = "outbound_context_v1"

export type OutboundGrantProfile = typeof OUTBOUND_L1_DEFAULT_PROFILE | typeof OUTBOUND_L1_INTERACT_PROFILE | typeof OUTBOUND_CONTEXT_PROFILE

export const OUTBOUND_GRANT_PROFILE_OPTIONS: Array<{
  value: OutboundGrantProfile
  label: string
  hint: string
}> = [
  {
    value: OUTBOUND_L1_DEFAULT_PROFILE,
    label: "默认档（8 工具 + meta）",
    hint: "list_tabs / navigate / click / type / get_page_text 等基础面",
  },
  {
    value: OUTBOUND_L1_INTERACT_PROFILE,
    label: "交互档 outbound_l1_interact",
    hint: "默认 8 + 滚动/元素检查/按键/表单/建 tab/get_page_html/analyze_image",
  },
  {
    value: OUTBOUND_CONTEXT_PROFILE,
    label: "站点上下文档 outbound_context_v1",
    hint: "默认 8 工具 + site_context；所选知识与页面内容分别授权",
  },
]

export const OUTBOUND_DEFAULT_PROFILE_FOR_UI: OutboundGrantProfile = OUTBOUND_L1_DEFAULT_PROFILE

export function isOutboundGrantProfileForUi(v: unknown): v is OutboundGrantProfile {
  return v === OUTBOUND_L1_DEFAULT_PROFILE || v === OUTBOUND_L1_INTERACT_PROFILE || v === OUTBOUND_CONTEXT_PROFILE
}
