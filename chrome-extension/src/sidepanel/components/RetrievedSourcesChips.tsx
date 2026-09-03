// 「本轮附带」知识芯片行（从 ChatView 抽出，供真实渲染测试）
// #273 Wave B（AC-18 / Gate9 MAJOR-1）：芯片口径 N=|S_post|（实际注入篇数）、
// M=|S_pre|（预预算候选数）——N/M 真渲染出来，不只是上线字段。

import { tokens } from "../ui/tokens"

export type RetrievedSourceChip = { id: string; title: string; group_label?: string }

export function RetrievedSourcesChips({
  sources,
  routing,
}: {
  sources: RetrievedSourceChip[]
  routing?: { groupmap: "injected" | "omitted"; m: number }
}) {
  if (!Array.isArray(sources) || sources.length === 0) return null
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }} aria-label="本轮附带">
      {/* 口径钉死：N=|S_post|（实际注入）；路由轮加 /M（M=|S_pre|，预预算候选） */}
      <span
        style={{ fontSize: 10, color: tokens.textMuted, alignSelf: "center" }}
        aria-label="本轮附带计数"
      >
        本轮附带 {sources.length}
        {routing ? `/${routing.m}` : ""}
      </span>
      {sources.map((s) => (
        <button
          key={s.id}
          type="button"
          title={s.group_label ? `${s.id} · 来源分组：${s.group_label}` : s.id}
          onClick={() => {
            window.dispatchEvent(new CustomEvent("cmspark:open-knowledge", { detail: { id: s.id } }))
          }}
          style={{
            border: `1px solid ${tokens.border}`,
            background: tokens.bgElevated,
            color: tokens.textSecondary,
            borderRadius: 10,
            fontSize: 11,
            padding: "2px 8px",
            cursor: "pointer",
          }}
        >
          本轮附带 · {s.title || s.id}
          {s.group_label ? `（${s.group_label}）` : ""}
        </button>
      ))}
      {/* #273 Wave B（AC-18）：分组概览两态都可识别——概览占预算少灌正文
          标「含分组概览」，没灌标「未含分组概览」；都不写成「按相关性」截断 */}
      {routing?.groupmap === "injected" ? (
        <span style={{ fontSize: 10, color: tokens.textMuted, alignSelf: "center" }}>含分组概览</span>
      ) : routing?.groupmap === "omitted" ? (
        <span style={{ fontSize: 10, color: tokens.textMuted, alignSelf: "center" }}>未含分组概览</span>
      ) : null}
    </div>
  )
}
