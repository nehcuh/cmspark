import { normalizeDocumentWarning } from "../utils/document-warning"
import { tokens } from "../ui/tokens"

export function DocumentWarning({ warning, filename }: { warning?: string; filename?: string }) {
  const text = normalizeDocumentWarning(warning)
  if (!text) return null
  return <div role="status" style={{ fontSize: 11, color: tokens.warningText, marginTop: 6 }}>
    {filename ? `${filename.slice(0, 256)}：` : ""}{text}
  </div>
}
