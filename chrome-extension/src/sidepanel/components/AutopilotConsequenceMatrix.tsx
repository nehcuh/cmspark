// Shared Autopilot consequence matrix — Settings arm sheet and Composer picker.
// Rows are AUTOPILOT_CONSEQUENCE_ROWS (SoT). Not a permission enum.

import type { CSSProperties } from "react"
import { AUTOPILOT_CONSEQUENCE_ROWS, UNATTENDED_MATRIX_FOOTNOTES } from "./autopilot-tier"
import { tokens } from "../ui/tokens"

export function AutopilotConsequenceMatrix({
  footnotes = true,
}: {
  footnotes?: boolean
}) {
  return (
    <div data-testid="autopilot-consequence-matrix" style={{ overflowX: "auto" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textSecondary, marginBottom: 4 }}>
        武装后仍会 / 不会跳过（后果矩阵）
      </div>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 10,
          color: tokens.textSecondary,
        }}
      >
        <thead>
          <tr style={{ background: tokens.bgMuted }}>
            <th style={th}>工具族</th>
            <th style={th}>网页</th>
            <th style={th}>全自动</th>
            <th style={th}>+协议</th>
            <th style={th}>值守</th>
          </tr>
        </thead>
        <tbody>
          {AUTOPILOT_CONSEQUENCE_ROWS.map((row) => (
            <tr key={row.family}>
              <td style={td}>{row.family}</td>
              <td style={td}>{row.browser}</td>
              <td style={td}>{row.full}</td>
              <td style={td}>{row.protocol}</td>
              <td style={td}>{row.unattended}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {footnotes ? (
        <div style={{ fontSize: 10, color: tokens.textMuted, marginTop: 4, lineHeight: 1.45 }}>
          {UNATTENDED_MATRIX_FOOTNOTES}
        </div>
      ) : null}
    </div>
  )
}

const cell: CSSProperties = {
  textAlign: "left",
  padding: "4px 6px",
  border: `1px solid ${tokens.borderStrong}`,
}
const th: CSSProperties = { ...cell, fontWeight: 600 }
const td: CSSProperties = cell
