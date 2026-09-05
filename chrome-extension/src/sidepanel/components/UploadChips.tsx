// Composer upload chips — cut out of App.tsx InputArea in #321 PR-7.
// Pure move: file-error / dest-ack banners + image/doc chips. No ingest logic.

import { useEffect, useMemo, useState } from "react"
import type { FileAttachment } from "../types"
import { tokens } from "../ui/tokens"
import { isAllowlistedImageMime } from "../utils/image-compose"

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function blobUrlFromB64(b64: string, mime: string): string {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }))
  } catch {
    return ""
  }
}

export function ComposerImageChip({
  file,
  destHost,
  onRemove,
}: {
  file: FileAttachment
  destHost: string
  onRemove: () => void
}) {
  const [broken, setBroken] = useState(false)
  const url = useMemo(() => blobUrlFromB64(file.content, file.type), [file.content, file.type])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "2px 8px 2px 2px", background: tokens.accentSoft, borderRadius: tokens.radiusPill,
      fontSize: 11, color: tokens.accentText, maxWidth: 220,
    }}>
      {url && !broken ? (
        <img
          src={url}
          alt={file.name}
          width={48}
          height={48}
          onError={() => setBroken(true)}
          style={{
            width: 48, height: 48, objectFit: "cover", borderRadius: tokens.radiusSm,
            border: `1px solid ${tokens.border}`, background: tokens.bgMuted, display: "block", flexShrink: 0,
          }}
        />
      ) : (
        <span style={{
          width: 48, height: 48, borderRadius: tokens.radiusSm, border: `1px solid ${tokens.border}`,
          background: tokens.bgMuted, display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, color: tokens.textMuted, flexShrink: 0,
        }}>
          图
        </span>
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {file.name} ({formatFileSize(file.size)})
        {file.compressed ? " · 已压缩" : ""}
        {` → ${destHost}`}
      </span>
      <span role="button" onClick={onRemove} style={{ cursor: "pointer", marginLeft: 2, fontWeight: "bold", flexShrink: 0 }}>
        {"\u00d7"}
      </span>
    </span>
  )
}

export type UploadChipsProps = {
  fileError: string
  onDismissError: () => void
  destAck: string
  onDismissAck: () => void
  selectedFiles: FileAttachment[]
  destHost: string
  onRemove: (idx: number) => void
}

export function UploadChips({
  fileError,
  onDismissError,
  destAck,
  onDismissAck,
  selectedFiles,
  destHost,
  onRemove,
}: UploadChipsProps) {
  return (
    <>
      {fileError && (
        <div style={{
          padding: "4px 12px", background: tokens.warningSoft, color: tokens.warning,
          fontSize: 11, display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>{fileError}</span>
          <span role="button" style={{ cursor: "pointer", fontWeight: "bold" }} onClick={onDismissError}>×</span>
        </div>
      )}
      {destAck && (
        <div style={{
          padding: "4px 12px", color: tokens.textSecondary,
          fontSize: 11, display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>{destAck}</span>
          <span role="button" style={{ cursor: "pointer", fontWeight: "bold" }} onClick={onDismissAck}>×</span>
        </div>
      )}
      {selectedFiles.length > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 4,
          padding: "8px 12px 0",
        }}>
          {selectedFiles.map((file, idx) => (
            isAllowlistedImageMime(file.type) ? (
              <ComposerImageChip
                key={`${file.name}-${idx}`}
                file={file}
                destHost={destHost}
                onRemove={() => onRemove(idx)}
              />
            ) : (
            <span key={idx} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 8px", background: tokens.accentSoft, borderRadius: tokens.radiusPill,
              fontSize: 11, color: tokens.accentText, maxWidth: 200,
            }}>
              <span style={{
                overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap", minWidth: 0,
              }}>
                {file.name} ({formatFileSize(file.size)})
              </span>
              <span
                role="button"
                onClick={() => onRemove(idx)}
                style={{ cursor: "pointer", marginLeft: 2, fontWeight: "bold", flexShrink: 0 }}
              >
                {"\u00d7"}
              </span>
            </span>
            )
          ))}
        </div>
      )}
    </>
  )
}
