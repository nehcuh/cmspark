// Outbound MCP L4+ grants — Settings UI (issue / copy once / revoke / require_grant).
// Design: docs/decisions/outbound-mcp-l4-grant-design-2026-08-04.md

import { useCallback, useEffect, useState, type CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import { SectionHeader } from "../ui/SectionHeader"

type GrantRow = {
  id: string
  label: string
  caller_id: string
  profile: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
}

type IssuedGrant = GrantRow & { token: string }

const TTL_OPTIONS: { label: string; ttl_ms: number }[] = [
  { label: "1 小时", ttl_ms: 60 * 60 * 1000 },
  { label: "24 小时", ttl_ms: 24 * 60 * 60 * 1000 },
  { label: "7 天", ttl_ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "30 天（默认）", ttl_ms: 30 * 24 * 60 * 60 * 1000 },
  { label: "不过期", ttl_ms: 0 },
]

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function OutboundMcpSettingsSection() {
  const [grants, setGrants] = useState<GrantRow[]>([])
  const [requireGrant, setRequireGrant] = useState(false)
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [label, setLabel] = useState("grok-build")
  const [callerId, setCallerId] = useState("grok-build")
  const [ttlMs, setTtlMs] = useState(30 * 24 * 60 * 60 * 1000)
  const [issued, setIssued] = useState<IssuedGrant | null>(null)
  const [copyOk, setCopyOk] = useState(false)

  const flash = (msg: string, ms = 4000) => {
    setStatus(msg)
    setTimeout(() => setStatus(""), ms)
  }

  const refresh = useCallback(() => {
    chrome.runtime.sendMessage({ type: "outbound_mcp.grants.list" })
  }, [])

  useEffect(() => {
    refresh()
    const handler = (msg: any) => {
      if (!msg?.type) return
      if (
        msg.type === "outbound_mcp.grants.list" ||
        msg.type === "outbound_mcp.grants.issued"
      ) {
        if (Array.isArray(msg.grants)) setGrants(msg.grants)
        if (typeof msg.require_grant === "boolean") setRequireGrant(msg.require_grant)
        setBusy(null)
        if (msg.type === "outbound_mcp.grants.issued" && msg.grant?.token) {
          setIssued(msg.grant as IssuedGrant)
          flash("已签发 — 请立即复制 token（只显示一次）", 6000)
        }
        if (msg.revoked_id) flash(`已撤销 ${msg.revoked_id}`, 2500)
        if (typeof msg.revoked_count === "number") {
          flash(`已撤销 ${msg.revoked_count} 个 grant`, 2500)
        }
      }
      if (msg.type === "error") {
        flash(msg.error || "操作失败", 5000)
        setBusy(null)
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [refresh])

  const activeGrants = grants.filter((g) => !g.revoked_at)
  const revokedGrants = grants.filter((g) => !!g.revoked_at)

  const issue = () => {
    const cid = callerId.trim()
    if (!cid) {
      flash("caller_id 必填", 3000)
      return
    }
    setBusy("issue")
    setIssued(null)
    chrome.runtime.sendMessage({
      type: "outbound_mcp.grants.issue",
      label: label.trim() || cid,
      caller_id: cid,
      ttl_ms: ttlMs,
    })
  }

  const revoke = (grant_id: string) => {
    if (!confirm(`撤销 grant ${grant_id}？相关 IDE 配置中的 token 将立即失效。`)) return
    setBusy(`revoke:${grant_id}`)
    chrome.runtime.sendMessage({ type: "outbound_mcp.grants.revoke", grant_id })
  }

  const revokeAll = () => {
    if (!confirm("撤销全部 Outbound grant？所有编程 Agent 需重新签发。")) return
    setBusy("revoke_all")
    chrome.runtime.sendMessage({ type: "outbound_mcp.grants.revoke_all" })
  }

  const toggleRequire = (next: boolean) => {
    setBusy("require")
    chrome.runtime.sendMessage({
      type: "outbound_mcp.set_require_grant",
      require_grant: next,
    })
  }

  const copyToken = async () => {
    if (!issued?.token) return
    try {
      await navigator.clipboard.writeText(issued.token)
      setCopyOk(true)
      setTimeout(() => setCopyOk(false), 2000)
    } catch {
      flash("复制失败，请手动选中 token", 3000)
    }
  }

  const copyEnvSnippet = async () => {
    if (!issued?.token) return
    const snippet =
      `CMSPARK_OUTBOUND_GRANT=${issued.token}\n` +
      `CMSPARK_OUTBOUND_CALLER_ID=${issued.caller_id}\n`
    try {
      await navigator.clipboard.writeText(snippet)
      setCopyOk(true)
      setTimeout(() => setCopyOk(false), 2000)
    } catch {
      flash("复制失败", 3000)
    }
  }

  return (
    <div>
      <SectionHeader title="Outbound MCP 调用方授权" />
      <div style={styles.helpText}>
        把浏览器能力导出给 Grok / Claude Code 等时使用。Grant 与扩展配对密钥（ws_secret）分离（ADR-022 L4+）。
        Token 只在签发时显示一次；请写入 IDE 的 <code>CMSPARK_OUTBOUND_GRANT</code>。
      </div>

      <div style={{ ...styles.row, marginTop: 10, alignItems: "flex-start" }}>
        <label style={{ ...styles.label, flex: 1, marginBottom: 0 }}>
          强制 require_grant
          <div style={{ ...styles.helpText, marginTop: 2 }}>
            开启后 loopback 只接受 grant，拒绝 ws_secret（P1 发货门；bake-off 可保持关闭）
          </div>
        </label>
        <button
          type="button"
          style={{
            ...styles.toggleBtn,
            background: requireGrant ? tokens.dangerSoft : tokens.bgMuted,
            color: requireGrant ? tokens.danger : tokens.textSecondary,
          }}
          disabled={busy === "require"}
          onClick={() => toggleRequire(!requireGrant)}
        >
          {requireGrant ? "已开启" : "关闭"}
        </button>
      </div>

      <div style={{ ...styles.field, marginTop: 12 }}>
        <label style={styles.label}>签发新 grant</label>
        <input
          style={styles.input}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="显示名称（如 grok-build）"
        />
        <input
          style={{ ...styles.input, marginTop: 6 }}
          value={callerId}
          onChange={(e) => setCallerId(e.target.value)}
          placeholder="caller_id（与 MCP 调用 body 绑定）"
          spellCheck={false}
        />
        <select
          style={{ ...styles.input, marginTop: 6 }}
          value={String(ttlMs)}
          onChange={(e) => setTtlMs(Number(e.target.value))}
        >
          {TTL_OPTIONS.map((o) => (
            <option key={o.ttl_ms} value={o.ttl_ms}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          style={{ ...styles.primaryBtn, marginTop: 8 }}
          disabled={busy === "issue"}
          onClick={issue}
        >
          {busy === "issue" ? "签发中…" : "签发 grant"}
        </button>
      </div>

      {issued?.token && (
        <div style={styles.issuedBox}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>
            一次性 token（关闭面板后无法再看）
          </div>
          <code style={styles.tokenCode}>{issued.token}</code>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button type="button" style={styles.toggleBtn} onClick={copyToken}>
              {copyOk ? "已复制" : "复制 token"}
            </button>
            <button type="button" style={styles.toggleBtn} onClick={copyEnvSnippet}>
              复制 env 片段
            </button>
            <button
              type="button"
              style={styles.secondaryBtn}
              onClick={() => setIssued(null)}
            >
              隐藏
            </button>
          </div>
          <div style={{ ...styles.helpText, marginTop: 6 }}>
            caller_id=<code>{issued.caller_id}</code>
            {issued.expires_at ? ` · 过期 ${fmtTime(issued.expires_at)}` : " · 不过期"}
          </div>
        </div>
      )}

      <div style={{ ...styles.row, marginTop: 14 }}>
        <div style={styles.label}>
          有效 grant（{activeGrants.length}）
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" style={styles.secondaryBtn} onClick={refresh} disabled={!!busy}>
            刷新
          </button>
          <button
            type="button"
            style={{ ...styles.secondaryBtn, color: tokens.danger }}
            onClick={revokeAll}
            disabled={!!busy || activeGrants.length === 0}
          >
            全部撤销
          </button>
        </div>
      </div>

      {activeGrants.length === 0 ? (
        <div style={{ ...styles.helpText, marginTop: 6 }}>尚无有效 grant</div>
      ) : (
        <ul style={styles.list}>
          {activeGrants.map((g) => (
            <li key={g.id} style={styles.listItem}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 12 }}>
                  {g.label}{" "}
                  <span style={{ fontWeight: 400, color: tokens.textSecondary }}>
                    ({g.caller_id})
                  </span>
                </div>
                <div style={styles.meta}>
                  {g.id.slice(0, 12)}… · 创建于 {fmtTime(g.created_at)}
                  {g.expires_at ? ` · 过期 ${fmtTime(g.expires_at)}` : " · 不过期"}
                  {g.last_used_at ? ` · 最近使用 ${fmtTime(g.last_used_at)}` : ""}
                </div>
              </div>
              <button
                type="button"
                style={{ ...styles.secondaryBtn, color: tokens.danger, flexShrink: 0 }}
                disabled={busy === `revoke:${g.id}`}
                onClick={() => revoke(g.id)}
              >
                撤销
              </button>
            </li>
          ))}
        </ul>
      )}

      {revokedGrants.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ ...styles.helpText, cursor: "pointer" }}>
            已撤销（{revokedGrants.length}）
          </summary>
          <ul style={styles.list}>
            {revokedGrants.slice(0, 10).map((g) => (
              <li key={g.id} style={{ ...styles.listItem, opacity: 0.7 }}>
                <div style={{ fontSize: 11 }}>
                  {g.label} / {g.caller_id} · 撤销于 {fmtTime(g.revoked_at)}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {status && (
        <div
          style={{
            ...styles.helpText,
            marginTop: 8,
            color: status.includes("失败") ? tokens.danger : tokens.success,
          }}
        >
          {status}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  field: { marginBottom: 8 },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 4,
    color: tokens.text,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.border}`,
    background: tokens.bg,
    color: tokens.text,
  },
  helpText: {
    fontSize: 11,
    color: tokens.textSecondary,
    lineHeight: 1.45,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  toggleBtn: {
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
    cursor: "pointer",
    color: tokens.text,
  },
  primaryBtn: {
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: 6,
    border: "none",
    background: tokens.accent,
    color: tokens.userBubbleText,
    cursor: "pointer",
    fontWeight: 600,
  },
  secondaryBtn: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.border}`,
    background: "transparent",
    cursor: "pointer",
    color: tokens.text,
  },
  issuedBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    border: `1px solid ${tokens.accent}`,
    background: tokens.accentSoft || tokens.bgMuted,
  },
  tokenCode: {
    display: "block",
    fontSize: 10,
    wordBreak: "break-all",
    lineHeight: 1.4,
    padding: 6,
    borderRadius: 4,
    background: tokens.bg,
    border: `1px solid ${tokens.border}`,
  },
  list: {
    listStyle: "none",
    margin: "8px 0 0",
    padding: 0,
  },
  listItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 0",
    borderBottom: `1px solid ${tokens.border}`,
  },
  meta: {
    fontSize: 10,
    color: tokens.textSecondary,
    marginTop: 2,
  },
}
