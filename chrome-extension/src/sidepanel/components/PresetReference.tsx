import type { AppPresetStatus } from "../types"
import { tokens } from "../ui/tokens"

// This view shows a bundled release witness, never an installed-file verdict.
// Older companions omit it; malformed/oversized fields stay bounded plain text.
export function PresetReference({ reference }: { reference: AppPresetStatus["reference"] }) {
  if (!reference || typeof reference !== "object") return null
  const text = (v: unknown, limit = 260) => typeof v === "string" && v ? v.slice(0, limit) : "尚未采集"
  const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/i.test(v) ? v : "尚未采集"
  const paths = Array.isArray(reference.typicalPaths) ? reference.typicalPaths.slice(0, 4) : []
  return (
    <details style={{ fontSize: 11, color: tokens.textSecondary, overflowWrap: "anywhere", margin: "0 0 8px" }}>
      <summary>指定发行版证书参考 · {text(reference.release, 40)}</summary>
      <div>{text(reference.architecture, 40)}；本机当前文件未核对。</div>
      <div>典型安装路径：{paths.map(p => text(p)).join("；") || "未知"}（自定义路径请手动添加）</div>
      <div>发行版叶证书 SHA-256（DER）：{digest(reference.expectedCertificateSHA256DER)}</div>
      <div>采样签名状态：{text(reference.observedSignatureStatus, 40)}；采样时间：{text(reference.collectedAtUTC, 40)}</div>
      <div>采样证书 Subject：{text(reference.observedSubject)}</div>
      <div>发行包 SHA256：{digest(reference.packageSHA256)}</div>
      <div>参考 EXE SHA256：{digest(reference.referenceEXESHA256)}</div>
      <div>官方发行包：{text(reference.artifactURL, 1024)}</div>
      <div>{text(reference.advice, 400)}</div>
    </details>
  )
}
